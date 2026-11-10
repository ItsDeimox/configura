'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { FileStore, decodeBytes, encodeText, MAX_BYTES } = require('./file-store.cjs');

async function fixture(t, bytes, filename = 'GameData.ini') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'configura-file-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, filename);
  await fs.writeFile(filePath, bytes);
  return { directory, filePath, store: new FileStore() };
}
for (const encoding of ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE', 'Windows-1252']) {
  test(`preserves ${encoding} bytes and CRLF on an unchanged save, then backs up the original`, async (t) => {
    const text = '; Café e resolução\r\n[Video]\r\nname="João"\r\nFOV = 65 ; comment\r\n';
    const bytes = encodeText(text, encoding);
    const { filePath, store } = await fixture(t, bytes);
    const opened = await store.open(filePath);
    assert.equal(opened.encoding, encoding);
    assert.equal(opened.text, text);
    await store.save({ id: opened.id, text });
    assert.deepEqual(await fs.readFile(filePath), bytes);
    await assert.rejects(fs.access(`${filePath}.configura.bak`));
    const edited = text.replace('65', '75');
    const saved = await store.save({ id: opened.id, text: edited });
    assert.equal(saved.id, opened.id);
    assert.equal(saved.encoding, encoding);
    assert.deepEqual(await fs.readFile(filePath), encodeText(edited, encoding));
    assert.deepEqual(await fs.readFile(`${filePath}.configura.bak`), bytes);
  });
}

test('UTF-8 BOM is retained even if the text starts with another BOM character', () => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('\ufeffa=1\n')]);
  const decoded = decodeBytes(bytes);
  assert.equal(decoded.text, '\ufeffa=1\n');
  assert.deepEqual(encodeText(decoded.text, decoded.encoding), bytes);
});

test('rejects external modifications without touching disk, allows explicit replacement with backup', async (t) => {
  const { filePath, store } = await fixture(t, Buffer.from('a=1\n'));
  const opened = await store.open(filePath);
  await fs.writeFile(filePath, 'a=2\n');
  assert.equal(await store.conflict(opened.id), true);
  await assert.rejects(store.save({ id: opened.id, text: 'a=3\n' }), { code: 'CONFLICT' });
  assert.equal(await fs.readFile(filePath, 'utf8'), 'a=2\n');
  await store.save({ id: opened.id, text: 'a=3\n', force: true });
  assert.equal(await fs.readFile(filePath, 'utf8'), 'a=3\n');
  assert.equal(await fs.readFile(`${filePath}.configura.bak`, 'utf8'), 'a=2\n');
  assert.equal(await store.conflict(opened.id), false);
});

test('deleted external file requires explicit permission to recreate', async (t) => {
  const { filePath, store } = await fixture(t, Buffer.from('a=1\n'));
  const opened = await store.open(filePath);
  await fs.unlink(filePath);
  await assert.rejects(store.save({ id: opened.id, text: 'a=2\n' }), { code: 'CONFLICT' });
  await store.save({ id: opened.id, text: 'a=2\n', force: true });
  assert.equal(await fs.readFile(filePath, 'utf8'), 'a=2\n');
});

test('unsupported characters never silently turn into question marks in legacy files', async (t) => {
  const original = encodeText('nome=João\n', 'Windows-1252');
  const { filePath, directory, store } = await fixture(t, original);
  const opened = await store.open(filePath);
  await assert.rejects(store.save({ id: opened.id, text: 'nome=星\n' }), { code: 'UNREPRESENTABLE' });
  assert.deepEqual(await fs.readFile(filePath), original);
  assert.deepEqual(await fs.readdir(directory), ['GameData.ini']);
  const saved = await store.save({ id: opened.id, text: 'nome=星\n', targetPath: path.join(directory, 'new.ini'), utf8: true });
  assert.equal(saved.encoding, 'UTF-8');
  assert.equal(await fs.readFile(saved.path, 'utf8'), 'nome=星\n');
  assert.deepEqual(await fs.readFile(filePath), original);
});

test('Save As retains document identity and releases the old path', async (t) => {
  const { filePath, directory, store } = await fixture(t, Buffer.from('x=1\n'));
  const opened = await store.open(filePath);
  const saved = await store.save({ id: opened.id, text: 'x=2\n', targetPath: path.join(directory, 'copy.cfg') });
  assert.equal(saved.id, opened.id);
  assert.equal(saved.name, 'copy.cfg');
  const reopenedOriginal = await store.open(filePath);
  assert.notEqual(reopenedOriginal.id, saved.id);
  assert.equal(reopenedOriginal.text, 'x=1\n');
});

test('opening an existing path returns the same document, and close releases it', async (t) => {
  const { filePath, store } = await fixture(t, Buffer.from('x=1\n'));
  const first = await store.open(filePath);
  assert.deepEqual(await store.open(filePath), first);
  store.close(first.id);
  assert.notEqual((await store.open(filePath)).id, first.id);
  await assert.rejects(store.save({ id: first.id, text: 'x=2\n' }), { code: 'NOT_OPEN' });
});

test('Save As refuses to overwrite another open document', async (t) => {
  const { filePath, directory, store } = await fixture(t, Buffer.from('x=1\n'));
  const otherPath = path.join(directory, 'other.ini');
  await fs.writeFile(otherPath, 'x=8\n');
  const first = await store.open(filePath);
  await store.open(otherPath);
  await assert.rejects(store.save({ id: first.id, text: 'x=2\n', targetPath: otherPath }), { code: 'ALREADY_OPEN' });
  assert.equal(await fs.readFile(otherPath, 'utf8'), 'x=8\n');
});

test('symlink open/edit preserves the link and saves its actual target', { skip: process.platform === 'win32' }, async (t) => {
  const { filePath, directory, store } = await fixture(t, Buffer.from('x=1\n'));
  const linkPath = path.join(directory, 'link.cfg');
  await fs.symlink(filePath, linkPath);
  const opened = await store.open(linkPath);
  await store.save({ id: opened.id, text: 'x=2\n' });
  assert.equal((await fs.lstat(linkPath)).isSymbolicLink(), true);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'x=2\n');
});

test('can disable backups while retaining the same safe write path', async (t) => {
  const { filePath, store } = await fixture(t, Buffer.from('x=1'));
  const opened = await store.open(filePath);
  await store.save({ id: opened.id, text: 'x=2', backup: false });
  assert.equal(await fs.readFile(filePath, 'utf8'), 'x=2');
  await assert.rejects(fs.access(`${filePath}.configura.bak`));
});

test('rejects binary files, invalid UTF-8 BOM and truncated UTF-16', () => {
  assert.throws(() => decodeBytes(Buffer.from([0, 1, 2, 3])), { code: 'BINARY' });
  assert.throws(() => decodeBytes(Buffer.from([0xef, 0xbb, 0xbf, 0xff])), { code: 'ENCODING' });
  assert.throws(() => decodeBytes(Buffer.from([0xff, 0xfe, 0x41])), { code: 'ENCODING' });
  assert.throws(() => encodeText('\ud800', 'UTF-8'), { code: 'ENCODING' });
});

test('refuses directories, relative paths and files above the cap', async (t) => {
  const { filePath, directory, store } = await fixture(t, Buffer.from('x=1'));
  await assert.rejects(store.open(directory), { code: 'NOT_FILE' });
  await assert.rejects(store.open('file.ini'), { code: 'PATH' });
  const handle = await fs.open(filePath, 'w');
  await handle.truncate(MAX_BYTES + 1); await handle.close();
  await assert.rejects(store.open(filePath), { code: 'TOO_LARGE' });
});
