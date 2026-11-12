package main

import (
	"database/sql"
	"strings"
	"testing"
	"time"
)

func TestMultiFrequencyDeconstruction(t *testing.T) {
	svc := &AgendaService{}
	res, err := svc.ParseMultipleRemindersWithAI("早中晚 各 一次检查 CPL leads 的使用情况")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(res) != 3 {
		t.Fatalf("expected 3 items, got %d", len(res))
	}

	if !strings.Contains(res[0].Title, "早间") {
		t.Errorf("expected item 0 title to contain '早间', got %s", res[0].Title)
	}
	if !strings.Contains(res[1].Title, "午间") {
		t.Errorf("expected item 1 title to contain '午间', got %s", res[1].Title)
	}
	if !strings.Contains(res[2].Title, "晚间") {
		t.Errorf("expected item 2 title to contain '晚间', got %s", res[2].Title)
	}

	for i, it := range res {
		if it.RepeatRule != "FREQ=DAILY" {
			t.Errorf("item %d repeat rule expected FREQ=DAILY, got %s", i, it.RepeatRule)
		}
	}

	// Test offline chat response
	chatReply, err := svc.generateOfflineChatResponse([]AIChatMessage{
		{Role: "user", Content: "早中晚 各 一次检查 CPL leads 的使用情况"},
	}, nil, time.Now())
	if err != nil {
		t.Fatalf("offline chat unexpected error: %v", err)
	}

	if !strings.Contains(chatReply, "create_batch") {
		t.Errorf("expected create_batch in offline chat reply, got:\n%s", chatReply)
	}
	if !strings.Contains(chatReply, "早间") || !strings.Contains(chatReply, "午间") || !strings.Contains(chatReply, "晚间") {
		t.Errorf("expected 3 times in reply, got:\n%s", chatReply)
	}
}

func TestAddReminderDefense(t *testing.T) {
	// Initialize in-memory DB
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("failed to open memory db: %v", err)
	}
	defer db.Close()

	d := &DB{db: db}
	if err := d.migrate(); err != nil {
		t.Fatalf("failed to init schema: %v", err)
	}

	svc := &AgendaService{db: d}

	// Test 1: Past time
	pastTime := time.Now().Add(-5 * time.Minute).Format(time.RFC3339)
	rem, err := svc.AddReminder(CreateReminderRequest{
		Title:       "暂停限流域名",
		ScheduledAt: pastTime,
	})
	if err != nil {
		t.Fatalf("AddReminder failed: %v", err)
	}

	sched, err := time.Parse(time.RFC3339, rem.ScheduledAt)
	if err != nil {
		t.Fatalf("failed to parse scheduled time: %v", err)
	}

	if sched.Before(time.Now()) {
		t.Errorf("expected scheduled time to be in the future, got: %v", sched)
	}
}

func TestDomainIncidentDeconstruction(t *testing.T) {
	svc := &AgendaService{}
	input := `play.uzuy.org fun.uzuy.org game.uzuy.org @孙坤峰 这三条前天昨天刚加量的，今天就限流了[撇嘴]，辛苦先暂停了`
	res, err := svc.ParseMultipleRemindersWithAI(input)
	if err != nil {
		t.Fatalf("unexpected error on domain incident deconstruction: %v", err)
	}

	if len(res) != 1 {
		t.Fatalf("expected 1 consolidated reminder, got %d", len(res))
	}

	if !strings.Contains(res[0].Title, "暂停") || !strings.Contains(res[0].Title, "3条") {
		t.Errorf("expected title to mention 暂停 3条, got: %s", res[0].Title)
	}

	if res[0].Priority != "p0" {
		t.Errorf("expected priority p0, got: %s", res[0].Priority)
	}

	if !strings.Contains(res[0].Notes, "play.uzuy.org") || !strings.Contains(res[0].Notes, "game.uzuy.org") {
		t.Errorf("expected notes to contain all domains, got: %s", res[0].Notes)
	}

	sched, err := time.Parse(time.RFC3339, res[0].ScheduledAt)
	if err != nil {
		t.Fatalf("expected valid RFC3339 time, got: %s, err: %v", res[0].ScheduledAt, err)
	}

	if sched.Before(time.Now()) {
		t.Errorf("expected scheduled time to be in the future, got: %v", sched)
	}
}
