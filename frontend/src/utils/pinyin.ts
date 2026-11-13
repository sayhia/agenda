/**
 * Lightweight Pinyin Initials Matcher for Chinese Task Titles & Commands.
 * Maps common Chinese ideographs to their pinyin initials for blazing fast ⌘K fuzzy searching.
 */

// Common CJK ideograph unicode ranges to pinyin initials
const PINYIN_TABLE: Record<string, string> = {
  新: 'x', 建: 'j', 日: 'r', 程: 'c', 提: 't', 醒: 'x',
  开: 'k', 会: 'h', 架: 'j', 构: 'g', 评: 'p', 审: 's',
  发: 'f', 布: 'b', 修: 'x', 复: 'f', 测: 'c', 试: 's',
  讨: 't', 论: 'l', 设: 's', 置: 'z', 偏: 'p', 好: 'h',
  专: 'z', 注: 'z', 模: 'm', 式: 's', 早: 'z', 报: 'b',
  数: 's', 据: 'j', 看: 'k', 板: 'b', 废: 'f', 纸: 'z',
  篓: 'l', 清: 'q', 空: 'k', 导: 'd', 出: 'c', 入: 'r',
  历: 'l', 表: 'b', 周: 'z', 月: 'y', 矩: 'j', 阵: 'z',
  任: 'r', 务: 'w', 备: 'b', 忘: 'w', 记: 'j', 录: 'l',
  执: 'z', 行: 'x', 重: 'z', 要: 'y', 紧: 'j', 急: 'j',
  高: 'g', 优: 'y', 低: 'd', 完: 'w', 成: 'c', 待: 'd',
  办: 'b', 逾: 'y', 期: 'q', 标: 'b', 签: 'q', 分: 'f',
  组: 'z', 删: 's', 除: 'c', 恢: 'h', 助: 'z', 手: 's',
  搜: 's', 索: 's', 全: 'q', 局: 'j', 命: 'm', 令: 'l',
  常: 'c', 用: 'y', 指: 'z', 界: 'j', 面: 'm', 控: 'k',
  制: 'z', 折: 'z', 叠: 'd', 展: 'z', 侧: 'c', 栏: 'l',
  凑: 'c', 窗: 'c', 口: 'k', 样: 'y',
  主: 'z', 题: 't', 极: 'j', 光: 'g', 琥: 'h', 珀: 'p',
  赛: 's', 博: 'b', 灰: 'h', 白: 'b', 天: 't', 黑: 'h',
  夜: 'y', 始: 's', 结: 'j', 束: 's', 关: 'g', 闭: 'b',
};

/**
 * Extracts initials from Chinese and ASCII text.
 * e.g., "新建日程" -> "xjrc", "架构评审 P0" -> "jgpsp0"
 */
export function getPinyinInitials(text: string): string {
  if (!text) return '';
  let result = '';
  for (const ch of text) {
    if (PINYIN_TABLE[ch]) {
      result += PINYIN_TABLE[ch];
    } else if (/[a-zA-Z0-9]/.test(ch)) {
      result += ch.toLowerCase();
    }
  }
  return result;
}

/**
 * Fuzzy matches query against text using both direct substring and pinyin initials.
 */
export function fuzzyMatchPinyin(text: string, query: string): boolean {
  if (!query) return true;
  if (!text) return false;

  const q = query.trim().toLowerCase();
  const lowerText = text.toLowerCase();

  // 1. Direct substring match
  if (lowerText.includes(q)) return true;

  // 2. Pinyin initials match
  const initials = getPinyinInitials(text);
  if (initials && initials.includes(q)) return true;

  return false;
}
