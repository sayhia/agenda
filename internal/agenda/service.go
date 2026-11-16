package agenda

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

type AgendaService struct {
	db        *DB
	desktop   *DesktopManager
	scheduler *Scheduler
}

func NewAgendaService(db *DB) *AgendaService {
	return &AgendaService{db: db}
}

func (s *AgendaService) SetDesktopManager(dm *DesktopManager) {
	s.desktop = dm
}

func (s *AgendaService) SetScheduler(sched *Scheduler) {
	s.scheduler = sched
}

func (s *AgendaService) notifyDataChanged() {
	if s.desktop != nil {
		s.desktop.NotifyDataChanged()
	}
}

func (s *AgendaService) GetReminders() ([]Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetAllReminders()
}

func (s *AgendaService) GetReminder(id string) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetReminder(id)
}

// parseFlexibleTime parses multiple common date/time formats and returns a valid time.Time
func parseFlexibleTime(s string) (time.Time, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, errors.New("empty time string")
	}
	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05Z07:00",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02T15:04",
		"2006-01-02",
	}
	for _, f := range formats {
		if t, err := time.ParseInLocation(f, s, time.Local); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unable to parse time: %s", s)
}

func (s *AgendaService) AddReminder(req CreateReminderRequest) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	if strings.TrimSpace(req.Title) == "" {
		return nil, errors.New("标题不能为空")
	}
	now := time.Now()
	if req.ScheduledAt == "" {
		req.ScheduledAt = now.Add(30 * time.Minute).Format(time.RFC3339)
	} else {
		// Defensive guard against past time & instant expiration:
		t, err := parseFlexibleTime(req.ScheduledAt)
		if err == nil {
			if t.Before(now) || t.Equal(now) || t.Sub(now) < time.Minute {
				if req.RepeatRule == "" {
					// Single reminder: bump to now + 15 minutes so it never triggers and expires on the 0th millisecond
					t = now.Add(15 * time.Minute)
				} else {
					// Repeating reminder: calculate next future recurrence
					t = calculateNextOccurrence(t, req.RepeatRule, now)
				}
			}
			req.ScheduledAt = t.Format(time.RFC3339)
		} else {
			req.ScheduledAt = now.Add(15 * time.Minute).Format(time.RFC3339)
		}
	}
	created, err := s.db.CreateReminder(req)
	if err == nil {
		s.notifyDataChanged()
	}
	return created, err
}

func (s *AgendaService) UpdateReminder(req UpdateReminderRequest) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	if strings.TrimSpace(req.ID) == "" {
		return nil, errors.New("ID 不能为空")
	}
	if strings.TrimSpace(req.Title) == "" {
		return nil, errors.New("标题不能为空")
	}
	updated, err := s.db.UpdateReminder(req)
	if err == nil {
		s.notifyDataChanged()
	}
	return updated, err
}

func (s *AgendaService) DeleteReminder(id string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.DeleteReminder(id)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) BatchDelete(ids []string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.BatchDelete(ids)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) BatchSetStatus(ids []string, status string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.BatchSetStatus(ids, status)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) BatchSetPriority(ids []string, priority string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.BatchSetPriority(ids, priority)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) UpdateSubtasks(id string, subtasks string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.UpdateSubtasks(id, subtasks)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) ArchiveOldEndedReminders(days int) (int, error) {
	if s.db == nil {
		return 0, errors.New("database not initialized")
	}
	count, err := s.db.ArchiveOldEndedReminders(days)
	if err == nil && count > 0 {
		s.notifyDataChanged()
	}
	return count, err
}

func (s *AgendaService) ClearDeliveryHistory() error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.ClearDeliveryHistory()
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) BackupDatabase() (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	return s.db.BackupDatabase("")
}

func (s *AgendaService) RestoreDatabase(backupPath string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.RestoreDatabase(backupPath)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) GetBackupsList() ([]string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".agenda", "backups")
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	var backups []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".db") {
			backups = append(backups, filepath.Join(dir, e.Name()))
		}
	}
	return backups, nil
}

func (s *AgendaService) CheckConflict(scheduledAt string, durationMinutes int, excludeID string) ([]Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	t, err := parseFlexibleTime(scheduledAt)
	if err != nil {
		return nil, fmt.Errorf("invalid time format: %w", err)
	}
	if durationMinutes <= 0 {
		durationMinutes = 30
	}
	endTime := t.Add(time.Duration(durationMinutes) * time.Minute)

	all, err := s.db.GetAllReminders()
	if err != nil {
		return nil, err
	}

	var conflicts []Reminder
	for _, r := range all {
		if r.ID == excludeID || r.Status != "active" {
			continue
		}
		rt, err := parseFlexibleTime(r.ScheduledAt)
		if err != nil {
			continue
		}
		rdur := r.DurationMinutes
		if rdur <= 0 {
			rdur = 30
		}
		rend := rt.Add(time.Duration(rdur) * time.Minute)

		if t.Before(rend) && rt.Before(endTime) {
			conflicts = append(conflicts, r)
		}
	}
	return conflicts, nil
}

func (s *AgendaService) GetDeliveryHistory(reminderID string) ([]DeliveryRecord, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetDeliveryHistory(reminderID)
}

func (s *AgendaService) GetStats() (*Stats, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetStats()
}

func (s *AgendaService) ExportICS() (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	reminders, err := s.db.GetAllReminders()
	if err != nil {
		return "", err
	}
	return ExportICS(reminders), nil
}

func (s *AgendaService) ImportICS(content string) (int, error) {
	if s.db == nil {
		return 0, errors.New("database not initialized")
	}
	events, err := ImportICS(content)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, ev := range events {
		if _, err := s.db.CreateReminder(ev); err == nil {
			count++
		}
	}
	if count > 0 {
		s.notifyDataChanged()
	}
	return count, nil
}

func (s *AgendaService) GetSettings() (map[string]string, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetSettings()
}

func (s *AgendaService) SaveSettings(settings map[string]string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	return s.db.SaveSettings(settings)
}

func (s *AgendaService) TriggerTestNotification(title, message string) string {
	sendDesktopNotification(title, message)
	return fmt.Sprintf("已发送通知: %s", title)
}

func (s *AgendaService) RestoreReminder(id string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.RestoreReminder(id)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) PermanentDelete(id string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.PermanentDelete(id)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) GetTrashReminders() ([]Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetTrashReminders()
}

func (s *AgendaService) EmptyTrash() error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.EmptyTrash()
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) CleanExpiredTrash(retentionDays int) (int64, error) {
	if s.db == nil {
		return 0, errors.New("database not initialized")
	}
	return s.db.CleanExpiredTrash(retentionDays)
}

func (s *AgendaService) DuplicateReminder(id string, newScheduledAt string) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	orig, err := s.db.GetReminder(id)
	if err != nil {
		return nil, fmt.Errorf("原日程不存在: %w", err)
	}

	sched := newScheduledAt
	if strings.TrimSpace(sched) == "" {
		t, err := parseFlexibleTime(orig.ScheduledAt)
		if err == nil {
			sched = t.AddDate(0, 0, 1).Format(time.RFC3339)
		} else {
			sched = time.Now().Add(24 * time.Hour).Format(time.RFC3339)
		}
	}

	req := CreateReminderRequest{
		Title:           orig.Title + " (副本)",
		ScheduledAt:     sched,
		RepeatRule:      orig.RepeatRule,
		LeadMinutes:     orig.LeadMinutes,
		Notes:           orig.Notes,
		DurationMinutes: orig.DurationMinutes,
		Timezone:        orig.Timezone,
		Prompt:          orig.Prompt,
		Priority:        orig.Priority,
		Tags:            orig.Tags,
		Subtasks:        orig.Subtasks,
		IsPinned:        orig.IsPinned,
	}
	return s.AddReminder(req)
}

func (s *AgendaService) FindOptimalFreeSlot(dateStr string, durationMinutes int) (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	if durationMinutes <= 0 {
		durationMinutes = 30
	}

	loc := time.Local
	targetDate, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(dateStr), loc)
	if err != nil {
		if tFlex, err2 := parseFlexibleTime(dateStr); err2 == nil {
			targetDate = tFlex.In(loc)
		} else {
			targetDate = time.Now().In(loc)
		}
	}

	dayStart := time.Date(targetDate.Year(), targetDate.Month(), targetDate.Day(), 9, 0, 0, 0, loc)
	dayEnd := time.Date(targetDate.Year(), targetDate.Month(), targetDate.Day(), 19, 0, 0, 0, loc)

	reminders, err := s.db.GetAllReminders()
	if err != nil {
		return "", err
	}

	type interval struct {
		start time.Time
		end   time.Time
	}
	var busy []interval

	for _, r := range reminders {
		if r.Status == "ended" || r.Status == "expired" {
			continue
		}
		t, err := parseFlexibleTime(r.ScheduledAt)
		if err != nil {
			continue
		}
		t = t.In(loc)
		dur := r.DurationMinutes
		if dur <= 0 {
			dur = 30
		}
		rEnd := t.Add(time.Duration(dur) * time.Minute)

		if t.Before(dayEnd) && rEnd.After(dayStart) {
			busy = append(busy, interval{start: t, end: rEnd})
		}
	}

	sort.Slice(busy, func(i, j int) bool {
		if busy[i].start.Equal(busy[j].start) {
			return busy[i].end.Before(busy[j].end)
		}
		return busy[i].start.Before(busy[j].start)
	})

	curr := dayStart
	now := time.Now().In(loc)
	if targetDate.Year() == now.Year() && targetDate.YearDay() == now.YearDay() {
		if now.After(curr) {
			curr = now.Add(15 * time.Minute)
			min := curr.Minute()
			remainder := min % 15
			if remainder != 0 {
				curr = curr.Add(time.Duration(15-remainder) * time.Minute)
			}
			curr = time.Date(curr.Year(), curr.Month(), curr.Day(), curr.Hour(), curr.Minute(), 0, 0, loc)
		}
	}

	slotDur := time.Duration(durationMinutes) * time.Minute
	for curr.Add(slotDur).Before(dayEnd) || curr.Add(slotDur).Equal(dayEnd) {
		slotEnd := curr.Add(slotDur)
		hasConflict := false
		for _, b := range busy {
			if curr.Before(b.end) && slotEnd.After(b.start) {
				hasConflict = true
				curr = b.end
				break
			}
		}
		if !hasConflict {
			return curr.Format(time.RFC3339), nil
		}
	}

	return dayEnd.Format(time.RFC3339), nil
}

func (s *AgendaService) CheckSimilarReminders(title string, scheduledAt string, excludeID string) ([]Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	title = strings.TrimSpace(strings.ToLower(title))
	if title == "" {
		return []Reminder{}, nil
	}

	all, err := s.db.GetAllReminders()
	if err != nil {
		return nil, err
	}

	var targetDate string
	if t, err := parseFlexibleTime(scheduledAt); err == nil {
		targetDate = t.In(time.Local).Format("2006-01-02")
	}

	var similar []Reminder
	for _, r := range all {
		if r.ID == excludeID || r.Status == "ended" || r.Status == "expired" {
			continue
		}
		rTitle := strings.ToLower(r.Title)

		if targetDate != "" {
			if t, err := parseFlexibleTime(r.ScheduledAt); err == nil {
				if t.In(time.Local).Format("2006-01-02") != targetDate {
					continue
				}
			}
		}

		if rTitle == title || strings.Contains(rTitle, title) || strings.Contains(title, rTitle) {
			similar = append(similar, r)
		}
	}
	return similar, nil
}

func (s *AgendaService) OptimizeDatabase() (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	return s.db.OptimizeDatabase()
}

func (s *AgendaService) TogglePinReminder(id string) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	updated, err := s.db.TogglePinReminder(id)
	if err == nil {
		s.notifyDataChanged()
	}
	return updated, err
}

func (s *AgendaService) BatchSetPinned(ids []string, pinned bool) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.BatchSetPinned(ids, pinned)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) BatchAddTag(ids []string, tag string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.BatchAddTag(ids, tag)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) CheckTimeConflicts(scheduledAt string, durationMinutes int, excludeID string) ([]Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	if durationMinutes <= 0 {
		durationMinutes = 30
	}
	targetStart, err := parseFlexibleTime(scheduledAt)
	if err != nil {
		return []Reminder{}, nil
	}
	targetEnd := targetStart.Add(time.Duration(durationMinutes) * time.Minute)

	all, err := s.db.GetAllReminders()
	if err != nil {
		return nil, err
	}

	var conflicts []Reminder
	for _, r := range all {
		if r.ID == excludeID || r.Status == "ended" || r.Status == "expired" {
			continue
		}
		rStart, err := parseFlexibleTime(r.ScheduledAt)
		if err != nil {
			continue
		}
		rDur := r.DurationMinutes
		if rDur <= 0 {
			rDur = 30
		}
		rEnd := rStart.Add(time.Duration(rDur) * time.Minute)

		if targetStart.Before(rEnd) && rStart.Before(targetEnd) {
			conflicts = append(conflicts, r)
		}
	}
	return conflicts, nil
}

func (s *AgendaService) RevealInFinder(targetPath string) error {
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return errors.New("路径不能为空")
	}
	targetPath = strings.TrimPrefix(targetPath, "file://")

	fi, err := os.Stat(targetPath)
	if err != nil {
		return fmt.Errorf("文件或目录不存在: %w", err)
	}

	if runtime.GOOS == "darwin" {
		if fi.IsDir() {
			return exec.Command("open", targetPath).Run()
		}
		return exec.Command("open", "-R", targetPath).Run()
	} else if runtime.GOOS == "windows" {
		return exec.Command("explorer", "/select,", targetPath).Run()
	} else {
		return exec.Command("xdg-open", filepath.Dir(targetPath)).Run()
	}
}

func (s *AgendaService) ImportJSONBackup(jsonContent string) (int, error) {
	if s.db == nil {
		return 0, errors.New("database not initialized")
	}
	var items []CreateReminderRequest
	if err := json.Unmarshal([]byte(jsonContent), &items); err != nil {
		var wrapper struct {
			Reminders []CreateReminderRequest `json:"reminders"`
		}
		if err2 := json.Unmarshal([]byte(jsonContent), &wrapper); err2 != nil {
			return 0, fmt.Errorf("JSON 解析失败: %v", err)
		}
		items = wrapper.Reminders
	}

	count := 0
	for _, item := range items {
		if strings.TrimSpace(item.Title) == "" {
			continue
		}
		if _, err := s.db.CreateReminder(item); err == nil {
			count++
		}
	}
	if count > 0 {
		s.notifyDataChanged()
	}
	return count, nil
}

func (s *AgendaService) SaveAIChatMessage(id, role, content, actionsJSON string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	return s.db.SaveAIChatMessage(id, role, content, actionsJSON)
}

func (s *AgendaService) GetAIChatHistory() ([]AIChatRecord, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetAIChatHistory()
}

func (s *AgendaService) ClearAIChatHistory() error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	return s.db.ClearAIChatHistory()
}

func (s *AgendaService) GetOverdueReminders() ([]Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetOverdueReminders()
}

func (s *AgendaService) GetTagsSummary() (map[string]int, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetTagsSummary()
}

func (s *AgendaService) BatchSetSubtasks(ids []string, subtasks string) error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	err := s.db.BatchSetSubtasks(ids, subtasks)
	if err == nil {
		s.notifyDataChanged()
	}
	return err
}

func (s *AgendaService) FindLowDensitySlot(dateStr string, durationMinutes int) (string, error) {
	return s.FindOptimalFreeSlot(dateStr, durationMinutes)
}

func (s *AgendaService) ExportCSV() (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	reminders, err := s.db.GetAllReminders()
	if err != nil {
		return "", err
	}
	return ExportCSV(reminders)
}

func (s *AgendaService) ImportCSVContent(content string) (int, error) {
	if s.db == nil {
		return 0, errors.New("database not initialized")
	}
	items, err := ImportCSV(content)
	if err != nil {
		return 0, err
	}
	count := 0
	for _, it := range items {
		if _, err := s.db.CreateReminder(it); err == nil {
			count++
		}
	}
	if count > 0 {
		s.notifyDataChanged()
	}
	return count, nil
}

func (s *AgendaService) VacuumDatabase() error {
	if s.db == nil {
		return errors.New("database not initialized")
	}
	return s.db.Vacuum()
}

func (s *AgendaService) CheckDatabaseIntegrity() (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	return s.db.CheckIntegrity()
}

func (s *AgendaService) findConflictFreeSlot(scheduledAt string, durationMinutes int, excludeID string) (time.Time, bool, error) {
	dur := durationMinutes
	if dur <= 0 {
		dur = 30
	}
	conflicts, err := s.CheckTimeConflicts(scheduledAt, dur, excludeID)
	if err != nil {
		return time.Time{}, false, err
	}
	candidate, parseErr := parseFlexibleTime(scheduledAt)
	if parseErr != nil {
		candidate = time.Now()
	}
	if len(conflicts) == 0 {
		return candidate, false, nil
	}

	// Iteratively advance past any overlapping active/paused reminders with a 10-minute buffer
	for step := 0; step < 20; step++ {
		stepConflicts, err := s.CheckTimeConflicts(candidate.Format(time.RFC3339), dur, excludeID)
		if err != nil || len(stepConflicts) == 0 {
			break
		}
		latestEnd := candidate
		for _, c := range stepConflicts {
			t, err := parseFlexibleTime(c.ScheduledAt)
			if err == nil {
				cDur := c.DurationMinutes
				if cDur <= 0 {
					cDur = 30
				}
				end := t.Add(time.Duration(cDur) * time.Minute)
				if end.After(latestEnd) {
					latestEnd = end
				}
			}
		}
		candidate = latestEnd.Add(10 * time.Minute)
	}
	return candidate, true, nil
}

// SuggestNextFreeSlot returns the next conflict-free RFC3339 timestamp for a pending schedule draft.
func (s *AgendaService) SuggestNextFreeSlot(scheduledAt string, durationMinutes int) (string, error) {
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	slot, _, err := s.findConflictFreeSlot(scheduledAt, durationMinutes, "")
	if err != nil {
		return "", err
	}
	return slot.Format(time.RFC3339), nil
}

func (s *AgendaService) AutoResolveConflict(reminderID string) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	rem, err := s.db.GetReminder(reminderID)
	if err != nil || rem == nil {
		return nil, errors.New("日程未找到")
	}

	candidate, hadConflict, err := s.findConflictFreeSlot(rem.ScheduledAt, rem.DurationMinutes, reminderID)
	if err != nil {
		return nil, err
	}
	if !hadConflict {
		return rem, nil
	}

	newScheduledStr := candidate.Format(time.RFC3339)

	updated, err := s.db.UpdateReminder(UpdateReminderRequest{
		ID:              rem.ID,
		Title:           rem.Title,
		ScheduledAt:     newScheduledStr,
		RepeatRule:      rem.RepeatRule,
		LeadMinutes:     rem.LeadMinutes,
		Notes:           rem.Notes,
		DurationMinutes: rem.DurationMinutes,
		Timezone:        rem.Timezone,
		Prompt:          rem.Prompt,
		Status:          rem.Status,
		Priority:        rem.Priority,
		Tags:            rem.Tags,
		Subtasks:        rem.Subtasks,
		IsPinned:        rem.IsPinned,
	})
	if err == nil {
		s.notifyDataChanged()
	}
	return updated, err
}

func (s *AgendaService) GetDatabaseStats() (map[string]interface{}, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	reminders, err := s.db.GetAllReminders()
	if err != nil {
		return nil, err
	}

	total := len(reminders)
	active := 0
	ended := 0
	expired := 0
	paused := 0
	overdue := 0
	now := time.Now()

	for _, r := range reminders {
		switch r.Status {
		case "active":
			active++
			t, err := parseFlexibleTime(r.ScheduledAt)
			if err == nil && t.Before(now) {
				overdue++
			}
		case "expired":
			expired++
			overdue++
		case "ended":
			ended++
		case "paused":
			paused++
		}
	}

	trashItems, _ := s.db.GetTrashReminders()
	integrity, _ := s.db.CheckIntegrity()

	dbPath := s.db.dbPath
	if strings.TrimSpace(dbPath) == "" {
		home, _ := os.UserHomeDir()
		dbPath = filepath.Join(home, ".agenda", "agenda.db")
	}
	var fileSize int64 = 0
	if fi, err := os.Stat(dbPath); err == nil {
		fileSize = fi.Size()
	}

	return map[string]interface{}{
		"total":       total,
		"active":      active,
		"ended":       ended,
		"expired":     expired,
		"paused":      paused,
		"overdue":     overdue,
		"trash_count": len(trashItems),
		"file_size":   fileSize,
		"integrity":   integrity,
		"db_path":     dbPath,
	}, nil
}

// SnoozeReminder pushes an active or expired reminder forward by N minutes (from max(now, scheduled_at))
// and ensures its status is set to active.
func (s *AgendaService) SnoozeReminder(id string, minutes int) (*Reminder, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	if minutes <= 0 {
		minutes = 10
	}
	rem, err := s.db.GetReminder(id)
	if err != nil || rem == nil {
		return nil, errors.New("日程未找到")
	}
	base := time.Now()
	if t, err := parseFlexibleTime(rem.ScheduledAt); err == nil && t.After(base) {
		base = t
	}
	nextAt := base.Add(time.Duration(minutes) * time.Minute).Format(time.RFC3339)
	updated, err := s.db.UpdateReminder(UpdateReminderRequest{
		ID:              rem.ID,
		Title:           rem.Title,
		ScheduledAt:     nextAt,
		RepeatRule:      rem.RepeatRule,
		LeadMinutes:     rem.LeadMinutes,
		Notes:           rem.Notes,
		DurationMinutes: rem.DurationMinutes,
		Timezone:        rem.Timezone,
		Prompt:          rem.Prompt,
		Status:          "active",
		Priority:        rem.Priority,
		Tags:            rem.Tags,
		Subtasks:        rem.Subtasks,
		IsPinned:        rem.IsPinned,
	})
	if err == nil {
		s.notifyDataChanged()
	}
	return updated, err
}

func (s *AgendaService) GetDesktopPreferences() (DesktopPreferences, error) {
	if s.db == nil {
		return DefaultDesktopPreferences(), errors.New("database not initialized")
	}
	return LoadDesktopPreferences(s.db), nil
}

func (s *AgendaService) SaveDesktopPreferences(prefs DesktopPreferences) (DesktopPreferences, error) {
	if s.db == nil {
		return DefaultDesktopPreferences(), errors.New("database not initialized")
	}
	normalized := NormalizeDesktopPreferences(prefs)
	if err := SaveDesktopPreferences(s.db, normalized); err != nil {
		return normalized, err
	}
	if s.desktop != nil {
		s.desktop.NotifyPreferencesChanged()
	} else if s.scheduler != nil {
		s.scheduler.SetPaused(normalized.SchedulerPaused)
	}
	return normalized, nil
}

func (s *AgendaService) GetDesktopRuntimeStatus() (DesktopRuntimeStatus, error) {
	if s.desktop != nil {
		return s.desktop.GetRuntimeStatus(), nil
	}
	prefs := LoadDesktopPreferences(s.db)
	var schedStatus SchedulerStatus
	if s.scheduler != nil {
		schedStatus = s.scheduler.GetStatus()
	}
	return DesktopRuntimeStatus{
		Preferences: prefs,
		Scheduler:   schedStatus,
		Windows:     []WindowSummary{},
	}, nil
}

func (s *AgendaService) OpenDesktopWindow(kind string, param string) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.OpenWindow(kind, param)
}

func (s *AgendaService) ToggleDesktopWindow(kind string) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.ToggleWindow(kind)
}

func (s *AgendaService) CloseDesktopWindow(name string) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.CloseWindow(name)
}

func (s *AgendaService) FocusDesktopWindow(name string) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.FocusWindow(name)
}

func (s *AgendaService) SetDesktopWindowAlwaysOnTop(name string, onTop bool) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.SetWindowAlwaysOnTop(name, onTop)
}

func (s *AgendaService) SetTrayPopoverPinned(pinned bool) error {
	if s.desktop == nil {
		return nil
	}
	s.desktop.SetPopoverPinned(pinned)
	return nil
}

func (s *AgendaService) SetSchedulerPaused(paused bool) error {
	if s.desktop != nil {
		return s.desktop.SetSchedulerPaused(paused)
	}
	if s.scheduler != nil {
		s.scheduler.SetPaused(paused)
	}
	if s.db != nil {
		p := LoadDesktopPreferences(s.db)
		p.SchedulerPaused = paused
		return SaveDesktopPreferences(s.db, p)
	}
	return nil
}

func (s *AgendaService) PauseSchedulerFor(minutes int) error {
	if s.desktop != nil {
		return s.desktop.PauseSchedulerFor(minutes)
	}
	if s.scheduler != nil {
		s.scheduler.PauseFor(minutes)
	}
	return nil
}

func (s *AgendaService) SetAutoStartEnabled(enabled bool) (AutoStartInfo, error) {
	if s.desktop == nil {
		return AutoStartInfo{Supported: false}, errors.New("desktop runtime not available")
	}
	return s.desktop.SetAutoStartEnabled(enabled)
}

func (s *AgendaService) UpdateFocusTrayStatus(running bool, mode string, clock string, title string) error {
	if s.desktop == nil {
		return nil
	}
	s.desktop.UpdateFocusState(FocusTrayState{
		Running: running,
		Mode:    mode,
		Clock:   clock,
		Title:   title,
	})
	return nil
}

func (s *AgendaService) SendMorningBriefingNow() (string, error) {
	if s.scheduler != nil {
		return s.scheduler.SendMorningBriefingDigest()
	}
	if s.db == nil {
		return "", errors.New("database not initialized")
	}
	sched := NewScheduler(s.db, nil)
	return sched.SendMorningBriefingDigest()
}

func (s *AgendaService) TriggerOpenInMain(reminderID string) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.TriggerOpenInMain(reminderID)
}

// SendDesktopNotification dispatches a native OS notification unless Do-Not-Disturb is active.
func (s *AgendaService) SendDesktopNotification(title string, body string) error {
	if s.db != nil {
		prefs := LoadDesktopPreferences(s.db)
		if IsWithinDND(prefs, time.Now()) {
			return nil
		}
	}
	if strings.TrimSpace(title) == "" {
		title = "Agenda Butler"
	}
	dispatchDesktopNotification(title, body)
	return nil
}

func (s *AgendaService) RefreshTrayMenu() error {
	if s.desktop != nil {
		s.desktop.UpdateTrayStatus()
		s.desktop.RebuildTrayMenu()
	}
	return nil
}

func (s *AgendaService) SnoozeAllOverdue(minutes int) (int, error) {
	if s.db == nil {
		return 0, errors.New("database not initialized")
	}
	if minutes <= 0 {
		minutes = 15
	}
	overdue, err := s.db.GetOverdueReminders()
	if err != nil {
		return 0, err
	}
	count := 0
	nextAt := time.Now().Add(time.Duration(minutes) * time.Minute).Format(time.RFC3339)
	for _, rem := range overdue {
		_, err := s.db.UpdateReminder(UpdateReminderRequest{
			ID:              rem.ID,
			Title:           rem.Title,
			ScheduledAt:     nextAt,
			RepeatRule:      rem.RepeatRule,
			LeadMinutes:     rem.LeadMinutes,
			Notes:           rem.Notes,
			DurationMinutes: rem.DurationMinutes,
			Timezone:        rem.Timezone,
			Prompt:          rem.Prompt,
			Status:          "active",
			Priority:        rem.Priority,
			Tags:            rem.Tags,
			Subtasks:        rem.Subtasks,
			IsPinned:        rem.IsPinned,
		})
		if err == nil {
			count++
		}
	}
	if count > 0 {
		s.notifyDataChanged()
	}
	return count, nil
}

func (s *AgendaService) GetRecentDeliveries(limit int) ([]RecentDeliveryItem, error) {
	if s.db == nil {
		return nil, errors.New("database not initialized")
	}
	return s.db.GetRecentDeliveries(limit)
}

func (s *AgendaService) ResizeDesktopWindow(name string, width, height int) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.ResizeWindow(name, width, height)
}

func (s *AgendaService) ResetDesktopWindowBounds(name string) error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.ResetWindowBounds(name)
}

func (s *AgendaService) ResetAllDesktopWindowBounds() error {
	if s.desktop == nil {
		return nil
	}
	return s.desktop.ResetAllWindowBounds()
}

func (s *AgendaService) HideAllAuxiliaryWindows() error {
	if s.desktop != nil {
		s.desktop.HideAllAuxiliaryWindows()
	}
	return nil
}

func (s *AgendaService) TriggerImmediateSchedulerCheck() error {
	if s.scheduler != nil {
		s.scheduler.TriggerImmediateCheck()
	}
	if s.desktop != nil {
		s.desktop.NotifyDataChanged()
	}
	return nil
}
