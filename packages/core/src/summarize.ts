const CONDENSED_CAP = 300;
const KEYPOINT_CAP = 150;
const SHORT_THRESHOLD = 150;

const ABBREVS = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|i\.e|e\.g|approx|dept|est|inc|ltd|corp)\.\s*$/i;

function stripFrontmatter(text: string): string {
  if (!text.startsWith('---')) return text;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  return text.slice(end + 4).trimStart();
}

function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';

  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (current.trim()) {
        sentences.push(current.trim());
        current = '';
      }
      continue;
    }

    // Skip markdown headers
    if (trimmed.startsWith('#')) continue;
    // Skip code fences
    if (trimmed.startsWith('```')) continue;
    // Skip list markers for sentence splitting but keep content
    const listContent = trimmed.replace(/^[-*+]\s+/, '').replace(/^\d+\.\s+/, '');

    current += (current ? ' ' : '') + listContent;

    // Try to split on sentence-ending punctuation
    const parts = current.split(/(?<=[.!?])\s+/);
    if (parts.length > 1) {
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i].trim();
        if (part && !ABBREVS.test(part)) {
          sentences.push(part);
        } else if (part) {
          // Reattach abbreviated segment to next part
          parts[i + 1] = part + ' ' + parts[i + 1];
        }
      }
      current = parts[parts.length - 1];
    }
  }

  if (current.trim()) {
    sentences.push(current.trim());
  }

  return sentences.filter(s => s.length > 0);
}

function firstHeaderText(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/^#{1,6}\s+(.+)/);
    if (match) return match[1].trim();
  }
  return null;
}

function firstCodeComment(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) return trimmed.slice(2).trim();
    if (trimmed.startsWith('#') && !trimmed.startsWith('##')) return trimmed.slice(1).trim();
    if (trimmed.startsWith('/*')) {
      const content = trimmed.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '');
      if (content) return content;
    }
  }
  return null;
}

function isCodeOnly(text: string): boolean {
  const stripped = stripFrontmatter(text);
  const lines = stripped.split('\n').filter(l => l.trim());
  if (lines.length === 0) return false;
  const codeLines = lines.filter(l => {
    const t = l.trim();
    return t.startsWith('```') || t.startsWith('//') || t.startsWith('/*') ||
           t.startsWith('import ') || t.startsWith('export ') || t.startsWith('const ') ||
           t.startsWith('let ') || t.startsWith('function ') || t.startsWith('class ') ||
           t.startsWith('{') || t.startsWith('}') || t.startsWith('def ') ||
           t.startsWith('return ');
  });
  return codeLines.length / lines.length > 0.7;
}

function cap(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit - 3);
  const lastSpace = truncated.lastIndexOf(' ');
  return (lastSpace > limit * 0.5 ? truncated.slice(0, lastSpace) : truncated) + '...';
}

export function generateSummaryTiers(body: string): {
  condensed: string;
  keypoint: string;
} {
  const cleaned = stripFrontmatter(body).trim();

  if (!cleaned) {
    return { condensed: '', keypoint: '' };
  }

  // Short entries: use body as both
  if (cleaned.length < SHORT_THRESHOLD) {
    return { condensed: cleaned, keypoint: cleaned };
  }

  // Code-only entries
  if (isCodeOnly(cleaned)) {
    const comment = firstCodeComment(cleaned);
    const firstLine = cleaned.split('\n').find(l => l.trim())?.trim() || '';
    const label = comment || `Code block: ${firstLine.slice(0, 80)}`;
    return {
      condensed: cap(label, CONDENSED_CAP),
      keypoint: cap(label, KEYPOINT_CAP),
    };
  }

  const sentences = splitSentences(cleaned);

  // Keypoint: prefer first header, then first sentence
  const header = firstHeaderText(cleaned);
  const keypoint = header || sentences[0] || cleaned.slice(0, KEYPOINT_CAP);

  // Condensed: first sentence + last sentence
  let condensed: string;
  if (sentences.length <= 1) {
    condensed = sentences[0] || cleaned.slice(0, CONDENSED_CAP);
  } else {
    const first = sentences[0];
    const last = sentences[sentences.length - 1];
    if (first === last) {
      condensed = first;
    } else {
      condensed = `${first} ${last}`;
    }
  }

  return {
    condensed: cap(condensed, CONDENSED_CAP),
    keypoint: cap(keypoint, KEYPOINT_CAP),
  };
}
