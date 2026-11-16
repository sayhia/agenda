package agenda

import (
	"encoding/json"
	"fmt"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	WindowKindMain        = "main"
	WindowKindQuickAdd    = "quick-add"
	WindowKindTrayPopover = "tray-popover"
	WindowKindFocus       = "focus"
	WindowKindAI          = "ai"
	WindowKindWorkspace   = "workspace"
)

// DesktopPreferences persists multi-window, system tray, and background daemon preferences in SQLite.
type DesktopPreferences struct {
	CloseToTray            bool   `json:"close_to_tray"`
	StartMinimized         bool   `json:"start_minimized"`
	ShowTrayCount          bool   `json:"show_tray_count"`
	TrayClickAction        string `json:"tray_click_action"` // "popover" | "main" | "menu"
	HotkeyTarget           string `json:"hotkey_target"`     // "quick-add" | "main"
	QuickAddHotkey         string `json:"quick_add_hotkey"`
	TrayPopoverHotkey      string `json:"tray_popover_hotkey"`
	FocusHotkey            string `json:"focus_hotkey"`
	QuickAddAutoHide       bool   `json:"quick_add_auto_hide"`
	SchedulerPaused        bool   `json:"scheduler_paused"`
	DndEnabled             bool   `json:"dnd_enabled"`
	DndStart               string `json:"dnd_start"` // "HH:MM"
	DndEnd                 string `json:"dnd_end"`   // "HH:MM"
	DndAllowP0             bool   `json:"dnd_allow_p0"`
	MorningBriefingEnabled bool   `json:"morning_briefing_enabled"`
	MorningBriefingTime    string `json:"morning_briefing_time"` // "HH:MM"
}

// WindowBounds stores persisted DIP position and dimensions for a named window.
type WindowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

// FocusTrayState holds live Pomodoro timer telemetry synced from the active frontend window.
type FocusTrayState struct {
	Running bool   `json:"running"`
	Mode    string `json:"mode"`  // "focus" | "shortBreak" | "longBreak"
	Clock   string `json:"clock"` // "24:59"
	Title   string `json:"title"`
}

// WindowSummary describes an active Wails window managed by DesktopManager.
type WindowSummary struct {
	Name        string `json:"name"`
	Title       string `json:"title"`
	Kind        string `json:"kind"`
	Visible     bool   `json:"visible"`
	AlwaysOnTop bool   `json:"always_on_top"`
	Focused     bool   `json:"focused"`
}

// AutoStartInfo describes native login autostart registration state.
type AutoStartInfo struct {
	Enabled   bool   `json:"enabled"`
	Strategy  string `json:"strategy"`
	Path      string `json:"path"`
	Supported bool   `json:"supported"`
	Error     string `json:"error"`
}

// DesktopRuntimeStatus aggregates preferences, autostart, scheduler telemetry, and open windows.
type DesktopRuntimeStatus struct {
	Preferences         DesktopPreferences `json:"preferences"`
	AutoStart           AutoStartInfo      `json:"autostart"`
	Scheduler           SchedulerStatus    `json:"scheduler"`
	Windows             []WindowSummary    `json:"windows"`
	Focus               FocusTrayState     `json:"focus"`
	TraySupported       bool               `json:"tray_supported"`
	RegisteredShortcuts []string           `json:"registered_shortcuts"`
	HotkeyError         string             `json:"hotkey_error"`
}

func DefaultDesktopPreferences() DesktopPreferences {
	return DesktopPreferences{
		CloseToTray:            true,
		StartMinimized:         false,
		ShowTrayCount:          true,
		TrayClickAction:        "popover",
		HotkeyTarget:           "quick-add",
		QuickAddHotkey:         "CmdOrCtrl+Alt+A",
		TrayPopoverHotkey:      "",
		FocusHotkey:            "",
		QuickAddAutoHide:       true,
		SchedulerPaused:        false,
		DndEnabled:             false,
		DndStart:               "23:00",
		DndEnd:                 "08:00",
		DndAllowP0:             true,
		MorningBriefingEnabled: false,
		MorningBriefingTime:    "09:00",
	}
}

func normalizeHHMM(val, fallback string) string {
	val = strings.TrimSpace(val)
	parts := strings.Split(val, ":")
	if len(parts) != 2 {
		return fallback
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return fallback
	}
	return fmt.Sprintf("%02d:%02d", h, m)
}

func NormalizeDesktopPreferences(p DesktopPreferences) DesktopPreferences {
	def := DefaultDesktopPreferences()
	switch p.TrayClickAction {
	case "popover", "main", "menu":
	default:
		p.TrayClickAction = def.TrayClickAction
	}
	switch p.HotkeyTarget {
	case "quick-add", "main":
	default:
		p.HotkeyTarget = def.HotkeyTarget
	}
	p.QuickAddHotkey = strings.TrimSpace(p.QuickAddHotkey)
	p.TrayPopoverHotkey = strings.TrimSpace(p.TrayPopoverHotkey)
	p.FocusHotkey = strings.TrimSpace(p.FocusHotkey)
	p.DndStart = normalizeHHMM(p.DndStart, def.DndStart)
	p.DndEnd = normalizeHHMM(p.DndEnd, def.DndEnd)
	p.MorningBriefingTime = normalizeHHMM(p.MorningBriefingTime, def.MorningBriefingTime)
	return p
}

func parseBoolSetting(settings map[string]string, key string, fallback bool) bool {
	val, ok := settings[key]
	if !ok {
		return fallback
	}
	b, err := strconv.ParseBool(strings.TrimSpace(val))
	if err != nil {
		return fallback
	}
	return b
}

func LoadDesktopPreferences(db *DB) DesktopPreferences {
	prefs := DefaultDesktopPreferences()
	if db == nil {
		return prefs
	}
	settings, err := db.GetSettings()
	if err != nil || settings == nil {
		return prefs
	}
	prefs.CloseToTray = parseBoolSetting(settings, "desktop.close_to_tray", prefs.CloseToTray)
	prefs.StartMinimized = parseBoolSetting(settings, "desktop.start_minimized", prefs.StartMinimized)
	prefs.ShowTrayCount = parseBoolSetting(settings, "desktop.show_tray_count", prefs.ShowTrayCount)
	if v, ok := settings["desktop.tray_click_action"]; ok && v != "" {
		prefs.TrayClickAction = v
	}
	if v, ok := settings["desktop.hotkey_target"]; ok && v != "" {
		prefs.HotkeyTarget = v
	}
	if v, ok := settings["desktop.quick_add_hotkey"]; ok {
		prefs.QuickAddHotkey = v
	}
	if v, ok := settings["desktop.tray_popover_hotkey"]; ok {
		prefs.TrayPopoverHotkey = v
	}
	if v, ok := settings["desktop.focus_hotkey"]; ok {
		prefs.FocusHotkey = v
	}
	prefs.QuickAddAutoHide = parseBoolSetting(settings, "desktop.quick_add_auto_hide", prefs.QuickAddAutoHide)
	prefs.SchedulerPaused = parseBoolSetting(settings, "desktop.scheduler_paused", prefs.SchedulerPaused)
	prefs.DndEnabled = parseBoolSetting(settings, "desktop.dnd_enabled", prefs.DndEnabled)
	if v, ok := settings["desktop.dnd_start"]; ok && v != "" {
		prefs.DndStart = v
	}
	if v, ok := settings["desktop.dnd_end"]; ok && v != "" {
		prefs.DndEnd = v
	}
	prefs.DndAllowP0 = parseBoolSetting(settings, "desktop.dnd_allow_p0", prefs.DndAllowP0)
	prefs.MorningBriefingEnabled = parseBoolSetting(settings, "desktop.morning_briefing_enabled", prefs.MorningBriefingEnabled)
	if v, ok := settings["desktop.morning_briefing_time"]; ok && v != "" {
		prefs.MorningBriefingTime = v
	}
	return NormalizeDesktopPreferences(prefs)
}

func SaveDesktopPreferences(db *DB, prefs DesktopPreferences) error {
	if db == nil {
		return nil
	}
	p := NormalizeDesktopPreferences(prefs)
	return db.SaveSettings(map[string]string{
		"desktop.close_to_tray":            strconv.FormatBool(p.CloseToTray),
		"desktop.start_minimized":          strconv.FormatBool(p.StartMinimized),
		"desktop.show_tray_count":          strconv.FormatBool(p.ShowTrayCount),
		"desktop.tray_click_action":        p.TrayClickAction,
		"desktop.hotkey_target":            p.HotkeyTarget,
		"desktop.quick_add_hotkey":         p.QuickAddHotkey,
		"desktop.tray_popover_hotkey":      p.TrayPopoverHotkey,
		"desktop.focus_hotkey":             p.FocusHotkey,
		"desktop.quick_add_auto_hide":      strconv.FormatBool(p.QuickAddAutoHide),
		"desktop.scheduler_paused":         strconv.FormatBool(p.SchedulerPaused),
		"desktop.dnd_enabled":              strconv.FormatBool(p.DndEnabled),
		"desktop.dnd_start":                p.DndStart,
		"desktop.dnd_end":                  p.DndEnd,
		"desktop.dnd_allow_p0":             strconv.FormatBool(p.DndAllowP0),
		"desktop.morning_briefing_enabled": strconv.FormatBool(p.MorningBriefingEnabled),
		"desktop.morning_briefing_time":    p.MorningBriefingTime,
	})
}

func hhmmToMinutes(val string) (int, bool) {
	parts := strings.Split(strings.TrimSpace(val), ":")
	if len(parts) != 2 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || h < 0 || h > 23 || m < 0 || m > 59 {
		return 0, false
	}
	return h*60 + m, true
}

// IsWithinDND reports whether now falls inside the configured Do-Not-Disturb window.
func IsWithinDND(prefs DesktopPreferences, now time.Time) bool {
	if !prefs.DndEnabled {
		return false
	}
	startMin, ok1 := hhmmToMinutes(prefs.DndStart)
	endMin, ok2 := hhmmToMinutes(prefs.DndEnd)
	if !ok1 || !ok2 || startMin == endMin {
		return false
	}
	curMin := now.Hour()*60 + now.Minute()
	if startMin > endMin {
		// Overnight range, e.g. 23:00 -> 08:00
		return curMin >= startMin || curMin < endMin
	}
	return curMin >= startMin && curMin < endMin
}

func NormalizeWorkspaceView(view string) string {
	switch strings.ToLower(strings.TrimSpace(view)) {
	case "list", "week", "month", "matrix":
		return strings.ToLower(strings.TrimSpace(view))
	default:
		return "week"
	}
}

func WindowNameForKind(kind, param string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case WindowKindMain, "":
		return WindowKindMain
	case WindowKindQuickAdd:
		return WindowKindQuickAdd
	case WindowKindTrayPopover:
		return WindowKindTrayPopover
	case WindowKindFocus:
		return WindowKindFocus
	case WindowKindAI:
		return WindowKindAI
	case WindowKindWorkspace:
		return "workspace-" + NormalizeWorkspaceView(param)
	default:
		return strings.TrimSpace(kind)
	}
}

// DesktopManager coordinates multi-window lifecycle, native system tray, global shortcuts,
// login autostart, and cross-window state synchronization.
type DesktopManager struct {
	app           *application.App
	db            *DB
	scheduler     *Scheduler
	service       *AgendaService
	tray          *application.SystemTray
	trayMenu      *application.Menu
	isQuitting    atomic.Bool
	popoverPinned atomic.Bool

	mu                  sync.Mutex
	focusState          FocusTrayState
	lastFocusMenuKey    string
	windowKinds         map[string]string
	alwaysOnTop         map[string]bool
	boundsTimers        map[string]*time.Timer
	registeredHotkeys   []string
	hotkeyError         string
	lastTrayLabel       string
	lastTrayTooltip     string
	popoverHiddenAt     time.Time
	trayRebuild         atomic.Bool
}

func NewDesktopManager(app *application.App, db *DB, scheduler *Scheduler, service *AgendaService) *DesktopManager {
	dm := &DesktopManager{
		app:          app,
		db:           db,
		scheduler:    scheduler,
		service:      service,
		windowKinds:  map[string]string{WindowKindMain: WindowKindMain},
		alwaysOnTop:  make(map[string]bool),
		boundsTimers: make(map[string]*time.Timer),
	}
	if scheduler != nil {
		scheduler.SetOnChanged(func() {
			dm.NotifyDataChanged()
		})
		scheduler.SetOnMinuteRefresh(func() {
			dm.RefreshTrayAndStatus()
		})
	}
	if service != nil {
		service.SetDesktopManager(dm)
		service.SetScheduler(scheduler)
	}
	return dm
}

func (dm *DesktopManager) MarkQuitting() {
	dm.isQuitting.Store(true)
	dm.mu.Lock()
	for name, t := range dm.boundsTimers {
		if t != nil {
			t.Stop()
		}
		delete(dm.boundsTimers, name)
	}
	dm.mu.Unlock()
}

func (dm *DesktopManager) QuitApp() {
	dm.MarkQuitting()
	if dm.app != nil {
		dm.app.Quit()
	}
}

func (dm *DesktopManager) SetupMainWindow(mainWin *application.WebviewWindow) {
	if mainWin == nil {
		return
	}
	dm.mu.Lock()
	dm.windowKinds[mainWin.Name()] = WindowKindMain
	dm.mu.Unlock()

	mainWin.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if dm.isQuitting.Load() {
			return
		}
		prefs := LoadDesktopPreferences(dm.db)
		if prefs.CloseToTray {
			mainWin.Hide()
			event.Cancel()
			dm.emitDesktopStatus()
		} else {
			// User opted to quit when closing the main window
			dm.isQuitting.Store(true)
			if dm.app != nil {
				go dm.app.Quit()
			}
		}
	})

	mainWin.OnWindowEvent(events.Common.WindowShow, func(event *application.WindowEvent) {
		dm.emitDesktopStatus()
	})
	mainWin.OnWindowEvent(events.Common.WindowHide, func(event *application.WindowEvent) {
		dm.emitDesktopStatus()
	})
	mainWin.OnWindowEvent(events.Common.WindowFullscreen, func(event *application.WindowEvent) {
		if dm.app != nil {
			dm.app.Event.Emit("window-fullscreen", true)
		}
	})
	mainWin.OnWindowEvent(events.Common.WindowUnFullscreen, func(event *application.WindowEvent) {
		if dm.app != nil {
			dm.app.Event.Emit("window-fullscreen", false)
		}
	})
	dm.applySavedBounds(mainWin, 880, 600)
	dm.attachBoundsPersistence(mainWin)
}

func (dm *DesktopManager) SetupSystemTray(templateIcon, colorIcon []byte) {
	if dm.app == nil {
		return
	}
	tray := dm.app.SystemTray.New()
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(templateIcon)
	} else {
		tray.SetIcon(colorIcon)
	}
	tray.SetTooltip("Agenda Butler — 日程管家")

	menu := application.NewMenu()
	tray.SetMenu(menu)
	tray.OnClick(func() {
		dm.HandleTrayClick()
	})

	dm.tray = tray
	dm.trayMenu = menu

	// Pre-create tray popover window hidden so clicking tray icon opens immediately
	_, _ = dm.ensureWindow(WindowKindTrayPopover, "", false)
	if pop, ok := dm.app.Window.GetByName(WindowKindTrayPopover); ok {
		tray.AttachWindow(pop).WindowOffset(6)
		// Re-assign OnClick so our configured TrayClickAction governs left clicks
		tray.OnClick(func() {
			dm.HandleTrayClick()
		})
	}

	dm.UpdateTrayStatus()
	dm.RebuildTrayMenu()
}

func (dm *DesktopManager) SetupGlobalShortcuts() {
	dm.ApplyGlobalShortcuts()
}

func (dm *DesktopManager) ApplyGlobalShortcuts() {
	if dm.app == nil || dm.app.GlobalShortcut == nil {
		return
	}
	prefs := LoadDesktopPreferences(dm.db)

	dm.mu.Lock()
	prev := append([]string(nil), dm.registeredHotkeys...)
	dm.mu.Unlock()

	for _, acc := range prev {
		_ = dm.app.GlobalShortcut.Unregister(acc)
	}

	var registered []string
	var errMsgs []string

	tryRegister := func(accel string, handler func()) {
		accel = strings.TrimSpace(accel)
		if accel == "" {
			return
		}
		if err := dm.app.GlobalShortcut.Register(accel, handler); err != nil {
			errMsgs = append(errMsgs, fmt.Sprintf("%s: %v", accel, err))
			return
		}
		registered = append(registered, accel)
	}

	tryRegister(prefs.QuickAddHotkey, func() {
		p := LoadDesktopPreferences(dm.db)
		if p.HotkeyTarget == "main" {
			_ = dm.OpenWindow(WindowKindMain, "")
			dm.app.Event.Emit("open-create-modal", true)
			return
		}
		_ = dm.ToggleWindow(WindowKindQuickAdd)
	})
	tryRegister(prefs.TrayPopoverHotkey, func() {
		_ = dm.toggleTrayPopover()
	})
	tryRegister(prefs.FocusHotkey, func() {
		_ = dm.ToggleWindow(WindowKindFocus)
	})

	dm.mu.Lock()
	dm.registeredHotkeys = registered
	dm.hotkeyError = strings.Join(errMsgs, "; ")
	dm.mu.Unlock()
}

func (dm *DesktopManager) SetupApplicationMenu() {
	if dm.app == nil || dm.app.Menu == nil {
		return
	}
	menu := application.NewMenu()
	if runtime.GOOS == "darwin" {
		menu.AddRole(application.AppMenu)
	}

	fileMenu := menu.AddSubmenu("文件")
	fileMenu.Add("新建日程...").SetAccelerator("CmdOrCtrl+N").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindMain, "")
		dm.app.Event.Emit("open-create-modal", true)
	})
	fileMenu.Add("快速捕获浮窗").OnClick(func(ctx *application.Context) {
		_ = dm.ToggleWindow(WindowKindQuickAdd)
	})
	fileMenu.AddSeparator()
	fileMenu.Add("偏好与后台设置...").SetAccelerator("CmdOrCtrl+,").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindMain, "")
		dm.app.Event.Emit("open-settings-tab", "desktop")
	})

	menu.AddRole(application.EditMenu)

	viewMenu := menu.AddSubmenu("视图")
	viewMenu.Add("新开周计划窗口").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "week")
	})
	viewMenu.Add("新开全景月历窗口").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "month")
	})
	viewMenu.Add("新开四象限矩阵窗口").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "matrix")
	})
	viewMenu.Add("新开日程列表窗口").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "list")
	})

	winMenu := menu.AddSubmenu("窗口")
	winMenu.Add("显示主工作台").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindMain, "")
	})
	winMenu.Add("今日速览浮窗").OnClick(func(ctx *application.Context) {
		_ = dm.toggleTrayPopover()
	})
	winMenu.Add("番茄专注浮窗").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindFocus, "")
	})
	winMenu.Add("AI 日程副驾驶").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindAI, "")
	})
	winMenu.AddSeparator()
	winMenu.Add("隐藏全部辅助浮窗").OnClick(func(ctx *application.Context) {
		dm.HideAllAuxiliaryWindows()
	})
	winMenu.Add("重置全部窗口位置与尺寸").OnClick(func(ctx *application.Context) {
		_ = dm.ResetAllWindowBounds()
	})

	menu.AddRole(application.HelpMenu)
	dm.app.Menu.Set(menu)
}

func (dm *DesktopManager) HandleTrayClick() {
	prefs := LoadDesktopPreferences(dm.db)
	switch prefs.TrayClickAction {
	case "menu":
		dm.RebuildTrayMenu()
		if dm.tray != nil {
			dm.tray.OpenMenu()
		}
	case "main":
		_ = dm.ToggleWindow(WindowKindMain)
	default:
		_ = dm.toggleTrayPopover()
	}
}

func showAndFocusWindow(win application.Window) {
	if win == nil {
		return
	}
	if win.IsMinimised() {
		win.UnMinimise()
	}
	win.Show()
	win.Focus()
}

func (dm *DesktopManager) toggleTrayPopover() error {
	if dm.app == nil {
		return nil
	}
	win, err := dm.ensureWindow(WindowKindTrayPopover, "", false)
	if err != nil || win == nil {
		return err
	}
	if win.IsVisible() {
		win.Hide()
		dm.emitDesktopStatus()
		return nil
	}
	dm.mu.Lock()
	recentlyBlurred := !dm.popoverHiddenAt.IsZero() && time.Since(dm.popoverHiddenAt) < 250*time.Millisecond
	if recentlyBlurred {
		dm.popoverHiddenAt = time.Time{}
	}
	dm.mu.Unlock()
	if recentlyBlurred {
		dm.emitDesktopStatus()
		return nil
	}
	if dm.tray != nil {
		_ = dm.tray.PositionWindow(win, 6)
	} else {
		win.Center()
	}
	showAndFocusWindow(win)
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) OpenWindow(kind string, param string) error {
	if dm.app == nil {
		return nil
	}
	win, err := dm.ensureWindow(kind, param, true)
	if err != nil || win == nil {
		return err
	}
	if strings.ToLower(strings.TrimSpace(kind)) == WindowKindTrayPopover && dm.tray != nil {
		_ = dm.tray.PositionWindow(win, 6)
	}
	showAndFocusWindow(win)
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) ToggleWindow(kind string) error {
	if dm.app == nil {
		return nil
	}
	if strings.ToLower(strings.TrimSpace(kind)) == WindowKindTrayPopover {
		return dm.toggleTrayPopover()
	}
	name := WindowNameForKind(kind, "")
	if existing, ok := dm.app.Window.GetByName(name); ok {
		if existing.IsVisible() {
			existing.Hide()
			dm.emitDesktopStatus()
			return nil
		}
		showAndFocusWindow(existing)
		dm.emitDesktopStatus()
		return nil
	}
	return dm.OpenWindow(kind, "")
}

func (dm *DesktopManager) CloseWindow(name string) error {
	if dm.app == nil {
		return nil
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil
	}
	win, ok := dm.app.Window.GetByName(name)
	if !ok {
		return nil
	}
	if name == WindowKindMain || name == WindowKindQuickAdd || name == WindowKindTrayPopover || name == WindowKindFocus {
		win.Hide()
	} else {
		win.Close()
	}
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) FocusWindow(name string) error {
	if dm.app == nil {
		return nil
	}
	win, ok := dm.app.Window.GetByName(strings.TrimSpace(name))
	if !ok {
		return fmt.Errorf("窗口不存在: %s", name)
	}
	showAndFocusWindow(win)
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) ResizeWindow(name string, width, height int) error {
	if dm.app == nil {
		return nil
	}
	name = strings.TrimSpace(name)
	win, ok := dm.app.Window.GetByName(name)
	if !ok {
		return fmt.Errorf("窗口不存在: %s", name)
	}
	if width < 220 {
		width = 220
	}
	if height < 120 {
		height = 120
	}
	win.SetSize(width, height)
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) ResetWindowBounds(name string) error {
	name = strings.TrimSpace(name)
	if dm.db != nil && name != "" {
		_ = dm.db.SaveSettings(map[string]string{
			"desktop.bounds." + name: "",
		})
	}
	if dm.app != nil && name != "" {
		if win, ok := dm.app.Window.GetByName(name); ok {
			win.Center()
			showAndFocusWindow(win)
		}
	}
	return nil
}

// ResetAllWindowBounds clears persisted bounds for all known windows and re-centers visible ones.
func (dm *DesktopManager) ResetAllWindowBounds() error {
	if dm.db != nil {
		if settings, err := dm.db.GetSettings(); err == nil {
			patch := make(map[string]string)
			for k, v := range settings {
				if strings.HasPrefix(k, "desktop.bounds.") && strings.TrimSpace(v) != "" {
					patch[k] = ""
				}
			}
			if len(patch) > 0 {
				_ = dm.db.SaveSettings(patch)
			}
		}
	}
	if dm.app != nil {
		for _, w := range dm.app.Window.GetAll() {
			if w.Name() == WindowKindTrayPopover {
				continue
			}
			w.Center()
		}
	}
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) HideAllAuxiliaryWindows() {
	if dm.app == nil {
		return
	}
	for _, w := range dm.app.Window.GetAll() {
		if w.Name() != WindowKindMain && w.IsVisible() {
			w.Hide()
		}
	}
	dm.emitDesktopStatus()
}

func (dm *DesktopManager) SetWindowAlwaysOnTop(name string, onTop bool) error {
	if dm.app == nil {
		return nil
	}
	name = strings.TrimSpace(name)
	win, ok := dm.app.Window.GetByName(name)
	if !ok {
		return fmt.Errorf("窗口不存在: %s", name)
	}
	win.SetAlwaysOnTop(onTop)
	dm.mu.Lock()
	dm.alwaysOnTop[name] = onTop
	dm.mu.Unlock()
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) SetPopoverPinned(pinned bool) {
	dm.popoverPinned.Store(pinned)
	dm.emitDesktopStatus()
}

func buildWindowOptions(kind string, param string, showAfterCreate bool) (application.WebviewWindowOptions, bool, error) {
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))
	name := WindowNameForKind(normalizedKind, param)

	var opts application.WebviewWindowOptions
	defaultOnTop := false

	switch normalizedKind {
	case WindowKindMain:
		return opts, false, fmt.Errorf("主窗口尚未初始化")
	case WindowKindQuickAdd:
		defaultOnTop = true
		opts = application.WebviewWindowOptions{
			Name:             name,
			Title:            "快速新建日程",
			Width:            640,
			Height:           330,
			MinWidth:         500,
			MinHeight:        250,
			AlwaysOnTop:      true,
			InitialPosition:  application.WindowCentered,
			Hidden:           !showAfterCreate,
			HideOnEscape:     true,
			BackgroundColour: application.NewRGBA(10, 12, 16, 240),
			Mac: application.MacWindow{
				InvisibleTitleBarHeight: 42,
				Backdrop:                application.MacBackdropTranslucent,
				TitleBar:                application.MacTitleBarHiddenInset,
				// CanJoinAllSpaces and MoveToActiveSpace are mutually exclusive on macOS NSWindow.
				CollectionBehavior: application.MacWindowCollectionBehaviorMoveToActiveSpace | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
			},
			URL: "/?window=quick-add",
		}
	case WindowKindTrayPopover:
		defaultOnTop = true
		opts = application.WebviewWindowOptions{
			Name:             name,
			Title:            "今日待办速览",
			Width:            396,
			Height:           548,
			MinWidth:         340,
			MinHeight:        420,
			AlwaysOnTop:      true,
			Frameless:        true,
			Hidden:           !showAfterCreate,
			HideOnEscape:     true,
			BackgroundColour: application.NewRGBA(10, 12, 16, 240),
			Mac: application.MacWindow{
				Backdrop:           application.MacBackdropTranslucent,
				CornerType:         application.MacWindowCornerTypeRounded,
				CollectionBehavior: application.MacWindowCollectionBehaviorMoveToActiveSpace | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
				WindowLevel:        application.MacWindowLevelPopUpMenu,
			},
			URL: "/?window=tray-popover",
		}
	case WindowKindFocus:
		defaultOnTop = true
		opts = application.WebviewWindowOptions{
			Name:             name,
			Title:            "番茄专注浮窗 · Agenda Butler",
			Width:            440,
			Height:           620,
			MinWidth:         320,
			MinHeight:        140,
			AlwaysOnTop:      true,
			Hidden:           !showAfterCreate,
			BackgroundColour: application.NewRGBA(10, 12, 16, 245),
			Mac: application.MacWindow{
				InvisibleTitleBarHeight: 44,
				Backdrop:                application.MacBackdropTranslucent,
				TitleBar:                application.MacTitleBarHiddenInset,
				// Keep Focus HUD visible across Spaces without combining CanJoinAllSpaces with MoveToActiveSpace (AppKit throws NSInvalidArgumentException).
				CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
			},
			URL: "/?window=focus",
		}
	case WindowKindAI:
		opts = application.WebviewWindowOptions{
			Name:             name,
			Title:            "AI 智能副驾驶 · Agenda Butler",
			Width:            490,
			Height:           700,
			MinWidth:         380,
			MinHeight:        520,
			Hidden:           !showAfterCreate,
			BackgroundColour: application.NewRGBA(10, 12, 16, 245),
			Mac: application.MacWindow{
				InvisibleTitleBarHeight: 46,
				Backdrop:                application.MacBackdropTranslucent,
				TitleBar:                application.MacTitleBarHiddenInset,
			},
			URL: "/?window=ai",
		}
	case WindowKindWorkspace:
		view := NormalizeWorkspaceView(param)
		viewTitles := map[string]string{
			"list":   "日程列表",
			"week":   "周计划视图",
			"month":  "全景月历视图",
			"matrix": "四象限矩阵视图",
		}
		opts = application.WebviewWindowOptions{
			Name:             name,
			Title:            fmt.Sprintf("%s · Agenda Butler", viewTitles[view]),
			Width:            1040,
			Height:           700,
			MinWidth:         760,
			MinHeight:        540,
			Hidden:           !showAfterCreate,
			BackgroundColour: application.NewRGB(7, 8, 10),
			Mac: application.MacWindow{
				InvisibleTitleBarHeight:      50,
				Backdrop:                     application.MacBackdropTranslucent,
				TitleBar:                     application.MacTitleBarHiddenInset,
				DisableEscapeExitsFullscreen: true,
			},
			URL: "/?window=workspace&view=" + view,
		}
	default:
		return opts, false, fmt.Errorf("未知窗口类型: %s", kind)
	}
	return opts, defaultOnTop, nil
}

func (dm *DesktopManager) ensureWindow(kind string, param string, showAfterCreate bool) (application.Window, error) {
	if dm.app == nil {
		return nil, nil
	}
	normalizedKind := strings.ToLower(strings.TrimSpace(kind))
	name := WindowNameForKind(normalizedKind, param)

	if existing, ok := dm.app.Window.GetByName(name); ok {
		return existing, nil
	}

	opts, defaultOnTop, err := buildWindowOptions(normalizedKind, param, showAfterCreate)
	if err != nil {
		return nil, err
	}

	win := dm.app.Window.NewWithOptions(opts)

	dm.mu.Lock()
	dm.windowKinds[name] = normalizedKind
	dm.alwaysOnTop[name] = defaultOnTop
	dm.mu.Unlock()

	// Persistent auxiliary windows hide on close for instant re-summon unless app is quitting
	if normalizedKind == WindowKindQuickAdd || normalizedKind == WindowKindTrayPopover || normalizedKind == WindowKindFocus {
		win.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
			if dm.isQuitting.Load() {
				return
			}
			win.Hide()
			event.Cancel()
			dm.emitDesktopStatus()
		})
	} else {
		win.OnWindowEvent(events.Common.WindowClosing, func(event *application.WindowEvent) {
			dm.mu.Lock()
			delete(dm.windowKinds, name)
			delete(dm.alwaysOnTop, name)
			dm.mu.Unlock()
			dm.emitDesktopStatus()
		})
	}

	if normalizedKind == WindowKindTrayPopover {
		win.OnWindowEvent(events.Common.WindowLostFocus, func(event *application.WindowEvent) {
			if !dm.popoverPinned.Load() && win.IsVisible() {
				dm.mu.Lock()
				dm.popoverHiddenAt = time.Now()
				dm.mu.Unlock()
				win.Hide()
				dm.emitDesktopStatus()
			}
		})
	}

	win.OnWindowEvent(events.Common.WindowShow, func(event *application.WindowEvent) {
		dm.emitDesktopStatus()
	})
	win.OnWindowEvent(events.Common.WindowHide, func(event *application.WindowEvent) {
		dm.emitDesktopStatus()
	})

	if normalizedKind != WindowKindTrayPopover {
		dm.applySavedBounds(win, opts.MinWidth, opts.MinHeight)
		dm.attachBoundsPersistence(win)
	}

	return win, nil
}

// ClampWindowBounds constrains a persisted WindowBounds rect to the given screen work area and minimum size.
func ClampWindowBounds(saved WindowBounds, workArea application.Rect, minW, minH int) WindowBounds {
	if minW <= 0 {
		minW = 320
	}
	if minH <= 0 {
		minH = 220
	}
	w := saved.Width
	if w < minW {
		w = minW
	}
	h := saved.Height
	if h < minH {
		h = minH
	}
	x := saved.X
	y := saved.Y

	if workArea.Width > 0 && workArea.Height > 0 {
		if w > workArea.Width {
			w = workArea.Width
		}
		if h > workArea.Height {
			h = workArea.Height
		}
		if x < workArea.X {
			x = workArea.X
		}
		if y < workArea.Y {
			y = workArea.Y
		}
		if x+w > workArea.X+workArea.Width {
			x = workArea.X + workArea.Width - w
		}
		if y+h > workArea.Y+workArea.Height {
			y = workArea.Y + workArea.Height - h
		}
	}
	return WindowBounds{X: x, Y: y, Width: w, Height: h}
}

func (dm *DesktopManager) applySavedBounds(win application.Window, minW, minH int) {
	if dm.db == nil || win == nil {
		return
	}
	settings, err := dm.db.GetSettings()
	if err != nil {
		return
	}
	raw := strings.TrimSpace(settings["desktop.bounds."+win.Name()])
	if raw == "" {
		return
	}
	var saved WindowBounds
	if err := json.Unmarshal([]byte(raw), &saved); err != nil || saved.Width <= 0 || saved.Height <= 0 {
		return
	}
	var workArea application.Rect
	if scr, err := win.GetScreen(); err == nil && scr != nil {
		workArea = scr.WorkArea
	}
	clamped := ClampWindowBounds(saved, workArea, minW, minH)
	win.SetBounds(application.Rect{
		X:      clamped.X,
		Y:      clamped.Y,
		Width:  clamped.Width,
		Height: clamped.Height,
	})
}

func (dm *DesktopManager) attachBoundsPersistence(win application.Window) {
	if dm.db == nil || win == nil {
		return
	}
	name := win.Name()
	scheduleSave := func() {
		if win.IsFullscreen() || win.IsMinimised() || !win.IsVisible() {
			return
		}
		b := win.Bounds()
		if b.Width <= 0 || b.Height <= 0 {
			return
		}
		dm.mu.Lock()
		if prev, ok := dm.boundsTimers[name]; ok && prev != nil {
			prev.Stop()
		}
		dm.boundsTimers[name] = time.AfterFunc(450*time.Millisecond, func() {
			data, err := json.Marshal(WindowBounds{
				X:      b.X,
				Y:      b.Y,
				Width:  b.Width,
				Height: b.Height,
			})
			if err == nil && dm.db != nil {
				_ = dm.db.SaveSettings(map[string]string{
					"desktop.bounds." + name: string(data),
				})
			}
		})
		dm.mu.Unlock()
	}
	win.OnWindowEvent(events.Common.WindowDidMove, func(event *application.WindowEvent) {
		scheduleSave()
	})
	win.OnWindowEvent(events.Common.WindowDidResize, func(event *application.WindowEvent) {
		scheduleSave()
	})
}

func (dm *DesktopManager) GetOpenWindows() []WindowSummary {
	if dm.app == nil {
		return []WindowSummary{}
	}
	all := dm.app.Window.GetAll()
	dm.mu.Lock()
	kinds := make(map[string]string, len(dm.windowKinds))
	for k, v := range dm.windowKinds {
		kinds[k] = v
	}
	onTopMap := make(map[string]bool, len(dm.alwaysOnTop))
	for k, v := range dm.alwaysOnTop {
		onTopMap[k] = v
	}
	dm.mu.Unlock()

	res := make([]WindowSummary, 0, len(all))
	for _, w := range all {
		name := w.Name()
		kind := kinds[name]
		if kind == "" {
			kind = name
		}
		res = append(res, WindowSummary{
			Name:        name,
			Title:       windowFriendlyTitle(name, kind),
			Kind:        kind,
			Visible:     w.IsVisible(),
			AlwaysOnTop: onTopMap[name],
			Focused:     w.IsFocused(),
		})
	}
	sort.Slice(res, func(i, j int) bool {
		if res[i].Name == WindowKindMain {
			return true
		}
		if res[j].Name == WindowKindMain {
			return false
		}
		return res[i].Name < res[j].Name
	})
	return res
}

func (dm *DesktopManager) UpdateFocusState(state FocusTrayState) {
	menuKey := fmt.Sprintf("%t|%s|%t|%s", state.Running, state.Mode, state.Clock != "", state.Title)
	dm.mu.Lock()
	dm.focusState = state
	menuChanged := menuKey != dm.lastFocusMenuKey
	if menuChanged {
		dm.lastFocusMenuKey = menuKey
	}
	dm.mu.Unlock()
	dm.UpdateTrayStatus()
	if menuChanged {
		dm.RebuildTrayMenu()
	}
}

func (dm *DesktopManager) GetFocusState() FocusTrayState {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	return dm.focusState
}

func formatPausedRemainingText(remainingSec int64) string {
	if remainingSec <= 0 {
		return ""
	}
	mins := (remainingSec + 59) / 60
	if mins >= 60 {
		h := mins / 60
		m := mins % 60
		if m == 0 {
			return fmt.Sprintf("%d 小时", h)
		}
		return fmt.Sprintf("%d 小时 %d 分", h, m)
	}
	return fmt.Sprintf("%d 分钟", mins)
}

func formatNextReminderCountdown(scheduledAt string, now time.Time) string {
	t, err := parseFlexibleTime(scheduledAt)
	if err != nil {
		return ""
	}
	diff := t.Sub(now)
	if diff <= 0 {
		return "即将到期"
	}
	mins := int((diff + 59*time.Second) / time.Minute)
	if mins < 60 {
		return fmt.Sprintf("%d 分钟后", mins)
	}
	hours := mins / 60
	rem := mins % 60
	if hours < 24 {
		if rem == 0 {
			return fmt.Sprintf("%d 小时后", hours)
		}
		return fmt.Sprintf("%d 小时 %d 分后", hours, rem)
	}
	return t.In(time.Local).Format("01-02 15:04")
}

func (dm *DesktopManager) UpdateTrayStatus() {
	if dm.tray == nil || dm.db == nil {
		return
	}
	prefs := LoadDesktopPreferences(dm.db)
	stats, err := dm.db.GetStats()
	if err != nil || stats == nil {
		return
	}
	focus := dm.GetFocusState()
	now := time.Now()
	var schedStatus SchedulerStatus
	paused := false
	if dm.scheduler != nil {
		schedStatus = dm.scheduler.GetStatus()
		paused = schedStatus.Paused
	}
	dnd := IsWithinDND(prefs, now)

	var labelParts []string
	if focus.Running && focus.Clock != "" {
		phase := "专注"
		if focus.Mode == "shortBreak" {
			phase = "短休"
		} else if focus.Mode == "longBreak" {
			phase = "长休"
		}
		labelParts = append(labelParts, fmt.Sprintf("%s %s", phase, focus.Clock))
	} else if prefs.ShowTrayCount && stats.TodayReminders > 0 {
		labelParts = append(labelParts, fmt.Sprintf("%d", stats.TodayReminders))
	}

	var newLabel string
	if len(labelParts) > 0 {
		newLabel = " " + strings.Join(labelParts, " ")
	}

	var statusTags []string
	if paused {
		if rem := formatPausedRemainingText(schedStatus.PausedRemainingSec); rem != "" {
			statusTags = append(statusTags, "后台暂停中 · 剩余 "+rem)
		} else {
			statusTags = append(statusTags, "后台提醒已暂停")
		}
	}
	if dnd {
		statusTags = append(statusTags, "免打扰中")
	}
	if focus.Clock != "" {
		taskPart := ""
		if focus.Title != "" {
			taskPart = " · " + focus.Title
		}
		if focus.Running {
			statusTags = append(statusTags, fmt.Sprintf("专注 %s%s", focus.Clock, taskPart))
		} else {
			statusTags = append(statusTags, fmt.Sprintf("专注已暂停 %s%s", focus.Clock, taskPart))
		}
	}
	if schedStatus.NextReminderTitle != "" {
		if cd := formatNextReminderCountdown(schedStatus.NextReminderAt, now); cd != "" {
			statusTags = append(statusTags, fmt.Sprintf("下一项: %s (%s)", truncateMenuTitle(schedStatus.NextReminderTitle, 14), cd))
		}
	}

	tooltip := fmt.Sprintf("Agenda Butler — 今日 %d 项待办", stats.TodayReminders)
	if stats.TodayReminders == 0 {
		tooltip = "Agenda Butler — 今日日程已清空"
	}
	if len(statusTags) > 0 {
		tooltip += " (" + strings.Join(statusTags, " · ") + ")"
	}

	dm.mu.Lock()
	labelChanged := newLabel != dm.lastTrayLabel
	tooltipChanged := tooltip != dm.lastTrayTooltip
	if labelChanged {
		dm.lastTrayLabel = newLabel
	}
	if tooltipChanged {
		dm.lastTrayTooltip = tooltip
	}
	dm.mu.Unlock()

	if labelChanged {
		dm.tray.SetLabel(newLabel)
	}
	if tooltipChanged {
		dm.tray.SetTooltip(tooltip)
	}
}

func (dm *DesktopManager) RebuildTrayMenu() {
	if dm.tray == nil || dm.trayMenu == nil || dm.db == nil {
		return
	}
	if !dm.trayRebuild.CompareAndSwap(false, true) {
		return
	}
	defer dm.trayRebuild.Store(false)

	now := time.Now()
	prefs := LoadDesktopPreferences(dm.db)
	stats, _ := dm.db.GetStats()
	overdueList, _ := dm.db.GetOverdueReminders()
	allReminders, _ := dm.db.GetAllReminders()
	autoStart := dm.GetAutoStartInfo()
	var schedStatus SchedulerStatus
	paused := false
	if dm.scheduler != nil {
		schedStatus = dm.scheduler.GetStatus()
		paused = schedStatus.Paused
	}
	dnd := IsWithinDND(prefs, now)
	focus := dm.GetFocusState()

	menu := dm.trayMenu
	menu.Clear()

	// 1. Status Header
	todayCount := 0
	if stats != nil {
		todayCount = stats.TodayReminders
	}
	headerText := fmt.Sprintf("今日待办 %d 项", todayCount)
	if len(overdueList) > 0 {
		headerText += fmt.Sprintf(" · 逾期 %d 项", len(overdueList))
	}
	if paused {
		if rem := formatPausedRemainingText(schedStatus.PausedRemainingSec); rem != "" {
			headerText += fmt.Sprintf(" [暂停剩余 %s]", rem)
		} else {
			headerText += " [已暂停]"
		}
	} else if dnd {
		headerText += " [免打扰]"
	}
	menu.Add(headerText).SetEnabled(false)

	if schedStatus.NextReminderTitle != "" {
		nextLine := "下一项：" + truncateMenuTitle(schedStatus.NextReminderTitle, 20)
		if cd := formatNextReminderCountdown(schedStatus.NextReminderAt, now); cd != "" {
			nextLine += " (" + cd + ")"
		}
		menu.Add(nextLine).SetEnabled(false)
	}

	if focus.Clock != "" {
		stateLabel := "专注计时中"
		toggleLabel := fmt.Sprintf("暂停专注 (%s)", focus.Clock)
		if !focus.Running {
			stateLabel = "专注已暂停"
			toggleLabel = fmt.Sprintf("继续专注 (%s)", focus.Clock)
		}
		focusLabel := fmt.Sprintf("%s: %s", stateLabel, focus.Clock)
		if focus.Title != "" {
			focusLabel += " · " + truncateMenuTitle(focus.Title, 16)
		}
		focusSub := menu.AddSubmenu(focusLabel)
		focusSub.Add(toggleLabel).OnClick(func(ctx *application.Context) {
			if dm.app != nil {
				dm.app.Event.Emit("focus-command", "toggle")
			}
		})
		focusSub.Add("跳过至下一阶段").OnClick(func(ctx *application.Context) {
			if dm.app != nil {
				dm.app.Event.Emit("focus-command", "skip")
			}
		})
		focusSub.Add("打开独立专注浮窗").OnClick(func(ctx *application.Context) {
			_ = dm.OpenWindow(WindowKindFocus, "")
		})
	}

	menu.AddSeparator()

	// 2. Upcoming & Overdue Quick Actions (up to 5 items)
	activeQuickItems := collectTrayReminders(allReminders, 5)
	if len(activeQuickItems) == 0 {
		menu.Add("暂无待处理日程").SetEnabled(false)
	} else {
		for _, item := range activeQuickItems {
			rem := item
			timeStr := formatTrayReminderTime(rem)
			tag := ""
			if rem.Status == "expired" || isReminderPastDue(rem) {
				tag = "[逾期] "
			} else if rem.IsPinned {
				tag = "[置顶] "
			}
			label := fmt.Sprintf("%s%s %s", tag, timeStr, truncateMenuTitle(rem.Title, 22))
			sub := menu.AddSubmenu(label)
			sub.Add("✓ 标记完成").OnClick(func(ctx *application.Context) {
				if dm.service != nil {
					_, _ = dm.service.UpdateReminder(UpdateReminderRequest{
						ID:              rem.ID,
						Title:           rem.Title,
						ScheduledAt:     rem.ScheduledAt,
						RepeatRule:      rem.RepeatRule,
						LeadMinutes:     rem.LeadMinutes,
						Notes:           rem.Notes,
						DurationMinutes: rem.DurationMinutes,
						Timezone:        rem.Timezone,
						Prompt:          rem.Prompt,
						Status:          "ended",
						Priority:        rem.Priority,
						Tags:            rem.Tags,
						Subtasks:        rem.Subtasks,
						IsPinned:        rem.IsPinned,
					})
				}
			})
			sub.Add("稍后 10 分钟提醒").OnClick(func(ctx *application.Context) {
				if dm.service != nil {
					_, _ = dm.service.SnoozeReminder(rem.ID, 10)
				}
			})
			sub.Add("稍后 1 小时提醒").OnClick(func(ctx *application.Context) {
				if dm.service != nil {
					_, _ = dm.service.SnoozeReminder(rem.ID, 60)
				}
			})
			sub.AddSeparator()
			sub.Add("以此任务开始专注").OnClick(func(ctx *application.Context) {
				_ = dm.OpenWindow(WindowKindFocus, "")
				if dm.app != nil {
					dm.app.Event.Emit("focus-bind-reminder", rem.ID)
				}
			})
			sub.Add("在主窗口编辑").OnClick(func(ctx *application.Context) {
				_ = dm.TriggerOpenInMain(rem.ID)
			})
		}
	}

	if len(overdueList) > 0 {
		menu.Add(fmt.Sprintf("一键将 %d 项逾期顺延 15 分钟", len(overdueList))).OnClick(func(ctx *application.Context) {
			if dm.service != nil {
				_, _ = dm.service.SnoozeAllOverdue(15)
			}
		})
	}

	menu.AddSeparator()

	isWinVisible := func(name string) bool {
		if dm.app == nil {
			return false
		}
		if w, ok := dm.app.Window.GetByName(name); ok {
			return w.IsVisible()
		}
		return false
	}
	winLabel := func(title, name string) string {
		if isWinVisible(name) {
			return "● " + title
		}
		return title
	}

	// 3. Multi-Window Launchers
	menu.Add(winLabel("显示主工作台", WindowKindMain)).OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindMain, "")
	})
	menu.Add(winLabel("今日速览浮窗", WindowKindTrayPopover)).OnClick(func(ctx *application.Context) {
		_ = dm.toggleTrayPopover()
	})
	menu.Add(winLabel("快速新建浮窗...", WindowKindQuickAdd)).OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindQuickAdd, "")
	})
	menu.Add(winLabel("独立番茄专注浮窗", WindowKindFocus)).OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindFocus, "")
	})
	menu.Add(winLabel("独立 AI 日程助手", WindowKindAI)).OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindAI, "")
	})

	viewsMenu := menu.AddSubmenu("新开独立视图窗口")
	viewsMenu.Add("周计划视图").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "week")
	})
	viewsMenu.Add("全景月历视图").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "month")
	})
	viewsMenu.Add("四象限优先级矩阵").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "matrix")
	})
	viewsMenu.Add("日程列表视图").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindWorkspace, "list")
	})
	viewsMenu.AddSeparator()
	viewsMenu.Add("重置全部窗口位置与尺寸").OnClick(func(ctx *application.Context) {
		_ = dm.ResetAllWindowBounds()
	})
	menu.Add("隐藏全部辅助浮窗").OnClick(func(ctx *application.Context) {
		dm.HideAllAuxiliaryWindows()
	})

	menu.AddSeparator()

	// 4. Background Daemon Controls
	if paused {
		resumeLabel := "立即恢复后台提醒守护"
		if rem := formatPausedRemainingText(schedStatus.PausedRemainingSec); rem != "" {
			resumeLabel = fmt.Sprintf("立即恢复后台提醒（剩余 %s）", rem)
		}
		menu.Add(resumeLabel).OnClick(func(ctx *application.Context) {
			_ = dm.SetSchedulerPaused(false)
		})
	} else {
		pauseSub := menu.AddSubmenu("暂停后台提醒守护")
		pauseSub.Add("暂停 30 分钟").OnClick(func(ctx *application.Context) {
			_ = dm.PauseSchedulerFor(30)
		})
		pauseSub.Add("暂停 1 小时").OnClick(func(ctx *application.Context) {
			_ = dm.PauseSchedulerFor(60)
		})
		pauseSub.Add("暂停 2 小时").OnClick(func(ctx *application.Context) {
			_ = dm.PauseSchedulerFor(120)
		})
		pauseSub.AddSeparator()
		pauseSub.Add("持续暂停（直到手动恢复）").OnClick(func(ctx *application.Context) {
			_ = dm.SetSchedulerPaused(true)
		})
	}
	menu.AddCheckbox("免打扰模式 (DND)", prefs.DndEnabled).OnClick(func(ctx *application.Context) {
		p := LoadDesktopPreferences(dm.db)
		p.DndEnabled = !p.DndEnabled
		_ = SaveDesktopPreferences(dm.db, p)
		dm.NotifyPreferencesChanged()
	})
	if autoStart.Supported {
		menu.AddCheckbox("开机自动启动", autoStart.Enabled).OnClick(func(ctx *application.Context) {
			_, _ = dm.SetAutoStartEnabled(!autoStart.Enabled)
		})
	}
	menu.Add("发送今日简报通知").OnClick(func(ctx *application.Context) {
		if dm.scheduler != nil {
			_, _ = dm.scheduler.SendMorningBriefingDigest()
		}
	})
	menu.Add("立即巡检提醒并发送测试通知").OnClick(func(ctx *application.Context) {
		if dm.scheduler != nil {
			dm.scheduler.TriggerImmediateCheck()
		}
		dispatchDesktopNotification("日程管家后台测试", "后台提醒守护工作正常，系统通知通路畅通。")
	})

	menu.AddSeparator()

	menu.Add("偏好与后台设置...").OnClick(func(ctx *application.Context) {
		_ = dm.OpenWindow(WindowKindMain, "")
		if dm.app != nil {
			dm.app.Event.Emit("open-settings-tab", "desktop")
		}
	})
	menu.Add("退出日程管家").OnClick(func(ctx *application.Context) {
		dm.QuitApp()
	})

	menu.Update()
}

func (dm *DesktopManager) PauseSchedulerFor(minutes int) error {
	if minutes <= 0 {
		return dm.SetSchedulerPaused(false)
	}
	if dm.scheduler != nil {
		dm.scheduler.PauseFor(minutes)
	}
	dm.UpdateTrayStatus()
	dm.RebuildTrayMenu()
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) SetSchedulerPaused(paused bool) error {
	if dm.scheduler != nil {
		dm.scheduler.SetPaused(paused)
	}
	if dm.db != nil {
		prefs := LoadDesktopPreferences(dm.db)
		prefs.SchedulerPaused = paused
		if err := SaveDesktopPreferences(dm.db, prefs); err != nil {
			return err
		}
	}
	dm.UpdateTrayStatus()
	dm.RebuildTrayMenu()
	dm.emitDesktopStatus()
	return nil
}

func (dm *DesktopManager) GetAutoStartInfo() AutoStartInfo {
	if dm.app == nil || dm.app.Autostart == nil {
		return AutoStartInfo{Supported: false}
	}
	st, err := dm.app.Autostart.Status()
	if err != nil {
		return AutoStartInfo{
			Supported: err != application.ErrAutostartNotSupported,
			Error:     err.Error(),
		}
	}
	return AutoStartInfo{
		Enabled:   st.Enabled,
		Strategy:  string(st.Strategy),
		Path:      st.Path,
		Supported: true,
	}
}

func (dm *DesktopManager) SetAutoStartEnabled(enabled bool) (AutoStartInfo, error) {
	if dm.app == nil || dm.app.Autostart == nil {
		return AutoStartInfo{Supported: false}, application.ErrAutostartNotSupported
	}
	prefs := LoadDesktopPreferences(dm.db)
	var err error
	if enabled {
		var args []string
		if prefs.StartMinimized {
			args = []string{"--minimized"}
		}
		err = dm.app.Autostart.EnableWithOptions(application.AutostartOptions{
			Identifier: "com.agendabutler.desktop",
			Arguments:  args,
		})
	} else {
		err = dm.app.Autostart.Disable()
	}
	info := dm.GetAutoStartInfo()
	if err != nil {
		info.Error = err.Error()
		return info, err
	}
	dm.RebuildTrayMenu()
	dm.emitDesktopStatus()
	return info, nil
}

func (dm *DesktopManager) TriggerOpenInMain(reminderID string) error {
	if err := dm.OpenWindow(WindowKindMain, ""); err != nil {
		return err
	}
	if dm.app != nil && strings.TrimSpace(reminderID) != "" {
		dm.app.Event.Emit("open-reminder-detail", reminderID)
	}
	return nil
}

func (dm *DesktopManager) RefreshTrayAndStatus() {
	dm.UpdateTrayStatus()
	dm.RebuildTrayMenu()
	dm.emitDesktopStatus()
}

func (dm *DesktopManager) NotifyDataChanged() {
	if dm.app != nil {
		dm.app.Event.Emit("reminders-updated", true)
	}
	dm.RefreshTrayAndStatus()
}

func (dm *DesktopManager) NotifyPreferencesChanged() {
	if dm.scheduler != nil && dm.db != nil {
		prefs := LoadDesktopPreferences(dm.db)
		dm.scheduler.SetPaused(prefs.SchedulerPaused)
	}
	dm.ApplyGlobalShortcuts()
	dm.UpdateTrayStatus()
	dm.RebuildTrayMenu()
	dm.emitDesktopStatus()
}

func (dm *DesktopManager) emitDesktopStatus() {
	if dm.app != nil {
		dm.app.Event.Emit("desktop-status-updated", true)
	}
}

func (dm *DesktopManager) GetRuntimeStatus() DesktopRuntimeStatus {
	prefs := LoadDesktopPreferences(dm.db)
	var schedStatus SchedulerStatus
	if dm.scheduler != nil {
		schedStatus = dm.scheduler.GetStatus()
	}
	dm.mu.Lock()
	hotkeys := append([]string(nil), dm.registeredHotkeys...)
	hotkeyErr := dm.hotkeyError
	dm.mu.Unlock()
	if hotkeys == nil {
		hotkeys = []string{}
	}
	return DesktopRuntimeStatus{
		Preferences:         prefs,
		AutoStart:           dm.GetAutoStartInfo(),
		Scheduler:           schedStatus,
		Windows:             dm.GetOpenWindows(),
		Focus:               dm.GetFocusState(),
		TraySupported:       dm.tray != nil,
		RegisteredShortcuts: hotkeys,
		HotkeyError:         hotkeyErr,
	}
}

func windowFriendlyTitle(name, kind string) string {
	switch kind {
	case WindowKindMain:
		return "主工作台窗口"
	case WindowKindQuickAdd:
		return "快速新建悬浮窗"
	case WindowKindTrayPopover:
		return "今日速览浮窗"
	case WindowKindFocus:
		return "番茄专注浮窗"
	case WindowKindAI:
		return "AI 日程副驾驶"
	case WindowKindWorkspace:
		switch strings.TrimPrefix(name, "workspace-") {
		case "week":
			return "独立视图 · 周计划"
		case "month":
			return "独立视图 · 全景月历"
		case "matrix":
			return "独立视图 · 四象限矩阵"
		case "list":
			return "独立视图 · 日程列表"
		default:
			return "独立视图窗口"
		}
	default:
		return name
	}
}

func truncateMenuTitle(s string, maxRunes int) string {
	s = strings.TrimSpace(s)
	runes := []rune(s)
	if len(runes) <= maxRunes {
		return s
	}
	return string(runes[:maxRunes-1]) + "…"
}

func isReminderPastDue(r Reminder) bool {
	t, err := parseFlexibleTime(r.ScheduledAt)
	if err != nil {
		return false
	}
	return t.Before(time.Now())
}

func formatTrayReminderTime(r Reminder) string {
	t, err := parseFlexibleTime(r.ScheduledAt)
	if err != nil {
		return "--:--"
	}
	now := time.Now()
	locT := t.In(time.Local)
	if locT.Year() == now.Year() && locT.YearDay() == now.YearDay() {
		return locT.Format("15:04")
	}
	return locT.Format("01-02 15:04")
}

func collectTrayReminders(reminders []Reminder, limit int) []Reminder {
	var candidates []Reminder
	for _, r := range reminders {
		if r.DeletedAt != "" {
			continue
		}
		if r.Status == "active" || r.Status == "expired" {
			candidates = append(candidates, r)
		}
	}
	sort.Slice(candidates, func(i, j int) bool {
		// Overdue / expired first, then earliest scheduled time
		iPast := candidates[i].Status == "expired" || isReminderPastDue(candidates[i])
		jPast := candidates[j].Status == "expired" || isReminderPastDue(candidates[j])
		if iPast != jPast {
			return iPast
		}
		ti, err1 := parseFlexibleTime(candidates[i].ScheduledAt)
		tj, err2 := parseFlexibleTime(candidates[j].ScheduledAt)
		if err1 == nil && err2 == nil {
			return ti.Before(tj)
		}
		return candidates[i].ScheduledAt < candidates[j].ScheduledAt
	})
	if len(candidates) > limit {
		return candidates[:limit]
	}
	return candidates
}
