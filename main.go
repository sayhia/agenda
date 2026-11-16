package main

import (
	"embed"
	"log"
	"os"
	"slices"

	"agenda/internal/agenda"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/tray-template.png
var trayTemplateIcon []byte

//go:embed build/tray-color.png
var trayColorIcon []byte

func init() {
	// Register custom events for typed JS bindings
	application.RegisterEvent[bool]("reminders-updated")
	application.RegisterEvent[map[string]interface{}]("reminder-triggered")
	application.RegisterEvent[map[string]interface{}]("reminder-lead-triggered")
	application.RegisterEvent[bool]("open-create-modal")
	application.RegisterEvent[bool]("open-ai-drawer")
	application.RegisterEvent[bool]("window-fullscreen")
	application.RegisterEvent[string]("open-reminder-detail")
	application.RegisterEvent[string]("open-ai-action-draft")
	application.RegisterEvent[string]("open-settings-tab")
	application.RegisterEvent[bool]("desktop-status-updated")
	application.RegisterEvent[string]("focus-state-sync")
	application.RegisterEvent[string]("focus-bind-reminder")
	application.RegisterEvent[string]("focus-command")
}

func main() {
	// 1. Initialize SQLite Database
	db, err := agenda.InitDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	agendaService := agenda.NewAgendaService(db)
	desktopPrefs := agenda.LoadDesktopPreferences(db)

	startQuickAdd := slices.Contains(os.Args[1:], "--quick-add")
	startFocus := slices.Contains(os.Args[1:], "--focus")
	startPopover := slices.Contains(os.Args[1:], "--popover")
	startAI := slices.Contains(os.Args[1:], "--ai")
	startMinimized := slices.Contains(os.Args[1:], "--minimized") || desktopPrefs.StartMinimized || startQuickAdd || startFocus || startPopover || startAI

	var desktopMgr *agenda.DesktopManager
	var scheduler *agenda.Scheduler

	// 2. Initialize Wails v3 Application
	app := application.New(application.Options{
		Name:        "AgendaButler",
		Description: "日程管家桌面版 - 智能自然语言提醒与日程管理",
		Services: []application.Service{
			application.NewService(agendaService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.agendabutler.desktop",
			OnSecondInstanceLaunch: func(data application.SecondInstanceData) {
				if desktopMgr == nil {
					return
				}
				if !openWindowFromArgs(desktopMgr, data.Args) {
					_ = desktopMgr.OpenWindow(agenda.WindowKindMain, "")
				}
			},
		},
		ShouldQuit: func() bool {
			if desktopMgr != nil {
				desktopMgr.MarkQuitting()
			}
			return true
		},
		OnShutdown: func() {
			if scheduler != nil {
				scheduler.Stop()
			}
			_ = db.Close()
		},
	})

	// 3. Start Background Scheduler Daemon & Desktop Runtime Manager
	scheduler = agenda.NewScheduler(db, app)
	desktopMgr = agenda.NewDesktopManager(app, db, scheduler, agendaService)

	// 4. Create Main Workspace Window
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:      agenda.WindowKindMain,
		Title:     "日程管家 Agenda Butler",
		Width:     1120,
		Height:    740,
		MinWidth:  880,
		MinHeight: 600,
		Hidden:    startMinimized,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight:      50,
			Backdrop:                     application.MacBackdropTranslucent,
			TitleBar:                     application.MacTitleBarHiddenInset,
			DisableEscapeExitsFullscreen: true,
		},
		BackgroundColour: application.NewRGB(7, 8, 10),
		URL:              "/",
	})
	desktopMgr.SetupMainWindow(mainWindow)

	// Re-open main window when clicking Dock icon on macOS
	app.Event.OnApplicationEvent(events.Mac.ApplicationShouldHandleReopen, func(event *application.ApplicationEvent) {
		_ = desktopMgr.OpenWindow(agenda.WindowKindMain, "")
	})

	// 5. Setup Application Menu, Native System Tray & Global Shortcuts
	desktopMgr.SetupApplicationMenu()
	desktopMgr.SetupSystemTray(trayTemplateIcon, trayColorIcon)
	desktopMgr.SetupGlobalShortcuts()

	app.Event.OnApplicationEvent(events.Common.SystemDidWake, func(event *application.ApplicationEvent) {
		scheduler.TriggerImmediateCheck()
		desktopMgr.NotifyDataChanged()
	})

	app.Event.On("reminders-updated", func(event *application.CustomEvent) {
		desktopMgr.UpdateTrayStatus()
		desktopMgr.RebuildTrayMenu()
	})
	app.Event.On("reminder-triggered", func(event *application.CustomEvent) {
		desktopMgr.UpdateTrayStatus()
		desktopMgr.RebuildTrayMenu()
	})

	// 6. Start Background Scheduler
	scheduler.Start()

	openWindowFromArgs(desktopMgr, os.Args[1:])

	// 7. Run Application
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

func openWindowFromArgs(desktopMgr *agenda.DesktopManager, args []string) bool {
	if desktopMgr == nil {
		return false
	}
	flagMap := []struct {
		flag string
		kind string
	}{
		{"--quick-add", agenda.WindowKindQuickAdd},
		{"--focus", agenda.WindowKindFocus},
		{"--popover", agenda.WindowKindTrayPopover},
		{"--ai", agenda.WindowKindAI},
	}
	for _, entry := range flagMap {
		if slices.Contains(args, entry.flag) {
			_ = desktopMgr.OpenWindow(entry.kind, "")
			return true
		}
	}
	return false
}
