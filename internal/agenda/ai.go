package agenda

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type AIChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type AIConfig struct {
	BaseURL string `json:"base_url"`
	APIKey  string `json:"api_key"`
	Model   string `json:"model"`
}

type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []AIChatMessage `json:"messages"`
	Temperature float64         `json:"temperature"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message AIChatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (s *AgendaService) GetAIConfig() (*AIConfig, error) {
	if s == nil || s.db == nil {
		return &AIConfig{
			BaseURL: "https://api.deepseek.com/v1",
			APIKey:  "",
			Model:   "deepseek-chat",
		}, nil
	}
	settings, err := s.db.GetSettings()
	if err != nil {
		return &AIConfig{
			BaseURL: "https://api.deepseek.com/v1",
			APIKey:  "",
			Model:   "deepseek-chat",
		}, nil
	}

	baseURL := settings["ai_base_url"]
	if baseURL == "" {
		baseURL = "https://api.deepseek.com/v1"
	}
	model := settings["ai_model"]
	if model == "" {
		model = "deepseek-chat"
	}

	return &AIConfig{
		BaseURL: baseURL,
		APIKey:  settings["ai_api_key"],
		Model:   model,
	}, nil
}

func (s *AgendaService) SaveAIConfig(cfg AIConfig) error {
	m := map[string]string{
		"ai_base_url": strings.TrimSpace(cfg.BaseURL),
		"ai_api_key":  strings.TrimSpace(cfg.APIKey),
		"ai_model":    strings.TrimSpace(cfg.Model),
	}
	return s.db.SaveSettings(m)
}

func (s *AgendaService) TestAIConnection(baseURL, apiKey, model string) (string, error) {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = "https://api.deepseek.com/v1"
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = "deepseek-chat"
	}

	if apiKey == "" {
		return "", errors.New("API Key 不能为空")
	}

	messages := []AIChatMessage{
		{Role: "user", Content: "Hello, reply 'Connection OK' if you can read this."},
	}

	resp, err := callOpenAICompatible(baseURL, apiKey, model, messages, 0.1)
	if err != nil {
		return "", fmt.Errorf("连接失败: %w", err)
	}
	return fmt.Sprintf("连接成功！模型响应: %s", strings.TrimSpace(resp)), nil
}

// pruneRemindersForAI limits context noise and guards token budget.
// It prioritizes:
// 1. Overdue active reminders
// 2. Today's active reminders
// 3. P0/P1 high-priority active reminders within 3 days
// 4. Other active reminders, capped at a maximum of 30 items total.
func pruneRemindersForAI(reminders []Reminder, now time.Time) ([]Reminder, int) {
	if len(reminders) <= 30 {
		return reminders, 0
	}

	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	threeDaysLater := todayStart.Add(72 * time.Hour)

	var highPriority []Reminder
	var todayList []Reminder
	var overdueList []Reminder
	var otherActive []Reminder

	for _, r := range reminders {
		if r.Status == "ended" {
			continue
		}
		t, err := time.Parse(time.RFC3339, r.ScheduledAt)
		if err != nil {
			t, err = time.Parse("2006-01-02 15:04:05", r.ScheduledAt)
		}
		if err != nil {
			otherActive = append(otherActive, r)
			continue
		}

		if t.Before(now) {
			overdueList = append(overdueList, r)
		} else if t.Before(todayStart.Add(24 * time.Hour)) {
			todayList = append(todayList, r)
		} else if (strings.ToLower(r.Priority) == "p0" || strings.ToLower(r.Priority) == "p1") && t.Before(threeDaysLater) {
			highPriority = append(highPriority, r)
		} else {
			otherActive = append(otherActive, r)
		}
	}

	result := make([]Reminder, 0, 30)
	result = append(result, overdueList...)
	if len(result) < 30 {
		remaining := 30 - len(result)
		if len(todayList) <= remaining {
			result = append(result, todayList...)
		} else {
			result = append(result, todayList[:remaining]...)
		}
	}
	if len(result) < 30 {
		remaining := 30 - len(result)
		if len(highPriority) <= remaining {
			result = append(result, highPriority...)
		} else {
			result = append(result, highPriority[:remaining]...)
		}
	}
	if len(result) < 30 {
		remaining := 30 - len(result)
		if len(otherActive) <= remaining {
			result = append(result, otherActive...)
		} else {
			result = append(result, otherActive[:remaining]...)
		}
	}

	prunedCount := len(reminders) - len(result)
	if prunedCount < 0 {
		prunedCount = 0
	}
	return result, prunedCount
}

func (s *AgendaService) ChatWithAI(userMessages []AIChatMessage) (string, error) {
	cfg, _ := s.GetAIConfig()

	// 1. Gather current context (Time, Reminders)
	reminders, _ := s.db.GetAllReminders()
	now := time.Now()
	nowStr := now.Format("2006-01-02 15:04:05 (Monday)")

	prunedReminders, prunedCount := pruneRemindersForAI(reminders, now)

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("当前系统准确时间: %s。\n", nowStr))
	sb.WriteString("用户当前的日程列表如下:\n")
	if len(prunedReminders) == 0 {
		sb.WriteString("(暂无日程)\n")
	} else {
		for i, r := range prunedReminders {
			sb.WriteString(fmt.Sprintf("%d. [%s] 标题: %s | 计划时间: %s", i+1, r.Status, r.Title, r.ScheduledAt))
			if r.Priority != "" {
				sb.WriteString(fmt.Sprintf(" | 优先级: %s", strings.ToUpper(r.Priority)))
			}
			if r.RepeatRule != "" {
				sb.WriteString(fmt.Sprintf(" | 重复: %s", r.RepeatRule))
			}
			if r.LeadMinutes > 0 {
				sb.WriteString(fmt.Sprintf(" | 提前: %d分钟", r.LeadMinutes))
			}
			if r.DurationMinutes > 0 {
				sb.WriteString(fmt.Sprintf(" | 持续: %d分钟", r.DurationMinutes))
			}
			if r.Notes != "" {
				sb.WriteString(fmt.Sprintf(" | 备注: %s", r.Notes))
			}
			sb.WriteString("\n")
		}
		if prunedCount > 0 {
			sb.WriteString(fmt.Sprintf("\n(系统已优化上下文：另有 %d 项低优先级或远期日程已折叠)\n", prunedCount))
		}
	}

	systemPrompt := `你是一位专业、温暖、高效的「日程管家 AI 助手 (Agenda Butler AI)」。
你的职责是帮助用户管理日常安排、答疑解惑、分析时间冲突、提供时间管理建议、生成日程早报与智能排期。

` + sb.String() + `
指示准则:
1. 语言亲切、简练、条理分明，善用 Emoji 与排版；
2. 【核心排期与拆解准则：区分“时间拆解”与“对象合并”】
   - 【时间拆解（必须拆为多条）】：当用户表达【不同时间点】或【多频次触发】（如“早中晚各一次”、“一日三次”、“每天上午9点和下午3点”、“周一开会周三复盘”）时，底层日历提醒必须【拆解为多个独立的日程项】输出，绝不能合并成单条！
     例如：“早中晚 各 一次检查 CPL leads 的使用情况”，必须完整拆解为早、中、晚 3 个独立日程：
     - 早间：标题为“检查 CPL leads 的使用情况 (早间)”，时间设为今日/明日 09:00:00，repeat_rule 设为 "FREQ=DAILY"，duration_minutes 设为 15；
     - 午间：标题为“检查 CPL leads 的使用情况 (午间)”，时间设为今日/明日 13:00:00，repeat_rule 设为 "FREQ=DAILY"，duration_minutes 设为 15；
     - 晚间：标题为“检查 CPL leads 的使用情况 (晚间)”，时间设为今日/明日 19:00:00，repeat_rule 设为 "FREQ=DAILY"，duration_minutes 设为 15；
   - 【对象合并（严禁过度碎片化拆解）】：如果是在【同一时间执行同一动作处理多个对象/目标/域名/清单项】（如“暂停这3条域名：play、fun、game”、“去超市买苹果和牛奶”、“通知张三李四”），【严禁拆成多个在同一时间重复触发的碎片日程】！必须合并为 1 条日程：
     * 标题概括核心操作（如“暂停3个限流域名 (play/fun/game)”）；
     * 将具体的各个对象列表、背景原因完整清晰地整理在 notes 备注清单中；
     * 自动去除聊天记录中的 @人名、表情符等干扰符号。
   - 【严防创建即过期与合理时间推断】：
     * 严禁将 scheduled_at 设为当前瞬间或过去时间！否则系统会在入库瞬间判定到期并立即标记为已结束。
     * 若用户未指明具体时刻（如“今天就限流了，辛苦先暂停了”、“马上处理”、“今天尽快完成”）：
       - 紧急/即时待办（如“先暂停了”、“马上处理”）：scheduled_at 必须推迟设为【当前时间之后 15~30 分钟】，留出跟进窗口，防止创建即过期；
       - 当天常规待办（如“今天整理报告”）：若为上午设为今日 14:00 或 18:00；若为下午设为【当前时间 + 1 小时】；
       - 仅当用户明确给出了未来具体时刻（如“明天下午3点”）时，才按指定时间设定。
3. 【极其重要准则：动作卡片强制输出要求（杜绝假性确认）】
   - 严禁只在文本中声称“已为您设为提醒/已排进日程/已设为今天的即时提醒”而【漏掉】agenda-action 代码块！
   - 系统依靠你输出的 agenda-action 代码块在前端渲染可交互的操作卡片供用户点击入库。如果你只在自然语言回复中说“已为你添加”，但没有附带代码块，系统实际上【根本无法创建任何日程】，用户会非常困惑！
   - 因此，无论是用户要求安排（如“帮我安排”、“生成提醒啊”、“设个闹钟”），还是你主动建议安排（如“帮你把暂停排进日程跟进”）：
     你【必须且强制】在回复末尾附带 agenda-action 代码块（用三个反引号包裹），前端将自动渲染为可点击执行的交互卡片：
     - 单个创建日程：
       {"action": "create", "title": "...", "scheduled_at": "...", "priority": "p0|p1|p2|p3", "tags": "...", "notes": "..."}
     - 批量创建日程（如早中晚多频次）：
       {"action": "create_batch", "items": [{"title": "...", "scheduled_at": "...", "priority": "p0|p1|p2|p3", "tags": "...", "notes": "..."}]}
     - 修改已有日程（基于上方已知日程 ID）：
       {"action": "update", "id": "rem-xxx", "title": "...", "scheduled_at": "...", "notes": "..."}
     - 删除已有日程：
       {"action": "delete", "id": "rem-xxx", "title": "..."}
     - 快速推迟（如“推迟半小时”）：
       {"action": "snooze", "id": "rem-xxx", "minutes": 30}
     - 标记完成日程：
       {"action": "complete", "id": "rem-xxx"}
4. 【智能日程早报与复盘】
   当用户询问“今日早报”、“每日总结”、“复盘”时：
   - 结构化分析上方的全部已有日程，按时间轴（早、中、晚）梳理；
   - 重点标记 P0/P1 优先级事项和时间冲突节点；
   - 给出清晰、鼓舞人心的建议。`

	fullMessages := []AIChatMessage{
		{Role: "system", Content: systemPrompt},
	}
	fullMessages = append(fullMessages, userMessages...)

	// If no API Key configured, fallback to smart offline assistant
	if cfg.APIKey == "" {
		return s.generateOfflineChatResponse(userMessages, reminders, now)
	}

	return callOpenAICompatible(cfg.BaseURL, cfg.APIKey, cfg.Model, fullMessages, 0.7)
}

func (s *AgendaService) GenerateDailyBriefing() (string, error) {
	cfg, _ := s.GetAIConfig()
	reminders, _ := s.db.GetAllReminders()
	now := time.Now()

	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	todayEnd := todayStart.Add(24 * time.Hour)

	var todayItems []Reminder
	for _, r := range reminders {
		if r.Status != "active" {
			continue
		}
		if t, err := time.Parse(time.RFC3339, r.ScheduledAt); err == nil {
			if t.After(todayStart) && t.Before(todayEnd) {
				todayItems = append(todayItems, r)
			}
		}
	}

	if cfg.APIKey == "" {
		// Offline template
		var b strings.Builder
		b.WriteString(fmt.Sprintf("☀️ **今日日程早报 · %s**\n\n", now.Format("2006年01月02日 星期一")))
		if len(todayItems) == 0 {
			b.WriteString("今天没有安排任何到期日程，整天时间完全由您自由支配！\n💡 *建议：可以专注进行深度思考、阅读或安排休闲放松。*")
		} else {
			b.WriteString(fmt.Sprintf("今天共有 **%d** 项待办事项：\n", len(todayItems)))
			for i, it := range todayItems {
				t, _ := time.Parse(time.RFC3339, it.ScheduledAt)
				b.WriteString(fmt.Sprintf("%d. ⏰ **%s** — %s", i+1, t.Format("15:04"), it.Title))
				if it.Notes != "" {
					b.WriteString(fmt.Sprintf(" *(%s)*", it.Notes))
				}
				b.WriteString("\n")
			}
			b.WriteString("\n🌟 *提示：如需开启 AI 大模型深度润色与智能建议，可在右上角设置中填入 API Key。*")
		}
		return b.String(), nil
	}

	// Use LLM to generate high quality briefing
	prompt := fmt.Sprintf(`请根据我今天（%s）的日程安排，生成一份专业、贴心、结构清晰的今日早报。
今日日程项数量：%d。
详细列表：
`, now.Format("2006-01-02"), len(todayItems))
	for _, it := range todayItems {
		prompt += fmt.Sprintf("- %s: %s (备注: %s)\n", it.ScheduledAt, it.Title, it.Notes)
	}
	prompt += "\n请包含：今日总览、时间线优先级梳理、精力分配与健康提示。语气温暖干练。"

	messages := []AIChatMessage{
		{Role: "user", Content: prompt},
	}
	return s.ChatWithAI(messages)
}

func (s *AgendaService) AnalyzeScheduleConflicts() (string, error) {
	reminders, _ := s.db.GetAllReminders()

	var activeList []Reminder
	for _, r := range reminders {
		if r.Status == "active" {
			activeList = append(activeList, r)
		}
	}

	type conflictPair struct {
		A Reminder
		B Reminder
	}
	var conflicts []conflictPair

	for i := 0; i < len(activeList); i++ {
		for j := i + 1; j < len(activeList); j++ {
			tA, errA := time.Parse(time.RFC3339, activeList[i].ScheduledAt)
			tB, errB := time.Parse(time.RFC3339, activeList[j].ScheduledAt)
			if errA != nil || errB != nil {
				continue
			}

			durA := time.Duration(activeList[i].DurationMinutes) * time.Minute
			if durA <= 0 {
				durA = 30 * time.Minute
			}
			durB := time.Duration(activeList[j].DurationMinutes) * time.Minute
			if durB <= 0 {
				durB = 30 * time.Minute
			}

			endA := tA.Add(durA)
			endB := tB.Add(durB)

			// Overlap check
			if tA.Before(endB) && tB.Before(endA) {
				conflicts = append(conflicts, conflictPair{A: activeList[i], B: activeList[j]})
			}
		}
	}

	cfg, _ := s.GetAIConfig()
	if cfg.APIKey == "" || len(conflicts) == 0 {
		if len(conflicts) == 0 {
			return "🎉 **太棒了！未检测到时间冲突**\n\n您当前所有的日程与会议均有充足的间隔，时间安排井然有序。", nil
		}
		var b strings.Builder
		b.WriteString(fmt.Sprintf("⚠️ **检测到 %d 处日程时间重叠冲突**：\n\n", len(conflicts)))
		for i, c := range conflicts {
			tA, _ := time.Parse(time.RFC3339, c.A.ScheduledAt)
			tB, _ := time.Parse(time.RFC3339, c.B.ScheduledAt)
			b.WriteString(fmt.Sprintf("%d. 「**%s**」（%s）与「**%s**」（%s）在时间上存在交叉！\n",
				i+1, c.A.Title, tA.Format("01-02 15:04"), c.B.Title, tB.Format("01-02 15:04")))
		}
		b.WriteString("\n建议您调整其中一项的时间以避免同时撞期。")
		return b.String(), nil
	}

	prompt := "我当前的日程中存在以下冲突，请帮我分析并提出合理的调整建议方案：\n"
	for i, c := range conflicts {
		prompt += fmt.Sprintf("%d. %s (%s) 与 %s (%s) 冲突\n", i+1, c.A.Title, c.A.ScheduledAt, c.B.Title, c.B.ScheduledAt)
	}

	return s.ChatWithAI([]AIChatMessage{{Role: "user", Content: prompt}})
}

func (s *AgendaService) ParseMultipleRemindersWithAI(input string) ([]CreateReminderRequest, error) {
	cfg, _ := s.GetAIConfig()
	now := time.Now()
	nowStr := now.Format("2006-01-02 15:04:05 (Monday)")
	zone, _ := now.Zone()
	if zone == "" {
		zone = "Asia/Shanghai"
	}

	// Smart rule fallback for multi-frequency requests (e.g. 早中晚各一次)
	if strings.Contains(input, "早中晚") || strings.Contains(input, "一日三次") || (strings.Contains(input, "早") && strings.Contains(input, "中") && strings.Contains(input, "晚")) {
		cleanTitle := input
		keywords := []string{"早中晚", "各一次", "各1次", "每天", "帮我添加", "帮我安排", "提醒我", "安排", "创建", "设置", "添加"}
		for _, kw := range keywords {
			cleanTitle = strings.ReplaceAll(cleanTitle, kw, "")
		}
		cleanTitle = strings.TrimSpace(cleanTitle)
		if cleanTitle == "" {
			cleanTitle = "检查事项"
		}

		today := now.Format("2006-01-02")
		zoneOffset := now.Format("-07:00")
		if zoneOffset == "Z" {
			zoneOffset = "+08:00"
		}

		return []CreateReminderRequest{
			{
				Title:           fmt.Sprintf("%s (早间)", cleanTitle),
				ScheduledAt:     fmt.Sprintf("%sT09:00:00%s", today, zoneOffset),
				RepeatRule:      "FREQ=DAILY",
				LeadMinutes:     10,
				DurationMinutes: 15,
				Notes:           "早间使用量与指标检查",
				Timezone:        zone,
				Prompt:          fmt.Sprintf("提醒您执行早间任务：%s", cleanTitle),
			},
			{
				Title:           fmt.Sprintf("%s (午间)", cleanTitle),
				ScheduledAt:     fmt.Sprintf("%sT13:00:00%s", today, zoneOffset),
				RepeatRule:      "FREQ=DAILY",
				LeadMinutes:     10,
				DurationMinutes: 15,
				Notes:           "午间进度跟进与核查",
				Timezone:        zone,
				Prompt:          fmt.Sprintf("提醒您执行午间任务：%s", cleanTitle),
			},
			{
				Title:           fmt.Sprintf("%s (晚间)", cleanTitle),
				ScheduledAt:     fmt.Sprintf("%sT19:00:00%s", today, zoneOffset),
				RepeatRule:      "FREQ=DAILY",
				LeadMinutes:     10,
				DurationMinutes: 15,
				Notes:           "晚间复盘与最终核对",
				Timezone:        zone,
				Prompt:          fmt.Sprintf("提醒您执行晚间任务：%s", cleanTitle),
			},
		}, nil
	}

	// Smart rule fallback for multi-domain / incident / limit alerts (e.g. play.uzuy.org fun.uzuy.org game.uzuy.org 限流 暂停)
	domainRegex := regexp.MustCompile(`(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}`)
	domains := domainRegex.FindAllString(input, -1)
	if len(domains) >= 2 && (strings.Contains(input, "限流") || strings.Contains(input, "暂停") || strings.Contains(input, "止损") || strings.Contains(input, "排查")) {
		domainListStr := strings.Join(domains, "、")
		scheduled := now.Add(15 * time.Minute).Format(time.RFC3339)

		return []CreateReminderRequest{
			{
				Title:           fmt.Sprintf("暂停%d条加量限流域名投放并排查原因", len(domains)),
				ScheduledAt:     scheduled,
				RepeatRule:      "",
				LeadMinutes:     5,
				DurationMinutes: 30,
				Notes:           fmt.Sprintf("涉及域名：%s\n背景：加量后遭遇限流\n行动要点：1. 先暂停投放止损；2. 排查上游风控与流量质量；3. 与业务同学同步结果与恢复条件", domainListStr),
				Timezone:        zone,
				Prompt:          fmt.Sprintf("提醒您立即跟进限流域名排查：%s", domainListStr),
				Priority:        "p0",
				Tags:            "线上风控,域名投放,紧急待办",
			},
		}, nil
	}

	if cfg.APIKey == "" {
		return nil, errors.New("请先在右上角设置中配置 AI API Key，以启用大模型多重语义深度拆解功能")
	}

	prompt := fmt.Sprintf(`当前系统准确时间: %s, 时区: %s。
用户输入了一句或多句日程安排描述:
"%s"

请将其精准解析为日程项。
【关键准则 1 - 严格区分“时间拆解”与“对象合并”】：
1. 【时间拆解（必须拆为多条）】：当且仅当用户表达【不同时间点】或【多频次触发】（如“早中晚各一次”、“一日三次”、“每天上午9点和下午3点”、“周一开会周三复盘”）时，才拆解为多个独立日程（如早间09:00、午间13:00、晚间19:00各一条，repeat_rule设为"FREQ=DAILY"）。
2. 【对象合并（严禁过度碎片化拆解）】：如果是在【同一时间执行同一动作处理多个对象/目标/域名/清单项】（如“暂停这3条域名”、“买苹果和香蕉”、“通知张三李四”），【严禁拆解为多个在同一时间同时响铃的碎片日程】！必须合并为 1 条日程：
   - 标题概括核心操作（如“暂停3个限流域名”）；
   - 将各个对象清单（如具体域名列表、背景原因）完整整理在 notes 备注中；
   - 忽略群聊 @人名 和语气表情符（如 [撇嘴]）。

【关键准则 2 - 严防创建即过期与合理时间推断】：
- 严禁将 scheduled_at 设为当前时间或过去的时间！绝不能创建入库即过期的日程。
- 若用户未指明具体未来时刻（如“今天就限流了，辛苦先暂停了”、“马上做”、“今天处理”）：
  * 紧急/即时待办（如“先暂停了”、“马上处理”）：scheduled_at 必须推迟设为【当前时间之后 15~30 分钟】，留出跟进窗口，严防创建即过期；
  * 当天常规待办（如“今天整理报告”）：若为上午设为 14:00 或 18:00；若为下午设为【当前时间 + 1 小时】；
  * 仅当用户明确给出了未来具体时刻（如“明天下午3点”）时，才按指定时间设定。
以纯 JSON 数组格式输出，不要包含任何 markdown 标记或额外解释，格式严格如下:
[
  {
    "title": "日程标题",
    "scheduled_at": "ISO8601格式时间如 2026-11-12T15:00:00+08:00",
    "repeat_rule": "RRULE重复规则如 FREQ=DAILY 或为空",
    "lead_minutes": 10,
    "duration_minutes": 45,
    "notes": "备注信息",
    "timezone": "%s",
    "prompt": "提醒文案"
  }
]`, nowStr, zone, input, zone)

	messages := []AIChatMessage{
		{Role: "system", Content: "你是一个精通日程管理的 JSON 数据提取专家。必须仅输出合法的 JSON 数组，严禁附带任何自然语言解释。"},
		{Role: "user", Content: prompt},
	}

	respStr, err := callOpenAICompatible(cfg.BaseURL, cfg.APIKey, cfg.Model, messages, 0.1)
	if err != nil {
		return nil, err
	}

	respStr = strings.TrimSpace(respStr)
	if strings.HasPrefix(respStr, "```json") {
		respStr = strings.TrimPrefix(respStr, "```json")
	}
	if strings.HasPrefix(respStr, "```") {
		respStr = strings.TrimPrefix(respStr, "```")
	}
	if strings.HasSuffix(respStr, "```") {
		respStr = strings.TrimSuffix(respStr, "```")
	}
	respStr = strings.TrimSpace(respStr)

	var requests []CreateReminderRequest
	if err := json.Unmarshal([]byte(respStr), &requests); err != nil {
		return nil, fmt.Errorf("解析模型返回的 JSON 失败: %w", err)
	}

	for i := range requests {
		if strings.TrimSpace(requests[i].Timezone) == "" {
			requests[i].Timezone = zone
		}
		if requests[i].DurationMinutes <= 0 {
			requests[i].DurationMinutes = 30
		}
		// Defensive time check against instant expiration
		t, err := parseFlexibleTime(requests[i].ScheduledAt)
		if err == nil {
			if t.Before(now) || t.Equal(now) || t.Sub(now) < time.Minute {
				if requests[i].RepeatRule == "" {
					t = now.Add(15 * time.Minute)
				} else {
					t = calculateNextOccurrence(t, requests[i].RepeatRule, now)
				}
			}
			requests[i].ScheduledAt = t.Format(time.RFC3339)
		} else {
			requests[i].ScheduledAt = now.Add(15 * time.Minute).Format(time.RFC3339)
		}
	}

	return requests, nil
}

func (s *AgendaService) generateOfflineChatResponse(messages []AIChatMessage, reminders []Reminder, now time.Time) (string, error) {
	if len(messages) == 0 {
		return "您好！我是您的日程管家助手。请告诉我您需要安排什么日程？", nil
	}
	last := messages[len(messages)-1].Content

	// Check for "早中晚" multi-frequency reminder pattern
	if strings.Contains(last, "早中晚") || strings.Contains(last, "一日三次") || (strings.Contains(last, "早") && strings.Contains(last, "中") && strings.Contains(last, "晚")) {
		cleanTitle := last
		keywords := []string{"早中晚", "各一次", "各1次", "每天", "帮我添加", "帮我安排", "提醒我", "安排", "创建", "设置", "添加"}
		for _, kw := range keywords {
			cleanTitle = strings.ReplaceAll(cleanTitle, kw, "")
		}
		cleanTitle = strings.TrimSpace(cleanTitle)
		if cleanTitle == "" {
			cleanTitle = "检查事项"
		}

		today := now.Format("2006-01-02")
		zoneOffset := now.Format("-07:00")
		if zoneOffset == "Z" {
			zoneOffset = "+08:00"
		}

		morningTime := fmt.Sprintf("%sT09:00:00%s", today, zoneOffset)
		noonTime := fmt.Sprintf("%sT13:00:00%s", today, zoneOffset)
		eveningTime := fmt.Sprintf("%sT19:00:00%s", today, zoneOffset)

		actionJSON := fmt.Sprintf(`{
  "action": "create_batch",
  "items": [
    {
      "title": "%s (早间)",
      "scheduled_at": "%s",
      "repeat_rule": "FREQ=DAILY",
      "duration_minutes": 15,
      "notes": "早间 CPL leads 指标与使用量核查"
    },
    {
      "title": "%s (午间)",
      "scheduled_at": "%s",
      "repeat_rule": "FREQ=DAILY",
      "duration_minutes": 15,
      "notes": "午间 CPL leads 进度与线索成本核查"
    },
    {
      "title": "%s (晚间)",
      "scheduled_at": "%s",
      "repeat_rule": "FREQ=DAILY",
      "duration_minutes": 15,
      "notes": "晚间 CPL leads 全天使用量汇总与复盘"
    }
  ]
}`, cleanTitle, morningTime, cleanTitle, noonTime, cleanTitle, eveningTime)

		return fmt.Sprintf("已为您智能识别出每日高频循环任务：“**%s**”！\n\n根据【早中晚各一次】的规律，已为您拆解为 3 项每日独立触发的日程：\n- 🌅 **早间 (09:00)**: %s (早间)\n- ☀️ **午间 (13:00)**: %s (午间)\n- 🌙 **晚间 (19:00)**: %s (晚间)\n\n均为每天重复执行 (`FREQ=DAILY`)。您可以点击下方卡片一键添加：\n\n```agenda-action\n%s\n```",
			cleanTitle, cleanTitle, cleanTitle, cleanTitle, actionJSON), nil
	}

	// Check if user is asking for summary or listing
	if strings.Contains(last, "今天") || strings.Contains(last, "安排") || strings.Contains(last, "日程") {
		return s.GenerateDailyBriefing()
	}

	if strings.Contains(last, "冲突") || strings.Contains(last, "撞期") {
		return s.AnalyzeScheduleConflicts()
	}

	return fmt.Sprintf("收到您的留言：“%s”\n\n💡 *提示：日程管家支持直连 DeepSeek、OpenAI、Ollama 等大模型。若要享受全功能对话与自然语言排期，请在右上角设置中配置 API Key。*\n\n您可以随时使用顶部的命令栏快速添加日程，或输入“今天日程”、“冲突检测”进行智能分析！", last), nil
}

func (s *AgendaService) PolishReminderWithAI(rawText string) (*PolishResult, error) {
	rawText = strings.TrimSpace(rawText)
	if rawText == "" {
		return &PolishResult{
			Title:    "",
			Notes:    "",
			Tags:     []string{},
			Subtasks: []string{},
		}, nil
	}

	config, _ := s.GetAIConfig()
	if config != nil && config.APIKey != "" {
		systemPrompt := `你是一位专业的 GTD 个人生产力专家。用户会提供一段关于待办事项、会议或任务的杂乱文字，请提炼并润色为一条高效结构化的日程。
请以严格的 JSON 格式回复，不要包含任何 Markdown 标记或额外解释：
{
  "title": "简洁有力、动词开头的行动标题（20字以内）",
  "notes": "背景要点与执行细节（条理化）",
  "tags": ["核心标签1", "标签2"],
  "subtasks": ["步骤1", "步骤2"]
}`
		messages := []AIChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: rawText},
		}

		reply, err := callOpenAICompatible(config.BaseURL, config.APIKey, config.Model, messages, 0.3)
		if err == nil {
			cleanJSON := strings.TrimSpace(reply)
			if strings.HasPrefix(cleanJSON, "```") {
				lines := strings.Split(cleanJSON, "\n")
				if len(lines) >= 2 {
					if strings.HasPrefix(lines[0], "```") {
						lines = lines[1:]
					}
					if len(lines) > 0 && strings.HasPrefix(lines[len(lines)-1], "```") {
						lines = lines[:len(lines)-1]
					}
					cleanJSON = strings.Join(lines, "\n")
				}
			}
			var res PolishResult
			if err := json.Unmarshal([]byte(cleanJSON), &res); err == nil && res.Title != "" {
				if res.Tags == nil {
					res.Tags = []string{}
				}
				if res.Subtasks == nil {
					res.Subtasks = []string{}
				}
				return &res, nil
			}
		}
	}

	// High quality local heuristic fallback
	lines := strings.Split(rawText, "\n")
	firstLine := strings.TrimSpace(lines[0])
	firstLine = strings.TrimPrefix(firstLine, "标题:")
	firstLine = strings.TrimPrefix(firstLine, "标题：")
	firstLine = strings.TrimSpace(firstLine)

	title := firstLine
	if len([]rune(title)) > 25 {
		title = string([]rune(title)[:25]) + "..."
	}

	var notesLines []string
	var subtasks []string
	var tags []string

	for i, l := range lines {
		l = strings.TrimSpace(l)
		if l == "" {
			continue
		}
		if strings.HasPrefix(l, "- [ ]") || strings.HasPrefix(l, "•") || strings.HasPrefix(l, "*") {
			item := strings.TrimLeft(l, "- []•* \t")
			if item != "" {
				subtasks = append(subtasks, item)
			}
		} else if i > 0 {
			notesLines = append(notesLines, l)
		}
	}

	lower := strings.ToLower(rawText)
	if strings.Contains(lower, "会") || strings.Contains(lower, "meeting") {
		tags = append(tags, "会议")
	}
	if strings.Contains(lower, "上线") || strings.Contains(lower, "部署") || strings.Contains(lower, "开发") || strings.Contains(lower, "bug") {
		tags = append(tags, "技术")
	}
	if strings.Contains(lower, "紧急") || strings.Contains(lower, "限流") || strings.Contains(lower, "止损") {
		tags = append(tags, "紧急")
	}
	if len(tags) == 0 {
		tags = append(tags, "工作")
	}

	return &PolishResult{
		Title:    title,
		Notes:    strings.Join(notesLines, "\n"),
		Tags:     tags,
		Subtasks: subtasks,
	}, nil
}

func callOpenAICompatible(baseURL, apiKey, model string, messages []AIChatMessage, temp float64) (string, error) {
	url := strings.TrimRight(baseURL, "/") + "/chat/completions"

	reqBody := openAIChatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: temp,
	}

	jsonData, err := json.Marshal(reqBody)
	if err != nil {
		return "", err
	}

	client := &http.Client{Timeout: 60 * time.Second}
	var lastErr error

	// Exponential backoff retry (up to 2 attempts) for transient failures
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt*150) * time.Millisecond)
		}

		httpReq, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
		if err != nil {
			return "", err
		}

		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)

		resp, err := client.Do(httpReq)
		if err != nil {
			lastErr = err
			continue
		}

		bodyBytes, err := io.ReadAll(resp.Body)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			lastErr = fmt.Errorf("API 响应错误 (状态码 %d): %s", resp.StatusCode, string(bodyBytes))
			continue
		}

		if resp.StatusCode != http.StatusOK {
			return "", fmt.Errorf("API 响应错误 (状态码 %d): %s", resp.StatusCode, string(bodyBytes))
		}

		var chatResp openAIChatResponse
		if err := json.Unmarshal(bodyBytes, &chatResp); err != nil {
			return "", fmt.Errorf("解析响应失败: %w", err)
		}

		if chatResp.Error != nil && chatResp.Error.Message != "" {
			return "", errors.New(chatResp.Error.Message)
		}

		if len(chatResp.Choices) == 0 {
			return "", errors.New("模型未返回任何有效回复")
		}

		return chatResp.Choices[0].Message.Content, nil
	}

	return "", fmt.Errorf("请求失败 (已重试): %w", lastErr)
}
