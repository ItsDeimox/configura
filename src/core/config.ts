/**
 * Conservative, lossless editor for INI-style key/value configuration files.
 *
 * The source text is the document. Parsing never serializes or normalizes it:
 * edits splice a single value token into its original line. Unknown syntax is
 * deliberately left to the source editor instead of being guessed away.
 */
export type ValueKind = 'string' | 'boolean' | 'number' | 'enum';

export interface ConfigEntry {
  id: string;
  key: string;
  /** Original token, including surrounding quotes when present. */
  value: string;
  lineIndex: number;
  kind: ValueKind;
  booleanStyle?: string;
}

export interface ConfigSection {
  id: string;
  name: string;
  entries: ConfigEntry[];
  lineIndex: number;
}

export interface ConfigDocument {
  sections: ConfigSection[];
  lineEnding: string;
  warnings: string[];
  unparsedLines: number;
}

interface SourceLine {
  text: string;
  ending: string;
  offset: number;
}

interface EntryLocation {
  entry: ConfigEntry;
  sectionId: string;
  valueStart: number;
  valueEnd: number;
  emptyBeforeComment: boolean;
  indentation: string;
  exportPrefix: string;
  separator: string;
}

interface ScanState {
  quote: string | null;
  brackets: string[];
  scanBrackets: boolean;
}

interface ScanResult extends ScanState {
  commentAt: number;
}

interface ParsedSource {
  document: ConfigDocument;
  lines: SourceLine[];
  locations: Map<string, EntryLocation>;
  allSections: ConfigSection[];
  unfinishedValue: boolean;
}

const BOOLEAN_PAIRS = [
  ['true', 'false'],
  ['yes', 'no'],
  ['on', 'off'],
] as const;

function booleanPair(value: string): readonly [string, string] | undefined {
  const lower = value.toLowerCase();
  return BOOLEAN_PAIRS.find(([yes, no]) => lower === yes || lower === no);
}

/** Avoid inferring identifiers, large integers or padded numbers as numbers. */
export function inferKind(value: string): ValueKind {
  if (booleanPair(value)) return 'boolean';
  if (!/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return 'string';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'string';
  if (!/[.eE]/.test(value) && !Number.isSafeInteger(numeric)) return 'string';
  const significant = value.split(/[eE]/)[0].replace(/^[+-]/, '').replace('.', '').replace(/^0+/, '');
  if (significant.length > 15) return 'string';
  return 'number';
}

/** Preserve the file's boolean vocabulary and capitalization. */
export function toggleBoolean(value: string): string {
  if (value === '0') return '1';
  if (value === '1') return '0';
  const pair = booleanPair(value);
  if (!pair) throw new Error('Este valor não é um booleano reconhecido.');
  const replacement = value.toLowerCase() === pair[0] ? pair[1] : pair[0];
  if (value === value.toUpperCase()) return replacement.toUpperCase();
  if (value === value.toLowerCase()) return replacement;
  if (value[0] === value[0].toUpperCase() && value.slice(1) === value.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return [...replacement].map((char, i) => {
    const original = value[Math.min(i, value.length - 1)];
    return original === original.toUpperCase() ? char.toUpperCase() : char;
  }).join('');
}

function splitSource(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const pattern = /\r\n|\r|\n/g;
  let start = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    lines.push({ text: text.slice(start, match.index), ending: match[0], offset: start });
    start = match.index + match[0].length;
  }
  if (start < text.length) lines.push({ text: text.slice(start), ending: '', offset: start });
  return lines;
}

function preferredEnding(lines: SourceLine[]): string {
  const counts = new Map<string, number>();
  for (const line of lines) {
    if (line.ending) counts.set(line.ending, (counts.get(line.ending) ?? 0) + 1);
  }
  let result = '\n';
  let count = 0;
  for (const [ending, occurrences] of counts) {
    if (occurrences > count) { result = ending; count = occurrences; }
  }
  return result;
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === '\\'; i--) slashes++;
  return slashes % 2 === 1;
}

function isTrivia(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === '' || /^(?:[;#!]|\/\/)/.test(trimmed);
}

function scanValue(value: string, previous?: ScanState): ScanResult {
  const first = value.search(/\S/);
  let quote = previous?.quote ?? null;
  const brackets = [...(previous?.brackets ?? [])];
  const scanBrackets = previous?.scanBrackets ?? (first >= 0 && /[\[{]/.test(value[first]));
  let commentAt = -1;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (quote) {
      if (value.startsWith(quote, i) && !isEscaped(value, i)) {
        i += quote.length - 1;
        quote = null;
      }
      continue;
    }

    if ((char === ';' || char === '#') && !isEscaped(value, i) && (i === first || /\s/.test(value[i - 1] ?? ''))) {
      commentAt = i;
      break;
    }

    const mayOpenQuote = i === first || /[\s=:[{,(]/.test(value[i - 1] ?? '');
    if ((char === '"' || char === "'") && mayOpenQuote && !isEscaped(value, i)) {
      const triple = char.repeat(3);
      quote = value.startsWith(triple, i) ? triple : char;
      i += quote.length - 1;
      continue;
    }

    if (scanBrackets && !isEscaped(value, i)) {
      if (char === '[' || char === '{') brackets.push(char);
      if ((char === ']' && brackets.at(-1) === '[') || (char === '}' && brackets.at(-1) === '{')) brackets.pop();
    }
  }
  return { quote, brackets, scanBrackets, commentAt };
}

function hasContinuation(value: string): boolean {
  const trimmed = value.replace(/[ \t]+$/, '');
  return trimmed.endsWith('\\') && !isEscaped(trimmed, trimmed.length - 1);
}

function findDelimiter(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if ((line[i] === '=' || line[i] === ':') && !isEscaped(line, i)) return i;
  }
  return -1;
}

function validKey(key: string): boolean {
  return key.length > 0 && !/^[;#!]|^\/\//.test(key) && !/[\x00-\x1f\x7f\[\]{}"']/.test(key);
}

function parseSource(text: string): ParsedSource {
  const lines = splitSource(text);
  const globalSection: ConfigSection = { id: 'section:global', name: 'Geral', entries: [], lineIndex: -1 };
  const allSections = [globalSection];
  const locations = new Map<string, EntryLocation>();
  const warnings: string[] = [];
  let section = globalSection;
  let unparsedLines = 0;
  let multiline: ScanState | null = null;
  let continued = false;
  let unknownSyntax = 0;

  if (text.includes('\0')) {
    return {
      lines, locations, allSections, unfinishedValue: false,
      document: { sections: [], lineEnding: preferredEnding(lines), warnings: ['O arquivo contém caracteres nulos; utilize o editor de código para inspecioná-lo.'], unparsedLines: lines.length },
    };
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const sourceLine = lines[lineIndex];
    const bomLength = lineIndex === 0 && sourceLine.text.startsWith('\uFEFF') ? 1 : 0;
    const line = sourceLine.text.slice(bomLength);

    if (multiline || continued) {
      if (line.trim()) unparsedLines++;
      const scan = scanValue(line, multiline ?? undefined);
      const body = scan.commentAt < 0 ? line : line.slice(0, scan.commentAt);
      multiline = scan.quote || scan.brackets.length ? scan : null;
      continued = hasContinuation(body);
      continue;
    }

    if (isTrivia(line)) continue;
    const sectionMatch = /^\s*\[([^\]\r\n]+)\]\s*(?:[;#].*)?$/.exec(line);
    if (sectionMatch?.[1].trim()) {
      section = {
        id: `section:${lineIndex}`,
        name: sectionMatch[1].trim(),
        entries: [],
        lineIndex,
      };
      allSections.push(section);
      continue;
    }

    const delimiter = findDelimiter(line);
    const rawKey = delimiter >= 0 ? line.slice(0, delimiter) : '';
    const trimmedKey = rawKey.trim();
    const exportPrefix = /^export[ \t]+/.exec(trimmedKey)?.[0] ?? '';
    const key = trimmedKey.slice(exportPrefix.length).trim();
    const looksLikeBarePath = delimiter >= 0 && line[delimiter] === ':' && /^[\\/]/.test(line[delimiter + 1] ?? '');
    if (delimiter < 0 || !validKey(key) || looksLikeBarePath) {
      unparsedLines++;
      unknownSyntax++;
      continue;
    }

    const remainder = line.slice(delimiter + 1);
    const scan = scanValue(remainder);
    const body = scan.commentAt < 0 ? remainder : remainder.slice(0, scan.commentAt);
    if (scan.quote || scan.brackets.length || hasContinuation(body)) {
      unparsedLines++;
      warnings.push(`Linha ${lineIndex + 1}: valor com continuação ou várias linhas; edite este trecho no modo código.`);
      multiline = scan.quote || scan.brackets.length ? scan : null;
      continued = hasContinuation(body);
      continue;
    }

    const leadingSpace = /^[ \t]*/.exec(body)?.[0] ?? '';
    const value = body.replace(/^[ \t]+|[ \t]+$/g, '');
    const valueStart = bomLength + delimiter + 1 + leadingSpace.length;
    const kind = inferKind(value);
    const pair = booleanPair(value);
    const entry: ConfigEntry = {
      id: `entry:${lineIndex}`, key, value, lineIndex, kind,
      ...(pair ? { booleanStyle: `${pair[0]}/${pair[1]}` } : {}),
    };
    section.entries.push(entry);
    locations.set(entry.id, {
      entry,
      sectionId: section.id,
      valueStart,
      valueEnd: valueStart + value.length,
      emptyBeforeComment: value === '' && scan.commentAt >= 0,
      indentation: /^[ \t]*/.exec(line)?.[0] ?? '',
      exportPrefix,
      separator: (/[ \t]*$/.exec(rawKey)?.[0] ?? '') + line[delimiter] + leadingSpace,
    });
  }

  if (unknownSyntax > 0) {
    warnings.push(`${unknownSyntax} ${unknownSyntax === 1 ? 'linha usa' : 'linhas usam'} outra sintaxe e ${unknownSyntax === 1 ? 'foi preservada' : 'foram preservadas'} no modo código.`);
  }
  if (multiline || continued) warnings.push('Há uma continuação ou um valor sem fechamento no final do arquivo. O conteúdo original foi preservado.');
  const sections = globalSection.entries.length || allSections.length === 1 ? allSections : allSections.slice(1);
  return { lines, locations, allSections, unfinishedValue: Boolean(multiline || continued), document: { sections, lineEnding: preferredEnding(lines), warnings, unparsedLines } };
}

export function parseConfig(text: string): ConfigDocument {
  return parseSource(text).document;
}

function validateValue(value: string): void {
  if (/[\r\n\0]/.test(value)) throw new Error('Use o modo código para editar valores com várias linhas.');
  if (/^[ \t]|[ \t]$/.test(value)) throw new Error('Coloque o valor entre aspas para preservar espaços no início ou no final.');
  const scan = scanValue(value);
  if (scan.commentAt >= 0) throw new Error('Coloque o valor entre aspas para incluir # ou ; após um espaço.');
  if (scan.quote || scan.brackets.length || hasContinuation(value)) {
    throw new Error('Feche as aspas ou use o modo código para editar este valor.');
  }
}

/** Replace just this value; do not serialize the rest of the configuration. */
export function setEntryValue(text: string, entryId: string, value: string): string {
  const source = parseSource(text);
  const location = source.locations.get(entryId);
  if (!location) throw new Error('Esta propriedade não existe mais. Reabra a seção e tente novamente.');
  if (location.entry.value === value) return text;
  validateValue(value);
  const line = source.lines[location.entry.lineIndex];
  const start = line.offset + location.valueStart;
  const end = line.offset + location.valueEnd;
  // An empty value directly before a comment needs a separator when populated.
  const commentSeparator = location.emptyBeforeComment && value ? ' ' : '';
  return text.slice(0, start) + value + commentSeparator + text.slice(end);
}

function validateNewKey(key: string): void {
  if (key !== key.trim() || !validKey(key) || /[=:]/.test(key)) {
    throw new Error('Use um nome de propriedade sem quebras de linha, colchetes, aspas, = ou :.');
  }
}

function insertLine(text: string, lines: SourceLine[], index: number, value: string, ending: string): string {
  if (index < lines.length) {
    const offset = lines[index].offset;
    return text.slice(0, offset) + value + ending + text.slice(offset);
  }
  const last = lines.at(-1);
  const separator = last && !last.ending ? ending : '';
  const terminal = last?.ending ? ending : '';
  return text + separator + value + terminal;
}

/** Add a field within the selected section, keeping existing source untouched. */
export function addEntry(text: string, sectionId: string, key: string, value: string): string {
  validateNewKey(key);
  validateValue(value);
  const source = parseSource(text);
  const sectionIndex = source.allSections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) throw new Error('Esta seção não existe mais.');
  const section = source.allSections[sectionIndex];
  let insertion = source.allSections[sectionIndex + 1]?.lineIndex ?? source.lines.length;
  while (insertion > section.lineIndex + 1 && source.lines[insertion - 1].text.trim() === '') insertion--;
  const template = [...source.locations.values()].find((location) => location.sectionId === sectionId);
  const content = template
    ? `${template.indentation}${template.exportPrefix}${key}${template.separator}${value}`
    : `${key} = ${value}`;
  // A UTF-8 BOM remains the first character even when adding a global field.
  const result = insertion === 0 && text.startsWith('\uFEFF')
    ? '\uFEFF' + content + (text.length > 1 ? source.document.lineEnding + text.slice(1) : '')
    : insertLine(text, source.lines, insertion, content, source.document.lineEnding);
  const inserted = parseSource(result).locations.get(`entry:${insertion}`)?.entry;
  if (!inserted || inserted.key !== key || inserted.value !== value) {
    throw new Error('Esta posição está dentro de um valor com continuação. Finalize o valor no modo código antes de adicionar uma propriedade.');
  }
  return result;
}

export function removeEntry(text: string, entryId: string): string {
  const source = parseSource(text);
  const location = source.locations.get(entryId);
  if (!location) throw new Error('Esta propriedade não existe mais.');
  const index = location.entry.lineIndex;
  const line = source.lines[index];
  let start = line.offset;
  let end = start + line.text.length + line.ending.length;
  // If the original last line had no newline, do not create one by deleting it.
  if (index === source.lines.length - 1 && !line.ending && index > 0) start -= source.lines[index - 1].ending.length;
  const bom = index === 0 && line.text.startsWith('\uFEFF') ? '\uFEFF' : '';
  return bom + text.slice(0, start) + text.slice(end);
}

export function addSection(text: string, name: string): string {
  if (!name || name !== name.trim() || /[\r\n\0\[\]]/.test(name)) {
    throw new Error('Use um nome de seção sem colchetes ou quebras de linha.');
  }
  const source = parseSource(text);
  if (source.unfinishedValue) throw new Error('Finalize o valor com continuação no modo código antes de adicionar uma seção.');
  const lines = source.lines;
  const ending = preferredEnding(lines);
  const last = lines.at(-1);
  const hasFinalNewline = Boolean(last?.ending);
  const body = text.replace(/^\uFEFF/, '');
  if (!body) return text + `[${name}]`;
  let spacer = last?.ending ? '' : ending;
  if (last?.text.trim()) spacer += ending;
  return text + spacer + `[${name}]` + (hasFinalNewline ? ending : '');
}
