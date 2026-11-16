package agenda

import (
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func setupTestDB(t *testing.T) (*AgendaService, *DB) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open memory db: %v", err)
	}

	d := &DB{db: db}
	if err := d.migrate(); err != nil {
		t.Fatalf("failed to init schema: %v", err)
	}

	svc := &AgendaService{db: d}
	return svc, d
}

func TestPinAndBatchOperations(t *testing.T) {
	svc, _ := setupTestDB(t)

	r1, err := svc.AddReminder(CreateReminderRequest{
		Title:       "常规事项 A",
		ScheduledAt: time.Now().Add(2 * time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("failed to add r1: %v", err)
	}

	r2, err := svc.AddReminder(CreateReminderRequest{
		Title:       "常规事项 B",
		ScheduledAt: time.Now().Add(3 * time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("failed to add r2: %v", err)
	}

	// 1. Toggle pin on r2
	pinnedR2, err := svc.TogglePinReminder(r2.ID)
	if err != nil {
		t.Fatalf("TogglePinReminder failed: %v", err)
	}
	if !pinnedR2.IsPinned {
		t.Errorf("expected r2 to be pinned")
	}

	// Reminders list should have pinned items first
	all, err := svc.GetReminders()
	if err != nil {
		t.Fatalf("GetReminders failed: %v", err)
	}
	if len(all) < 2 {
		t.Fatalf("expected at least 2 reminders, got %d", len(all))
	}
	if all[0].ID != r2.ID {
		t.Errorf("expected pinned r2 to be first in list, got %s", all[0].Title)
	}

	// 2. Batch Set Pinned
	err = svc.BatchSetPinned([]string{r1.ID, r2.ID}, false)
	if err != nil {
		t.Fatalf("BatchSetPinned failed: %v", err)
	}
	allAfter, _ := svc.GetReminders()
	for _, it := range allAfter {
		if it.IsPinned {
			t.Errorf("expected %s to not be pinned", it.Title)
		}
	}

	// 3. Batch Add Tag
	err = svc.BatchAddTag([]string{r1.ID, r2.ID}, "项目A")
	if err != nil {
		t.Fatalf("BatchAddTag failed: %v", err)
	}
	r1Updated, _ := svc.GetReminder(r1.ID)
	if !strings.Contains(r1Updated.Tags, "项目A") {
		t.Errorf("expected r1 to have tag '项目A', got %s", r1Updated.Tags)
	}
}

func TestCheckTimeConflicts(t *testing.T) {
	svc, _ := setupTestDB(t)

	now := time.Now().Truncate(time.Minute)
	// Reminder 1: 10:00 to 11:00 (60 mins)
	time1 := now.Add(2 * time.Hour).Format(time.RFC3339)
	r1, err := svc.AddReminder(CreateReminderRequest{
		Title:           "产品周会",
		ScheduledAt:     time1,
		DurationMinutes: 60,
	})
	if err != nil {
		t.Fatalf("failed to add r1: %v", err)
	}

	// Conflict test 1: overlaps with 10:00 - 11:00 (starts at 10:30)
	conflictTime := now.Add(2*time.Hour + 30*time.Minute).Format(time.RFC3339)
	conflicts, err := svc.CheckTimeConflicts(conflictTime, 30, "")
	if err != nil {
		t.Fatalf("CheckTimeConflicts failed: %v", err)
	}
	if len(conflicts) != 1 || conflicts[0].ID != r1.ID {
		t.Fatalf("expected 1 conflict with r1, got %d", len(conflicts))
	}

	// Conflict test 2: exclude r1 itself
	conflictsExclude, err := svc.CheckTimeConflicts(conflictTime, 30, r1.ID)
	if err != nil {
		t.Fatalf("CheckTimeConflicts failed: %v", err)
	}
	if len(conflictsExclude) != 0 {
		t.Errorf("expected 0 conflicts when excluding r1, got %d", len(conflictsExclude))
	}

	// Conflict test 3: no overlap (starts at 11:30)
	freeTime := now.Add(3*time.Hour + 30*time.Minute).Format(time.RFC3339)
	conflictsFree, err := svc.CheckTimeConflicts(freeTime, 30, "")
	if err != nil {
		t.Fatalf("CheckTimeConflicts failed: %v", err)
	}
	if len(conflictsFree) != 0 {
		t.Errorf("expected 0 conflicts, got %d", len(conflictsFree))
	}
}

func TestAIChatHistoryAndPolish(t *testing.T) {
	svc, _ := setupTestDB(t)

	// Test chat history
	err := svc.SaveAIChatMessage("msg-1", "user", "帮我安排明天下午开会", "")
	if err != nil {
		t.Fatalf("SaveAIChatMessage failed: %v", err)
	}
	err = svc.SaveAIChatMessage("msg-2", "assistant", "好的，已为您安排明天 14:00 开会", `[{"title":"开会"}]`)
	if err != nil {
		t.Fatalf("SaveAIChatMessage failed: %v", err)
	}

	history, err := svc.GetAIChatHistory()
	if err != nil {
		t.Fatalf("GetAIChatHistory failed: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(history))
	}
	if history[0].Role != "user" || history[1].Role != "assistant" {
		t.Errorf("unexpected roles: %s, %s", history[0].Role, history[1].Role)
	}

	err = svc.ClearAIChatHistory()
	if err != nil {
		t.Fatalf("ClearAIChatHistory failed: %v", err)
	}
	emptyHistory, _ := svc.GetAIChatHistory()
	if len(emptyHistory) != 0 {
		t.Errorf("expected 0 messages after clear, got %d", len(emptyHistory))
	}

	// Test AI Polish offline fallback
	rawNote := `play.uzuy.org fun.uzuy.org 这两域名限流了
- [ ] 暂停投放
- [ ] 核对上游风控
- [ ] 联系商务恢复`
	polish, err := svc.PolishReminderWithAI(rawNote)
	if err != nil {
		t.Fatalf("PolishReminderWithAI failed: %v", err)
	}
	if polish.Title == "" {
		t.Errorf("expected non-empty title")
	}
	if len(polish.Subtasks) != 3 {
		t.Errorf("expected 3 subtasks, got %d", len(polish.Subtasks))
	}
	if len(polish.Tags) == 0 {
		t.Errorf("expected at least 1 tag, got 0")
	}
}

func TestImportJSONBackup(t *testing.T) {
	svc, _ := setupTestDB(t)

	jsonStr := `[
		{"title": "备份事项1", "scheduled_at": "2026-11-20T10:00:00Z", "priority": "p0"},
		{"title": "备份事项2", "scheduled_at": "2026-11-20T14:00:00Z", "priority": "p1"}
	]`

	count, err := svc.ImportJSONBackup(jsonStr)
	if err != nil {
		t.Fatalf("ImportJSONBackup failed: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 imported, got %d", count)
	}

	all, _ := svc.GetReminders()
	if len(all) != 2 {
		t.Errorf("expected 2 reminders in db, got %d", len(all))
	}
}

func TestOverdueAndTagSummary(t *testing.T) {
	svc, d := setupTestDB(t)

	// Past active reminder inserted directly
	pastTime := time.Now().Add(-1 * time.Hour).Format(time.RFC3339)
	_, err := d.db.Exec(`
		INSERT INTO reminders (id, title, scheduled_at, status, tags, created_at, updated_at)
		VALUES (?, ?, ?, 'active', ?, ?, ?)
	`, "r-overdue-1", "已逾期测试任务", pastTime, "紧急,风控", pastTime, pastTime)
	if err != nil {
		t.Fatalf("insert failed: %v", err)
	}

	futureTime := time.Now().Add(2 * time.Hour).Format(time.RFC3339)
	_, _ = d.db.Exec(`
		INSERT INTO reminders (id, title, scheduled_at, status, tags, created_at, updated_at)
		VALUES (?, ?, ?, 'active', ?, ?, ?)
	`, "r-future-1", "未来任务", futureTime, "风控,工作", futureTime, futureTime)

	// 1. Check Overdue
	overdue, err := svc.GetOverdueReminders()
	if err != nil {
		t.Fatalf("GetOverdueReminders failed: %v", err)
	}
	if len(overdue) != 1 || overdue[0].ID != "r-overdue-1" {
		t.Fatalf("expected 1 overdue reminder r-overdue-1, got %d", len(overdue))
	}

	// 2. Check Tags Summary
	summary, err := svc.GetTagsSummary()
	if err != nil {
		t.Fatalf("GetTagsSummary failed: %v", err)
	}
	if summary["风控"] != 2 {
		t.Errorf("expected tag '风控' count 2, got %d", summary["风控"])
	}
	if summary["紧急"] != 1 {
		t.Errorf("expected tag '紧急' count 1, got %d", summary["紧急"])
	}

	// 3. Check Batch Set Subtasks
	err = svc.BatchSetSubtasks([]string{"r-overdue-1"}, `[{"title":"第一步","done":true}]`)
	if err != nil {
		t.Fatalf("BatchSetSubtasks failed: %v", err)
	}
	r, _ := svc.GetReminder("r-overdue-1")
	if !strings.Contains(r.Subtasks, "第一步") {
		t.Errorf("expected subtasks to contain '第一步', got %s", r.Subtasks)
	}
}

func TestCSVExportImportAndMaintenance(t *testing.T) {
	svc, _ := setupTestDB(t)

	// 1. Add sample reminders
	future1 := time.Now().Add(2 * time.Hour).Format(time.RFC3339)
	future2 := time.Now().Add(4 * time.Hour).Format(time.RFC3339)
	_, _ = svc.AddReminder(CreateReminderRequest{
		Title:           "项目上线发布",
		ScheduledAt:     future1,
		Priority:        "p0",
		Tags:            "上线,DevOps",
		DurationMinutes: 45,
		Notes:           "发布前核对 checklist",
	})
	_, _ = svc.AddReminder(CreateReminderRequest{
		Title:           "晚间复盘会议",
		ScheduledAt:     future2,
		Priority:        "p1",
		Tags:            "会议",
		DurationMinutes: 30,
	})

	// 2. Export CSV
	csvStr, err := svc.ExportCSV()
	if err != nil {
		t.Fatalf("ExportCSV failed: %v", err)
	}
	if !strings.Contains(csvStr, "项目上线发布") || !strings.Contains(csvStr, "晚间复盘会议") {
		t.Errorf("expected CSV to contain reminder titles, got:\n%s", csvStr)
	}

	// 3. Import CSV into new service
	svc2, _ := setupTestDB(t)
	count, err := svc2.ImportCSVContent(csvStr)
	if err != nil {
		t.Fatalf("ImportCSVContent failed: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 reminders imported, got %d", count)
	}
	remList, _ := svc2.GetReminders()
	if len(remList) != 2 {
		t.Errorf("expected 2 reminders in svc2, got %d", len(remList))
	}

	// 4. Test Vacuum and Integrity
	if err := svc2.VacuumDatabase(); err != nil {
		t.Errorf("VacuumDatabase failed: %v", err)
	}
	integrity, err := svc2.CheckDatabaseIntegrity()
	if err != nil || integrity != "ok" {
		t.Errorf("CheckDatabaseIntegrity expected 'ok', got %q (err=%v)", integrity, err)
	}

	// 5. Test GetDatabaseStats
	stats, err := svc2.GetDatabaseStats()
	if err != nil {
		t.Fatalf("GetDatabaseStats failed: %v", err)
	}
	if stats["total"] != 2 {
		t.Errorf("expected total 2, got %v", stats["total"])
	}
}

func TestAutoResolveConflict(t *testing.T) {
	svc, _ := setupTestDB(t)

	now := time.Now().Truncate(time.Minute)
	time1 := now.Add(2 * time.Hour).Format(time.RFC3339)
	r1, err := svc.AddReminder(CreateReminderRequest{
		Title:           "重要发布",
		ScheduledAt:     time1,
		DurationMinutes: 60,
	})
	if err != nil {
		t.Fatalf("failed to add r1: %v", err)
	}

	// r2 overlaps with r1 (starts at time1 + 15m)
	time2 := now.Add(2*time.Hour + 15*time.Minute).Format(time.RFC3339)
	r2, err := svc.AddReminder(CreateReminderRequest{
		Title:           "团队同步会",
		ScheduledAt:     time2,
		DurationMinutes: 30,
	})
	if err != nil {
		t.Fatalf("failed to add r2: %v", err)
	}

	// Resolve conflict for r2: should shift to end of r1 (now + 3h) + 10m
	resolved, err := svc.AutoResolveConflict(r2.ID)
	if err != nil {
		t.Fatalf("AutoResolveConflict failed: %v", err)
	}

	resolvedTime, _ := parseFlexibleTime(resolved.ScheduledAt)
	r1Time, _ := parseFlexibleTime(r1.ScheduledAt)
	r1End := r1Time.Add(time.Duration(r1.DurationMinutes) * time.Minute)

	if !resolvedTime.After(r1End) {
		t.Errorf("expected resolved time to be after r1 end (%v), got: %v", r1End, resolvedTime)
	}
}

func TestICSLosslessRoundtripWithAlarmAndFolding(t *testing.T) {
	future := time.Now().Add(4 * time.Hour).UTC().Truncate(time.Second)
	input := []Reminder{
		{
			ID:              "ics-test-1",
			Title:           "发布评审,含逗号;分号",
			ScheduledAt:     future.Format(time.RFC3339),
			DurationMinutes: 45,
			LeadMinutes:     15,
			Notes:           "第一行重要备注\n第二行补充",
			Priority:        "p0",
			Tags:            "工程,发布",
			RepeatRule:      "FREQ=WEEKLY;BYDAY=MO",
		},
	}

	icsContent := ExportICS(input)
	if !strings.Contains(icsContent, "PRIORITY:1") || !strings.Contains(icsContent, "CATEGORIES:工程,发布") {
		t.Fatalf("expected PRIORITY:1 and CATEGORIES in ICS, got:\n%s", icsContent)
	}

	// Inject RFC 5545 folded line and a CANCELLED event
	icsWithFold := strings.Replace(icsContent, "END:VCALENDAR",
		"BEGIN:VEVENT\r\nUID:cancelled-1\r\nSTATUS:CANCELLED\r\nSUMMARY:应跳过\r\nDTSTART:20261115T090000Z\r\nEND:VEVENT\r\nEND:VCALENDAR", 1)
	icsWithFold = strings.Replace(icsWithFold, "SUMMARY:发布评审", "SUMMARY:发布\r\n 评审", 1)

	events, err := ImportICS(icsWithFold)
	if err != nil {
		t.Fatalf("ImportICS failed: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 active event (skipping cancelled), got %d", len(events))
	}
	ev := events[0]
	if ev.Title != "发布评审,含逗号;分号" {
		t.Errorf("expected unfolded/unescaped title, got %q", ev.Title)
	}
	if !strings.Contains(ev.Notes, "第一行重要备注") || strings.Contains(ev.Notes, "提前提醒:") {
		t.Errorf("expected VALARM not to overwrite Notes, got %q", ev.Notes)
	}
	if ev.LeadMinutes != 15 {
		t.Errorf("expected LeadMinutes=15 restored from VALARM TRIGGER, got %d", ev.LeadMinutes)
	}
	if ev.Priority != "p0" {
		t.Errorf("expected Priority=p0, got %q", ev.Priority)
	}
	if ev.Tags != "工程,发布" {
		t.Errorf("expected Tags='工程,发布', got %q", ev.Tags)
	}
	if ev.DurationMinutes != 45 {
		t.Errorf("expected DurationMinutes=45, got %d", ev.DurationMinutes)
	}
}

func TestCSVHeaderlessAndPriorityNormalization(t *testing.T) {
	future := time.Now().Add(3 * time.Hour).Format(time.RFC3339)
	headerless := "无表头第一行," + future + ",FREQ=DAILY,P0,工作,60,10,Asia/Shanghai,备注\n" +
		"custom_99,带非rem前缀ID," + future + ",,INVALID_PRI,设计,25,5,Asia/Shanghai,说明,[],active,是"

	reqs, err := ImportCSV(headerless)
	if err != nil {
		t.Fatalf("ImportCSV failed: %v", err)
	}
	if len(reqs) != 2 {
		t.Fatalf("expected 2 imported rows including headerless row 0, got %d", len(reqs))
	}
	if reqs[0].Title != "无表头第一行" || reqs[0].Priority != "p0" || reqs[0].DurationMinutes != 60 {
		t.Errorf("unexpected first row: %+v", reqs[0])
	}
	if reqs[1].Title != "带非rem前缀ID" || reqs[1].Priority != "p2" || !reqs[1].IsPinned {
		t.Errorf("unexpected second row (non-rem_ ID + normalized priority + pin): %+v", reqs[1])
	}
}

func TestSchedulerTriggerPreservesPinAndCount(t *testing.T) {
	svc, db := setupTestDB(t)
	origNotify := dispatchDesktopNotification
	var notified []string
	dispatchDesktopNotification = func(title, message string) {
		notified = append(notified, title)
	}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	// Bypass AddReminder's past-time bump via direct DB insert so triggerReminder sees past due items
	past := time.Now().Add(-2 * time.Minute).Format(time.RFC3339)
	rRepeat, err := db.CreateReminder(CreateReminderRequest{
		Title:           "置顶循环任务",
		ScheduledAt:     past,
		RepeatRule:      "FREQ=DAILY;COUNT=2",
		DurationMinutes: 30,
		Priority:        "p0",
		IsPinned:        true,
	})
	if err != nil {
		t.Fatalf("create repeat reminder failed: %v", err)
	}
	rOnce, err := db.CreateReminder(CreateReminderRequest{
		Title:           "置顶单次任务",
		ScheduledAt:     past,
		DurationMinutes: 15,
		Priority:        "p1",
		IsPinned:        true,
	})
	if err != nil {
		t.Fatalf("create once reminder failed: %v", err)
	}

	sched := NewScheduler(db, nil)
	sched.checkReminders()

	if len(notified) != 2 {
		t.Fatalf("expected 2 dispatched notifications, got %d", len(notified))
	}

	gotRepeat, _ := svc.GetReminder(rRepeat.ID)
	if !gotRepeat.IsPinned {
		t.Errorf("expected triggered recurring reminder to preserve IsPinned=true")
	}
	if gotRepeat.Status != "active" || !strings.Contains(gotRepeat.RepeatRule, "COUNT=1") {
		t.Errorf("expected COUNT decremented to 1 & active, got status=%s rule=%s", gotRepeat.Status, gotRepeat.RepeatRule)
	}

	gotOnce, _ := svc.GetReminder(rOnce.ID)
	if !gotOnce.IsPinned || gotOnce.Status != "expired" {
		t.Errorf("expected single triggered reminder to be marked expired with IsPinned=true, got pinned=%v status=%s", gotOnce.IsPinned, gotOnce.Status)
	}
}

func TestDatabaseBackupAndPrune(t *testing.T) {
	tempDir := t.TempDir()
	dbPath := tempDir + "/test_agenda.db"

	db, err := InitDBWithPath(dbPath)
	if err != nil {
		t.Fatalf("InitDBWithPath failed: %v", err)
	}
	defer db.Close()

	// Create test reminder
	_, err = db.CreateReminder(CreateReminderRequest{
		Title:       "备份验证日程",
		ScheduledAt: time.Now().Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("CreateReminder failed: %v", err)
	}

	backupDir := tempDir + "/backups"
	backupFile, err := db.BackupDatabase(backupDir)
	if err != nil {
		t.Fatalf("BackupDatabase failed: %v", err)
	}

	if backupFile == "" {
		t.Fatal("expected non-empty backup path")
	}

	// Verify backup can be opened
	verifyDB, err := sql.Open("sqlite", backupFile)
	if err != nil {
		t.Fatalf("failed to open backup db: %v", err)
	}
	defer verifyDB.Close()

	var count int
	if err := verifyDB.QueryRow("SELECT count(*) FROM reminders WHERE title = '备份验证日程'").Scan(&count); err != nil {
		t.Fatalf("failed to query backup db: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 reminder in backup, got %d", count)
	}

	// Test pruning
	err = db.PruneOldBackups(backupDir, 1)
	if err != nil {
		t.Fatalf("PruneOldBackups failed: %v", err)
	}
}

func TestICSWithTimezone(t *testing.T) {
	tStr := "TZID=Asia/Shanghai:20261113T150000"
	parsed, err := parseICSTime(tStr)
	if err != nil {
		t.Fatalf("parseICSTime failed: %v", err)
	}

	if parsed.Hour() != 15 || parsed.Minute() != 0 {
		t.Errorf("expected 15:00, got %s", parsed.Format("15:04"))
	}
}

func TestCSVSemicolonAndLazyQuotes(t *testing.T) {
	csvData := "标题;时间;优先级;备注\n\"架构评审\";2026-11-13 14:00:00;P0;\"带有 \"未转义\" 引号的备注\"\n"
	reminders, err := ImportCSV(csvData)
	if err != nil {
		t.Fatalf("ImportCSV failed: %v", err)
	}

	if len(reminders) != 1 {
		t.Fatalf("expected 1 reminder, got %d", len(reminders))
	}
	if reminders[0].Title != "架构评审" {
		t.Errorf("expected 架构评审, got %s", reminders[0].Title)
	}
	if reminders[0].Priority != "p0" {
		t.Errorf("expected p0, got %s", reminders[0].Priority)
	}
}

func TestPruneRemindersForAI(t *testing.T) {
	now := time.Now()
	var testReminders []Reminder

	// Create 40 reminders: 5 overdue, 10 today, 5 P0 upcoming, 20 far future
	for i := 0; i < 5; i++ {
		testReminders = append(testReminders, Reminder{
			ID:          string(rune('a' + i)),
			Title:       "逾期任务",
			Status:      "active",
			ScheduledAt: now.Add(-time.Duration(i+1) * time.Hour).Format(time.RFC3339),
			Priority:    "p2",
		})
	}
	for i := 0; i < 10; i++ {
		testReminders = append(testReminders, Reminder{
			ID:          string(rune('k' + i)),
			Title:       "今日任务",
			Status:      "active",
			ScheduledAt: now.Add(time.Duration(i+1) * time.Hour).Format(time.RFC3339),
			Priority:    "p2",
		})
	}
	for i := 0; i < 25; i++ {
		testReminders = append(testReminders, Reminder{
			ID:          string(rune('u' + i)),
			Title:       "远期任务",
			Status:      "active",
			ScheduledAt: now.Add(time.Duration(24*(i+5)) * time.Hour).Format(time.RFC3339),
			Priority:    "p3",
		})
	}

	pruned, count := pruneRemindersForAI(testReminders, now)
	if len(pruned) > 30 {
		t.Errorf("expected pruned list to be <= 30, got %d", len(pruned))
	}
	if count != 10 {
		t.Errorf("expected 10 items pruned, got %d", count)
	}

	// Verify all overdue and today tasks are preserved
	var overdueFound, todayFound int
	for _, r := range pruned {
		if r.Title == "逾期任务" {
			overdueFound++
		}
		if r.Title == "今日任务" {
			todayFound++
		}
	}
	if overdueFound != 5 {
		t.Errorf("expected 5 overdue tasks preserved, got %d", overdueFound)
	}
	if todayFound != 10 {
		t.Errorf("expected 10 today tasks preserved, got %d", todayFound)
	}
}

func TestRecurrenceUntilRule(t *testing.T) {
	start := time.Date(2026, 11, 10, 9, 0, 0, 0, time.UTC)
	after := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)

	// Daily rule
	next := calculateNextOccurrence(start, "FREQ=DAILY;INTERVAL=1", after)
	if !next.After(after) {
		t.Errorf("expected next occurrence after %v, got %v", after, next)
	}

	// Weekly with BYDAY
	nextWeekly := calculateNextOccurrence(start, "FREQ=WEEKLY;BYDAY=MO,WE,FR", after)
	if !nextWeekly.After(after) {
		t.Errorf("expected next weekly occurrence after %v, got %v", after, nextWeekly)
	}
}

func TestAuditDeliveryTrail(t *testing.T) {
	svc, d := setupTestDB(t)

	r, err := svc.AddReminder(CreateReminderRequest{
		Title:       "审计追踪测试任务",
		ScheduledAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("failed to add reminder: %v", err)
	}

	// Should have recorded "created"
	history, err := d.GetDeliveryHistory(r.ID)
	if err != nil {
		t.Fatalf("GetDeliveryHistory failed: %v", err)
	}
	if len(history) == 0 {
		t.Errorf("expected at least 1 history record, got 0")
	}

	// Mark ended
	_, err = svc.UpdateReminder(UpdateReminderRequest{
		ID:          r.ID,
		Title:       r.Title,
		ScheduledAt: r.ScheduledAt,
		Status:      "ended",
	})
	if err != nil {
		t.Fatalf("UpdateReminder failed: %v", err)
	}

	historyAfter, err := d.GetDeliveryHistory(r.ID)
	if err != nil {
		t.Fatalf("GetDeliveryHistory failed: %v", err)
	}
	if len(historyAfter) < 2 {
		t.Errorf("expected >= 2 history records after completion, got %d", len(historyAfter))
	}
}

func TestVacuumAndCheckIntegrity(t *testing.T) {
	_, d := setupTestDB(t)

	report, err := d.CheckIntegrity()
	if err != nil {
		t.Fatalf("CheckIntegrity failed: %v", err)
	}
	if !strings.Contains(strings.ToLower(report), "ok") {
		t.Errorf("expected integrity check report to contain 'ok', got %s", report)
	}

	if err := d.Vacuum(); err != nil {
		t.Fatalf("Vacuum failed: %v", err)
	}

	res, err := d.OptimizeDatabase()
	if err != nil {
		t.Fatalf("OptimizeDatabase failed: %v", err)
	}
	if !strings.Contains(strings.ToLower(res), "ok") {
		t.Errorf("expected OptimizeDatabase to contain 'ok', got %s", res)
	}
}

func TestCleanExpiredTrashAndRelativeDuplication(t *testing.T) {
	svc, d := setupTestDB(t)

	// 1. Create two reminders
	rOld, err := svc.AddReminder(CreateReminderRequest{
		Title:       "老旧待清理",
		ScheduledAt: time.Now().Format(time.RFC3339),
		Priority:    "p3",
	})
	if err != nil {
		t.Fatalf("AddReminder failed: %v", err)
	}

	rRecent, err := svc.AddReminder(CreateReminderRequest{
		Title:       "近期废纸篓",
		ScheduledAt: time.Now().Format(time.RFC3339),
		Priority:    "p1",
	})
	if err != nil {
		t.Fatalf("AddReminder failed: %v", err)
	}

	// Soft-delete both via svc.DeleteReminder
	if err := svc.DeleteReminder(rOld.ID); err != nil {
		t.Fatalf("DeleteReminder failed: %v", err)
	}
	if err := svc.DeleteReminder(rRecent.ID); err != nil {
		t.Fatalf("DeleteReminder failed: %v", err)
	}

	// Backdate rOld.deleted_at to 45 days ago
	oldDate := time.Now().AddDate(0, 0, -45).Format(time.RFC3339)
	if _, err := d.db.Exec("UPDATE reminders SET deleted_at = ? WHERE id = ?", oldDate, rOld.ID); err != nil {
		t.Fatalf("backdating failed: %v", err)
	}

	// Run CleanExpiredTrash(30)
	purged, err := svc.CleanExpiredTrash(30)
	if err != nil {
		t.Fatalf("CleanExpiredTrash failed: %v", err)
	}
	if purged != 1 {
		t.Errorf("expected 1 reminder purged, got %d", purged)
	}

	// Verify rOld is gone, rRecent is still in trash
	trash, err := svc.GetTrashReminders()
	if err != nil {
		t.Fatalf("GetTrashReminders failed: %v", err)
	}
	if len(trash) != 1 || trash[0].ID != rRecent.ID {
		t.Errorf("expected only rRecent in trash, got %v", trash)
	}

	// 2. Test relative duplication
	newSched := time.Now().AddDate(0, 0, 7).Format(time.RFC3339)
	activeRem, err := svc.AddReminder(CreateReminderRequest{
		Title:       "周会模板",
		ScheduledAt: time.Now().Format(time.RFC3339),
		Priority:    "p0",
		Tags:        "周会,例会",
	})
	if err != nil {
		t.Fatalf("AddReminder failed: %v", err)
	}

	cloned, err := svc.DuplicateReminder(activeRem.ID, newSched)
	if err != nil {
		t.Fatalf("DuplicateReminder failed: %v", err)
	}
	if cloned.Title != activeRem.Title+" (副本)" {
		t.Errorf("expected cloned title %s (副本), got %s", activeRem.Title, cloned.Title)
	}
	if cloned.ScheduledAt != newSched {
		t.Errorf("expected cloned scheduled at %s, got %s", newSched, cloned.ScheduledAt)
	}
	if cloned.Tags != activeRem.Tags {
		t.Errorf("expected cloned tags %s, got %s", activeRem.Tags, cloned.Tags)
	}
}

func TestUpdateReminderPreservesPinAndGetStatsExcludesTrash(t *testing.T) {
	svc, db := setupTestDB(t)

	now := time.Now()
	r1, err := svc.AddReminder(CreateReminderRequest{
		Title:       "置顶事项更新验证",
		ScheduledAt: now.Add(10 * time.Minute).UTC().Format(time.RFC3339),
		IsPinned:    true,
		Priority:    "p0",
	})
	if err != nil {
		t.Fatalf("AddReminder r1 failed: %v", err)
	}

	updated, err := svc.UpdateReminder(UpdateReminderRequest{
		ID:          r1.ID,
		Title:       "置顶事项已改名",
		ScheduledAt: r1.ScheduledAt,
		Status:      "active",
		Priority:    "p0",
		IsPinned:    true,
	})
	if err != nil {
		t.Fatalf("UpdateReminder failed: %v", err)
	}
	if !updated.IsPinned {
		t.Errorf("expected UpdateReminder return struct to preserve IsPinned=true")
	}

	// Add second reminder and move it to trash
	r2, err := svc.AddReminder(CreateReminderRequest{
		Title:       "即将删除事项",
		ScheduledAt: now.Add(5 * time.Minute).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("AddReminder r2 failed: %v", err)
	}
	if err := svc.DeleteReminder(r2.ID); err != nil {
		t.Fatalf("DeleteReminder r2 failed: %v", err)
	}

	stats, err := db.GetStats()
	if err != nil {
		t.Fatalf("GetStats failed: %v", err)
	}
	if stats.TotalReminders != 1 || stats.ActiveReminders != 1 {
		t.Errorf("expected stats to exclude trashed reminder (total=1, active=1), got total=%d active=%d", stats.TotalReminders, stats.ActiveReminders)
	}
	if stats.NearDueReminders != 1 {
		t.Errorf("expected NearDueReminders=1 for UTC scheduled reminder in 10m, got %d", stats.NearDueReminders)
	}
}

func TestSchedulerLeadTimePreNotificationAndMonthlyRecurrence(t *testing.T) {
	svc, db := setupTestDB(t)
	origNotify := dispatchDesktopNotification
	var notified []string
	dispatchDesktopNotification = func(title, message string) {
		notified = append(notified, title)
	}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	// Reminder due in 10 minutes with 15-minute lead warning
	in10Min := time.Now().Add(10 * time.Minute).Format(time.RFC3339)
	rLead, err := db.CreateReminder(CreateReminderRequest{
		Title:       "提前预警架构会",
		ScheduledAt: in10Min,
		LeadMinutes: 15,
		Priority:    "p1",
	})
	if err != nil {
		t.Fatalf("CreateReminder failed: %v", err)
	}

	sched := NewScheduler(db, nil)
	sched.checkReminders()
	if len(notified) != 1 || !strings.Contains(notified[0], "即将开始") {
		t.Fatalf("expected 1 lead pre-notification, got %v", notified)
	}
	// Second check should not duplicate the pre-notification
	sched.checkReminders()
	if len(notified) != 1 {
		t.Errorf("expected no duplicate lead pre-notification on second tick, got %d", len(notified))
	}
	gotLead, _ := svc.GetReminder(rLead.ID)
	if gotLead.Status != "active" {
		t.Errorf("expected reminder to remain active after lead pre-notification, got %s", gotLead.Status)
	}

	// Test Monthly BYDAY=-1FR (last Friday of month) and BYMONTHDAY=15
	start := time.Date(2026, 10, 30, 16, 0, 0, 0, time.UTC) // Last Friday of Oct 2026
	after := time.Date(2026, 10, 30, 16, 1, 0, 0, time.UTC)
	nextLastFri := calculateNextOccurrence(start, "FREQ=MONTHLY;BYDAY=-1FR", after)
	// Last Friday of Nov 2026 is Nov 27, 2026
	if nextLastFri.Year() != 2026 || nextLastFri.Month() != time.November || nextLastFri.Day() != 27 || nextLastFri.Weekday() != time.Friday {
		t.Errorf("expected 2026-11-27 (last Friday of Nov 2026), got %v (%s)", nextLastFri, nextLastFri.Weekday())
	}

	next15th := calculateNextOccurrence(start, "FREQ=MONTHLY;BYMONTHDAY=15", after)
	if next15th.Year() != 2026 || next15th.Month() != time.November || next15th.Day() != 15 {
		t.Errorf("expected 2026-11-15, got %v", next15th)
	}
}

func TestICSTriggerDurationsAndSkipDeleted(t *testing.T) {
	if mins := parseICSTriggerMinutes("-P1D"); mins != 1440 {
		t.Errorf("expected -P1D = 1440, got %d", mins)
	}
	if mins := parseICSTriggerMinutes("-PT1H30M"); mins != 90 {
		t.Errorf("expected -PT1H30M = 90, got %d", mins)
	}
	if mins := parseICSTriggerMinutes("TRIGGER;VALUE=DURATION:-PT25M"); mins != 25 {
		t.Errorf("expected TRIGGER;VALUE=DURATION:-PT25M = 25, got %d", mins)
	}

	exported := ExportICS([]Reminder{
		{ID: "active-1", Title: "保留日程", ScheduledAt: time.Now().Format(time.RFC3339)},
		{ID: "trashed-1", Title: "已删日程", ScheduledAt: time.Now().Format(time.RFC3339), DeletedAt: time.Now().Format(time.RFC3339)},
	})
	if !strings.Contains(exported, "保留日程") || strings.Contains(exported, "已删日程") {
		t.Errorf("expected ExportICS to include active and exclude soft-deleted items, got:\n%s", exported)
	}
}

func TestBiweeklyRecurrenceAndCascadingAutoResolve(t *testing.T) {
	// 1. Biweekly single BYDAY: Friday 2026-11-13 -> Friday 2026-11-27 (+14d)
	startFri := time.Date(2026, 11, 13, 16, 0, 0, 0, time.UTC)
	afterFri := time.Date(2026, 11, 13, 16, 1, 0, 0, time.UTC)
	nextBiweekly := calculateNextOccurrence(startFri, "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", afterFri)
	if nextBiweekly.Year() != 2026 || nextBiweekly.Month() != time.November || nextBiweekly.Day() != 27 {
		t.Errorf("expected biweekly Friday 2026-11-27, got %v", nextBiweekly)
	}

	// 2. Biweekly multi BYDAY: Monday 2026-11-09 with BYDAY=MO,FR
	startMon := time.Date(2026, 11, 9, 10, 0, 0, 0, time.UTC)
	afterMon := time.Date(2026, 11, 9, 10, 1, 0, 0, time.UTC)
	sameWeekFri := calculateNextOccurrence(startMon, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR", afterMon)
	if sameWeekFri.Day() != 13 || sameWeekFri.Weekday() != time.Friday {
		t.Errorf("expected same-week Friday 2026-11-13, got %v", sameWeekFri)
	}
	nextCycleMon := calculateNextOccurrence(sameWeekFri, "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR", sameWeekFri.Add(time.Minute))
	if nextCycleMon.Day() != 23 || nextCycleMon.Weekday() != time.Monday {
		t.Errorf("expected next biweekly cycle Monday 2026-11-23, got %v", nextCycleMon)
	}

	// 3. Cascading AutoResolveConflict + UpdateReminder CreatedAt preservation + local FindOptimalFreeSlot
	svc, _ := setupTestDB(t)
	base := time.Now().Add(3 * time.Hour).Truncate(time.Minute)

	r1, err := svc.AddReminder(CreateReminderRequest{
		Title:           "第一场评审",
		ScheduledAt:     base.Format(time.RFC3339),
		DurationMinutes: 60, // base .. base+60m
	})
	if err != nil {
		t.Fatalf("AddReminder r1 failed: %v", err)
	}
	// r2 starts 5m after r1 ends (base+65m .. base+95m), so base+70m would collide with r2!
	_, err = svc.AddReminder(CreateReminderRequest{
		Title:           "紧接的第二场评审",
		ScheduledAt:     base.Add(65 * time.Minute).Format(time.RFC3339),
		DurationMinutes: 30,
	})
	if err != nil {
		t.Fatalf("AddReminder r2 failed: %v", err)
	}
	r3, err := svc.AddReminder(CreateReminderRequest{
		Title:           "待顺延事项",
		ScheduledAt:     base.Add(15 * time.Minute).Format(time.RFC3339),
		DurationMinutes: 30,
	})
	if err != nil {
		t.Fatalf("AddReminder r3 failed: %v", err)
	}

	resolved, err := svc.AutoResolveConflict(r3.ID)
	if err != nil {
		t.Fatalf("AutoResolveConflict failed: %v", err)
	}
	if resolved.CreatedAt == "" {
		t.Errorf("expected UpdateReminder/AutoResolveConflict to preserve non-empty CreatedAt")
	}
	remConflicts, _ := svc.CheckTimeConflicts(resolved.ScheduledAt, resolved.DurationMinutes, r3.ID)
	if len(remConflicts) != 0 {
		t.Errorf("expected 0 remaining conflicts after cascading AutoResolveConflict, got %d", len(remConflicts))
	}

	// Verify FindOptimalFreeSlot uses local timezone (09:00 local on a future date)
	futureDate := time.Now().In(time.Local).AddDate(0, 0, 10).Format("2006-01-02")
	slotStr, err := svc.FindOptimalFreeSlot(futureDate, 45)
	if err != nil {
		t.Fatalf("FindOptimalFreeSlot failed: %v", err)
	}
	slotTime, err := parseFlexibleTime(slotStr)
	if err != nil {
		t.Fatalf("failed to parse slotStr %q: %v", slotStr, err)
	}
	if slotTime.In(time.Local).Hour() != 9 || slotTime.In(time.Local).Minute() != 0 {
		t.Errorf("expected local 09:00 free slot on empty future day, got %s (raw %s)", slotTime.In(time.Local).Format("15:04"), slotStr)
	}
	_ = r1
}

func TestCSVLosslessRoundtripAndOfflineAIChatActions(t *testing.T) {
	svc, db := setupTestDB(t)
	future := time.Now().Add(2 * time.Hour).Truncate(time.Second).Format(time.RFC3339)

	orig, err := svc.AddReminder(CreateReminderRequest{
		Title:           "全字段CSV往返验证",
		ScheduledAt:     future,
		RepeatRule:      "FREQ=MONTHLY;BYMONTHDAY=-1",
		Priority:        "p1",
		Tags:            "财务,月结",
		DurationMinutes: 75,
		LeadMinutes:     20,
		Notes:           "核对月度账单",
		Subtasks:        `[{"id":"s1","title":"导出流水","done":true}]`,
		IsPinned:        true,
	})
	if err != nil {
		t.Fatalf("AddReminder failed: %v", err)
	}

	csvStr, err := svc.ExportCSV()
	if err != nil {
		t.Fatalf("ExportCSV failed: %v", err)
	}
	imported, err := ImportCSV(csvStr)
	if err != nil || len(imported) != 1 {
		t.Fatalf("ImportCSV failed: len=%d err=%v", len(imported), err)
	}
	got := imported[0]
	if got.DurationMinutes != 75 || got.LeadMinutes != 20 || !got.IsPinned || !strings.Contains(got.Subtasks, "导出流水") {
		t.Errorf("expected lossless CSV roundtrip (dur=75, lead=20, pinned=true, subtasks), got %+v", got)
	}
	_ = orig

	// Test BYMONTHDAY=-1 recurrence across Jan 31 -> Feb 28 (2026)
	jan31 := time.Date(2026, 1, 31, 17, 0, 0, 0, time.UTC)
	febLast := calculateNextOccurrence(jan31, "FREQ=MONTHLY;BYMONTHDAY=-1", jan31.Add(time.Minute))
	if febLast.Month() != time.February || febLast.Day() != 28 {
		t.Errorf("expected 2026-02-28 for BYMONTHDAY=-1 after Jan 31, got %v", febLast)
	}

	// Test offline AI assistant responses for overdue, free slot, and quick create
	past := time.Now().Add(-30 * time.Minute).Format(time.RFC3339)
	_, _ = db.db.Exec(`
		INSERT INTO reminders (id, title, scheduled_at, status, priority, created_at, updated_at)
		VALUES ('overdue-ai-1', '逾期架构评审', ?, 'active', 'p0', ?, ?)
	`, past, past, past)

	overdueReply, err := svc.ChatWithAI([]AIChatMessage{{Role: "user", Content: "帮我看看有哪些逾期任务"}})
	if err != nil || !strings.Contains(overdueReply, "agenda-action") || !strings.Contains(overdueReply, "snooze") {
		t.Errorf("expected offline overdue query to include snooze agenda-action, got:\n%s", overdueReply)
	}

	freeReply, err := svc.ChatWithAI([]AIChatMessage{{Role: "user", Content: "今天什么时候有空闲时段"}})
	if err != nil || !strings.Contains(freeReply, "agenda-action") || !strings.Contains(freeReply, "深度专注块") {
		t.Errorf("expected offline free-slot query to include create agenda-action, got:\n%s", freeReply)
	}

	createReply, err := svc.ChatWithAI([]AIChatMessage{{Role: "user", Content: "提醒我提交周报"}})
	if err != nil || !strings.Contains(createReply, "agenda-action") || !strings.Contains(createReply, "提交周报") {
		t.Errorf("expected offline remind query to include create agenda-action, got:\n%s", createReply)
	}
}

func TestPhase5BatchICSCSVAIEnhancements(t *testing.T) {
	svc, db := setupTestDB(t)
	future := time.Now().Add(3 * time.Hour).Truncate(time.Second).Format(time.RFC3339)

	r1, _ := svc.AddReminder(CreateReminderRequest{Title: "事务批量测试A", ScheduledAt: future, Priority: "p0"})
	r2, _ := svc.AddReminder(CreateReminderRequest{Title: "事务批量测试B", ScheduledAt: future, Priority: "p2"})

	if err := db.BatchSetPinned([]string{r1.ID, r2.ID}, true); err != nil {
		t.Fatalf("BatchSetPinned failed: %v", err)
	}
	if err := db.BatchAddTag([]string{r1.ID, r2.ID}, "冲刺"); err != nil {
		t.Fatalf("BatchAddTag failed: %v", err)
	}
	got1, _ := db.GetReminder(r1.ID)
	got2, _ := db.GetReminder(r2.ID)
	if !got1.IsPinned || !got2.IsPinned || !strings.Contains(got1.Tags, "冲刺") || !strings.Contains(got2.Tags, "冲刺") {
		t.Errorf("expected pinned=true and tag '冲刺' on both reminders, got %+v / %+v", got1, got2)
	}

	// ICS DURATION parsing and empty-summary skipping
	icsSample := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:架构对齐会\r\nDTSTART:20261120T090000Z\r\nDURATION:PT1H15M\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:   \r\nDTSTART:20261120T110000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	icsReqs, err := ImportICS(icsSample)
	if err != nil || len(icsReqs) != 1 || icsReqs[0].DurationMinutes != 75 {
		t.Fatalf("expected 1 ICS event with DurationMinutes=75, got len=%d reqs=%+v err=%v", len(icsReqs), icsReqs, err)
	}

	// CSV "无" repeat normalization
	csvSample := "ID,标题,提醒时间,状态,优先级,重复规则,提前提醒(分),持续时长(分),标签,备注,子任务,是否置顶\n1,导出验证,2026-11-20T10:00:00Z,active,p1,无,10,45,研发,,,是\n"
	csvReqs, err := ImportCSV(csvSample)
	if err != nil || len(csvReqs) != 1 || csvReqs[0].RepeatRule != "" || !csvReqs[0].IsPinned {
		t.Fatalf("expected CSV '无' repeat normalized to '', got %+v err=%v", csvReqs, err)
	}

	// Offline AI workload/P0 query
	workloadReply, err := svc.ChatWithAI([]AIChatMessage{{Role: "user", Content: "看看当前负荷和P0任务"}})
	if err != nil || !strings.Contains(workloadReply, "当前待办负荷概览") || !strings.Contains(workloadReply, "事务批量测试A") {
		t.Errorf("expected offline workload/P0 summary, got:\n%s", workloadReply)
	}

	// PolishReminderWithAI inline #tag extraction
	polished, err := svc.PolishReminderWithAI("准备 #季度复盘 #重点 材料\n- [ ] 汇总数据")
	if err != nil {
		t.Fatalf("PolishReminderWithAI failed: %v", err)
	}
	if strings.Contains(polished.Title, "#") || len(polished.Tags) < 2 || len(polished.Subtasks) != 1 {
		t.Errorf("expected #tags extracted and stripped from title, got %+v", polished)
	}
}

func TestSchedulerMarksExpiredNotCompleted(t *testing.T) {
	svc, db := setupTestDB(t)
	origNotify := dispatchDesktopNotification
	dispatchDesktopNotification = func(title, message string) {}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	past := time.Now().Add(-5 * time.Minute).Format(time.RFC3339)
	rSingle, err := db.CreateReminder(CreateReminderRequest{
		Title:       "过期单次事项",
		ScheduledAt: past,
		Priority:    "p1",
	})
	if err != nil {
		t.Fatalf("create single reminder failed: %v", err)
	}

	rLastRepeat, err := db.CreateReminder(CreateReminderRequest{
		Title:       "最后一次循环事项",
		ScheduledAt: past,
		RepeatRule:  "FREQ=DAILY;COUNT=1",
		Priority:    "p2",
	})
	if err != nil {
		t.Fatalf("create repeat reminder failed: %v", err)
	}

	rUntilExpired, err := db.CreateReminder(CreateReminderRequest{
		Title:       "截至日已到循环事项",
		ScheduledAt: past,
		RepeatRule:  fmt.Sprintf("FREQ=DAILY;UNTIL=%s", time.Now().Add(1*time.Hour).UTC().Format("20060102T150405Z")),
		Priority:    "p2",
	})
	if err != nil {
		t.Fatalf("create until reminder failed: %v", err)
	}

	rEnded, err := db.CreateReminder(CreateReminderRequest{
		Title:       "用户主动完成事项",
		ScheduledAt: time.Now().Add(1 * time.Hour).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatalf("create ended reminder failed: %v", err)
	}
	_, err = svc.UpdateReminder(UpdateReminderRequest{
		ID:          rEnded.ID,
		Title:       rEnded.Title,
		ScheduledAt: rEnded.ScheduledAt,
		Status:      "ended",
	})
	if err != nil {
		t.Fatalf("mark ended failed: %v", err)
	}

	sched := NewScheduler(db, nil)
	sched.checkReminders()

	for _, id := range []string{rSingle.ID, rLastRepeat.ID, rUntilExpired.ID} {
		got, err := svc.GetReminder(id)
		if err != nil {
			t.Fatalf("GetReminder(%s) failed: %v", id, err)
		}
		if got.Status != "expired" {
			t.Errorf("expected reminder %s (%s) status=expired, got %q", id, got.Title, got.Status)
		}
		history, err := db.GetDeliveryHistory(id)
		if err != nil {
			t.Fatalf("GetDeliveryHistory(%s) failed: %v", id, err)
		}
		hasExpiredRecord := false
		for _, rec := range history {
			if rec.Status == "completed" {
				t.Errorf("reminder %s should not record completed delivery status when expired", id)
			}
			if rec.Status == "expired" {
				hasExpiredRecord = true
			}
		}
		if !hasExpiredRecord {
			t.Errorf("expected reminder %s delivery history to include status='expired', got %+v", id, history)
		}
	}

	overdue, err := svc.GetOverdueReminders()
	if err != nil {
		t.Fatalf("GetOverdueReminders failed: %v", err)
	}
	if len(overdue) != 3 {
		t.Errorf("expected 3 expired reminders in GetOverdueReminders (excluding ended), got %d", len(overdue))
	}

	stats, err := db.GetStats()
	if err != nil {
		t.Fatalf("GetStats failed: %v", err)
	}
	if stats.ExpiredReminders != 3 || stats.EndedReminders != 1 || stats.ActiveReminders != 0 {
		t.Errorf("unexpected stats: %+v", stats)
	}

	dbStats, err := svc.GetDatabaseStats()
	if err != nil {
		t.Fatalf("GetDatabaseStats failed: %v", err)
	}
	if dbStats["expired"] != 3 || dbStats["ended"] != 1 || dbStats["overdue"] != 3 {
		t.Errorf("unexpected GetDatabaseStats: %+v", dbStats)
	}
}

func TestHardenedDBCSVICSAndAIValidation(t *testing.T) {
	svc, db := setupTestDB(t)

	// 1. UpdateReminder on non-existent ID must return error
	if _, err := db.UpdateReminder(UpdateReminderRequest{ID: "rem-missing", Title: "nope"}); err == nil {
		t.Errorf("expected error updating non-existent reminder")
	}

	// 2. GetAIChatHistory returns latest 100 messages in chronological order and preserves created_at on update
	for i := 0; i < 105; i++ {
		if err := db.SaveAIChatMessage(fmt.Sprintf("msg-%03d", i), "user", fmt.Sprintf("content-%03d", i), ""); err != nil {
			t.Fatalf("SaveAIChatMessage %d failed: %v", i, err)
		}
	}
	if err := db.SaveAIChatMessage("msg-100", "user", "updated-content-100", ""); err != nil {
		t.Fatalf("SaveAIChatMessage update failed: %v", err)
	}
	hist, err := db.GetAIChatHistory()
	if err != nil {
		t.Fatalf("GetAIChatHistory failed: %v", err)
	}
	if len(hist) != 100 {
		t.Fatalf("expected 100 chat history records, got %d", len(hist))
	}
	if hist[0].ID != "msg-005" || hist[len(hist)-1].ID != "msg-104" {
		t.Errorf("unexpected history window: first=%s last=%s", hist[0].ID, hist[len(hist)-1].ID)
	}
	foundUpdated100 := false
	for _, h := range hist {
		if h.ID == "msg-100" && h.Content == "updated-content-100" {
			foundUpdated100 = true
		}
	}
	if !foundUpdated100 {
		t.Errorf("expected updated msg-100 content to be preserved in place")
	}

	// 3. CSV headerless with rem- hyphenated ID prefix & headerMap empty title skip
	csvData := "rem-abc12345,发布复盘,2026-11-20T10:00:00+08:00,FREQ=DAILY,p1,工作,45,10,Asia/Shanghai,备注内容,[],active,是\n"
	csvItems, err := ImportCSV(csvData)
	if err != nil || len(csvItems) != 1 {
		t.Fatalf("ImportCSV rem- prefix failed: len=%d err=%v", len(csvItems), err)
	}
	if csvItems[0].Title != "发布复盘" || csvItems[0].Priority != "p1" || !csvItems[0].IsPinned {
		t.Errorf("unexpected parsed CSV item: %+v", csvItems[0])
	}
	csvWithEmptyTitle := "id,title,scheduled_at\nrem-999,,2026-11-20T10:00:00+08:00\n"
	emptyItems, err := ImportCSV(csvWithEmptyTitle)
	if err != nil || len(emptyItems) != 0 {
		t.Errorf("expected empty title row with id header to be skipped, got %+v err=%v", emptyItems, err)
	}

	// 4. ICS DTEND appearing before DTSTART still computes duration
	icsContent := "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:逆序时间测试\r\nDTEND:20261120T113000Z\r\nDTSTART:20261120T100000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"
	icsEvents, err := ImportICS(icsContent)
	if err != nil || len(icsEvents) != 1 {
		t.Fatalf("ImportICS failed: len=%d err=%v", len(icsEvents), err)
	}
	if icsEvents[0].DurationMinutes != 90 {
		t.Errorf("expected duration 90m when DTEND precedes DTSTART, got %d", icsEvents[0].DurationMinutes)
	}

	// 5. normalizeOpenAIBaseURL & offline JSON validity with quotes
	normURL, err := normalizeOpenAIBaseURL("https://api.deepseek.com/v1/chat/completions/")
	if err != nil || normURL != "https://api.deepseek.com/v1/chat/completions" {
		t.Errorf("unexpected normalized URL: %q err=%v", normURL, err)
	}
	if _, err := normalizeOpenAIBaseURL("ftp://invalid.local"); err == nil {
		t.Errorf("expected error for non-http(s) base URL")
	}
	offlineReply, err := svc.generateOfflineChatResponse([]AIChatMessage{
		{Role: "user", Content: `早中晚各一次核对 "API" 与 \quota\ 状态`},
	}, nil, time.Now())
	if err != nil {
		t.Fatalf("offline chat failed: %v", err)
	}
	if !strings.Contains(offlineReply, `\"API\"`) {
		t.Errorf("expected properly JSON-escaped quotes in offline reply, got:\n%s", offlineReply)
	}
}

func TestRestoreDatabaseRejectsInvalidAndCleansWAL(t *testing.T) {
	dir := t.TempDir()
	dbPath := dir + "/agenda.db"
	d, err := InitDBWithPath(dbPath)
	if err != nil {
		t.Fatalf("InitDBWithPath failed: %v", err)
	}
	defer d.Close()

	// Create a valid backup first
	backupPath, err := d.BackupDatabase(dir + "/backups")
	if err != nil {
		t.Fatalf("BackupDatabase failed: %v", err)
	}

	// Reject corrupt/non-SQLite file without closing active DB
	badFile := dir + "/bad.db"
	if err := os.WriteFile(badFile, []byte("not a sqlite database"), 0644); err != nil {
		t.Fatalf("write badFile failed: %v", err)
	}
	if err := d.RestoreDatabase(badFile); err == nil {
		t.Errorf("expected RestoreDatabase to reject non-sqlite file")
	}

	// Create a reminder after backup, then restore backup and verify clean state
	if _, err := d.CreateReminder(CreateReminderRequest{
		Title:       "备份后新增",
		ScheduledAt: time.Now().Add(time.Hour).Format(time.RFC3339),
	}); err != nil {
		t.Fatalf("CreateReminder failed: %v", err)
	}
	if err := d.RestoreDatabase(backupPath); err != nil {
		t.Fatalf("RestoreDatabase failed: %v", err)
	}
	list, err := d.GetAllReminders()
	if err != nil {
		t.Fatalf("GetAllReminders after restore failed: %v", err)
	}
	for _, r := range list {
		if r.Title == "备份后新增" {
			t.Errorf("expected restored DB not to contain post-backup reminder")
		}
	}
}
