const ALLOWED_TAGS = ['div', 'span', 'p', 'a', 'img', 'br', 'strong', 'em', 'b', 'i'];
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  'a': ['href', 'target', 'rel'],
  'img': ['src', 'alt', 'width', 'height'],
  'div': ['class'],
  'span': ['class'],
  'p': ['class']
};

const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:'];

function sanitizeUrl(url: string): string {
  const trimmed = url.trim().toLowerCase();
  for (const protocol of DANGEROUS_PROTOCOLS) {
    if (trimmed.startsWith(protocol)) {
      return '';
    }
  }
  return url;
}

function sanitizeAttribute(tagName: string, attrName: string, attrValue: string): string | null {
  const allowedAttrs = ALLOWED_ATTRIBUTES[tagName.toLowerCase()];
  if (!allowedAttrs || !allowedAttrs.includes(attrName.toLowerCase())) {
    return null;
  }

  if (attrName.toLowerCase() === 'href' || attrName.toLowerCase() === 'src') {
    const sanitized = sanitizeUrl(attrValue);
    if (!sanitized) {
      return null;
    }
    return sanitized;
  }

  if (attrName.toLowerCase() === 'target' && attrValue === '_blank') {
    return '_blank';
  }

  if (attrName.toLowerCase() === 'rel') {
    return 'noopener noreferrer';
  }

  return attrValue;
}

export function sanitizeHtml(html: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  function processNode(node: Node): Node | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.cloneNode(true);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();

      if (!ALLOWED_TAGS.includes(tagName)) {
        return null;
      }

      const newElement = document.createElement(tagName);

      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        const sanitizedValue = sanitizeAttribute(tagName, attr.name, attr.value);

        if (sanitizedValue !== null) {
          newElement.setAttribute(attr.name, sanitizedValue);
        }
      }

      if (tagName === 'a') {
        newElement.setAttribute('rel', 'noopener noreferrer');
        if (newElement.getAttribute('target') === '_blank') {
          newElement.setAttribute('target', '_blank');
        }
      }

      for (let i = 0; i < element.childNodes.length; i++) {
        const processedChild = processNode(element.childNodes[i]);
        if (processedChild) {
          newElement.appendChild(processedChild);
        }
      }

      return newElement;
    }

    return null;
  }

  const sanitizedBody = document.createElement('div');
  for (let i = 0; i < doc.body.childNodes.length; i++) {
    const processedNode = processNode(doc.body.childNodes[i]);
    if (processedNode) {
      sanitizedBody.appendChild(processedNode);
    }
  }

  return sanitizedBody.innerHTML;
}

export function createSafeHtml(html: string): { __html: string } {
  return { __html: sanitizeHtml(html) };
}

/**
 * Returns a URL safe for use as href (only http/https). Use for user-provided links
 * (e.g. profile social_media_url, social links) to prevent javascript:/data: XSS.
 * Returns '' if the URL is invalid or not http(s).
 */
export function safeHrefUrl(url: string | null | undefined): string {
  if (url == null || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    if (protocol === 'https:' || protocol === 'http:') return trimmed;
  } catch {
    // Invalid URL
  }
  return '';
}
