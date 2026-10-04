import type { FoliateBook } from './foliate-utils';

// Foliate must access the frame DOM to paginate and generate CFIs. Its frame
// therefore shares our origin; book-authored code must never execute there.
const CONTENT_POLICY = [
  "default-src 'none'", "script-src 'none'", "connect-src 'none'",
  "img-src blob: data:", "style-src 'unsafe-inline' blob: data:",
  "font-src blob: data:", "media-src blob: data:", "object-src 'none'",
  "frame-src 'none'", "base-uri 'none'", "form-action 'none'",
].join('; ');
const ACTIVE_ELEMENTS = new Set(['script', 'iframe', 'object', 'embed', 'base']);
const URL_ATTRIBUTES = new Set(['href', 'src', 'poster', 'data', 'action', 'formaction']);

function restrictStylesheet(css: string): string {
  // Decode CSS escapes before inspecting URL tokens. Foliate has already
  // rewritten bundled resources to blob URLs at this transform point.
  const decoded = css.replace(/\\(?:\r\n|\r|\n)/g, '')
    .replace(/\\([0-9a-f]{1,6})\s?|\\(.)/gi, (_, hex: string | undefined, literal: string | undefined) =>
      hex ? String.fromCodePoint(Math.min(parseInt(hex, 16) || 0xfffd, 0x10ffff)) : literal ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  return decoded.replace(/@import\b[^;]*;?/gi, (rule) =>
    /^@import\s+(?:url\(\s*["']?blob:|["']blob:)/i.test(rule) ? rule : '')
    .replace(/url\(\s*(["']?)([\s\S]*?)\1\s*\)/gi, (token, _quote: string, value: string) =>
      /^(?:blob:|#|data:(?:image\/|font\/|application\/(?:font|x-font|vnd\.ms-font)))/i.test(value.trim()) ? token : 'url("")');
}

export function sanitizeEpubMarkup(markup: string, mediaType: string): string {
  let document = new DOMParser().parseFromString(markup, mediaType as DOMParserSupportedType);
  if (document.querySelector('parsererror')) {
    if (mediaType === 'image/svg+xml') throw new Error('Invalid EPUB SVG');
    document = new DOMParser().parseFromString(markup, 'text/html');
  }
  for (const element of Array.from(document.querySelectorAll('*'))) {
    const tag = element.localName.toLowerCase();
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.localName.toLowerCase();
      const value = attribute.value.replace(/[\u0000-\u0020\u007f]/g, '').toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'srcset'
        || (URL_ATTRIBUTES.has(name) && /^(?:(?:javascript|vbscript):|data:(?:text\/html|application\/xhtml\+xml))/.test(value))) {
        element.removeAttributeNode(attribute);
      }
    }
    // Keep element slots stable so older CFI anchors are not shifted by
    // removing siblings. Active content becomes inert before serialization.
    if (ACTIVE_ELEMENTS.has(tag)) {
      for (const attribute of Array.from(element.attributes)) {
        if (URL_ATTRIBUTES.has(attribute.localName.toLowerCase())) element.removeAttributeNode(attribute);
      }
      if (tag === 'script') {
        element.setAttribute('type', 'application/x-reader-inert');
        element.textContent = '';
      }
    }
    if (tag === 'meta' && /^(?:refresh|content-security-policy)$/i.test(element.getAttribute('http-equiv') ?? '')) {
      element.remove();
    }
  }
  // SVG cannot carry an HTML CSP meta. It is rendered as an image or inside
  // the protected chapter frame, so strip external/active URL attributes.
  if (mediaType === 'image/svg+xml') {
    // A standalone SVG document has no HTML head in which to install CSP.
    for (const instruction of Array.from(document.childNodes)) {
      if (instruction.nodeType === Node.PROCESSING_INSTRUCTION_NODE) instruction.remove();
    }
    for (const element of Array.from(document.querySelectorAll('*'))) {
      if (element.localName.toLowerCase() === 'style') element.textContent = restrictStylesheet(element.textContent ?? '');
      if (element.hasAttribute('style')) element.setAttribute('style', restrictStylesheet(element.getAttribute('style') ?? ''));
      if (['animate', 'animateMotion', 'animateTransform', 'set'].includes(element.localName)) {
        // SMIL can create a new href after the URL attributes were checked.
        for (const name of ['attributeName', 'from', 'to', 'values']) element.removeAttribute(name);
      }
      for (const attribute of Array.from(element.attributes)) {
        if (URL_ATTRIBUTES.has(attribute.localName.toLowerCase())
          && !/^(?:#|blob:|data:image\/(?:png|jpeg|gif|webp);)/i.test(attribute.value)) {
          element.removeAttributeNode(attribute);
        }
      }
    }
  } else {
    const root = document.documentElement;
    let head: Element | null = document.querySelector('head');
    if (!head) {
      head = document.createElementNS(root.namespaceURI, 'head');
      root.insertBefore(head, root.firstChild);
    }
    const policy = document.createElementNS(root.namespaceURI, 'meta');
    policy.setAttribute('http-equiv', 'Content-Security-Policy');
    policy.setAttribute('content', CONTENT_POLICY);
    head.insertBefore(policy, head.firstChild);
  }
  return new XMLSerializer().serializeToString(document);
}

export function protectEpubContent(book: FoliateBook): void {
  if (!book.transformTarget) throw new Error('EPUB content protection is unavailable.');
  book.transformTarget.addEventListener('data', (event) => {
    const detail = (event as CustomEvent<{ type: string; data: unknown }>).detail;
    if (!['application/xhtml+xml', 'text/html', 'image/svg+xml', 'text/css'].includes(detail.type)) return;
    const mediaType = detail.type;
    detail.data = Promise.resolve(detail.data).then(async (data) => {
      const text = typeof data === 'string' ? data
        : data instanceof Blob ? await data.text()
          : data instanceof Uint8Array ? new TextDecoder().decode(data)
            : (() => { throw new Error('Unsupported EPUB markup payload'); })();
      return mediaType === 'text/css' ? restrictStylesheet(text) : sanitizeEpubMarkup(text, mediaType);
    });
  });
}
