export interface ActionItem {
  action?: string;
  id?: string;
  title: string;
  scheduled_at: string;
  repeat_rule?: string;
  lead_minutes?: number;
  duration_minutes?: number;
  notes?: string;
  minutes?: number;
  priority?: string;
  tags?: string;
  applied?: boolean;
  items?: any[];
}

export function parseJsonLenient(raw: string): any {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // Attempt to fix trailing commas before closing braces/brackets
    const fixed = trimmed.replace(/,(\s*[\]\}])/g, '$1');
    try {
      return JSON.parse(fixed);
    } catch {
      return null;
    }
  }
}

const VALID_ACTION_TYPES = new Set([
  'create',
  'create_batch',
  'update',
  'delete',
  'snooze',
  'complete',
  'end',
  'pause',
  'resume',
]);

function pushParsedAction(parsed: any, actions: ActionItem[]): boolean {
  let found = false;
  if (!parsed || typeof parsed !== 'object') return false;

  // Case 1: Array of items: [ { title: ... }, ... ]
  if (Array.isArray(parsed)) {
    for (const it of parsed) {
      if (it && typeof it === 'object') {
        const hasTitle = typeof it.title === 'string' && it.title.trim().length > 0;
        const hasAction = typeof it.action === 'string' && VALID_ACTION_TYPES.has(it.action.toLowerCase());
        if (hasTitle || hasAction) {
          actions.push({ ...it, applied: false });
          found = true;
        }
      }
    }
  }
  // Case 2: Object with create_batch or items list: { action: "create_batch", items: [...] }
  else if (Array.isArray(parsed.items)) {
    for (const it of parsed.items) {
      if (it && typeof it === 'object') {
        const hasTitle = typeof it.title === 'string' && it.title.trim().length > 0;
        const hasAction = typeof it.action === 'string' && VALID_ACTION_TYPES.has(it.action.toLowerCase());
        if (hasTitle || hasAction) {
          actions.push({ ...it, applied: false });
          found = true;
        }
      }
    }
  }
  // Case 3: Single item action: { action: "create", title: "...", ... }
  else {
    const hasTitle = typeof parsed.title === 'string' && parsed.title.trim().length > 0;
    const hasAction = typeof parsed.action === 'string' && VALID_ACTION_TYPES.has(parsed.action.toLowerCase());
    if (hasTitle || hasAction) {
      actions.push({ ...parsed, applied: false });
      found = true;
    }
  }

  return found;
}

/**
 * Robustly extracts agenda actions from AI output.
 * Supports:
 * - ```agenda-action ... ```
 * - ```agenda ... ```
 * - ```json ... ```
 * - Generic ``` ... ``` code blocks
 * - Raw / bare JSON objects or arrays in text
 */
export function extractActions(content: string): { text: string; actions: ActionItem[] } {
  if (!content) return { text: '', actions: [] };
  let cleanText = content;
  const actions: ActionItem[] = [];

  // Pass 1: Extract from markdown code blocks
  const codeBlockRegex = /```(?:agenda-action|agenda|json)?\s*[\r\n]+([\s\S]*?)[\r\n]+```/gi;
  cleanText = cleanText.replace(codeBlockRegex, (match, code) => {
    const parsed = parseJsonLenient(code);
    const beforeCount = actions.length;
    if (parsed && pushParsedAction(parsed, actions) && actions.length > beforeCount) {
      return '';
    }
    return match;
  });

  // Pass 2: Extract bare JSON structures (in case LLM omitted markdown code fences)
  let idx = 0;
  while (idx < cleanText.length) {
    const char = cleanText[idx];
    if (char === '{' || char === '[') {
      const isObject = char === '{';
      const openChar = char;
      const closeChar = isObject ? '}' : ']';
      let depth = 0;
      let inString = false;
      let escape = false;
      const startIdx = idx;
      let endIdx = -1;

      for (let j = idx; j < cleanText.length; j++) {
        const c = cleanText[j];
        if (escape) {
          escape = false;
          continue;
        }
        if (c === '\\') {
          escape = true;
          continue;
        }
        if (c === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (c === openChar) depth++;
          else if (c === closeChar) {
            depth--;
            if (depth === 0) {
              endIdx = j + 1;
              break;
            }
          }
        }
      }

      if (endIdx !== -1) {
        const candidate = cleanText.slice(startIdx, endIdx);
        // Only attempt to parse if candidate contains agenda action keywords
        if (/("action"\s*:|"items"\s*:|"scheduled_at"\s*:|"title"\s*:)/.test(candidate)) {
          const parsed = parseJsonLenient(candidate);
          const beforeCount = actions.length;
          if (parsed && pushParsedAction(parsed, actions) && actions.length > beforeCount) {
            cleanText = cleanText.slice(0, startIdx) + cleanText.slice(endIdx);
            idx = startIdx;
            continue;
          }
        }
      }
    }
    idx++;
  }

  return {
    text: cleanText.replace(/\n{3,}/g, '\n\n').trim(),
    actions,
  };
}
