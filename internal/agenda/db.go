package agenda

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Reminder struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	ScheduledAt     string `json:"scheduled_at"`
	RepeatRule      string `json:"repeat_rule"`
	LeadMinutes     int    `json:"lead_minutes"`
	Notes           string `json:"notes"`
	DurationMinutes int    `json:"duration_minutes"`
	Timezone        string `json:"timezone"`
	Prompt          string `json:"prompt"`
	Status          string `json:"status"` // "active", "paused", "ended", "expired"
	Priority        string `json:"priority"` // "p0", "p1", "p2", "p3"
	Tags            string `json:"tags"`     // comma separated, e.g. "工作,限流"
	Subtasks        string `json:"subtasks"` // JSON string of subtasks array
	DeletedAt       string `json:"deleted_at"`
	IsPinned        bool   `json:"is_pinned"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

type AIChatRecord struct {
	ID          string `json:"id"`
	Role        string `json:"role"`
	Content     string `json:"content"`
	ActionsJSON string `json:"actions_json"`
	CreatedAt   string `json:"created_at"`
}

type PolishResult struct {
	Title    string   `json:"title"`
	Notes    string   `json:"notes"`
	Tags     []string `json:"tags"`
	Subtasks []string `json:"subtasks"`
}

type DeliveryRecord struct {
	ID          string `json:"id"`
	ReminderID  string `json:"reminder_id"`
	DeliveredAt string `json:"delivered_at"`
	Prompt      string `json:"prompt"`
	Status      string `json:"status"`
	Error       string `json:"error"`
}

type RecentDeliveryItem struct {
	ID            string `json:"id"`
	ReminderID    string `json:"reminder_id"`
	ReminderTitle string `json:"reminder_title"`
	DeliveredAt   string `json:"delivered_at"`
	Prompt        string `json:"prompt"`
	Status        string `json:"status"`
	Error         string `json:"error"`
}

type Stats struct {
	TotalReminders   int `json:"total_reminders"`
	ActiveReminders  int `json:"active_reminders"`
	TodayReminders   int `json:"today_reminders"`
	NearDueReminders int `json:"near_due_reminders"`
	PausedReminders  int `json:"paused_reminders"`
	EndedReminders   int `json:"ended_reminders"`
	ExpiredReminders int `json:"expired_reminders"`
	TotalDelivered   int `json:"total_delivered"`
}

type CreateReminderRequest struct {
	Title           string `json:"title"`
	ScheduledAt     string `json:"scheduled_at"`
	RepeatRule      string `json:"repeat_rule"`
	LeadMinutes     int    `json:"lead_minutes"`
	Notes           string `json:"notes"`
	DurationMinutes int    `json:"duration_minutes"`
	Timezone        string `json:"timezone"`
	Prompt          string `json:"prompt"`
	Priority        string `json:"priority"`
	Tags            string `json:"tags"`
	Subtasks        string `json:"subtasks"`
	IsPinned        bool   `json:"is_pinned"`
}

type UpdateReminderRequest struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	ScheduledAt     string `json:"scheduled_at"`
	RepeatRule      string `json:"repeat_rule"`
	LeadMinutes     int    `json:"lead_minutes"`
	Notes           string `json:"notes"`
	DurationMinutes int    `json:"duration_minutes"`
	Timezone        string `json:"timezone"`
	Prompt          string `json:"prompt"`
	Status          string `json:"status"`
	Priority        string `json:"priority"`
	Tags            string `json:"tags"`
	Subtasks        string `json:"subtasks"`
	IsPinned        bool   `json:"is_pinned"`
}

type DB struct {
	db     *sql.DB
	dbPath string
	mu     sync.RWMutex
}

func generateID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return fmt.Sprintf("%s-%x", prefix, b)
}

func getDBPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "agenda.db"
	}
	legacyDir := filepath.Join(home, ".agenda-desktop")
	newDir := filepath.Join(home, ".agenda")
	legacyDB := filepath.Join(legacyDir, "agenda.db")
	newDB := filepath.Join(newDir, "agenda.db")

	_ = os.MkdirAll(newDir, 0755)

	// Backward compatibility: migrate existing ~/.agenda-desktop/agenda.db if ~/.agenda/agenda.db does not exist yet
	if _, err := os.Stat(newDB); os.IsNotExist(err) {
		if _, err := os.Stat(legacyDB); err == nil {
			_ = copyFile(legacyDB, newDB)
		}
	}

	return newDB
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

func (d *DB) Close() error {
	if d.db != nil {
		return d.db.Close()
	}
	return nil
}

func InitDBWithPath(dbPath string) (*DB, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open sqlite database: %w", err)
	}

	// Optimize SQLite performance & concurrency with Pragmas
	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA cache_size = -20000;", // 20 MB memory cache
		"PRAGMA temp_store = MEMORY;",
		"PRAGMA foreign_keys = ON;",
	}
	for _, p := range pragmas {
		_, _ = db.Exec(p)
	}

	d := &DB{db: db, dbPath: dbPath}
	if err := d.migrate(); err != nil {
		return nil, err
	}
	d.seedDefaultsIfEmpty()
	return d, nil
}

func InitDB() (*DB, error) {
	dbPath := getDBPath()
	d, err := InitDBWithPath(dbPath)
	if err != nil {
		return nil, err
	}

	// Trigger asynchronous daily auto-backup check
	go d.autoBackupIfStale()

	return d, nil
}

func (d *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS reminders (
		id TEXT PRIMARY KEY,
		title TEXT NOT NULL,
		scheduled_at TEXT NOT NULL,
		repeat_rule TEXT DEFAULT '',
		lead_minutes INTEGER DEFAULT 0,
		notes TEXT DEFAULT '',
		duration_minutes INTEGER DEFAULT 0,
		timezone TEXT DEFAULT '',
		prompt TEXT DEFAULT '',
		status TEXT DEFAULT 'active',
		priority TEXT DEFAULT 'p2',
		tags TEXT DEFAULT '',
		subtasks TEXT DEFAULT '',
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_reminders_scheduled_status ON reminders(status, scheduled_at);

	CREATE TABLE IF NOT EXISTS delivery_records (
		id TEXT PRIMARY KEY,
		reminder_id TEXT NOT NULL,
		delivered_at TEXT NOT NULL,
		prompt TEXT DEFAULT '',
		status TEXT DEFAULT 'success',
		error TEXT DEFAULT ''
	);

	CREATE INDEX IF NOT EXISTS idx_delivery_reminder ON delivery_records(reminder_id, delivered_at);

	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);

	CREATE TABLE IF NOT EXISTS ai_chat_messages (
		id TEXT PRIMARY KEY,
		role TEXT NOT NULL,
		content TEXT NOT NULL,
		actions_json TEXT DEFAULT '',
		created_at TEXT NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_ai_chat_created ON ai_chat_messages(created_at);
	`
	if _, err := d.db.Exec(schema); err != nil {
		return err
	}

	// Dynamic column migrations for preexisting tables before index creation
	_ = d.addColumnIfNotExists("reminders", "priority", "TEXT DEFAULT 'p2'")
	_ = d.addColumnIfNotExists("reminders", "tags", "TEXT DEFAULT ''")
	_ = d.addColumnIfNotExists("reminders", "subtasks", "TEXT DEFAULT ''")
	_ = d.addColumnIfNotExists("reminders", "deleted_at", "TEXT DEFAULT ''")
	_ = d.addColumnIfNotExists("reminders", "is_pinned", "INTEGER DEFAULT 0")

	_, _ = d.db.Exec("CREATE INDEX IF NOT EXISTS idx_reminders_priority ON reminders(priority);")
	_, _ = d.db.Exec("CREATE INDEX IF NOT EXISTS idx_reminders_deleted ON reminders(deleted_at);")
	_, _ = d.db.Exec("CREATE INDEX IF NOT EXISTS idx_reminders_pinned ON reminders(is_pinned);")
	_, _ = d.db.Exec("CREATE INDEX IF NOT EXISTS idx_reminders_active_pinned ON reminders(deleted_at, status, is_pinned, scheduled_at);")
	_, _ = d.db.Exec("CREATE INDEX IF NOT EXISTS idx_reminders_updated_at ON reminders(updated_at);")
	_, _ = d.db.Exec("CREATE INDEX IF NOT EXISTS idx_delivery_status_time ON delivery_records(status, delivered_at);")

	return nil
}

func (d *DB) addColumnIfNotExists(table, column, colDef string) error {
	query := fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, colDef)
	_, err := d.db.Exec(query)
	return err
}

func (d *DB) seedDefaultsIfEmpty() {
	var count int
	_ = d.db.QueryRow("SELECT COUNT(*) FROM reminders").Scan(&count)
	if count > 0 {
		return
	}

	now := time.Now()
	zone, _ := now.Zone()
	if zone == "" {
		zone = "Asia/Shanghai"
	}

	// 1. 吃药: 每天 08:00
	t1 := time.Date(now.Year(), now.Month(), now.Day(), 8, 0, 0, 0, now.Location())
	if t1.Before(now) {
		t1 = t1.AddDate(0, 0, 1)
	}
	_, _ = d.CreateReminder(CreateReminderRequest{
		Title:       "吃药",
		ScheduledAt: t1.Format(time.RFC3339),
		RepeatRule:  "FREQ=DAILY",
		LeadMinutes: 0,
		Notes:       "饭后温水服用",
		Timezone:    zone,
		Prompt:      "请按时吃药，保持身体健康！",
		Priority:    "p1",
		Tags:        "健康",
	})

	// 2. 开会: 明天 14:50 (提前 10 分钟)
	t2 := now.AddDate(0, 0, 1)
	t2 = time.Date(t2.Year(), t2.Month(), t2.Day(), 14, 50, 0, 0, now.Location())
	_, _ = d.CreateReminder(CreateReminderRequest{
		Title:           "开会",
		ScheduledAt:     t2.Format(time.RFC3339),
		RepeatRule:      "",
		LeadMinutes:     10,
		Notes:           "项目进度同步周会",
		DurationMinutes: 45,
		Timezone:        zone,
		Prompt:          "周会将在10分钟后开始，请提前准备好周报与汇报PPT。",
		Priority:        "p0",
		Tags:            "工作,周会",
	})

	// 3. 锻炼: 每周六、日 09:00
	t3 := now
	for t3.Weekday() != time.Saturday {
		t3 = t3.AddDate(0, 0, 1)
	}
	t3 = time.Date(t3.Year(), t3.Month(), t3.Day(), 9, 0, 0, 0, now.Location())
	_, _ = d.CreateReminder(CreateReminderRequest{
		Title:           "锻炼",
		ScheduledAt:     t3.Format(time.RFC3339),
		RepeatRule:      "FREQ=WEEKLY;BYDAY=SA,SU",
		LeadMinutes:     15,
		Notes:           "晨跑或健身房有氧力量训练",
		DurationMinutes: 60,
		Timezone:        zone,
		Prompt:          "周末早晨锻炼时间到了，适当运动活力一整天！",
		Priority:        "p2",
		Tags:            "生活,运动",
	})
}

func (d *DB) GetAllReminders() ([]Reminder, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(`
		SELECT id, title, scheduled_at, repeat_rule, lead_minutes, notes, duration_minutes,
		       timezone, prompt, status, COALESCE(priority, 'p2'), COALESCE(tags, ''), COALESCE(subtasks, ''),
		       COALESCE(deleted_at, ''), COALESCE(is_pinned, 0), created_at, updated_at
		FROM reminders
		WHERE COALESCE(deleted_at, '') = ''
		ORDER BY is_pinned DESC, scheduled_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Reminder
	for rows.Next() {
		var r Reminder
		var pinnedInt int
		err := rows.Scan(
			&r.ID, &r.Title, &r.ScheduledAt, &r.RepeatRule, &r.LeadMinutes, &r.Notes,
			&r.DurationMinutes, &r.Timezone, &r.Prompt, &r.Status, &r.Priority, &r.Tags, &r.Subtasks,
			&r.DeletedAt, &pinnedInt, &r.CreatedAt, &r.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		r.IsPinned = (pinnedInt == 1)
		list = append(list, r)
	}
	if list == nil {
		list = []Reminder{}
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].IsPinned != list[j].IsPinned {
			return list[i].IsPinned
		}
		ti, err1 := parseFlexibleTime(list[i].ScheduledAt)
		tj, err2 := parseFlexibleTime(list[j].ScheduledAt)
		if err1 == nil && err2 == nil {
			return ti.Before(tj)
		}
		return list[i].ScheduledAt < list[j].ScheduledAt
	})
	return list, nil
}

func (d *DB) GetReminder(id string) (*Reminder, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	row := d.db.QueryRow(`
		SELECT id, title, scheduled_at, repeat_rule, lead_minutes, notes, duration_minutes,
		       timezone, prompt, status, COALESCE(priority, 'p2'), COALESCE(tags, ''), COALESCE(subtasks, ''),
		       COALESCE(deleted_at, ''), COALESCE(is_pinned, 0), created_at, updated_at
		FROM reminders WHERE id = ?
	`, id)

	var r Reminder
	var pinnedInt int
	err := row.Scan(
		&r.ID, &r.Title, &r.ScheduledAt, &r.RepeatRule, &r.LeadMinutes, &r.Notes,
		&r.DurationMinutes, &r.Timezone, &r.Prompt, &r.Status, &r.Priority, &r.Tags, &r.Subtasks,
		&r.DeletedAt, &pinnedInt, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	r.IsPinned = (pinnedInt == 1)
	return &r, nil
}

func (d *DB) CreateReminder(req CreateReminderRequest) (*Reminder, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	id := generateID("rem")
	priority := req.Priority
	if priority == "" {
		priority = "p2"
	}
	pinnedVal := 0
	if req.IsPinned {
		pinnedVal = 1
	}

	_, err := d.db.Exec(`
		INSERT INTO reminders (
			id, title, scheduled_at, repeat_rule, lead_minutes, notes, duration_minutes,
			timezone, prompt, status, priority, tags, subtasks, is_pinned, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
	`, id, req.Title, req.ScheduledAt, req.RepeatRule, req.LeadMinutes, req.Notes,
		req.DurationMinutes, req.Timezone, req.Prompt, priority, req.Tags, req.Subtasks, pinnedVal, now, now)

	if err != nil {
		return nil, err
	}

	_, _ = d.db.Exec(`
		INSERT INTO delivery_records (id, reminder_id, delivered_at, prompt, status, error)
		VALUES (?, ?, ?, ?, ?, ?)
	`, generateID("rec"), id, now, "日程创建入库", "created", "")

	return &Reminder{
		ID:              id,
		Title:           req.Title,
		ScheduledAt:     req.ScheduledAt,
		RepeatRule:      req.RepeatRule,
		LeadMinutes:     req.LeadMinutes,
		Notes:           req.Notes,
		DurationMinutes: req.DurationMinutes,
		Timezone:        req.Timezone,
		Prompt:          req.Prompt,
		Status:          "active",
		Priority:        priority,
		Tags:            req.Tags,
		Subtasks:        req.Subtasks,
		IsPinned:        req.IsPinned,
		CreatedAt:       now,
		UpdatedAt:       now,
	}, nil
}

func (d *DB) UpdateReminder(req UpdateReminderRequest) (*Reminder, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	status := req.Status
	if status == "" {
		status = "active"
	}
	priority := req.Priority
	if priority == "" {
		priority = "p2"
	}
	pinnedVal := 0
	if req.IsPinned {
		pinnedVal = 1
	}

	var createdAt, prevStatus string
	if err := d.db.QueryRow("SELECT created_at, status FROM reminders WHERE id = ?", req.ID).Scan(&createdAt, &prevStatus); err != nil {
		return nil, fmt.Errorf("日程不存在: %w", err)
	}

	_, err := d.db.Exec(`
		UPDATE reminders SET
			title = ?, scheduled_at = ?, repeat_rule = ?, lead_minutes = ?, notes = ?,
			duration_minutes = ?, timezone = ?, prompt = ?, status = ?, priority = ?,
			tags = ?, subtasks = ?, is_pinned = ?, updated_at = ?
		WHERE id = ?
	`, req.Title, req.ScheduledAt, req.RepeatRule, req.LeadMinutes, req.Notes,
		req.DurationMinutes, req.Timezone, req.Prompt, status, priority, req.Tags, req.Subtasks, pinnedVal, now, req.ID)

	if err != nil {
		return nil, err
	}

	if status == "ended" && prevStatus != "ended" {
		_, _ = d.db.Exec(`
			INSERT INTO delivery_records (id, reminder_id, delivered_at, prompt, status, error)
			VALUES (?, ?, ?, ?, ?, ?)
		`, generateID("rec"), req.ID, now, "事项标记完结", "completed", "")
	} else if status == "expired" && prevStatus != "expired" {
		_, _ = d.db.Exec(`
			INSERT INTO delivery_records (id, reminder_id, delivered_at, prompt, status, error)
			VALUES (?, ?, ?, ?, ?, ?)
		`, generateID("rec"), req.ID, now, "事项已过期", "expired", "")
	} else if status == "paused" && prevStatus != "paused" {
		_, _ = d.db.Exec(`
			INSERT INTO delivery_records (id, reminder_id, delivered_at, prompt, status, error)
			VALUES (?, ?, ?, ?, ?, ?)
		`, generateID("rec"), req.ID, now, "事项已暂停", "paused", "")
	}

	return &Reminder{
		ID:              req.ID,
		Title:           req.Title,
		ScheduledAt:     req.ScheduledAt,
		RepeatRule:      req.RepeatRule,
		LeadMinutes:     req.LeadMinutes,
		Notes:           req.Notes,
		DurationMinutes: req.DurationMinutes,
		Timezone:        req.Timezone,
		Prompt:          req.Prompt,
		Status:          status,
		Priority:        priority,
		Tags:            req.Tags,
		Subtasks:        req.Subtasks,
		IsPinned:        req.IsPinned,
		CreatedAt:       createdAt,
		UpdatedAt:       now,
	}, nil
}

func (d *DB) UpdateSubtasks(id string, subtasks string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	_, err := d.db.Exec("UPDATE reminders SET subtasks = ?, updated_at = ? WHERE id = ?", subtasks, now, id)
	return err
}

func (d *DB) DeleteReminder(id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	_, err := d.db.Exec("UPDATE reminders SET deleted_at = ?, updated_at = ? WHERE id = ?", now, now, id)
	return err
}

func (d *DB) RestoreReminder(id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	_, err := d.db.Exec("UPDATE reminders SET deleted_at = '', updated_at = ? WHERE id = ?", now, id)
	return err
}

func (d *DB) PermanentDelete(id string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM reminders WHERE id = ?", id)
	return err
}

func (d *DB) EmptyTrash() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM reminders WHERE COALESCE(deleted_at, '') != ''")
	return err
}

func (d *DB) CleanExpiredTrash(retentionDays int) (int64, error) {
	if retentionDays <= 0 {
		retentionDays = 30
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	cutoff := time.Now().AddDate(0, 0, -retentionDays).Format(time.RFC3339)
	res, err := d.db.Exec("DELETE FROM reminders WHERE COALESCE(deleted_at, '') != '' AND deleted_at < ?", cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (d *DB) GetTrashReminders() ([]Reminder, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(`
		SELECT id, title, scheduled_at, repeat_rule, lead_minutes, notes, duration_minutes,
		       timezone, prompt, status, COALESCE(priority, 'p2'), COALESCE(tags, ''), COALESCE(subtasks, ''),
		       COALESCE(deleted_at, ''), COALESCE(is_pinned, 0), created_at, updated_at
		FROM reminders
		WHERE COALESCE(deleted_at, '') != ''
		ORDER BY updated_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Reminder
	for rows.Next() {
		var r Reminder
		var pinnedInt int
		err := rows.Scan(
			&r.ID, &r.Title, &r.ScheduledAt, &r.RepeatRule, &r.LeadMinutes, &r.Notes,
			&r.DurationMinutes, &r.Timezone, &r.Prompt, &r.Status, &r.Priority, &r.Tags, &r.Subtasks,
			&r.DeletedAt, &pinnedInt, &r.CreatedAt, &r.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}
		r.IsPinned = (pinnedInt == 1)
		list = append(list, r)
	}
	if list == nil {
		list = []Reminder{}
	}
	return list, nil
}

// batchUpdateColumn updates a single column plus updated_at across multiple reminder IDs in one transaction.
func (d *DB) batchUpdateColumn(ids []string, column string, value any) error {
	if len(ids) == 0 {
		return nil
	}
	switch column {
	case "status", "priority", "deleted_at", "is_pinned", "subtasks":
	default:
		return fmt.Errorf("unsupported batch update column: %s", column)
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(fmt.Sprintf("UPDATE reminders SET %s = ?, updated_at = ? WHERE id = ?", column))
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, id := range ids {
		if _, err := stmt.Exec(value, now, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) BatchDelete(ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	now := time.Now().Format(time.RFC3339)
	return d.batchUpdateColumn(ids, "deleted_at", now)
}

func (d *DB) OptimizeDatabase() (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	var integrity string
	if err := d.db.QueryRow("PRAGMA integrity_check;").Scan(&integrity); err != nil {
		return "", fmt.Errorf("数据库完整性检查失败: %w", err)
	}
	if integrity != "ok" {
		return "", fmt.Errorf("数据库完整性异常: %s", integrity)
	}

	cutoff := time.Now().AddDate(0, 0, -30).Format(time.RFC3339)
	purgedRes, _ := d.db.Exec("DELETE FROM reminders WHERE COALESCE(deleted_at, '') != '' AND deleted_at < ?", cutoff)
	purgedCount, _ := purgedRes.RowsAffected()

	if _, err := d.db.Exec("VACUUM;"); err != nil {
		return "", fmt.Errorf("整理碎片失败: %w", err)
	}

	return fmt.Sprintf("数据库检测正常 (Integrity: OK)，已自动清理超过30天的废纸篓历史 (%d 项)，完成碎片整理与索引重建 (VACUUM 成功)", purgedCount), nil
}

func (d *DB) BatchSetStatus(ids []string, status string) error {
	return d.batchUpdateColumn(ids, "status", status)
}

func (d *DB) BatchSetPriority(ids []string, priority string) error {
	return d.batchUpdateColumn(ids, "priority", priority)
}

func (d *DB) ArchiveOldEndedReminders(days int) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	if days <= 0 {
		days = 30
	}
	cutoff := time.Now().AddDate(0, 0, -days).Format(time.RFC3339)
	res, err := d.db.Exec("DELETE FROM reminders WHERE status IN ('ended', 'expired') AND updated_at < ?", cutoff)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

func (d *DB) AddDeliveryRecord(reminderID, prompt, status, errMsg string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	id := generateID("del")
	now := time.Now().Format(time.RFC3339)
	_, err := d.db.Exec(`
		INSERT INTO delivery_records (id, reminder_id, delivered_at, prompt, status, error)
		VALUES (?, ?, ?, ?, ?, ?)
	`, id, reminderID, now, prompt, status, errMsg)
	return err
}

func (d *DB) ClearDeliveryHistory() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM delivery_records")
	return err
}

func (d *DB) GetDeliveryHistory(reminderID string) ([]DeliveryRecord, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	query := `SELECT id, reminder_id, delivered_at, prompt, status, error FROM delivery_records`
	var rows *sql.Rows
	var err error
	if reminderID != "" {
		query += ` WHERE reminder_id = ? ORDER BY delivered_at DESC LIMIT 50`
		rows, err = d.db.Query(query, reminderID)
	} else {
		query += ` ORDER BY delivered_at DESC LIMIT 50`
		rows, err = d.db.Query(query)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []DeliveryRecord
	for rows.Next() {
		var r DeliveryRecord
		if err := rows.Scan(&r.ID, &r.ReminderID, &r.DeliveredAt, &r.Prompt, &r.Status, &r.Error); err != nil {
			return nil, err
		}
		list = append(list, r)
	}
	if list == nil {
		list = []DeliveryRecord{}
	}
	return list, nil
}

func (d *DB) GetRecentDeliveries(limit int) ([]RecentDeliveryItem, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if limit <= 0 || limit > 100 {
		limit = 15
	}
	rows, err := d.db.Query(`
		SELECT dr.id, dr.reminder_id, COALESCE(r.title, ''), dr.delivered_at, dr.prompt, dr.status, dr.error
		FROM delivery_records dr
		LEFT JOIN reminders r ON dr.reminder_id = r.id
		ORDER BY dr.delivered_at DESC
		LIMIT ?
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []RecentDeliveryItem
	for rows.Next() {
		var item RecentDeliveryItem
		if err := rows.Scan(&item.ID, &item.ReminderID, &item.ReminderTitle, &item.DeliveredAt, &item.Prompt, &item.Status, &item.Error); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	if list == nil {
		list = []RecentDeliveryItem{}
	}
	return list, nil
}

func (d *DB) GetStats() (*Stats, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var stats Stats
	_ = d.db.QueryRow("SELECT COUNT(*) FROM reminders WHERE COALESCE(deleted_at, '') = ''").Scan(&stats.TotalReminders)
	_ = d.db.QueryRow("SELECT COUNT(*) FROM reminders WHERE status = 'active' AND COALESCE(deleted_at, '') = ''").Scan(&stats.ActiveReminders)
	_ = d.db.QueryRow("SELECT COUNT(*) FROM reminders WHERE status = 'paused' AND COALESCE(deleted_at, '') = ''").Scan(&stats.PausedReminders)
	_ = d.db.QueryRow("SELECT COUNT(*) FROM reminders WHERE status = 'ended' AND COALESCE(deleted_at, '') = ''").Scan(&stats.EndedReminders)
	_ = d.db.QueryRow("SELECT COUNT(*) FROM reminders WHERE status = 'expired' AND COALESCE(deleted_at, '') = ''").Scan(&stats.ExpiredReminders)
	_ = d.db.QueryRow("SELECT COUNT(*) FROM delivery_records").Scan(&stats.TotalDelivered)

	now := time.Now()
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	todayEnd := time.Date(now.Year(), now.Month(), now.Day(), 23, 59, 59, 999999999, now.Location())
	nearLimit := now.Add(15 * time.Minute)

	rows, err := d.db.Query(`
		SELECT scheduled_at FROM reminders
		WHERE status = 'active' AND COALESCE(deleted_at, '') = ''
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var schedStr string
			if err := rows.Scan(&schedStr); err == nil {
				if t, err := parseFlexibleTime(schedStr); err == nil {
					if !t.Before(todayStart) && !t.After(todayEnd) {
						stats.TodayReminders++
					}
					if !t.Before(now) && !t.After(nearLimit) {
						stats.NearDueReminders++
					}
				}
			}
		}
	}

	return &stats, nil
}

func (d *DB) BackupDatabase(destDir string) (string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	if d.dbPath == "" || d.dbPath == ":memory:" {
		return "", fmt.Errorf("in-memory db cannot be backed up to file")
	}

	if destDir == "" {
		home, _ := os.UserHomeDir()
		destDir = filepath.Join(home, ".agenda", "backups")
	}
	_ = os.MkdirAll(destDir, 0755)

	backupFileName := fmt.Sprintf("agenda_backup_%s.db", time.Now().Format("20060102_150405"))
	destPath := filepath.Join(destDir, backupFileName)

	// Try atomic SQLite VACUUM INTO first (safely captures WAL transactions)
	escapedPath := strings.ReplaceAll(destPath, "'", "''")
	if _, err := d.db.Exec(fmt.Sprintf("VACUUM INTO '%s'", escapedPath)); err == nil {
		_ = d.PruneOldBackups(destDir, 7)
		return destPath, nil
	}

	// Fallback to safe file copy if VACUUM INTO is unsupported
	src, err := os.Open(d.dbPath)
	if err != nil {
		return "", err
	}
	defer src.Close()

	dest, err := os.Create(destPath)
	if err != nil {
		return "", err
	}
	defer dest.Close()

	if _, err := io.Copy(dest, src); err != nil {
		return "", err
	}

	_ = d.PruneOldBackups(destDir, 7)
	return destPath, nil
}

func (d *DB) PruneOldBackups(destDir string, keepCount int) error {
	if keepCount <= 0 {
		keepCount = 7
	}
	entries, err := os.ReadDir(destDir)
	if err != nil {
		return err
	}
	type fileInfo struct {
		path    string
		modTime time.Time
	}
	var backups []fileInfo
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".db") {
			info, err := e.Info()
			if err == nil {
				backups = append(backups, fileInfo{
					path:    filepath.Join(destDir, e.Name()),
					modTime: info.ModTime(),
				})
			}
		}
	}
	if len(backups) <= keepCount {
		return nil
	}
	// Sort ascending by modTime (oldest first)
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].modTime.Before(backups[j].modTime)
	})
	toDelete := len(backups) - keepCount
	for i := 0; i < toDelete; i++ {
		_ = os.Remove(backups[i].path)
	}
	return nil
}

func (d *DB) autoBackupIfStale() {
	if d.dbPath == "" || d.dbPath == ":memory:" {
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	destDir := filepath.Join(home, ".agenda", "backups")
	_ = os.MkdirAll(destDir, 0755)

	entries, err := os.ReadDir(destDir)
	todayPrefix := fmt.Sprintf("agenda_backup_%s", time.Now().Format("20060102"))
	if err == nil {
		for _, e := range entries {
			if strings.HasPrefix(e.Name(), todayPrefix) {
				return // Already backed up today
			}
		}
	}

	_, _ = d.BackupDatabase(destDir)
}

func (d *DB) RestoreDatabase(backupPath string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	if d.dbPath == "" || d.dbPath == ":memory:" {
		return fmt.Errorf("invalid db path")
	}

	// Verify backup file exists and is a valid SQLite 3 database header before closing current DB
	if _, err := os.Stat(backupPath); err != nil {
		return fmt.Errorf("backup file not found: %w", err)
	}
	src, err := os.Open(backupPath)
	if err != nil {
		return err
	}
	defer src.Close()
	header := make([]byte, 16)
	if n, err := io.ReadFull(src, header); err != nil || n < 16 || string(header) != "SQLite format 3\x00" {
		return fmt.Errorf("invalid sqlite backup file")
	}
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return err
	}

	// Close current db handle and remove stale WAL/SHM sidecar files before overwriting
	_ = d.db.Close()
	_ = os.Remove(d.dbPath + "-wal")
	_ = os.Remove(d.dbPath + "-shm")

	dest, err := os.Create(d.dbPath)
	if err != nil {
		return err
	}
	defer dest.Close()

	if _, err := io.Copy(dest, src); err != nil {
		return err
	}
	_ = dest.Sync()

	// Reopen sqlite connection with WAL pragmas
	newDB, err := sql.Open("sqlite", d.dbPath)
	if err != nil {
		return err
	}
	pragmas := []string{
		"PRAGMA journal_mode = WAL;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA synchronous = NORMAL;",
		"PRAGMA cache_size = -20000;",
		"PRAGMA temp_store = MEMORY;",
		"PRAGMA foreign_keys = ON;",
	}
	for _, p := range pragmas {
		_, _ = newDB.Exec(p)
	}
	d.db = newDB
	return d.migrate()
}

func (d *DB) GetSettings() (map[string]string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query("SELECT key, value FROM settings")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	settings := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			settings[k] = v
		}
	}
	return settings, nil
}

func (d *DB) SaveSettings(settings map[string]string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for k, v := range settings {
		if _, err := stmt.Exec(k, v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (d *DB) TogglePinReminder(id string) (*Reminder, error) {
	d.mu.Lock()
	defer d.mu.Unlock()

	var isPinned int
	err := d.db.QueryRow("SELECT COALESCE(is_pinned, 0) FROM reminders WHERE id = ?", id).Scan(&isPinned)
	if err != nil {
		return nil, err
	}

	newPinned := 1
	if isPinned == 1 {
		newPinned = 0
	}

	now := time.Now().Format(time.RFC3339)
	_, err = d.db.Exec("UPDATE reminders SET is_pinned = ?, updated_at = ? WHERE id = ?", newPinned, now, id)
	if err != nil {
		return nil, err
	}

	row := d.db.QueryRow(`
		SELECT id, title, scheduled_at, repeat_rule, lead_minutes, notes, duration_minutes,
		       timezone, prompt, status, COALESCE(priority, 'p2'), COALESCE(tags, ''), COALESCE(subtasks, ''),
		       COALESCE(deleted_at, ''), COALESCE(is_pinned, 0), created_at, updated_at
		FROM reminders WHERE id = ?
	`, id)

	var r Reminder
	var pinnedInt int
	err = row.Scan(
		&r.ID, &r.Title, &r.ScheduledAt, &r.RepeatRule, &r.LeadMinutes, &r.Notes,
		&r.DurationMinutes, &r.Timezone, &r.Prompt, &r.Status, &r.Priority, &r.Tags, &r.Subtasks,
		&r.DeletedAt, &pinnedInt, &r.CreatedAt, &r.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	r.IsPinned = (pinnedInt == 1)
	return &r, nil
}

func (d *DB) BatchSetPinned(ids []string, pinned bool) error {
	val := 0
	if pinned {
		val = 1
	}
	return d.batchUpdateColumn(ids, "is_pinned", val)
}

func (d *DB) BatchAddTag(ids []string, tag string) error {
	tag = strings.TrimSpace(tag)
	if len(ids) == 0 || tag == "" {
		return nil
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	tx, err := d.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	selectStmt, err := tx.Prepare("SELECT COALESCE(tags, '') FROM reminders WHERE id = ?")
	if err != nil {
		return err
	}
	defer selectStmt.Close()

	updateStmt, err := tx.Prepare("UPDATE reminders SET tags = ?, updated_at = ? WHERE id = ?")
	if err != nil {
		return err
	}
	defer updateStmt.Close()

	for _, id := range ids {
		var currTags string
		if err := selectStmt.QueryRow(id).Scan(&currTags); err != nil {
			continue
		}
		tagsList := strings.Split(currTags, ",")
		hasTag := false
		for _, t := range tagsList {
			if strings.TrimSpace(t) == tag {
				hasTag = true
				break
			}
		}
		if !hasTag {
			var newTags string
			if strings.TrimSpace(currTags) == "" {
				newTags = tag
			} else {
				newTags = currTags + "," + tag
			}
			if _, err := updateStmt.Exec(newTags, now, id); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func (d *DB) SaveAIChatMessage(id, role, content, actionsJSON string) error {
	d.mu.Lock()
	defer d.mu.Unlock()

	now := time.Now().Format(time.RFC3339)
	if id == "" {
		id = generateID("msg")
	}

	_, err := d.db.Exec(`
		INSERT INTO ai_chat_messages (id, role, content, actions_json, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			role = excluded.role,
			content = excluded.content,
			actions_json = excluded.actions_json
	`, id, role, content, actionsJSON, now)
	return err
}

func (d *DB) GetAIChatHistory() ([]AIChatRecord, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(`
		SELECT id, role, content, actions_json, created_at FROM (
			SELECT id, role, content, COALESCE(actions_json, '') AS actions_json, created_at, rowid
			FROM ai_chat_messages
			ORDER BY created_at DESC, rowid DESC
			LIMIT 100
		)
		ORDER BY created_at ASC, rowid ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []AIChatRecord
	for rows.Next() {
		var r AIChatRecord
		if err := rows.Scan(&r.ID, &r.Role, &r.Content, &r.ActionsJSON, &r.CreatedAt); err == nil {
			list = append(list, r)
		}
	}
	if list == nil {
		list = []AIChatRecord{}
	}
	return list, nil
}

func (d *DB) ClearAIChatHistory() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("DELETE FROM ai_chat_messages")
	return err
}

func (d *DB) GetOverdueReminders() ([]Reminder, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	now := time.Now()
	rows, err := d.db.Query(`
		SELECT id, title, scheduled_at, repeat_rule, lead_minutes, notes, duration_minutes,
		       timezone, prompt, status, COALESCE(priority, 'p2'), COALESCE(tags, ''), COALESCE(subtasks, ''),
		       COALESCE(deleted_at, ''), COALESCE(is_pinned, 0), created_at, updated_at
		FROM reminders
		WHERE status IN ('active', 'expired') AND (deleted_at IS NULL OR deleted_at = '')
		ORDER BY scheduled_at ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Reminder
	for rows.Next() {
		var r Reminder
		var pinnedInt int
		err := rows.Scan(
			&r.ID, &r.Title, &r.ScheduledAt, &r.RepeatRule, &r.LeadMinutes, &r.Notes,
			&r.DurationMinutes, &r.Timezone, &r.Prompt, &r.Status, &r.Priority, &r.Tags, &r.Subtasks,
			&r.DeletedAt, &pinnedInt, &r.CreatedAt, &r.UpdatedAt,
		)
		if err == nil {
			if r.Status == "expired" {
				r.IsPinned = (pinnedInt == 1)
				list = append(list, r)
			} else if t, parseErr := parseFlexibleTime(r.ScheduledAt); parseErr == nil && t.Before(now) {
				r.IsPinned = (pinnedInt == 1)
				list = append(list, r)
			}
		}
	}
	if list == nil {
		list = []Reminder{}
	}
	sort.SliceStable(list, func(i, j int) bool {
		if list[i].IsPinned != list[j].IsPinned {
			return list[i].IsPinned
		}
		ti, err1 := parseFlexibleTime(list[i].ScheduledAt)
		tj, err2 := parseFlexibleTime(list[j].ScheduledAt)
		if err1 == nil && err2 == nil {
			return ti.Before(tj)
		}
		return list[i].ScheduledAt < list[j].ScheduledAt
	})
	return list, nil
}

func (d *DB) GetTagsSummary() (map[string]int, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	rows, err := d.db.Query(`SELECT COALESCE(tags, '') FROM reminders WHERE (deleted_at IS NULL OR deleted_at = '')`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	summary := make(map[string]int)
	for rows.Next() {
		var tagsStr string
		if err := rows.Scan(&tagsStr); err == nil {
			parts := strings.Split(tagsStr, ",")
			for _, p := range parts {
				p = strings.TrimSpace(p)
				if p != "" {
					summary[p]++
				}
			}
		}
	}
	return summary, nil
}

func (d *DB) BatchSetSubtasks(ids []string, subtasks string) error {
	return d.batchUpdateColumn(ids, "subtasks", subtasks)
}

func (d *DB) Vacuum() error {
	d.mu.Lock()
	defer d.mu.Unlock()

	_, err := d.db.Exec("VACUUM")
	return err
}

func (d *DB) CheckIntegrity() (string, error) {
	d.mu.RLock()
	defer d.mu.RUnlock()

	var result string
	row := d.db.QueryRow("PRAGMA integrity_check")
	if err := row.Scan(&result); err != nil {
		return "", err
	}
	return result, nil
}
