export type LegalBlock =
  | { type: 'h3'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'dl'; items: { term: string; definition: string }[] };

export type LegalTocItem = {
  id: string;
  text: string;
  level: 1 | 2;
};

type DlEntry = { term: string; parts: string[] };

const QUOTED_TERM_DEF = /^["\u201c]([^"\u201d]+)["\u201d]\s*(.*)$/;

const lastDlDefinitionEndsSentence = (parts: string[]): boolean => {
  const s = parts.join(' ').trim();
  return /[.!?:]\s*$/.test(s);
};

const isDlContinuationLine = (trimmed: string, activeEntry: DlEntry): boolean => {
  if (QUOTED_TERM_DEF.test(trimmed)) return false;
  const parts = activeEntry.parts;
  if (!parts.length) return true;
  if (!lastDlDefinitionEndsSentence(parts)) return true;
  return /^[a-z(,]/.test(trimmed);
};

const looksLikeSectionHeading = (trimmed: string): boolean => {
  if (/https?:\/\//i.test(trimmed)) return false;
  if (trimmed.length < 6 || trimmed.length > 120) return false;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 14) return false;
  const letters = trimmed.replace(/[^a-zA-Z]/g, '');
  if (letters.length < 6) return false;
  const upperRatio = letters.replace(/[^A-Z]/g, '').length / letters.length;
  return upperRatio >= 0.85;
};

export const parseLegalDocument = (raw: string): LegalBlock[] => {
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const lines = text.split('\n');
  const blocks: LegalBlock[] = [];
  let paragraphBuffer: string[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];
  let dlBuffer: DlEntry[] | null = null;

  const flushParagraph = () => {
    const paragraph = paragraphBuffer.join('\n').trim();
    if (paragraph) blocks.push({ type: 'p', text: paragraph });
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!listType) return;
    if (listItems.length) blocks.push({ type: listType, items: listItems.slice() });
    listType = null;
    listItems = [];
  };

  const flushDl = () => {
    if (!dlBuffer?.length) {
      dlBuffer = null;
      return;
    }
    blocks.push({
      type: 'dl',
      items: dlBuffer.map(({ term, parts }) => ({
        term,
        definition: parts.join(' ').trim(),
      })),
    });
    dlBuffer = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      flushDl();
      continue;
    }

    const ulMatch = trimmed.match(/^([-*•])\s+(.+)$/);
    if (ulMatch) {
      const item = ulMatch[2].trim();
      if (!item) continue;
      if (listType !== 'ul') {
        flushParagraph();
        flushDl();
        flushList();
        listType = 'ul';
      }
      listItems.push(item);
      continue;
    }

    const olMatch = trimmed.match(/^(\d+)[\.)]\s+(.+)$/);
    if (olMatch) {
      const item = olMatch[2].trim();
      if (!item) continue;
      if (looksLikeSectionHeading(trimmed)) {
        flushParagraph();
        flushDl();
        flushList();
        blocks.push({ type: 'h3', text: trimmed });
        continue;
      }
      if (listType !== 'ol') {
        flushParagraph();
        flushDl();
        flushList();
        listType = 'ol';
      }
      listItems.push(item);
      continue;
    }

    if (looksLikeSectionHeading(trimmed)) {
      flushParagraph();
      flushDl();
      flushList();
      blocks.push({ type: 'h3', text: trimmed });
      continue;
    }

    const quotedDef = trimmed.match(QUOTED_TERM_DEF);
    if (quotedDef) {
      const inner = quotedDef[1].trim();
      const rest = quotedDef[2].trim();
      flushParagraph();
      flushList();
      if (!dlBuffer) dlBuffer = [];
      dlBuffer.push({ term: inner, parts: rest ? [rest] : [] });
      continue;
    }

    if (dlBuffer?.length) {
      const active = dlBuffer[dlBuffer.length - 1];
      if (isDlContinuationLine(trimmed, active)) {
        active.parts.push(trimmed);
        continue;
      }
      flushDl();
    }

    flushList();
    paragraphBuffer.push(trimmed);
  }

  flushParagraph();
  flushList();
  flushDl();
  return blocks;
};

export const headingToId = (text: string, index: number): string => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56);
  return slug || `section-${index}`;
};

export const parseSectionHeading = (
  text: string
): { prefix?: string; title: string; isNumbered: boolean } => {
  const numbered = text.match(/^(\d+(?:\.\d+)*\.?)\s+(.+)$/);
  if (numbered) {
    return { prefix: numbered[1], title: numbered[2], isNumbered: true };
  }
  return { title: text, isNumbered: false };
};

export const humanizeHeading = (text: string): string => {
  const { prefix, title } = parseSectionHeading(text);
  const words = title
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return prefix ? `${prefix} ${words}` : words;
};

export const isDocumentTitleBlock = (text: string, pageTitle: string): boolean => {
  const normalized = text.trim().toUpperCase();
  return (
    normalized.includes('TERMS OF SERVICE') ||
    normalized.includes('PRIVACY POLICY') ||
    normalized.includes('REFUND POLICY') ||
    normalized === pageTitle.trim().toUpperCase()
  );
};

export const buildTocFromBlocks = (
  blocks: LegalBlock[],
  pageTitle: string
): LegalTocItem[] => {
  const items: LegalTocItem[] = [];
  let headingIndex = 0;

  for (const block of blocks) {
    if (block.type !== 'h3') continue;
    if (headingIndex === 0 && isDocumentTitleBlock(block.text, pageTitle)) {
      headingIndex += 1;
      continue;
    }

    const { prefix } = parseSectionHeading(block.text);
    const level: 1 | 2 = prefix && /\d+\.\d+/.test(prefix) ? 2 : 1;

    items.push({
      id: headingToId(block.text, headingIndex),
      text: humanizeHeading(block.text),
      level,
    });
    headingIndex += 1;
  }

  return items;
};
