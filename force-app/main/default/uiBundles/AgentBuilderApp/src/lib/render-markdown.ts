import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

/** Same allow-list the old synapseChatPanel LWC used for its DOMPurify
 *  config — kept identical since this is rendering AI-generated content
 *  as HTML, a real XSS surface if the list is loosened. */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's', 'del', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'code', 'pre',
  'a',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'span', 'div',
];
const ALLOWED_ATTR = ['href', 'title', 'target', 'rel', 'align', 'colspan', 'rowspan', 'class'];

export function renderMarkdown(raw: string | null | undefined): string {
  if (!raw) return '';
  const dirty = marked.parse(String(raw), { async: false }) as string;
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select', 'button'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onblur', 'style'],
  });
}
