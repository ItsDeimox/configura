'use strict';

// Lossless byte handling lives outside Electron so it can be tested against real files.
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const iconv = require('iconv-lite');

const MAX_BYTES = 10 * 1024 * 1024;
class FileStoreError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const keyFor = (p) => process.platform === 'win32' ? p.toLowerCase() : p;

function decodeBytes(bytes) {
  let encoding = 'UTF-8';
  let text;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    encoding = 'UTF-8 BOM';
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(3)); }
    catch { throw new FileStoreError('ENCODING', 'O arquivo contém uma sequência UTF-8 inválida.'); }
  } else if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    encoding = 'UTF-16 LE';
    if (bytes.length % 2) throw new FileStoreError('ENCODING', 'O arquivo UTF-16 está incompleto.');
    text = iconv.decode(bytes.subarray(2), 'utf16-le', { stripBOM: false });
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    encoding = 'UTF-16 BE';
    if (bytes.length % 2) throw new FileStoreError('ENCODING', 'O arquivo UTF-16 está incompleto.');
    text = iconv.decode(bytes.subarray(2), 'utf16-be', { stripBOM: false });
  } else {
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { encoding = 'Windows-1252'; text = iconv.decode(bytes, 'windows1252'); }
  }
  // Configuration files are text; refuse binary blobs instead of rewriting them as text.
  if (/[\x00-\x08\x0b\x0e-\x1f]/.test(text)) {
    throw new FileStoreError('BINARY', 'Este arquivo parece binário. Abra um arquivo de configuração em texto.');
  }
  if (!encodeText(text, encoding).equals(bytes)) {
    throw new FileStoreError('ENCODING', 'A codificação deste arquivo não pode ser preservada com segurança.');
  }
  return { text, encoding };
}

function encodeText(text, encoding) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) {
    throw new FileStoreError('TOO_LARGE', 'O conteúdo excede o limite de 10 MB.');
  }
  let bytes;
  if (encoding === 'UTF-16 LE') bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf16-le')]);
  else if (encoding === 'UTF-16 BE') bytes = Buffer.concat([Buffer.from([0xfe, 0xff]), iconv.encode(text, 'utf16-be')]);
  else if (encoding === 'Windows-1252') {
    bytes = iconv.encode(text, 'windows1252');
    if (iconv.decode(bytes, 'windows1252') !== text) {
      throw new FileStoreError('UNREPRESENTABLE', 'Este texto contém caracteres que não existem em Windows-1252. Use Salvar como para criar uma cópia UTF-8.');
    }
  } else {
    bytes = Buffer.from(text, 'utf8');
    if (bytes.toString('utf8') !== text) throw new FileStoreError('ENCODING', 'O texto contém um caractere Unicode incompleto.');
    if (encoding === 'UTF-8 BOM') bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]);
  }
  if (bytes.length > MAX_BYTES) throw new FileStoreError('TOO_LARGE', 'O conteúdo excede o limite de 10 MB.');
  return bytes;
}

async function readRegular(filePath) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new FileStoreError('NOT_FILE', 'Selecione um arquivo, não uma pasta.');
  if (stat.size > MAX_BYTES) throw new FileStoreError('TOO_LARGE', 'Este arquivo excede o limite de 10 MB.');
  const bytes = await fs.readFile(filePath);
  if (bytes.length > MAX_BYTES) throw new FileStoreError('TOO_LARGE', 'Este arquivo excede o limite de 10 MB.');
  return { bytes, stat };
}

async function atomicWrite(filePath, bytes, mode) {
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.configura-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temporary, 'wx', mode ?? 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filePath);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }
}

class FileStore {
  constructor() { this.documents = new Map(); this.paths = new Map(); this.pending = new Set(); }
  public(record) { return { id: record.id, name: path.basename(record.path), path: record.path, text: record.text, encoding: record.encoding }; }
  get(id) { return this.documents.get(id); }
  async open(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || filePath.includes('\0')) {
      throw new FileStoreError('PATH', 'Caminho de arquivo inválido.');
    }
    const actualPath = await fs.realpath(filePath);
    const existingId = this.paths.get(keyFor(actualPath));
    if (existingId) return this.public(this.documents.get(existingId));
    const { bytes, stat } = await readRegular(actualPath);
    const { text, encoding } = decodeBytes(bytes);
    const record = { id: crypto.randomUUID(), path: actualPath, text, encoding, fingerprint: digest(bytes), mode: stat.mode };
    this.documents.set(record.id, record);
    this.paths.set(keyFor(actualPath), record.id);
    return this.public(record);
  }
  close(id) {
    const record = this.documents.get(id);
    if (!record) return;
    this.paths.delete(keyFor(record.path));
    this.documents.delete(id);
  }
  async conflict(id) {
    const record = this.documents.get(id);
    if (!record) throw new FileStoreError('NOT_OPEN', 'O arquivo não está aberto.');
    try { return digest((await readRegular(record.path)).bytes) !== record.fingerprint; }
    catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }
  async save({ id, text, targetPath, backup = true, force = false, utf8 = false }) {
    const original = id ? this.documents.get(id) : undefined;
    if (id && !original) throw new FileStoreError('NOT_OPEN', 'O arquivo não está aberto.');
    if (!targetPath && !original) throw new FileStoreError('PATH', 'Escolha onde salvar este arquivo.');
    let savePath = targetPath ?? original.path;
    if (!path.isAbsolute(savePath) || savePath.includes('\0')) throw new FileStoreError('PATH', 'Caminho de arquivo inválido.');
    savePath = path.resolve(savePath);
    try { savePath = await fs.realpath(savePath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const pathKey = keyFor(savePath);
    const alreadyOpenId = this.paths.get(pathKey);
    if (alreadyOpenId && alreadyOpenId !== id) {
      throw new FileStoreError('ALREADY_OPEN', 'Este destino já está aberto em outra aba. Salve pela aba correspondente.');
    }
    if (this.pending.has(pathKey)) throw new FileStoreError('BUSY', 'Este arquivo já está sendo salvo.');
    this.pending.add(pathKey);
    try {
      const samePath = original && keyFor(original.path) === pathKey;
      const encoding = utf8 ? 'UTF-8' : original?.encoding ?? 'UTF-8';
      const bytes = encodeText(text, encoding);
      let disk;
      try { disk = await readRegular(savePath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (samePath && !force && (!disk || digest(disk.bytes) !== original.fingerprint)) {
        throw new FileStoreError('CONFLICT', 'O arquivo foi alterado por outro programa.');
      }
      if (disk && disk.bytes.equals(bytes)) {
        const record = { id: id ?? crypto.randomUUID(), path: savePath, text, encoding, fingerprint: digest(bytes), mode: disk.stat.mode };
        if (original) this.paths.delete(keyFor(original.path));
        this.documents.set(record.id, record); this.paths.set(pathKey, record.id);
        return this.public(record);
      }
      const tempPath = path.join(path.dirname(savePath), `.${path.basename(savePath)}.configura-${crypto.randomUUID()}.tmp`);
      let handle;
      try {
        handle = await fs.open(tempPath, 'wx', disk?.stat.mode ?? original?.mode ?? 0o600);
        await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = undefined;
        // Check immediately before committing. Never delete the original to make rename succeed.
        if (disk) {
          const latest = await readRegular(savePath).catch((error) => {
            if (error.code === 'ENOENT') throw new FileStoreError('CONFLICT', 'O arquivo foi removido enquanto estava sendo salvo.');
            throw error;
          });
          if (digest(latest.bytes) !== digest(disk.bytes)) throw new FileStoreError('CONFLICT', 'O arquivo mudou enquanto estava sendo salvo. Tente novamente.');
          if (backup) await atomicWrite(`${savePath}.configura.bak`, disk.bytes, disk.stat.mode);
        }
        await fs.rename(tempPath, savePath);
      } catch (error) {
        if (handle) await handle.close().catch(() => {});
        await fs.unlink(tempPath).catch(() => {});
        throw error;
      }
      const record = { id: id ?? crypto.randomUUID(), path: savePath, text, encoding, fingerprint: digest(bytes), mode: disk?.stat.mode ?? original?.mode ?? 0o600 };
      if (original) this.paths.delete(keyFor(original.path));
      this.documents.set(record.id, record); this.paths.set(pathKey, record.id);
      return this.public(record);
    } finally { this.pending.delete(pathKey); }
  }
}
module.exports = { FileStore, FileStoreError, decodeBytes, encodeText, atomicWrite, MAX_BYTES };
