package agenda

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

// ExportCSV exports reminders to standard UTF-8 CSV formatted string with BOM for Excel compatibility
func ExportCSV(reminders []Reminder) (string, error) {
	var buf bytes.Buffer
	// UTF-8 BOM so Excel opens it with proper Chinese characters
	buf.WriteString("\xEF\xBB\xBF")

	w := csv.NewWriter(&buf)
	header := []string{
		"ID", "标题", "提醒时间", "重复规则", "优先级", "标签", "持续分钟", "提前提醒(分)", "时区", "备注", "子任务清单", "状态", "是否置顶",
	}
	if err := w.Write(header); err != nil {
		return "", err
	}

	for _, r := range reminders {
		pinnedStr := "否"
		if r.IsPinned {
			pinnedStr = "是"
		}
		row := []string{
			r.ID,
			r.Title,
			r.ScheduledAt,
			r.RepeatRule,
			r.Priority,
			r.Tags,
			strconv.Itoa(r.DurationMinutes),
			strconv.Itoa(r.LeadMinutes),
			r.Timezone,
			r.Notes,
			r.Subtasks,
			r.Status,
			pinnedStr,
		}
		if err := w.Write(row); err != nil {
			return "", err
		}
	}
	w.Flush()
	return buf.String(), w.Error()
}

func looksLikeCSVHeader(record []string) bool {
	if len(record) == 0 {
		return false
	}
	c0 := strings.ToLower(strings.TrimSpace(record[0]))
	c1 := ""
	if len(record) > 1 {
		c1 = strings.ToLower(strings.TrimSpace(record[1]))
	}
	for _, cand := range []string{c0, c1} {
		if cand == "id" || cand == "标题" || cand == "title" || cand == "summary" || cand == "task" || cand == "任务" || cand == "事项" || cand == "content" {
			return true
		}
	}
	return false
}

func normalizeCSVPriority(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "p0", "p1", "p2", "p3":
		return strings.ToLower(strings.TrimSpace(raw))
	default:
		return "p2"
	}
}

// ImportCSV parses a CSV string and returns a list of CreateReminderRequest items
func ImportCSV(content string) ([]CreateReminderRequest, error) {
	// Strip UTF-8 BOM if present
	content = strings.TrimPrefix(content, "\xEF\xBB\xBF")

	// Auto-detect delimiter from the first non-empty line
	lines := strings.Split(content, "\n")
	var comma rune = ','
	for _, l := range lines {
		trimmed := strings.TrimSpace(l)
		if trimmed != "" {
			semiCount := strings.Count(trimmed, ";")
			commaCount := strings.Count(trimmed, ",")
			tabCount := strings.Count(trimmed, "\t")
			if semiCount > commaCount && semiCount > tabCount {
				comma = ';'
			} else if tabCount > commaCount && tabCount > semiCount {
				comma = '\t'
			}
			break
		}
	}

	r := csv.NewReader(strings.NewReader(content))
	r.Comma = comma
	r.LazyQuotes = true
	r.FieldsPerRecord = -1 // Allow variable fields per record

	var requests []CreateReminderRequest
	isFirstRow := true
	seenIDHeader := false
	headerMap := make(map[string]int)

	for {
		record, err := r.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(record) == 0 {
			continue
		}
		if isFirstRow {
			isFirstRow = false
			if looksLikeCSVHeader(record) {
				for i, col := range record {
					name := strings.ToLower(strings.TrimSpace(col))
					switch name {
					case "标题", "title", "summary", "task", "事项", "任务", "content":
						headerMap["title"] = i
					case "时间", "计划时间", "scheduled_at", "time", "date", "due", "due_date", "截止", "截止时间", "提醒时间":
						headerMap["scheduled_at"] = i
					case "优先级", "priority", "level", "urgency":
						headerMap["priority"] = i
					case "重复", "repeat_rule", "repeat", "frequency":
						headerMap["repeat_rule"] = i
					case "标签", "tags", "category", "分类", "类别":
						headerMap["tags"] = i
					case "持续时间", "持续", "时长", "duration", "duration_minutes":
						headerMap["duration"] = i
					case "提前", "提前提醒", "lead", "lead_minutes":
						headerMap["lead"] = i
					case "时区", "timezone":
						headerMap["timezone"] = i
					case "备注", "notes", "description", "detail", "details", "说明", "详情":
						headerMap["notes"] = i
					case "子任务", "subtasks", "checklist", "items", "子项":
						headerMap["subtasks"] = i
					case "置顶", "pinned", "is_pinned", "star", "重要度":
						headerMap["is_pinned"] = i
					}
				}
				seenIDHeader = strings.EqualFold(strings.TrimSpace(record[0]), "id")
				continue
			}
		}

		title := strings.TrimSpace(record[0])
		scheduledAt := ""
		repeatRule := ""
		priority := "p2"
		tags := ""
		durationMinutes := 30
		leadMinutes := 0
		timezone := "Asia/Shanghai"
		notes := ""
		subtasks := ""
		isPinned := false

		if len(headerMap) > 0 {
			getCol := func(key string) string {
				if idx, ok := headerMap[key]; ok && idx < len(record) {
					return strings.TrimSpace(record[idx])
				}
				return ""
			}
			if v := getCol("title"); v != "" { title = v }
			if v := getCol("scheduled_at"); v != "" { scheduledAt = v }
			if v := getCol("priority"); v != "" { priority = v }
			if v := getCol("repeat_rule"); v != "" { repeatRule = v }
			if v := getCol("tags"); v != "" { tags = v }
			if v := getCol("duration"); v != "" { durationMinutes, _ = strconv.Atoi(v) }
			if v := getCol("lead"); v != "" { leadMinutes, _ = strconv.Atoi(v) }
			if v := getCol("timezone"); v != "" { timezone = v }
			if v := getCol("notes"); v != "" { notes = v }
			if v := getCol("subtasks"); v != "" { subtasks = v }
			if v := getCol("is_pinned"); v != "" { isPinned = v == "是" || v == "true" || v == "1" }
		} else {
			// Positional fallback
			// Detect ID-first column cleanly via header, prefix, or column timestamp position
			hasIDCol := len(record) >= 3 && seenIDHeader
			if !hasIDCol && len(record) >= 3 {
				if strings.HasPrefix(record[0], "rem_") {
					hasIDCol = true
				} else {
					_, errCol1 := parseFlexibleTime(record[1])
					_, errCol2 := parseFlexibleTime(record[2])
					if errCol1 != nil && errCol2 == nil {
						hasIDCol = true
					}
				}
			}

			if len(record) >= 2 {
				if hasIDCol {
					// Format with ID as first column
					title = strings.TrimSpace(record[1])
					scheduledAt = strings.TrimSpace(record[2])
					if len(record) >= 4 { repeatRule = strings.TrimSpace(record[3]) }
					if len(record) >= 5 { priority = strings.TrimSpace(record[4]) }
					if len(record) >= 6 { tags = strings.TrimSpace(record[5]) }
					if len(record) >= 7 { durationMinutes, _ = strconv.Atoi(record[6]) }
					if len(record) >= 8 { leadMinutes, _ = strconv.Atoi(record[7]) }
					if len(record) >= 9 { timezone = strings.TrimSpace(record[8]) }
					if len(record) >= 10 { notes = strings.TrimSpace(record[9]) }
					if len(record) >= 11 { subtasks = strings.TrimSpace(record[10]) }
					if len(record) >= 13 { isPinned = record[12] == "是" || record[12] == "true" || record[12] == "1" }
				} else {
					// Format with Title as first column
					title = strings.TrimSpace(record[0])
					scheduledAt = strings.TrimSpace(record[1])
					if len(record) >= 3 { repeatRule = strings.TrimSpace(record[2]) }
					if len(record) >= 4 { priority = strings.TrimSpace(record[3]) }
					if len(record) >= 5 { tags = strings.TrimSpace(record[4]) }
					if len(record) >= 6 { durationMinutes, _ = strconv.Atoi(record[5]) }
					if len(record) >= 7 { leadMinutes, _ = strconv.Atoi(record[6]) }
					if len(record) >= 8 { timezone = strings.TrimSpace(record[7]) }
					if len(record) >= 9 { notes = strings.TrimSpace(record[8]) }
					if len(record) >= 10 { subtasks = strings.TrimSpace(record[9]) }
					if len(record) >= 12 { isPinned = record[11] == "是" || record[11] == "true" || record[11] == "1" }
				}
			}
		}

		if title == "" {
			continue
		}

		if durationMinutes <= 0 {
			durationMinutes = 30
		}
		priority = normalizeCSVPriority(priority)
		if timezone == "" {
			timezone = "Asia/Shanghai"
		}

		// Ensure scheduledAt is normalized
		t, err := parseFlexibleTime(scheduledAt)
		if err == nil {
			scheduledAt = t.Format(time.RFC3339)
		} else {
			scheduledAt = time.Now().Add(15 * time.Minute).Format(time.RFC3339)
		}

		requests = append(requests, CreateReminderRequest{
			Title:           title,
			ScheduledAt:     scheduledAt,
			RepeatRule:      repeatRule,
			LeadMinutes:     leadMinutes,
			DurationMinutes: durationMinutes,
			Timezone:        timezone,
			Notes:           notes,
			Priority:        priority,
			Tags:            tags,
			Subtasks:        subtasks,
			IsPinned:        isPinned,
			Prompt:          fmt.Sprintf("提醒您：%s", title),
		})
	}

	return requests, nil
}
