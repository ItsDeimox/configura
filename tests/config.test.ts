import { describe, expect, it } from 'vitest';
import { addEntry, addSection, inferKind, parseConfig, removeEntry, setEntryValue, toggleBoolean } from '../src/core/config';

const firstEntry = (text: string) => parseConfig(text).sections.flatMap((section) => section.entries)[0];

describe('lossless configuration editing', () => {
  it('keeps BOM, CRLF, comments, spacing, duplicate keys and unknown syntax byte-for-byte', () => {
    const source = '\uFEFF; comentário\r\n[Users]  ; keep this\r\n  FOV  =  65   # field note\r\nFOV=90\r\nbind "W" "+forward"\r\n[Users]\r\nName="Deimox #1"\r\n';
    const doc = parseConfig(source);
    expect(doc.lineEnding).toBe('\r\n');
    expect(doc.sections.map((section) => section.name)).toEqual(['Users', 'Users']);
    expect(doc.sections[0].entries.map((entry) => entry.key)).toEqual(['FOV', 'FOV']);
    expect(doc.unparsedLines).toBe(1);
    expect(setEntryValue(source, 'entry:2', '65')).toBe(source);
    expect(setEntryValue(source, 'entry:2', '75')).toBe(source.replace('  65   #', '  75   #'));
    expect(setEntryValue(source, 'entry:3', '91')).toBe(source.replace('FOV=90', 'FOV=91'));
  });

  it('preserves URLs, passwords, apostrophes and literal comment characters', () => {
    const source = "url=https://host/path#fragment\npassword=p@ss;#word=part\nname=Bob's game\nquoted=\"value ; # still text\" # actual comment\nsingle='a # b; c' ; note\n";
    const entries = parseConfig(source).sections[0].entries;
    expect(entries.map((entry) => entry.value)).toEqual([
      'https://host/path#fragment', 'p@ss;#word=part', "Bob's game", '"value ; # still text"', "'a # b; c'",
    ]);
    expect(setEntryValue(source, 'entry:3', '"new # literal"')).toContain('quoted="new # literal" # actual comment');
  });

  it('understands escaped quotes and escaped delimiters without unescaping them', () => {
    const source = 'message = "a \\"quote\\";#b" ; comment\nescaped\\:key: value\ntoken=a \\# literal\n';
    const entries = parseConfig(source).sections[0].entries;
    expect(entries).toHaveLength(3);
    expect(entries[0].value).toBe('"a \\"quote\\";#b"');
    expect(entries[1].key).toBe('escaped\\:key');
    expect(entries[2].value).toBe('a \\# literal');
  });

  it('supports colon-delimited properties and exported environment variables', () => {
    const source = '  export HOST = localhost\nport: 8080\n[Network]\nTLS=yes\n';
    const doc = parseConfig(source);
    expect(doc.sections[0].id).toBe('section:global');
    expect(doc.sections[0].entries.map((entry) => entry.key)).toEqual(['HOST', 'port']);
    expect(setEntryValue(source, 'entry:0', 'example.org')).toBe(source.replace('localhost', 'example.org'));
    expect(addEntry(source, 'section:global', 'TOKEN', 'abc')).toContain('  export TOKEN = abc\n[Network]');
  });

  it('never reparses multiline contents as independent editable properties', () => {
    const source = 'message="first line\nlooks=like a key\nlast line"\narray=[\n  inner=preserved\n]\nnormal=true\n';
    const doc = parseConfig(source);
    expect(doc.sections[0].entries.map((entry) => entry.key)).toEqual(['normal']);
    expect(doc.unparsedLines).toBe(6);
    expect(doc.warnings).toHaveLength(2);
    expect(setEntryValue(source, 'entry:6', 'false')).toBe(source.replace('normal=true', 'normal=false'));
  });

  it('preserves properties continuations and triple-quoted values as raw source', () => {
    const source = 'path=one\\\ncontinued=not another field\ntext="""hello\ninside=still text\nbye"""\nreal=2';
    const doc = parseConfig(source);
    expect(doc.sections[0].entries.map((entry) => entry.key)).toEqual(['real']);
    expect(doc.unparsedLines).toBe(5);
  });

  it('does not mistake bare paths, URLs, JSON or CFG commands for safe key-value rows', () => {
    const source = 'C:\\games\\config.ini\nhttps://example.org\n{"key": true}\nbind "W" "+forward"\nreal = value';
    const doc = parseConfig(source);
    expect(doc.sections[0].entries.map((entry) => entry.key)).toEqual(['real']);
    expect(doc.unparsedLines).toBe(4);
  });

  it('keeps comments attached to originally empty values after populating them', () => {
    const source = 'empty =   ; keep\nblank=\n';
    const edited = setEntryValue(source, 'entry:0', 'new');
    expect(edited).toBe('empty =   new ; keep\nblank=\n');
    expect(firstEntry(edited).value).toBe('new');
    expect(setEntryValue(source, 'entry:1', 'ok')).toBe('empty =   ; keep\nblank=ok\n');
  });

  it('rejects ambiguous visual edits, multiline injection and stale entry IDs', () => {
    expect(() => setEntryValue('key=value', 'entry:0', 'a\ninjected=true')).toThrow();
    expect(() => setEntryValue('key=value', 'entry:0', 'hello # world')).toThrow(/aspas/);
    expect(() => setEntryValue('key=value', 'entry:0', ' spaced ')).toThrow(/aspas/);
    expect(() => setEntryValue('key=value', 'entry:0', '"unclosed')).toThrow();
    expect(() => setEntryValue('key=value', 'entry:9', 'new')).toThrow();
    expect(setEntryValue('key=value', 'entry:0', '" spaced # value "')).toBe('key=" spaced # value "');
  });

  it('retains mixed existing line endings and the lack of a final newline', () => {
    const source = '[A]\r\nx=1\ny=2\r\nz=3';
    expect(setEntryValue(source, 'entry:2', '4')).toBe('[A]\r\nx=1\ny=4\r\nz=3');
    expect(removeEntry(source, 'entry:3')).toBe('[A]\r\nx=1\ny=2');
    expect(addEntry(source, 'section:0', 'q', '5')).toBe('[A]\r\nx=1\ny=2\r\nz=3\r\nq=5');
  });

  it('inserts into the requested duplicate section without changing the other one', () => {
    const source = '[A]\r\nx = 1\r\n\r\n[A]\r\nx = 2\r\n';
    expect(addEntry(source, 'section:0', 'new', 'true')).toBe('[A]\r\nx = 1\r\nnew = true\r\n\r\n[A]\r\nx = 2\r\n');
    expect(addEntry(source, 'section:3', 'new', 'false')).toBe('[A]\r\nx = 1\r\n\r\n[A]\r\nx = 2\r\nnew = false\r\n');
  });

  it('retains the BOM at the beginning when adding and removing global properties', () => {
    expect(addEntry('\uFEFF[A]\nx=1\n', 'section:global', 'global', 'yes')).toBe('\uFEFFglobal = yes\n[A]\nx=1\n');
    expect(removeEntry('\uFEFFglobal=yes\n[A]\nx=1\n', 'entry:0')).toBe('\uFEFF[A]\nx=1\n');
    expect(setEntryValue('\uFEFFx=1', 'entry:0', '2')).toBe('\uFEFFx=2');
    expect(addEntry('\uFEFF', 'section:global', 'global', 'yes')).toBe('\uFEFFglobal = yes');
  });

  it('preserves meaningful Unicode whitespace without shifting replacement offsets', () => {
    const source = 'label=\u00a0hello\u00a0 ; note\n';
    expect(firstEntry(source).value).toBe('\u00a0hello\u00a0');
    expect(setEntryValue(source, 'entry:0', 'new')).toBe('label=new ; note\n');
  });

  it('refuses to append structured content inside an unfinished multiline value', () => {
    const source = '[A]\ntext="first\nunfinished';
    expect(() => addEntry(source, 'section:0', 'new', 'value')).toThrow(/continuação/);
    expect(() => addSection(source, 'New')).toThrow(/continuação/);
    // An earlier, complete section remains safe to edit.
    expect(addEntry('[B]\nx=1\n' + source, 'section:0', 'y', '2')).toContain('[B]\nx=1\ny=2\n[A]');
  });

  it('creates sections and properties while respecting source newline conventions', () => {
    expect(addSection('', 'Users')).toBe('[Users]');
    expect(addSection('\uFEFF', 'Users')).toBe('\uFEFF[Users]');
    expect(addSection('x=1\r\n', 'Users')).toBe('x=1\r\n\r\n[Users]\r\n');
    expect(addSection('x=1', 'Users')).toBe('x=1\n\n[Users]');
    expect(addSection('x=1\n\n', 'Users')).toBe('x=1\n\n[Users]\n');
    expect(addEntry('', 'section:global', 'name', 'value')).toBe('name = value');
    expect(() => addSection('', 'bad]\n[key')).toThrow();
    expect(() => addEntry('', 'section:global', 'bad=key', 'value')).toThrow();
  });

  it('does not expose NUL-containing data as editable structured fields', () => {
    const doc = parseConfig('x=1\0\ny=2');
    expect(doc.sections).toEqual([]);
    expect(doc.warnings[0]).toMatch(/nulos/);
    expect(() => setEntryValue('x=1\0\ny=2', 'entry:1', '3')).toThrow();
  });
});

describe('conservative value kinds', () => {
  it.each(['true', 'FALSE', 'True', 'yes', 'NO', 'on', 'Off'])('detects %s as a boolean', (value) => {
    expect(inferKind(value)).toBe('boolean');
  });

  it.each(['0', '1', '-12', '+42', '65', '3.1415', '0.001', '1e3', '-2.5E-2'])('detects %s as a number', (value) => {
    expect(inferKind(value)).toBe('number');
  });

  it.each(['001', '000123', '1920x1080', '9007199254740993', '1e999', 'NaN', 'Infinity', '0x10', 'trueish', '"true"', "'65'", '1.1234567890123456789'])('preserves %s as a string', (value) => {
    expect(inferKind(value)).toBe('string');
  });

  it('toggles original boolean representations, including explicit numeric overrides', () => {
    expect(toggleBoolean('TRUE')).toBe('FALSE');
    expect(toggleBoolean('False')).toBe('True');
    expect(toggleBoolean('yes')).toBe('no');
    expect(toggleBoolean('OFF')).toBe('ON');
    expect(toggleBoolean('0')).toBe('1');
    expect(toggleBoolean('1')).toBe('0');
    expect(() => toggleBoolean('sometimes')).toThrow();
  });
});
