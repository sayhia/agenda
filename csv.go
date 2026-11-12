package main

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
	return c0 == "id" || c0 == "标题" || c0 == "title" || c0 == "summary" || c1 == "标题" || c1 == "title"
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
	r := csv.NewReader(strings.NewReader(content))
	r.FieldsPerRecord = -1 // Allow variable fields per record

	var requests []CreateReminderRequest
	isFirstRow := true
	seenIDHeader := false

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
