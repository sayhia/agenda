package agenda

import (
	"database/sql"
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
	if !gotOnce.IsPinned || gotOnce.Status != "ended" {
		t.Errorf("expected single triggered reminder to end with IsPinned=true, got pinned=%v status=%s", gotOnce.IsPinned, gotOnce.Status)
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
