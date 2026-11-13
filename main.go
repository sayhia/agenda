package main

import (
	"embed"
	"fmt"
	"log"
	"runtime"
	"time"

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
	application.RegisterEvent[string]("time")
	application.RegisterEvent[bool]("reminders-updated")
	application.RegisterEvent[map[string]interface{}]("reminder-triggered")
	application.RegisterEvent[bool]("open-create-modal")
	application.RegisterEvent[bool]("open-ai-drawer")
	application.RegisterEvent[bool]("window-fullscreen")
}

func main() {
	// 1. Initialize SQLite Database
	db, err := agenda.InitDB()
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}

	agendaService := agenda.NewAgendaService(db)

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
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// 3. Create Main Window
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "日程管家 Agenda Butler",
		Width:     1120,
		Height:    740,
		MinWidth:  880,
		MinHeight: 600,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight:      50,
			Backdrop:                     application.MacBackdropTranslucent,
			TitleBar:                     application.MacTitleBarHiddenInset,
			DisableEscapeExitsFullscreen: true,
		},
		BackgroundColour: application.NewRGB(7, 8, 10),
		URL:              "/",
	})

	mainWindow.OnWindowEvent(events.Common.WindowFullscreen, func(event *application.WindowEvent) {
		app.Event.Emit("window-fullscreen", true)
	})
	mainWindow.OnWindowEvent(events.Common.WindowUnFullscreen, func(event *application.WindowEvent) {
		app.Event.Emit("window-fullscreen", false)
	})

	// 3.1 Setup Native System Tray
	tray := app.SystemTray.New()
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(trayTemplateIcon)
	} else {
		tray.SetIcon(trayColorIcon)
	}
	tray.SetTooltip("Agenda Butler — 日程管家")

	updateTrayStatus := func() {
		reminders, err := db.GetAllReminders()
		if err != nil {
			return
		}
		now := time.Now()
		todayKey := now.Format("2006-01-02")
		activeToday := 0
		for _, r := range reminders {
			if r.Status == "active" && len(r.ScheduledAt) >= 10 && r.ScheduledAt[:10] == todayKey {
				activeToday++
			}
		}
		if activeToday > 0 {
			tray.SetTooltip(fmt.Sprintf("Agenda Butler — 今日尚有 %d 项待办推进中", activeToday))
			tray.SetLabel(fmt.Sprintf(" %d", activeToday))
		} else {
			tray.SetTooltip("Agenda Butler — 今日日程已清空")
			tray.SetLabel("")
		}
	}
	updateTrayStatus()

	app.Event.On("reminders-updated", func(event *application.CustomEvent) {
		updateTrayStatus()
	})

	// 3.2 Register System-Wide Global Hotkey (CmdOrCtrl+Alt+A to summon)
	_ = app.GlobalShortcut.Register("CmdOrCtrl+Alt+A", func() {
		mainWindow.Show()
		mainWindow.Focus()
		app.Event.Emit("open-create-modal", true)
	})

	trayMenu := application.NewMenu()
	trayMenu.Add("显示主窗口").OnClick(func(ctx *application.Context) {
		mainWindow.Show()
		mainWindow.Focus()
	})
	trayMenu.AddSeparator()
	trayMenu.Add("新建日程...").OnClick(func(ctx *application.Context) {
		mainWindow.Show()
		mainWindow.Focus()
		app.Event.Emit("open-create-modal", true)
	})
	trayMenu.Add("打开 AI 助手...").OnClick(func(ctx *application.Context) {
		mainWindow.Show()
		mainWindow.Focus()
		app.Event.Emit("open-ai-drawer", true)
	})
	trayMenu.AddSeparator()
	trayMenu.Add("退出日程管家").OnClick(func(ctx *application.Context) {
		app.Quit()
	})
	tray.SetMenu(trayMenu)
	tray.OnClick(func() {
		mainWindow.Show()
		mainWindow.Focus()
	})

	// 4. Start Background Scheduler Daemon
	scheduler := agenda.NewScheduler(db, app)
	scheduler.Start()
	defer scheduler.Stop()

	// 5. Emit current time ticker
	go func() {
		for {
			now := time.Now().Format("2006-01-02 15:04:05")
			app.Event.Emit("time", now)
			time.Sleep(time.Second)
		}
	}()

	// 6. Run Application
	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
