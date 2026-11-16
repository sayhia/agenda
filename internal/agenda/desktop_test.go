package agenda

import (
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestDesktopPreferencesPersistenceAndNormalization(t *testing.T) {
	svc, db := setupTestDB(t)

	def, err := svc.GetDesktopPreferences()
	if err != nil {
		t.Fatalf("GetDesktopPreferences failed: %v", err)
	}
	if !def.CloseToTray || def.TrayClickAction != "popover" || def.HotkeyTarget != "quick-add" || !def.DndAllowP0 {
		t.Fatalf("unexpected default desktop preferences: %+v", def)
	}

	saved, err := svc.SaveDesktopPreferences(DesktopPreferences{
		CloseToTray:            false,
		StartMinimized:         true,
		ShowTrayCount:          false,
		TrayClickAction:        "invalid_action",
		HotkeyTarget:           "bad_target",
		QuickAddAutoHide:       false,
		SchedulerPaused:        true,
		DndEnabled:             true,
		DndStart:               "25:99",
		DndEnd:                 "07:30",
		DndAllowP0:             false,
		MorningBriefingEnabled: true,
		MorningBriefingTime:    "8:5",
	})
	if err != nil {
		t.Fatalf("SaveDesktopPreferences failed: %v", err)
	}
	if saved.TrayClickAction != "popover" {
		t.Errorf("expected invalid tray_click_action to normalize to popover, got %q", saved.TrayClickAction)
	}
	if saved.HotkeyTarget != "quick-add" {
		t.Errorf("expected invalid hotkey_target to normalize to quick-add, got %q", saved.HotkeyTarget)
	}
	if saved.DndStart != "23:00" {
		t.Errorf("expected invalid dnd_start to normalize to 23:00, got %q", saved.DndStart)
	}
	if saved.DndEnd != "07:30" {
		t.Errorf("expected valid dnd_end 07:30, got %q", saved.DndEnd)
	}
	if saved.MorningBriefingTime != "08:05" {
		t.Errorf("expected morning_briefing_time normalized to 08:05, got %q", saved.MorningBriefingTime)
	}

	reloaded := LoadDesktopPreferences(db)
	if reloaded != saved {
		t.Errorf("reloaded preferences mismatch: got %+v, want %+v", reloaded, saved)
	}
}

func TestIsWithinDNDRanges(t *testing.T) {
	loc := time.Local
	overnight := DesktopPreferences{DndEnabled: true, DndStart: "23:00", DndEnd: "08:00"}

	if !IsWithinDND(overnight, time.Date(2026, 11, 16, 23, 30, 0, 0, loc)) {
		t.Errorf("expected 23:30 to be inside 23:00-08:00 DND")
	}
	if !IsWithinDND(overnight, time.Date(2026, 11, 16, 2, 15, 0, 0, loc)) {
		t.Errorf("expected 02:15 to be inside 23:00-08:00 DND")
	}
	if IsWithinDND(overnight, time.Date(2026, 11, 16, 8, 0, 0, 0, loc)) {
		t.Errorf("expected 08:00 boundary to be outside 23:00-08:00 DND")
	}
	if IsWithinDND(overnight, time.Date(2026, 11, 16, 14, 0, 0, 0, loc)) {
		t.Errorf("expected 14:00 to be outside 23:00-08:00 DND")
	}

	daytime := DesktopPreferences{DndEnabled: true, DndStart: "12:30", DndEnd: "14:00"}
	if !IsWithinDND(daytime, time.Date(2026, 11, 16, 13, 0, 0, 0, loc)) {
		t.Errorf("expected 13:00 to be inside 12:30-14:00 DND")
	}
	if IsWithinDND(daytime, time.Date(2026, 11, 16, 12, 29, 0, 0, loc)) {
		t.Errorf("expected 12:29 to be outside 12:30-14:00 DND")
	}

	disabled := DesktopPreferences{DndEnabled: false, DndStart: "00:00", DndEnd: "23:59"}
	if IsWithinDND(disabled, time.Date(2026, 11, 16, 13, 0, 0, 0, loc)) {
		t.Errorf("expected disabled DND to always return false")
	}
}

func TestWindowNameAndTrayHelpers(t *testing.T) {
	if got := WindowNameForKind("workspace", "matrix"); got != "workspace-matrix" {
		t.Errorf("expected workspace-matrix, got %q", got)
	}
	if got := WindowNameForKind("workspace", "unknown"); got != "workspace-week" {
		t.Errorf("expected fallback workspace-week, got %q", got)
	}
	if got := WindowNameForKind("quick-add", ""); got != "quick-add" {
		t.Errorf("expected quick-add, got %q", got)
	}
	if got := truncateMenuTitle("这是一个非常长的中文日程标题用来测试截断", 8); got != "这是一个非常长…" {
		t.Errorf("unexpected utf-8 truncation: %q", got)
	}

	now := time.Now()
	items := []Reminder{
		{ID: "future", Title: "Future", Status: "active", ScheduledAt: now.Add(2 * time.Hour).Format(time.RFC3339)},
		{ID: "ended", Title: "Ended", Status: "ended", ScheduledAt: now.Add(-1 * time.Hour).Format(time.RFC3339)},
		{ID: "deleted", Title: "Deleted", Status: "active", DeletedAt: now.Format(time.RFC3339), ScheduledAt: now.Format(time.RFC3339)},
		{ID: "overdue", Title: "Overdue", Status: "expired", ScheduledAt: now.Add(-30 * time.Minute).Format(time.RFC3339)},
	}
	collected := collectTrayReminders(items, 5)
	if len(collected) != 2 || collected[0].ID != "overdue" || collected[1].ID != "future" {
		t.Fatalf("unexpected collected tray reminders order/filtering: %+v", collected)
	}
}

func TestSchedulerDNDPauseAndSnooze(t *testing.T) {
	svc, db := setupTestDB(t)
	origNotify := dispatchDesktopNotification
	var notified []string
	dispatchDesktopNotification = func(title, message string) {
		notified = append(notified, title+"|"+message)
	}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	// Configure DND covering the entire current hour
	now := time.Now()
	start := now.Add(-1 * time.Hour).Format("15:04")
	end := now.Add(2 * time.Hour).Format("15:04")
	if _, err := svc.SaveDesktopPreferences(DesktopPreferences{
		CloseToTray:     true,
		TrayClickAction: "popover",
		HotkeyTarget:    "quick-add",
		DndEnabled:      true,
		DndStart:        start,
		DndEnd:          end,
		DndAllowP0:      true,
	}); err != nil {
		t.Fatalf("SaveDesktopPreferences failed: %v", err)
	}

	past := now.Add(-2 * time.Minute).Format(time.RFC3339)
	rNormal, err := db.CreateReminder(CreateReminderRequest{
		Title:       "普通免打扰测试",
		ScheduledAt: past,
		Priority:    "p2",
	})
	if err != nil {
		t.Fatalf("create p2 failed: %v", err)
	}
	rUrgent, err := db.CreateReminder(CreateReminderRequest{
		Title:       "紧急P0穿透测试",
		ScheduledAt: past,
		Priority:    "p0",
	})
	if err != nil {
		t.Fatalf("create p0 failed: %v", err)
	}

	sched := NewScheduler(db, nil)
	svc.SetScheduler(sched)

	// 1. Paused scheduler should not trigger anything
	if err := svc.SetSchedulerPaused(true); err != nil {
		t.Fatalf("SetSchedulerPaused(true) failed: %v", err)
	}
	sched.checkReminders()
	if len(notified) != 0 {
		t.Fatalf("expected 0 notifications when scheduler is paused, got %v", notified)
	}

	// 2. Resume scheduler: DND mutes P2, allows P0
	if err := svc.SetSchedulerPaused(false); err != nil {
		t.Fatalf("SetSchedulerPaused(false) failed: %v", err)
	}
	sched.checkReminders()
	if len(notified) != 1 || !strings.Contains(notified[0], "紧急P0穿透测试") {
		t.Fatalf("expected only P0 notification during DND, got %v", notified)
	}

	histNormal, _ := db.GetDeliveryHistory(rNormal.ID)
	hasMuted := false
	for _, rec := range histNormal {
		if rec.Status == "muted_dnd" {
			hasMuted = true
		}
	}
	if !hasMuted {
		t.Errorf("expected muted_dnd delivery record for P2 during DND, got %+v", histNormal)
	}

	// 3. Snooze expired normal reminder -> becomes active again in +15m
	snoozed, err := svc.SnoozeReminder(rNormal.ID, 15)
	if err != nil {
		t.Fatalf("SnoozeReminder failed: %v", err)
	}
	if snoozed.Status != "active" {
		t.Errorf("expected snoozed reminder status=active, got %s", snoozed.Status)
	}
	snoozedTime, err := parseFlexibleTime(snoozed.ScheduledAt)
	if err != nil || snoozedTime.Before(time.Now().Add(10*time.Minute)) {
		t.Errorf("expected snoozed time ~15m in future, got %s", snoozed.ScheduledAt)
	}

	// 4. Telemetry & Morning Briefing
	status, err := svc.GetDesktopRuntimeStatus()
	if err != nil {
		t.Fatalf("GetDesktopRuntimeStatus failed: %v", err)
	}
	if status.Scheduler.ChecksCount < 2 || status.Scheduler.NotificationsSent != 1 {
		t.Errorf("unexpected scheduler telemetry: %+v", status.Scheduler)
	}
	if status.Scheduler.NextReminderID != rNormal.ID {
		t.Errorf("expected next reminder to be snoozed item %s, got %s", rNormal.ID, status.Scheduler.NextReminderID)
	}

	summary, err := svc.SendMorningBriefingNow()
	if err != nil || !strings.Contains(summary, "今日待办") {
		t.Errorf("unexpected morning briefing summary: %q (err=%v)", summary, err)
	}
	_ = rUrgent
}

func TestClampWindowBounds(t *testing.T) {
	workArea := application.Rect{X: 0, Y: 25, Width: 1440, Height: 875}

	// Disconnected right monitor position gets clamped inside current work area
	clamped := ClampWindowBounds(WindowBounds{X: 2800, Y: 100, Width: 600, Height: 400}, workArea, 400, 300)
	if clamped.X != 840 || clamped.Y != 100 || clamped.Width != 600 || clamped.Height != 400 {
		t.Errorf("unexpected clamped right overflow: %+v", clamped)
	}

	// Negative off-screen & undersized gets enforced to workArea origin & minW/minH
	clampedMin := ClampWindowBounds(WindowBounds{X: -200, Y: -50, Width: 100, Height: 80}, workArea, 500, 300)
	if clampedMin.X != 0 || clampedMin.Y != 25 || clampedMin.Width != 500 || clampedMin.Height != 300 {
		t.Errorf("unexpected clamped min/origin bounds: %+v", clampedMin)
	}

	// Larger than work area gets capped
	clampedBig := ClampWindowBounds(WindowBounds{X: 100, Y: 100, Width: 3000, Height: 2000}, workArea, 400, 300)
	if clampedBig.Width != 1440 || clampedBig.Height != 875 || clampedBig.X != 0 || clampedBig.Y != 25 {
		t.Errorf("unexpected clamped oversized bounds: %+v", clampedBig)
	}
}

func TestSnoozeAllOverdueAndRecentDeliveries(t *testing.T) {
	svc, db := setupTestDB(t)
	now := time.Now()

	past1, _ := db.CreateReminder(CreateReminderRequest{
		Title:       "逾期一",
		ScheduledAt: now.Add(-2 * time.Hour).Format(time.RFC3339),
		Priority:    "p1",
	})
	_, _ = db.CreateReminder(CreateReminderRequest{
		Title:       "逾期二",
		ScheduledAt: now.Add(-30 * time.Minute).Format(time.RFC3339),
		Priority:    "p2",
	})
	future, _ := db.CreateReminder(CreateReminderRequest{
		Title:       "未来正常日程",
		ScheduledAt: now.Add(3 * time.Hour).Format(time.RFC3339),
	})

	count, err := svc.SnoozeAllOverdue(20)
	if err != nil {
		t.Fatalf("SnoozeAllOverdue failed: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 snoozed overdue reminders, got %d", count)
	}

	got1, _ := svc.GetReminder(past1.ID)
	t1, _ := parseFlexibleTime(got1.ScheduledAt)
	if t1.Before(now.Add(15 * time.Minute)) {
		t.Errorf("expected past1 rescheduled ~20m ahead, got %s", got1.ScheduledAt)
	}
	gotFuture, _ := svc.GetReminder(future.ID)
	if gotFuture.ScheduledAt != future.ScheduledAt {
		t.Errorf("expected future reminder unchanged")
	}

	_ = db.AddDeliveryRecord(past1.ID, "测试投递记录", "success", "")
	deliveries, err := svc.GetRecentDeliveries(10)
	if err != nil {
		t.Fatalf("GetRecentDeliveries failed: %v", err)
	}
	found := false
	for _, d := range deliveries {
		if d.ReminderID == past1.ID && d.ReminderTitle == "逾期一" && d.Status == "success" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("expected recent deliveries to join reminder_title='逾期一', got %+v", deliveries)
	}
}

func TestSchedulerCoalescedWakeCatchup(t *testing.T) {
	svc, db := setupTestDB(t)
	origNotify := dispatchDesktopNotification
	var notifications []string
	dispatchDesktopNotification = func(title, message string) {
		notifications = append(notifications, title+"|"+message)
	}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	staleTime := time.Now().Add(-20 * time.Minute).Format(time.RFC3339)
	for i := 0; i < 4; i++ {
		_, err := db.CreateReminder(CreateReminderRequest{
			Title:       "休眠积压普通任务",
			ScheduledAt: staleTime,
			Priority:    "p2",
		})
		if err != nil {
			t.Fatalf("create stale p2 failed: %v", err)
		}
	}
	_, err := db.CreateReminder(CreateReminderRequest{
		Title:       "休眠积压P0急事",
		ScheduledAt: staleTime,
		Priority:    "p0",
	})
	if err != nil {
		t.Fatalf("create stale p0 failed: %v", err)
	}

	sched := NewScheduler(db, nil)
	sched.checkReminders()

	// 2 individual popups + 1 P0 bypass + 1 coalesced summary = <= 4 OS notifications instead of 5+ flood
	hasCoalescedSummary := false
	hasP0 := false
	for _, n := range notifications {
		if strings.Contains(n, "离线/休眠日程汇总") {
			hasCoalescedSummary = true
		}
		if strings.Contains(n, "休眠积压P0急事") {
			hasP0 = true
		}
	}
	if !hasCoalescedSummary || !hasP0 {
		t.Errorf("expected coalesced summary + P0 alert, got %v", notifications)
	}
	if len(notifications) >= 5 {
		t.Errorf("expected fewer OS popups than 5 due to coalescing, got %d: %v", len(notifications), notifications)
	}

	all, _ := svc.GetReminders()
	for _, r := range all {
		if strings.HasPrefix(r.Title, "休眠积压") && r.Status != "expired" {
			t.Errorf("expected stale reminder %s to be marked expired, got %s", r.Title, r.Status)
		}
	}
}

func TestDesktopPreferencesHotkeysPersistence(t *testing.T) {
	svc, db := setupTestDB(t)
	saved, err := svc.SaveDesktopPreferences(DesktopPreferences{
		CloseToTray:       true,
		TrayClickAction:   "main",
		HotkeyTarget:      "quick-add",
		QuickAddHotkey:    "CmdOrCtrl+Shift+Space",
		TrayPopoverHotkey: "Alt+S",
		FocusHotkey:       "Alt+F",
	})
	if err != nil {
		t.Fatalf("SaveDesktopPreferences failed: %v", err)
	}
	reloaded := LoadDesktopPreferences(db)
	if reloaded.QuickAddHotkey != "CmdOrCtrl+Shift+Space" || reloaded.TrayPopoverHotkey != "Alt+S" || reloaded.FocusHotkey != "Alt+F" {
		t.Errorf("hotkey preferences did not round-trip: %+v", reloaded)
	}
	_ = saved
}

func TestBuildWindowOptionsMacCollectionBehaviorValid(t *testing.T) {
	cases := []struct {
		kind  string
		param string
	}{
		{WindowKindQuickAdd, ""},
		{WindowKindTrayPopover, ""},
		{WindowKindFocus, ""},
		{WindowKindAI, ""},
		{WindowKindWorkspace, "week"},
	}

	mutuallyExclusiveSpaces := application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorMoveToActiveSpace
	for _, tc := range cases {
		opts, _, err := buildWindowOptions(tc.kind, tc.param, true)
		if err != nil {
			t.Fatalf("buildWindowOptions(%s) unexpected error: %v", tc.kind, err)
		}
		if (opts.Mac.CollectionBehavior & mutuallyExclusiveSpaces) == mutuallyExclusiveSpaces {
			t.Errorf("window %s combines mutually exclusive CanJoinAllSpaces and MoveToActiveSpace flags: %v", tc.kind, opts.Mac.CollectionBehavior)
		}
	}
}

func TestSchedulerTimedPauseAndAutoResume(t *testing.T) {
	origNotify := dispatchDesktopNotification
	dispatchDesktopNotification = func(title, body string) {}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	_, db := setupTestDB(t)
	sched := NewScheduler(db, nil)

	until := sched.PauseFor(30)
	if until.IsZero() {
		t.Fatalf("expected non-zero pause deadline")
	}
	st := sched.GetStatus()
	if !st.Paused || st.PausedUntil == "" || st.PausedRemainingSec <= 0 {
		t.Fatalf("expected active timed pause status, got %+v", st)
	}

	// Simulate expired deadline -> next checkReminders() sweep should auto-resume.
	sched.mu.Lock()
	sched.pausedUntil = time.Now().Add(-2 * time.Second)
	sched.mu.Unlock()
	sched.TriggerImmediateCheck()

	stAfter := sched.GetStatus()
	if stAfter.Paused || stAfter.PausedUntil != "" || stAfter.PausedRemainingSec != 0 {
		t.Fatalf("expected timed pause to auto-resume after deadline, got %+v", stAfter)
	}
}

func TestResetAllWindowBoundsAndHelpers(t *testing.T) {
	_, db := setupTestDB(t)
	_ = db.SaveSettings(map[string]string{
		"desktop.bounds.main":      `{"x":10,"y":20,"width":1000,"height":700}`,
		"desktop.bounds.focus":     `{"x":30,"y":40,"width":440,"height":620}`,
		"desktop.bounds.quick-add": `{"x":50,"y":60,"width":640,"height":330}`,
	})

	dm := NewDesktopManager(nil, db, nil, nil)
	if err := dm.ResetAllWindowBounds(); err != nil {
		t.Fatalf("ResetAllWindowBounds failed: %v", err)
	}

	settings, err := db.GetSettings()
	if err != nil {
		t.Fatalf("GetSettings failed: %v", err)
	}
	for _, key := range []string{"desktop.bounds.main", "desktop.bounds.focus", "desktop.bounds.quick-add"} {
		if strings.TrimSpace(settings[key]) != "" {
			t.Errorf("expected %s to be cleared, got %q", key, settings[key])
		}
	}

	if got := formatPausedRemainingText(1800); got != "30 分钟" {
		t.Errorf("unexpected formatPausedRemainingText(1800): %q", got)
	}
	if got := formatPausedRemainingText(5400); got != "1 小时 30 分" {
		t.Errorf("unexpected formatPausedRemainingText(5400): %q", got)
	}
	now := time.Date(2026, 11, 16, 18, 0, 0, 0, time.Local)
	if got := formatNextReminderCountdown(now.Add(15*time.Minute).Format(time.RFC3339), now); got != "15 分钟后" {
		t.Errorf("unexpected countdown: %q", got)
	}
}

func TestSuggestNextFreeSlotAndDNDNotification(t *testing.T) {
	svc, db := setupTestDB(t)

	base := time.Now().Add(2 * time.Hour).Truncate(time.Minute)
	_, err := svc.AddReminder(CreateReminderRequest{
		Title:           "占用时段会议",
		ScheduledAt:     base.Format(time.RFC3339),
		DurationMinutes: 45,
		Timezone:        "Asia/Shanghai",
	})
	if err != nil {
		t.Fatalf("AddReminder failed: %v", err)
	}

	freeISO, err := svc.SuggestNextFreeSlot(base.Add(10*time.Minute).Format(time.RFC3339), 30)
	if err != nil {
		t.Fatalf("SuggestNextFreeSlot failed: %v", err)
	}
	freeTime, err := parseFlexibleTime(freeISO)
	if err != nil {
		t.Fatalf("parseFlexibleTime failed: %v", err)
	}
	expectedMin := base.Add(45*time.Minute + 10*time.Minute)
	if freeTime.Before(expectedMin) {
		t.Errorf("expected free slot >= %v, got %v", expectedMin, freeTime)
	}

	origNotify := dispatchDesktopNotification
	var calls []string
	dispatchDesktopNotification = func(title, body string) {
		calls = append(calls, title)
	}
	t.Cleanup(func() { dispatchDesktopNotification = origNotify })

	_ = SaveDesktopPreferences(db, DesktopPreferences{
		DndEnabled: true,
		DndStart:   "00:00",
		DndEnd:     "23:59",
	})
	if err := svc.SendDesktopNotification("专注结束", "休息一下"); err != nil {
		t.Fatalf("SendDesktopNotification under DND failed: %v", err)
	}
	if len(calls) != 0 {
		t.Errorf("expected DND to mute SendDesktopNotification, got calls: %v", calls)
	}

	_ = SaveDesktopPreferences(db, DesktopPreferences{DndEnabled: false})
	if err := svc.SendDesktopNotification("专注结束", "休息一下"); err != nil {
		t.Fatalf("SendDesktopNotification failed: %v", err)
	}
	if len(calls) != 1 || calls[0] != "专注结束" {
		t.Errorf("expected 1 notification call, got %v", calls)
	}

	sched := NewScheduler(db, nil)
	st := sched.GetStatus()
	if st.NextReminderTitle != "占用时段会议" || st.NextReminderInSec <= 0 || st.LastMaintenanceAt == "" {
		t.Errorf("unexpected scheduler diagnostics: %+v", st)
	}
}

func TestMarkQuittingStopsBoundsTimersPSQuoteAndSweepMu(t *testing.T) {
	_, db := setupTestDB(t)
	dm := NewDesktopManager(nil, db, nil, nil)

	fired := make(chan struct{}, 1)
	dm.mu.Lock()
	dm.boundsTimers["main"] = time.AfterFunc(40*time.Millisecond, func() {
		fired <- struct{}{}
	})
	dm.mu.Unlock()

	dm.MarkQuitting()
	if !dm.isQuitting.Load() {
		t.Fatalf("expected isQuitting.Load() == true after MarkQuitting()")
	}
	select {
	case <-fired:
		t.Fatalf("expected bounds timer to be stopped on MarkQuitting()")
	case <-time.After(80 * time.Millisecond):
	}

	dm.mu.Lock()
	remainingTimers := len(dm.boundsTimers)
	dm.mu.Unlock()
	if remainingTimers != 0 {
		t.Errorf("expected boundsTimers map cleared on MarkQuitting(), got %d", remainingTimers)
	}

	raw := "Today's `sync`\nnext"
	escaped := escapePowerShellSingleQuoted(raw)
	if !strings.Contains(escaped, "''") {
		t.Errorf("expected single quote doubled in PowerShell escape, got %q", escaped)
	}
	if strings.ContainsRune(escaped, '\n') {
		t.Errorf("expected newline stripped/flattened in PowerShell escape, got %q", escaped)
	}

	sched := NewScheduler(db, nil)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			sched.checkReminders()
		}()
	}
	wg.Wait()
}
