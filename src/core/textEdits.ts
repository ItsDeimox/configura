/** DOM textareas represent every line ending as LF, even when given CRLF text. */
const normalize = (text: string) => text.replace(/\r\n|\r/g, '\n');

function preferredLineEnding(text: string): string {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(/\r\n|\r|\n/g)) {
    counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
  }
  let chosen = '\n';
  let maximum = 0;
  for (const [ending, count] of counts) {
    // Map insertion order chooses the first encountered ending for tied counts.
    if (count > maximum) { chosen = ending; maximum = count; }
  }
  return chosen;
}

/**
 * Apply one textarea change without rewriting untouched source line endings.
 *
 * Find the smallest contiguous replacement in DOM-normalized text, map both
 * boundaries back to the original UTF-16 string offsets, and splice only that
 * range. Newly inserted newlines follow the original document's dominant style.
 * Existing CRLF, LF, CR, BOM and final-newline choices outside the edit survive.
 */
export function applySourceEdit(original: string, normalizedNext: string): string {
  const previous = normalize(original);
  const next = normalize(normalizedNext);
  if (previous === next) return original;

  let prefix = 0;
  const shorter = Math.min(previous.length, next.length);
  while (prefix < shorter && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;

  let suffix = 0;
  while (
    suffix < previous.length - prefix && suffix < next.length - prefix &&
    previous.charCodeAt(previous.length - suffix - 1) === next.charCodeAt(next.length - suffix - 1)
  ) suffix++;

  const normalizedEnd = previous.length - suffix;
  let originalStart = 0;
  let originalEnd = original.length;
  let sourceOffset = 0;
  let domOffset = 0;
  while (sourceOffset <= original.length) {
    if (domOffset === prefix) originalStart = sourceOffset;
    if (domOffset === normalizedEnd) { originalEnd = sourceOffset; break; }
    sourceOffset += original[sourceOffset] === '\r' && original[sourceOffset + 1] === '\n' ? 2 : 1;
    domOffset++;
  }

  const replacement = next.slice(prefix, next.length - suffix).replace(/\n/g, preferredLineEnding(original));
  return original.slice(0, originalStart) + replacement + original.slice(originalEnd);
}
