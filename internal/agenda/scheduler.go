package agenda

import (
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

type Scheduler struct {
	db     *DB
	app    *application.App
	stopCh chan struct{}
	mu     sync.Mutex
}

func NewScheduler(db *DB, app *application.App) *Scheduler {
	return &Scheduler{
		db:     db,
		app:    app,
		stopCh: make(chan struct{}),
	}
}

func (s *Scheduler) Start() {
	ticker := time.NewTicker(3 * time.Second)
	go func() {
		for {
			select {
			case <-ticker.C:
				s.checkReminders()
			case <-s.stopCh:
				ticker.Stop()
				return
			}
		}
	}()
}

func (s *Scheduler) Stop() {
	close(s.stopCh)
}

func (s *Scheduler) checkReminders() {
	s.mu.Lock()
	defer s.mu.Unlock()

	reminders, err := s.db.GetAllReminders()
	if err != nil {
		return
	}

	now := time.Now()
	hasUpdates := false

	for _, r := range reminders {
		if r.Status != "active" {
			continue
		}

		scheduledTime, err := time.Parse(time.RFC3339, r.ScheduledAt)
		if err != nil {
			continue
		}

		// Check if it's time to trigger
		if now.After(scheduledTime) || now.Equal(scheduledTime) {
			s.triggerReminder(&r, scheduledTime, now)
			hasUpdates = true
		}
	}

	if hasUpdates && s.app != nil {
		s.app.Event.Emit("reminders-updated", true)
	}
}

func (s *Scheduler) triggerReminder(r *Reminder, scheduledTime, now time.Time) {
	// 1. Send native desktop notification
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

	title := fmt.Sprintf("日程提醒: %s", r.Title)
	dispatchDesktopNotification(title, msg)

	// 2. Record delivery history
	_ = s.db.AddDeliveryRecord(r.ID, msg, "success", "")

	// 3. Emit real-time event to Wails frontend
	if s.app != nil {
		s.app.Event.Emit("reminder-triggered", map[string]interface{}{
			"id":           r.ID,
			"title":        r.Title,
			"scheduled_at": r.ScheduledAt,
			"prompt":       msg,
			"triggered_at": now.Format(time.RFC3339),
		})
	}

	// 4. Update reminder for next repeat or mark as ended
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
					// Last occurrence executed! Mark as ended while preserving pin state
					_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, r.ScheduledAt, r.RepeatRule, "ended"))
					return
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
		_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, nextTime.Format(time.RFC3339), r.RepeatRule, "active"))
	} else {
		_, _ = s.db.UpdateReminder(triggeredReminderUpdate(r, r.ScheduledAt, r.RepeatRule, "ended"))
	}
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

func sendDesktopNotification(title, message string) {
	if runtime.GOOS == "darwin" {
		var script string
		if title == "日程管家" || title == "日程管家系统通知" {
			script = fmt.Sprintf(`display notification %q with title %q subtitle "系统通知" sound name "default"`, message, "📅 日程管家")
		} else {
			script = fmt.Sprintf(`display notification %q with title %q subtitle %q sound name "default"`, message, "📅 日程管家", title)
		}
		cmd := exec.Command("osascript", "-e", script)
		_ = cmd.Run()
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
				next = nextWeekDay(next, byDay)
			} else {
				next = next.AddDate(0, 0, 7*interval)
			}
		case "MONTHLY":
			next = next.AddDate(0, interval, 0)
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

func nextWeekDay(current time.Time, byDay string) time.Time {
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

	candidate := current.AddDate(0, 0, 1)
	for i := 0; i < 14; i++ {
		if targetDays[candidate.Weekday()] {
			return candidate
		}
		candidate = candidate.AddDate(0, 0, 1)
	}
	return current.AddDate(0, 0, 7)
}
