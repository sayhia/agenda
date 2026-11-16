package agenda

import (
	"context"
	"fmt"
	"log"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type SchedulerStatus struct {
	Running            bool   `json:"running"`
	Paused             bool   `json:"paused"`
	PausedUntil        string `json:"paused_until"`
	PausedRemainingSec int64  `json:"paused_remaining_sec"`
	StartedAt          string `json:"started_at"`
	UptimeSeconds      int64  `json:"uptime_seconds"`
	LastCheckAt        string `json:"last_check_at"`
	CheckIntervalSec   int    `json:"check_interval_sec"`
	ChecksCount        int64  `json:"checks_count"`
	NotificationsSent  int64  `json:"notifications_sent"`
	NextReminderID     string `json:"next_reminder_id"`
	NextReminderTitle  string `json:"next_reminder_title"`
	NextReminderAt     string `json:"next_reminder_at"`
	NextReminderInSec  int64  `json:"next_reminder_in_sec"`
	LastMaintenanceAt  string `json:"last_maintenance_at"`
	TodayCount         int    `json:"today_count"`
	OverdueCount       int    `json:"overdue_count"`
	DndActive          bool   `json:"dnd_active"`
}

type pendingDesktopNotice struct {
	title   string
	message string
}

type Scheduler struct {
	db                  *DB
	app                 *application.App
	stopCh              chan struct{}
	sweepMu             sync.Mutex
	mu                  sync.Mutex
	recentlyTriggered   map[string]time.Time
	preNotifiedSchedule map[string]string
	running             bool
	paused              bool
	pausedUntil         time.Time
	startedAt           time.Time
	lastCheckAt         time.Time
	lastMaintenanceAt   time.Time
	lastTrayRefreshAt   time.Time
	lastBriefingDate    string
	checksCount         int64
	notificationsSent   int64
	onChanged           func()
	onMinuteRefresh     func()
}

func NewScheduler(db *DB, app *application.App) *Scheduler {
	now := time.Now()
	return &Scheduler{
		db:                  db,
		app:                 app,
		stopCh:              make(chan struct{}),
		recentlyTriggered:   make(map[string]time.Time),
		preNotifiedSchedule: make(map[string]string),
		startedAt:           now,
		lastMaintenanceAt:   now,
	}
}

func (s *Scheduler) SetOnChanged(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onChanged = fn
}

func (s *Scheduler) SetOnMinuteRefresh(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.onMinuteRefresh = fn
}

func (s *Scheduler) SetPaused(paused bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.paused = paused
	s.pausedUntil = time.Time{}
}

// PauseFor pauses reminder dispatching for the given number of minutes (auto-resuming on expiry),
// or resumes immediately when minutes <= 0.
func (s *Scheduler) PauseFor(minutes int) time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	if minutes <= 0 {
		s.paused = false
		s.pausedUntil = time.Time{}
		return time.Time{}
	}
	until := time.Now().Add(time.Duration(minutes) * time.Minute)
	s.paused = true
	s.pausedUntil = until
	return until
}

func (s *Scheduler) IsPaused() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.paused
}

func (s *Scheduler) Start() {
	s.mu.Lock()
	s.running = true
	s.startedAt = time.Now()
	if s.db != nil {
		prefs := LoadDesktopPreferences(s.db)
		s.paused = prefs.SchedulerPaused
		if settings, err := s.db.GetSettings(); err == nil {
			s.lastBriefingDate = settings["desktop.morning_briefing_last_date"]
		}
	}
	s.mu.Unlock()

	ticker := time.NewTicker(3 * time.Second)
	go func() {
		for {
			select {
			case <-ticker.C:
				s.checkReminders()
			case <-s.stopCh:
				ticker.Stop()
				s.mu.Lock()
				s.running = false
				s.mu.Unlock()
				return
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	s.mu.Lock()
	s.running = false
	s.mu.Unlock()
	select {
	case <-s.stopCh:
	default:
		close(s.stopCh)
	}
}

func (s *Scheduler) GetStatus() SchedulerStatus {
	s.mu.Lock()
	running := s.running
	paused := s.paused
	pausedUntil := s.pausedUntil
	startedAt := s.startedAt
	lastCheckAt := s.lastCheckAt
	lastMaintenanceAt := s.lastMaintenanceAt
	checksCount := s.checksCount
	notificationsSent := s.notificationsSent
	s.mu.Unlock()

	now := time.Now()
	prefs := LoadDesktopPreferences(s.db)
	status := SchedulerStatus{
		Running:           running,
		Paused:            paused,
		StartedAt:         startedAt.Format(time.RFC3339),
		UptimeSeconds:     int64(now.Sub(startedAt).Seconds()),
		CheckIntervalSec:  3,
		ChecksCount:       checksCount,
		NotificationsSent: notificationsSent,
		DndActive:         IsWithinDND(prefs, now),
	}
	if !lastMaintenanceAt.IsZero() {
		status.LastMaintenanceAt = lastMaintenanceAt.Format(time.RFC3339)
	}
	if paused && !pausedUntil.IsZero() && pausedUntil.After(now) {
		status.PausedUntil = pausedUntil.Format(time.RFC3339)
		status.PausedRemainingSec = int64(pausedUntil.Sub(now).Seconds())
		if status.PausedRemainingSec < 1 {
			status.PausedRemainingSec = 1
		}
	}
	if !lastCheckAt.IsZero() {
		status.LastCheckAt = lastCheckAt.Format(time.RFC3339)
	}

	if s.db != nil {
		if stats, err := s.db.GetStats(); err == nil && stats != nil {
			status.TodayCount = stats.TodayReminders
		}
		if overdue, err := s.db.GetOverdueReminders(); err == nil {
			status.OverdueCount = len(overdue)
		}
		if reminders, err := s.db.GetAllReminders(); err == nil {
			var nextTime time.Time
			for _, r := range reminders {
				if r.DeletedAt != "" || r.Status != "active" {
					continue
				}
				t, err := parseFlexibleTime(r.ScheduledAt)
				if err != nil || t.Before(now) {
					continue
				}
				if nextTime.IsZero() || t.Before(nextTime) {
					nextTime = t
					status.NextReminderID = r.ID
					status.NextReminderTitle = r.Title
					status.NextReminderAt = r.ScheduledAt
					status.NextReminderInSec = int64(t.Sub(now).Seconds())
				}
			}
		}
	}
	return status
}

func (s *Scheduler) TriggerImmediateCheck() {
	s.checkReminders()
}

func (s *Scheduler) checkReminders() {
	s.sweepMu.Lock()
	defer s.sweepMu.Unlock()

	s.mu.Lock()
	now := time.Now()
	s.lastCheckAt = now
	s.checksCount++

	prefs := LoadDesktopPreferences(s.db)
	dndActive := IsWithinDND(prefs, now)
	autoResumed := false
	if s.paused && !s.pausedUntil.IsZero() && !now.Before(s.pausedUntil) {
		s.paused = false
		s.pausedUntil = time.Time{}
		autoResumed = true
	}
	paused := s.paused

	// Periodic background maintenance every 6 hours while resident
	shouldMaintain := !s.lastMaintenanceAt.IsZero() && now.Sub(s.lastMaintenanceAt) >= 6*time.Hour
	if shouldMaintain {
		s.lastMaintenanceAt = now
	}
	shouldRefreshTray := s.lastTrayRefreshAt.IsZero() || now.Sub(s.lastTrayRefreshAt) >= time.Minute
	if shouldRefreshTray {
		s.lastTrayRefreshAt = now
	}
	onChanged := s.onChanged
	onMinuteRefresh := s.onMinuteRefresh
	s.mu.Unlock()

	if autoResumed {
		if s.db != nil {
			prefs.SchedulerPaused = false
			_ = SaveDesktopPreferences(s.db, prefs)
		}
		dispatchDesktopNotification("后台守护已自动恢复", "定时暂停已到期，系统已自动恢复到期提醒巡检。")
		if onChanged != nil {
			onChanged()
		}
	}

	if shouldMaintain && s.db != nil {
		go func() {
			s.db.autoBackupIfStale()
			_, _ = s.db.CleanExpiredTrash(30)
		}()
	}

	if paused || s.db == nil {
		if !autoResumed && shouldRefreshTray && onMinuteRefresh != nil {
			onMinuteRefresh()
		}
		return
	}

	s.mu.Lock()
	reminders, err := s.db.GetAllReminders()
	if err != nil {
		s.mu.Unlock()
		return
	}

	hasUpdates := false
	var pendingNotices []pendingDesktopNotice

	// Clean up stale triggers older than 5 minutes
	for id, t := range s.recentlyTriggered {
		if now.Sub(t) > 5*time.Minute {
			delete(s.recentlyTriggered, id)
		}
	}

	activeIDs := make(map[string]struct{}, len(reminders))
	for _, r := range reminders {
		if r.Status == "active" {
			activeIDs[r.ID] = struct{}{}
		}
	}
	for id := range s.preNotifiedSchedule {
		if _, ok := activeIDs[id]; !ok {
			delete(s.preNotifiedSchedule, id)
		}
	}

	type dueCandidate struct {
		reminder      Reminder
		scheduledTime time.Time
		stale         bool
	}
	var dueQueue []dueCandidate

	for _, r := range reminders {
		if r.Status != "active" {
			continue
		}

		scheduledTime, err := parseFlexibleTime(r.ScheduledAt)
		if err != nil {
			continue
		}

		// Check if it's time for advance lead-minutes pre-notification before main trigger
		if r.LeadMinutes > 0 && now.Before(scheduledTime) {
			leadTime := scheduledTime.Add(-time.Duration(r.LeadMinutes) * time.Minute)
			if now.After(leadTime) || now.Equal(leadTime) {
				if s.preNotifiedSchedule[r.ID] != r.ScheduledAt {
					s.preNotifiedSchedule[r.ID] = r.ScheduledAt
					if notice := s.triggerLeadReminder(&r, scheduledTime, now, dndActive, prefs.DndAllowP0); notice != nil {
						pendingNotices = append(pendingNotices, *notice)
					}
				}
			}
			continue
		}

		// Check if it's time to trigger (avoid double firing within 60s)
		if now.After(scheduledTime) || now.Equal(scheduledTime) {
			if last, ok := s.recentlyTriggered[r.ID]; ok && now.Sub(last) < 60*time.Second {
				continue
			}
			s.recentlyTriggered[r.ID] = now
			delete(s.preNotifiedSchedule, r.ID)
			dueQueue = append(dueQueue, dueCandidate{
				reminder:      r,
				scheduledTime: scheduledTime,
				stale:         now.Sub(scheduledTime) > 5*time.Minute,
			})
		}
	}

	// Smart wake/offline catch-up coalescing: if >3 reminders are stale (>5m past due)
	// in a single sweep, dispatch at most 2 individual popups + 1 aggregated summary
	// instead of flooding the OS notification center.
	staleCount := 0
	for _, dc := range dueQueue {
		if dc.stale {
			staleCount++
		}
	}
	coalesce := staleCount > 3
	individualBudget := 2
	coalescedCount := 0
	for _, dc := range dueQueue {
		suppressPopup := false
		if coalesce && dc.stale {
			if dc.reminder.Priority != "p0" && individualBudget <= 0 {
				suppressPopup = true
				coalescedCount++
			} else if individualBudget > 0 {
				individualBudget--
			}
		}
		remCopy := dc.reminder
		if notice := s.triggerReminder(&remCopy, dc.scheduledTime, now, dndActive, prefs.DndAllowP0, suppressPopup); notice != nil {
			pendingNotices = append(pendingNotices, *notice)
		}
		hasUpdates = true
	}
	if coalescedCount > 0 && !dndActive {
		pendingNotices = append(pendingNotices, pendingDesktopNotice{
			title:   "离线/休眠日程汇总",
			message: fmt.Sprintf("另有 %d 项待办在离线或休眠期间已到期，已在今日速览中标出。", coalescedCount),
		})
		s.notificationsSent++
	}

	// Daily morning briefing background notification
	shouldSendBriefing := false
	todayStr := now.Format("2006-01-02")
	if prefs.MorningBriefingEnabled && !dndActive && s.lastBriefingDate != todayStr {
		if now.Format("15:04") >= prefs.MorningBriefingTime {
			s.lastBriefingDate = todayStr
			shouldSendBriefing = true
		}
	}
	s.mu.Unlock()

	for _, notice := range pendingNotices {
		dispatchDesktopNotification(notice.title, notice.message)
	}

	if shouldSendBriefing {
		_ = s.db.SaveSettings(map[string]string{
			"desktop.morning_briefing_last_date": todayStr,
		})
		_, _ = s.SendMorningBriefingDigest()
	}

	if hasUpdates {
		if onChanged != nil {
			onChanged()
		} else if s.app != nil {
			s.app.Event.Emit("reminders-updated", true)
		}
	} else if !autoResumed && shouldRefreshTray && onMinuteRefresh != nil {
		onMinuteRefresh()
	}
}

func (s *Scheduler) SendMorningBriefingDigest() (string, error) {
	if s.db == nil {
		return "", fmt.Errorf("database not initialized")
	}
	stats, err := s.db.GetStats()
	if err != nil {
		return "", err
	}
	overdue, _ := s.db.GetOverdueReminders()
	summary := fmt.Sprintf("今日待办 %d 项，临近到期 %d 项，已逾期 %d 项。",
		stats.TodayReminders, stats.NearDueReminders, len(overdue))
	if stats.TodayReminders == 0 && len(overdue) == 0 {
		summary = "今日暂无待办日程，祝您拥有专注从容的一天！"
	}
	dispatchDesktopNotification("今日日程早报", summary)
	s.mu.Lock()
	s.notificationsSent++
	s.mu.Unlock()
	return summary, nil
}

func (s *Scheduler) triggerLeadReminder(r *Reminder, scheduledTime, now time.Time, dndActive, allowP0 bool) *pendingDesktopNotice {
	msg := fmt.Sprintf("将在 %d 分钟后 (%s) 开始", r.LeadMinutes, scheduledTime.In(time.Local).Format("15:04"))
	if r.Notes != "" {
		msg += " · " + r.Notes
	}

	mutedByDnd := dndActive && !(allowP0 && r.Priority == "p0")
	title := fmt.Sprintf("即将开始 (%d分钟后): %s", r.LeadMinutes, r.Title)
	var notice *pendingDesktopNotice
	if !mutedByDnd {
		notice = &pendingDesktopNotice{title: title, message: msg}
		s.notificationsSent++
		_ = s.db.AddDeliveryRecord(r.ID, fmt.Sprintf("提前 %d 分钟预警: %s", r.LeadMinutes, msg), "lead_notice", "")
	} else {
		_ = s.db.AddDeliveryRecord(r.ID, fmt.Sprintf("免打扰静默预警 (%d分钟后): %s", r.LeadMinutes, msg), "muted_dnd", "")
	}

	if s.app != nil {
		s.app.Event.Emit("reminder-lead-triggered", map[string]interface{}{
			"id":           r.ID,
			"title":        r.Title,
			"scheduled_at": r.ScheduledAt,
			"lead_minutes": r.LeadMinutes,
			"priority":     r.Priority,
			"muted":        mutedByDnd,
			"prompt":       msg,
			"triggered_at": now.Format(time.RFC3339),
		})
	}
	return notice
}

func (s *Scheduler) triggerReminder(r *Reminder, scheduledTime, now time.Time, dndActive, allowP0, suppressOSPopup bool) *pendingDesktopNotice {
	// 1. Send native desktop notification (unless muted by Do-Not-Disturb or coalesced catch-up)
	msg := r.Notes
	if r.Prompt != "" {
		if msg != "" {
			msg += " - "
		}
		msg += r.Prompt
	}
	if msg == "" {
		msg = "您的日程时间到了！"
	}

	mutedByDnd := dndActive && !(allowP0 && r.Priority == "p0")
	title := fmt.Sprintf("日程提醒: %s", r.Title)
	var notice *pendingDesktopNotice
	if !mutedByDnd {
		if !suppressOSPopup {
			notice = &pendingDesktopNotice{title: title, message: msg}
			s.notificationsSent++
		}
		// 2. Record delivery history
		_ = s.db.AddDeliveryRecord(r.ID, msg, "success", "")
	} else {
		_ = s.db.AddDeliveryRecord(r.ID, fmt.Sprintf("免打扰静默提醒: %s", msg), "muted_dnd", "")
	}

	// 3. Emit real-time event to Wails frontend
	if s.app != nil {
		s.app.Event.Emit("reminder-triggered", map[string]interface{}{
			"id":           r.ID,
			"title":        r.Title,
			"scheduled_at": r.ScheduledAt,
			"priority":     r.Priority,
			"muted":        mutedByDnd,
			"prompt":       msg,
			"triggered_at": now.Format(time.RFC3339),
		})
	}

	// 4. Update reminder for next repeat or mark as expired
	if r.RepeatRule != "" {
		rule := strings.ToUpper(r.RepeatRule)
		parts := strings.Split(rule, ";")
		params := make(map[string]string)
		for _, p := range parts {
			kv := strings.SplitN(p, "=", 2)
			if len(kv) == 2 {
				params[kv[0]] = kv[1]
			}
		}

		if countStr, ok := params["COUNT"]; ok {
			count, err := strconv.Atoi(countStr)
			if err == nil {
				if count <= 1 {
					// Last occurrence executed! Mark as expired while preserving pin state
					_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, r.ScheduledAt, r.RepeatRule, "expired"))
					return notice
				}
				// Decrement COUNT for remaining repeats
				newParts := make([]string, 0, len(parts))
				for _, p := range parts {
					if strings.HasPrefix(strings.ToUpper(p), "COUNT=") {
						newParts = append(newParts, fmt.Sprintf("COUNT=%d", count-1))
					} else {
						newParts = append(newParts, p)
					}
				}
				r.RepeatRule = strings.Join(newParts, ";")
			}
		}

		nextTime := calculateNextOccurrence(scheduledTime, r.RepeatRule, now)

		if untilStr, ok := params["UNTIL"]; ok {
			untilTime, err := parseFlexibleTime(untilStr)
			if err != nil {
				untilTime, err = parseICSTime(untilStr)
			}
			if err == nil && !nextTime.Before(untilTime) {
				// Reached UNTIL deadline, mark as expired
				_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, r.ScheduledAt, r.RepeatRule, "expired"))
				return notice
			}
		}

		_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, nextTime.Format(time.RFC3339), r.RepeatRule, "active"))
	} else {
		_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, r.ScheduledAt, r.RepeatRule, "expired"))
	}
	return notice
}

func triggeredReminderUpdate(r *Reminder, scheduledAt, repeatRule, status string) UpdateReminderRequest {
	return UpdateReminderRequest{
		ID:              r.ID,
		Title:           r.Title,
		ScheduledAt:     scheduledAt,
		RepeatRule:      repeatRule,
		LeadMinutes:     r.LeadMinutes,
		Notes:           r.Notes,
		DurationMinutes: r.DurationMinutes,
		Timezone:        r.Timezone,
		Prompt:          r.Prompt,
		Status:          status,
		Priority:        r.Priority,
		Tags:            r.Tags,
		Subtasks:        r.Subtasks,
		IsPinned:        r.IsPinned,
	}
}

var dispatchDesktopNotification = sendDesktopNotification

func escapePowerShellSingleQuoted(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func sendDesktopNotification(title, message string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if runtime.GOOS == "darwin" {
		subtitle := title
		if title == "日程管家" || title == "日程管家系统通知" || strings.TrimSpace(title) == "" {
			subtitle = "系统通知"
		}
		script := `on run argv
display notification (item 1 of argv) with title (item 2 of argv) subtitle (item 3 of argv) sound name "default"
end run`
		cmd := exec.CommandContext(ctx, "osascript", "-e", script, "--", message, "📅 日程管家", subtitle)
		_ = cmd.Run()
	} else if runtime.GOOS == "windows" {
		psTitle := escapePowerShellSingleQuoted(title)
		psMessage := escapePowerShellSingleQuoted(message)
		psScript := fmt.Sprintf(`[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $textNodes = $template.GetElementsByTagName('text'); $textNodes.Item(0).AppendChild($template.CreateTextNode(%s)) > $null; $textNodes.Item(1).AppendChild($template.CreateTextNode(%s)) > $null; $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('AgendaButler').Show($toast)`, psTitle, psMessage)
		_ = exec.CommandContext(ctx, "powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", psScript).Run()
	} else if runtime.GOOS == "linux" {
		_ = exec.CommandContext(ctx, "notify-send", "-a", "Agenda Butler", "-i", "calendar", title, message).Run()
	} else {
		log.Printf("[Notification] %s: %s", title, message)
	}
}

func calculateNextOccurrence(start time.Time, rrule string, after time.Time) time.Time {
	rule := strings.ToUpper(rrule)
	parts := strings.Split(rule, ";")
	params := make(map[string]string)
	for _, p := range parts {
		kv := strings.SplitN(p, "=", 2)
		if len(kv) == 2 {
			params[kv[0]] = kv[1]
		}
	}

	freq := params["FREQ"]
	interval := 1
	if intStr, ok := params["INTERVAL"]; ok {
		if iv, err := strconv.Atoi(intStr); err == nil && iv > 0 {
			interval = iv
		}
	}

	next := start
	// Loop until next > after with bounded iterations for malformed rules
	for steps := 0; !next.After(after) && steps < 5000; steps++ {
		prev := next
		switch freq {
		case "DAILY":
			next = next.AddDate(0, 0, interval)
		case "WEEKLY":
			byDay, hasByDay := params["BYDAY"]
			if hasByDay && byDay != "" {
				next = nextWeekDay(next, byDay, interval)
			} else {
				next = next.AddDate(0, 0, 7*interval)
			}
		case "MONTHLY":
			if byDay, ok := params["BYDAY"]; ok && byDay != "" {
				next = nextMonthlyByDay(next, interval, byDay)
			} else if byMonthDay, ok := params["BYMONTHDAY"]; ok && byMonthDay != "" {
				next = nextMonthlyByMonthDay(next, interval, byMonthDay)
			} else {
				next = next.AddDate(0, interval, 0)
			}
		case "YEARLY":
			next = next.AddDate(interval, 0, 0)
		default:
			next = next.AddDate(0, 0, 1)
		}
		if !next.After(prev) {
			next = prev.AddDate(0, 0, 1)
		}
	}

	return next
}

func isoWeekdayOrder(wd time.Weekday) int {
	if wd == time.Sunday {
		return 7
	}
	return int(wd)
}

func nextWeekDay(current time.Time, byDay string, interval int) time.Time {
	if interval <= 0 {
		interval = 1
	}
	days := strings.Split(byDay, ",")
	dayMap := map[string]time.Weekday{
		"SU": time.Sunday,
		"MO": time.Monday,
		"TU": time.Tuesday,
		"WE": time.Wednesday,
		"TH": time.Thursday,
		"FR": time.Friday,
		"SA": time.Saturday,
	}

	targetDays := make(map[time.Weekday]bool)
	for _, d := range days {
		if wd, ok := dayMap[strings.TrimSpace(d)]; ok {
			targetDays[wd] = true
		}
	}
	if len(targetDays) == 0 {
		return current.AddDate(0, 0, 7*interval)
	}

	curOrder := isoWeekdayOrder(current.Weekday())
	candidate := current.AddDate(0, 0, 1)
	// First check remaining days in the current ISO week (through Sunday)
	for isoWeekdayOrder(candidate.Weekday()) > curOrder {
		if targetDays[candidate.Weekday()] {
			return candidate
		}
		candidate = candidate.AddDate(0, 0, 1)
	}

	// candidate is now Monday of the next week; skip (interval - 1) weeks if interval > 1
	if interval > 1 {
		candidate = candidate.AddDate(0, 0, (interval-1)*7)
	}

	for i := 0; i < 7; i++ {
		if targetDays[candidate.Weekday()] {
			return candidate
		}
		candidate = candidate.AddDate(0, 0, 1)
	}
	return current.AddDate(0, 0, 7*interval)
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}

func resolveMonthlyByDay(year int, month time.Month, byDay string, ref time.Time) (time.Time, bool) {
	dayMap := map[string]time.Weekday{
		"SU": time.Sunday,
		"MO": time.Monday,
		"TU": time.Tuesday,
		"WE": time.Wednesday,
		"TH": time.Thursday,
		"FR": time.Friday,
		"SA": time.Saturday,
	}
	spec := strings.TrimSpace(strings.Split(byDay, ",")[0])
	if len(spec) < 2 {
		return time.Time{}, false
	}
	dayCode := spec[len(spec)-2:]
	targetWd, ok := dayMap[dayCode]
	if !ok {
		return time.Time{}, false
	}
	prefix := spec[:len(spec)-2]
	nth := 1
	if prefix != "" {
		if parsed, err := strconv.Atoi(prefix); err == nil && parsed != 0 {
			nth = parsed
		}
	}

	if nth < 0 {
		// Count backwards from end of month (e.g. -1FR = last Friday)
		lastDay := daysInMonth(year, month)
		d := time.Date(year, month, lastDay, ref.Hour(), ref.Minute(), ref.Second(), ref.Nanosecond(), ref.Location())
		for d.Month() == month && d.Weekday() != targetWd {
			d = d.AddDate(0, 0, -1)
		}
		if nth < -1 {
			d = d.AddDate(0, 0, 7*(nth+1))
		}
		if d.Month() != month {
			return time.Time{}, false
		}
		return d, true
	}

	// Positive nth weekday of month (e.g. 1MO, 2FR)
	d := time.Date(year, month, 1, ref.Hour(), ref.Minute(), ref.Second(), ref.Nanosecond(), ref.Location())
	for d.Month() == month && d.Weekday() != targetWd {
		d = d.AddDate(0, 0, 1)
	}
	if nth > 1 {
		d = d.AddDate(0, 0, 7*(nth-1))
	}
	if d.Month() != month {
		return time.Time{}, false
	}
	return d, true
}

func nextMonthlyByDay(current time.Time, interval int, byDay string) time.Time {
	// Check if later in current month first
	if cand, ok := resolveMonthlyByDay(current.Year(), current.Month(), byDay, current); ok && cand.After(current) {
		return cand
	}
	targetMonth := time.Date(current.Year(), current.Month(), 1, current.Hour(), current.Minute(), current.Second(), current.Nanosecond(), current.Location()).AddDate(0, interval, 0)
	if cand, ok := resolveMonthlyByDay(targetMonth.Year(), targetMonth.Month(), byDay, current); ok {
		return cand
	}
	return current.AddDate(0, interval, 0)
}

func resolveMonthlyByMonthDay(year int, month time.Month, byMonthDay string, ref time.Time) (time.Time, bool) {
	spec := strings.TrimSpace(strings.Split(byMonthDay, ",")[0])
	dayNum, err := strconv.Atoi(spec)
	if err != nil || dayNum == 0 {
		return time.Time{}, false
	}
	maxDay := daysInMonth(year, month)
	targetDay := dayNum
	if dayNum < 0 {
		targetDay = maxDay + 1 + dayNum
	}
	if targetDay < 1 {
		targetDay = 1
	} else if targetDay > maxDay {
		targetDay = maxDay
	}
	return time.Date(year, month, targetDay, ref.Hour(), ref.Minute(), ref.Second(), ref.Nanosecond(), ref.Location()), true
}

func nextMonthlyByMonthDay(current time.Time, interval int, byMonthDay string) time.Time {
	if cand, ok := resolveMonthlyByMonthDay(current.Year(), current.Month(), byMonthDay, current); ok && cand.After(current) {
		return cand
	}
	targetMonth := time.Date(current.Year(), current.Month(), 1, current.Hour(), current.Minute(), current.Second(), current.Nanosecond(), current.Location()).AddDate(0, interval, 0)
	if cand, ok := resolveMonthlyByMonthDay(targetMonth.Year(), targetMonth.Month(), byMonthDay, current); ok {
		return cand
	}
	return current.AddDate(0, interval, 0)
}
