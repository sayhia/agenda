package agenda

import (
	"bufio"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func priorityToICS(pri string) int {
	switch strings.ToLower(strings.TrimSpace(pri)) {
	case "p0":
		return 1
	case "p1":
		return 3
	case "p3":
		return 9
	default:
		return 5
	}
}

func priorityFromICS(raw string) string {
	val, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || val <= 0 {
		return "p2"
	}
	switch {
	case val <= 2:
		return "p0"
	case val <= 4:
		return "p1"
	case val >= 7:
		return "p3"
	default:
		return "p2"
	}
}

func ExportICS(reminders []Reminder) string {
	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//Agenda Butler 1.8.0//EN\r\n")
	sb.WriteString("CALSCALE:GREGORIAN\r\n")
	sb.WriteString("METHOD:PUBLISH\r\n")

	nowUTC := time.Now().UTC().Format("20060102T150405Z")

	for _, r := range reminders {
		if r.DeletedAt != "" {
			continue
		}
		st, err := parseFlexibleTime(r.ScheduledAt)
		if err != nil {
			st = time.Now()
		}
		dtStart := st.UTC().Format("20060102T150405Z")

		duration := time.Duration(r.DurationMinutes) * time.Minute
		if duration <= 0 {
			duration = 30 * time.Minute
		}
		dtEnd := st.Add(duration).UTC().Format("20060102T150405Z")

		sb.WriteString("BEGIN:VEVENT\r\n")
		sb.WriteString(fmt.Sprintf("UID:%s@agenda.local\r\n", r.ID))
		sb.WriteString(fmt.Sprintf("DTSTAMP:%s\r\n", nowUTC))
		sb.WriteString(fmt.Sprintf("DTSTART:%s\r\n", dtStart))
		sb.WriteString(fmt.Sprintf("DTEND:%s\r\n", dtEnd))
		sb.WriteString(fmt.Sprintf("SUMMARY:%s\r\n", escapeICS(r.Title)))

		desc := r.Notes
		if r.Prompt != "" {
			if desc != "" {
				desc += "\n"
			}
			desc += "提示: " + r.Prompt
		}
		if desc != "" {
			sb.WriteString(fmt.Sprintf("DESCRIPTION:%s\r\n", escapeICS(desc)))
		}
		if r.Priority != "" {
			sb.WriteString(fmt.Sprintf("PRIORITY:%d\r\n", priorityToICS(r.Priority)))
		}
		if strings.TrimSpace(r.Tags) != "" {
			rawTags := strings.FieldsFunc(r.Tags, func(ch rune) bool {
				return ch == ',' || ch == '，'
			})
			var cleanTags []string
			for _, t := range rawTags {
				if trimmed := strings.TrimSpace(strings.TrimPrefix(t, "#")); trimmed != "" {
					cleanTags = append(cleanTags, trimmed)
				}
			}
			if len(cleanTags) > 0 {
				sb.WriteString(fmt.Sprintf("CATEGORIES:%s\r\n", strings.Join(cleanTags, ",")))
			}
		}

		if r.RepeatRule != "" {
			sb.WriteString(fmt.Sprintf("RRULE:%s\r\n", r.RepeatRule))
		}

		if r.LeadMinutes > 0 {
			sb.WriteString("BEGIN:VALARM\r\n")
			sb.WriteString("ACTION:DISPLAY\r\n")
			sb.WriteString(fmt.Sprintf("DESCRIPTION:提前提醒: %s\r\n", escapeICS(r.Title)))
			sb.WriteString(fmt.Sprintf("TRIGGER:-PT%dM\r\n", r.LeadMinutes))
			sb.WriteString("END:VALARM\r\n")
		}

		sb.WriteString("END:VEVENT\r\n")
	}

	sb.WriteString("END:VCALENDAR\r\n")
	return sb.String()
}

func unfoldICSLines(content string) string {
	content = strings.ReplaceAll(content, "\r\n ", "")
	content = strings.ReplaceAll(content, "\r\n\t", "")
	content = strings.ReplaceAll(content, "\n ", "")
	content = strings.ReplaceAll(content, "\n\t", "")
	return content
}

func parseICSTriggerMinutes(val string) int {
	v := strings.ToUpper(strings.TrimSpace(val))
	if idx := strings.LastIndex(v, ":"); idx != -1 {
		v = strings.TrimSpace(v[idx+1:])
	}
	v = strings.TrimPrefix(v, "-")
	v = strings.TrimPrefix(v, "P")
	if v == "" {
		return 0
	}

	totalMinutes := 0
	numBuf := ""
	for _, ch := range v {
		if ch >= '0' && ch <= '9' {
			numBuf += string(ch)
			continue
		}
		if ch == 'T' {
			numBuf = ""
			continue
		}
		if numBuf != "" {
			n, err := strconv.Atoi(numBuf)
			numBuf = ""
			if err == nil && n > 0 {
				switch ch {
				case 'W':
					totalMinutes += n * 7 * 24 * 60
				case 'D':
					totalMinutes += n * 24 * 60
				case 'H':
					totalMinutes += n * 60
				case 'M':
					totalMinutes += n
				case 'S':
					totalMinutes += n / 60
				}
			}
		}
	}
	return totalMinutes
}

func ImportICS(content string) ([]CreateReminderRequest, error) {
	scanner := bufio.NewScanner(strings.NewReader(unfoldICSLines(content)))
	var events []CreateReminderRequest
	var current *CreateReminderRequest
	var dtStartTime, dtEndTime time.Time
	var hasDTStart, hasDTEnd, hasExplicitDuration bool
	inEvent := false
	inAlarm := false
	isCancelled := false

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		upper := strings.ToUpper(line)
		if upper == "BEGIN:VEVENT" {
			inEvent = true
			inAlarm = false
			isCancelled = false
			dtStartTime = time.Time{}
			dtEndTime = time.Time{}
			hasDTStart = false
			hasDTEnd = false
			hasExplicitDuration = false
			current = &CreateReminderRequest{
				DurationMinutes: 30,
				Priority:        "p2",
			}
			continue
		}
		if upper == "END:VEVENT" && inEvent {
			inEvent = false
			inAlarm = false
			if current != nil {
				current.Title = strings.TrimSpace(current.Title)
				if !hasExplicitDuration && hasDTStart && hasDTEnd {
					if dur := int(dtEndTime.Sub(dtStartTime).Minutes()); dur > 0 {
						current.DurationMinutes = dur
					}
				}
			}
			if !isCancelled && current != nil && current.Title != "" {
				if current.ScheduledAt == "" {
					current.ScheduledAt = time.Now().Add(time.Hour).Format(time.RFC3339)
				}
				events = append(events, *current)
			}
			current = nil
			isCancelled = false
			continue
		}
		if !inEvent || current == nil {
			continue
		}
		if upper == "BEGIN:VALARM" {
			inAlarm = true
			continue
		}
		if upper == "END:VALARM" {
			inAlarm = false
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		keyPart := parts[0]
		rawVal := parts[1]
		val := unescapeICS(rawVal)

		key := keyPart
		if idx := strings.Index(keyPart, ";"); idx != -1 {
			key = keyPart[:idx]
		}
		key = strings.ToUpper(key)

		if inAlarm {
			if key == "TRIGGER" && current.LeadMinutes == 0 {
				if mins := parseICSTriggerMinutes(rawVal); mins > 0 {
					current.LeadMinutes = mins
				}
			}
			continue
		}

		switch key {
		case "SUMMARY":
			current.Title = val
		case "DESCRIPTION":
			current.Notes = val
		case "RRULE":
			current.RepeatRule = val
		case "PRIORITY":
			current.Priority = priorityFromICS(val)
		case "CATEGORIES":
			current.Tags = strings.TrimSpace(val)
		case "STATUS":
			if strings.EqualFold(strings.TrimSpace(val), "CANCELLED") {
				isCancelled = true
			}
		case "DTSTART":
			if t, err := parseICSTime(val, keyPart); err == nil {
				dtStartTime = t
				hasDTStart = true
				current.ScheduledAt = t.Format(time.RFC3339)
			}
		case "DTEND":
			if t, err := parseICSTime(val, keyPart); err == nil {
				dtEndTime = t
				hasDTEnd = true
			}
		case "DURATION":
			if mins := parseICSTriggerMinutes(rawVal); mins > 0 {
				current.DurationMinutes = mins
				hasExplicitDuration = true
			}
		}
	}

	return events, nil
}

func parseICSTime(val string, keyPart ...string) (time.Time, error) {
	val = strings.TrimSpace(val)
	loc := time.Local

	// Support TZID parameter passed directly in val, e.g. "TZID=Asia/Shanghai:20261113T150000"
	if strings.Contains(strings.ToUpper(val), "TZID=") && strings.Contains(val, ":") {
		parts := strings.SplitN(val, ":", 2)
		keyPart = append([]string{parts[0]}, keyPart...)
		val = strings.TrimSpace(parts[1])
	}

	if len(keyPart) > 0 && strings.Contains(strings.ToUpper(keyPart[0]), "TZID=") {
		upperKey := strings.ToUpper(keyPart[0])
		tzStart := strings.Index(upperKey, "TZID=") + 5
		tzEnd := strings.Index(keyPart[0][tzStart:], ";")
		var tzid string
		if tzEnd == -1 {
			tzid = keyPart[0][tzStart:]
		} else {
			tzid = keyPart[0][tzStart : tzStart+tzEnd]
		}
		tzid = strings.Trim(strings.TrimSpace(tzid), "\"")
		if l, err := time.LoadLocation(tzid); err == nil {
			loc = l
		}
	}

	if strings.HasSuffix(val, "Z") {
		return time.Parse("20060102T150405Z", val)
	}
	if len(val) == 15 && val[8] == 'T' {
		return time.ParseInLocation("20060102T150405", val, loc)
	}
	if len(val) == 8 {
		return time.ParseInLocation("20060102", val, loc)
	}
	return parseFlexibleTime(val)
}

func escapeICS(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ";", "\\;")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.ReplaceAll(s, "\r", "")
	return s
}

func unescapeICS(s string) string {
	s = strings.ReplaceAll(s, "\\n", "\n")
	s = strings.ReplaceAll(s, "\\,", ",")
	s = strings.ReplaceAll(s, "\\;", ";")
	s = strings.ReplaceAll(s, "\\\\", "\\")
	return s
}
