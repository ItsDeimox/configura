import { describe, expect, it } from 'vitest';
import { applySourceEdit } from '../src/core/textEdits';

const normalize = (text: string) => text.replace(/\r\n|\r/g, '\n');

describe('textarea edits preserve original source line endings', () => {
  it('returns the exact original for an unchanged DOM value', () => {
    const original = '\uFEFF; comment\r\n[A]\r\nx=1\ny=2\rlast';
    expect(applySourceEdit(original, normalize(original))).toBe(original);
  });

  it('updates a Windows value while preserving all original CRLFs and final newline', () => {
    const original = '; comment\r\n[Users]\r\n  FOV = 65 ; note\r\nName=Deimox\r\n';
    expect(applySourceEdit(original, normalize(original).replace('65', '75'))).toBe(original.replace('65', '75'));
  });

  it('preserves untouched mixed CRLF, LF and CR sequences', () => {
    const original = 'a=1\r\nb=2\nc=3\rd=4';
    expect(applySourceEdit(original, 'a=1\nb=20\nc=3\nd=4')).toBe('a=1\r\nb=20\nc=3\rd=4');
  });

  it('maps insertion at either side of a CRLF to the correct source offset', () => {
    expect(applySourceEdit('a\r\nb', 'a!\nb')).toBe('a!\r\nb');
    expect(applySourceEdit('a\r\nb', 'a\n!b')).toBe('a\r\n!b');
    expect(applySourceEdit('a\r\nb', 'a\n  b')).toBe('a\r\n  b');
  });

  it('deletes complete normalized line endings without leaving stray CRs', () => {
    expect(applySourceEdit('a\r\nb\r\n', 'ab\n')).toBe('ab\r\n');
    expect(applySourceEdit('a\r\nb\r\n', 'a\nb')).toBe('a\r\nb');
    expect(applySourceEdit('a\rb\r', 'ab\n')).toBe('ab\r');
  });

  it('uses the dominant EOL for new lines, with first appearance breaking ties', () => {
    expect(applySourceEdit('a\r\nb\nc\r\n', 'a\nnew\nb\nc\n')).toBe('a\r\nnew\r\nb\nc\r\n');
    expect(applySourceEdit('a\rb\nc', 'a\nb\nc\nnew')).toBe('a\rb\nc\rnew');
    expect(applySourceEdit('a\nb\r\nc', 'a\nb\nc\nnew')).toBe('a\nb\r\nc\nnew');
  });

  it('preserves BOM and absence of a trailing newline while changing the first or last value', () => {
    const original = '\uFEFFa=1\r\nb=2';
    expect(applySourceEdit(original, '\uFEFFa=3\nb=2')).toBe('\uFEFFa=3\r\nb=2');
    expect(applySourceEdit(original, '\uFEFFa=1\nb=4')).toBe('\uFEFFa=1\r\nb=4');
  });

  it('supports empty documents, complete deletion and complete replacement', () => {
    expect(applySourceEdit('', 'a\nb')).toBe('a\nb');
    expect(applySourceEdit('a\r\nb\r\n', '')).toBe('');
    expect(applySourceEdit('a\r\nb\r\n', 'x\ny')).toBe('x\r\ny');
    expect(applySourceEdit('', '')).toBe('');
  });

  it('handles Unicode and code-unit textarea offsets without corrupting surrogate pairs', () => {
    const original = 'título=á\r\nemoji=🚀\r\nfim=好';
    expect(applySourceEdit(original, 'título=á\nemoji=🚁\nfim=好')).toBe('título=á\r\nemoji=🚁\r\nfim=好');
    expect(applySourceEdit(original, 'título=ação\nemoji=🚀\nfim=好')).toBe('título=ação\r\nemoji=🚀\r\nfim=好');
  });

  it('normalizes pasted line endings only within the replacement', () => {
    expect(applySourceEdit('a\r\nb', 'a\r\npasted\rb')).toBe('a\r\npasted\r\nb');
  });

  it('reconstructs the requested DOM text across deterministic edit positions and ranges', () => {
    const originals = ['', '\r\n', 'a\r\nb\nc\rfinal', '\uFEFFα\r\n🚀\r\n'];
    const insertions = ['', 'x', '\n', 'two\nlines', '界🚀'];
    for (const original of originals) {
      const dom = normalize(original);
      for (let start = 0; start <= dom.length; start++) {
        for (const deleteCount of [0, 1, 3, dom.length]) {
          for (const inserted of insertions) {
            const next = dom.slice(0, start) + inserted + dom.slice(start + deleteCount);
            expect(normalize(applySourceEdit(original, next))).toBe(next);
          }
        }
      }
    }
  });
});
