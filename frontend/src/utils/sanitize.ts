const ALLOWED_TAGS = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'EM', 'H1', 'H2', 'H3', 'H4',
  'HR', 'LI', 'OL', 'P', 'PRE', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH',
  'THEAD', 'TR', 'UL', 'MARK',
]);

const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  A: new Set(['href', 'title']),
  CODE: new Set(['class']),
  MARK: new Set(['class']),
};

export function escapeHTML(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };
    return entities[character];
  });
}

/**
 * Sanitizes small trusted-format HTML fragments produced by the Markdown renderer.
 * Unknown elements are unwrapped, event handlers are removed, and links are limited
 * to http(s), mailto and same-page anchors.
 */
export function sanitizeHTML(html: string): string {
  if (typeof DOMParser === 'undefined') return escapeHTML(html);

  const documentNode = new DOMParser().parseFromString(html, 'text/html');
  const elements = Array.from(documentNode.body.querySelectorAll('*')).reverse();

  for (const element of elements) {
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...Array.from(element.childNodes));
      continue;
    }

    const allowed = ALLOWED_ATTRIBUTES[element.tagName] || new Set<string>();
    for (const attribute of Array.from(element.attributes)) {
      if (!allowed.has(attribute.name)) element.removeAttribute(attribute.name);
    }

    if (element.tagName === 'A') {
      const href = element.getAttribute('href')?.trim() || '';
      if (!/^(https?:|mailto:|#)/i.test(href)) {
        element.removeAttribute('href');
      } else {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }

  return documentNode.body.innerHTML;
}
