/**
 * Real-browser regression smoke tests for Configura.
 * Start `npm run dev`, then run `node scripts/qa-ui.mjs`.
 * CONFIGURA_QA_URL / CONFIGURA_CDP_URL / CHROMIUM_EXECUTABLE can target CI.
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const baseURL = process.env.CONFIGURA_QA_URL || 'http://127.0.0.1:5173';
const executablePath = process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
const fixture = '\uFEFF; keep this comment\r\n[Users]\r\nFOV = 65 ; degrees\r\nMotionBlur=TRUE\r\nName = Test\r\nGraphics=High\r\nCustom = alpha\r\n\r\n[Other]\r\nToken=p@ss;#word\r\nbind "W" "+forward"\r\n';
const normalize = value => value.replace(/\r\n|\r/g, '\n');
const report = { baseURL, cases: [], consoleErrors: [] };
let browser;
let server;

async function startServer() {
  if (process.env.CONFIGURA_QA_START_SERVER !== '1' && !process.argv.includes('--serve')) return;
  const url = new URL(baseURL);
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', url.hostname, '--port', url.port || '5173', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`Vite did not become ready: ${output}`)), 15000);
    const handle = data => {
      output += data.toString();
      if (/Local:|Network:/.test(output)) { clearTimeout(timeout); resolve(); }
    };
    server.stdout.on('data', handle); server.stderr.on('data', handle);
    server.on('error', error => { clearTimeout(timeout); reject(error); });
    server.on('exit', code => { clearTimeout(timeout); reject(new Error(`Vite exited ${code}: ${output}`)); });
  });
}

async function downloadText(page, trigger = () => page.getByRole('button', { name: 'save', exact: true }).click()) {
  const promise = page.waitForEvent('download');
  await trigger();
  const download = await promise;
  const path = await download.path();
  assert.ok(path, 'Download must expose its actual file');
  return readFile(path, 'utf8');
}

async function upload(page, text = fixture, name = 'qa-config.ini') {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') });
  await page.getByRole('tab', { name, exact: true }).waitFor();
}

async function rawText(page) {
  await page.getByRole('button', { name: 'Texto', exact: true }).click();
  return page.getByRole('textbox', { name: 'Conteúdo do arquivo' }).inputValue();
}

async function editField(page, name, value, nth = 0) {
  const field = page.getByRole('textbox', { name, exact: true }).nth(nth);
  await field.fill(value);
  await field.press('Enter');
}

async function useNativeMock(page) {
  await page.addInitScript(({ text }) => {
    const file = { id: 'qa-native-file', name: 'native.ini', path: 'C:\\Configura-QA\\native.ini', text, encoding: 'UTF-8' };
    let menu;
    window.__configuraNativeQA = {
      saves: [], saveMode: 'success', confirmedClose: false, dirty: false,
      emit: action => menu?.(action),
    };
    window.configura = {
      getAppInfo: async () => ({ version: '1.0.0', platform: 'win32', isPackaged: false }),
      getInitialFiles: async () => [file], openFiles: async () => [], openPaths: async () => [], openRecent: async () => null,
      saveFile: async request => {
        window.__configuraNativeQA.saves.push(request);
        if (window.__configuraNativeQA.saveMode === 'cancel') return null;
        return { ...file, text: request.text };
      },
      closeFile: async () => {}, setDirty: value => { window.__configuraNativeQA.dirty = value; },
      window: action => { if (action === 'close') menu?.('request-close'); },
      confirmClose: () => { window.__configuraNativeQA.confirmedClose = true; }, cancelClose: () => {},
      getPreferences: async () => ({ recentFiles: [] }), setPreferences: async () => {},
      getUpdateState: async () => ({ status: 'idle' }), checkForUpdates: async () => ({ status: 'not-available' }),
      downloadUpdate: async () => ({ status: 'downloaded' }), installUpdate: async () => {},
      onOpenFiles: () => () => {}, onUpdateState: () => () => {},
      onMenuAction: callback => { menu = callback; return () => { menu = undefined; }; },
      getPathForFile: () => '',
    };
  }, { text: fixture });
}

async function test(name, run, native = false) {
  if (process.env.CONFIGURA_QA_FILTER && !new RegExp(process.env.CONFIGURA_QA_FILTER, 'i').test(name)) return;
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const started = Date.now();
  try {
    if (native) await useNativeMock(page);
    await page.goto(baseURL, { waitUntil: 'networkidle' });
    await run(page);
    assert.deepEqual(errors, [], 'No console or uncaught browser errors');
    report.cases.push({ name, status: 'passed', durationMs: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({ name, status: 'failed', durationMs: Date.now() - started, error: error.stack || String(error) });
    report.consoleErrors.push(...errors);
    console.error(`FAIL ${name}: ${error.message}`);
    if (process.env.CONFIGURA_QA_SCREENSHOT_DIR) {
      await mkdir(process.env.CONFIGURA_QA_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: `${process.env.CONFIGURA_QA_SCREENSHOT_DIR}/${name.replace(/[^a-z0-9]+/gi, '-')}.png` });
    }
  } finally { await context.close(); }
}

try {
  await startServer();
  browser = process.env.CONFIGURA_CDP_URL
    ? await chromium.connectOverCDP(process.env.CONFIGURA_CDP_URL)
    : await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });

  await test('concept layout and initial example tabs', async page => {
    assert.equal(await page.getByRole('tab').count(), 2);
    assert.equal(await page.getByRole('textbox', { name: 'FOV', exact: true }).inputValue(), '65');
    assert.equal(await page.getByRole('switch', { name: 'MotionBlur', exact: true }).getAttribute('aria-checked'), 'true');
    const metrics = await page.evaluate(() => {
      const save = document.querySelector('.save-button').getBoundingClientRect();
      return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, save: { top: save.top, right: save.right, bottom: save.bottom, left: save.left } };
    });
    assert.ok(metrics.scrollWidth <= metrics.width, 'No page-level horizontal overflow');
    assert.ok(metrics.scrollHeight <= metrics.height, 'Editor scroll must stay within app shell');
    assert.ok(metrics.save.top >= 0 && metrics.save.bottom <= metrics.height && metrics.save.right <= metrics.width, 'Save remains visible');
    report.layout = metrics;
  });

  await test('upload and visual editing preserve BOM comments and CRLF', async page => {
    await upload(page);
    await editField(page, 'FOV', '72');
    await page.getByRole('switch', { name: 'MotionBlur', exact: true }).click();
    const expected = fixture.replace('FOV = 65', 'FOV = 72').replace('MotionBlur=TRUE', 'MotionBlur=FALSE');
    assert.equal(await rawText(page), normalize(expected));
    assert.equal(await downloadText(page), expected);
  });

  await test('draft inputs accept spaces quoted strings and transient numeric values', async page => {
    await upload(page);
    const name = page.getByRole('textbox', { name: 'Name', exact: true });
    await name.fill('');
    await name.pressSequentially('Two words', { delay: 40 });
    await name.press('Enter');
    assert.equal(await name.inputValue(), 'Two words');
    await name.fill('');
    await name.pressSequentially('"Title # one"', { delay: 35 });
    await name.press('Enter');
    assert.equal(await name.inputValue(), '"Title # one"');
    const numeric = page.getByRole('textbox', { name: 'FOV', exact: true });
    await numeric.fill('');
    await numeric.pressSequentially('-12', { delay: 40 });
    await numeric.press('Enter');
    assert.equal(await numeric.inputValue(), '-12');
    assert.equal(await page.getByRole('alert').count(), 0);
    assert.equal(await downloadText(page), fixture.replace('Name = Test', 'Name = "Title # one"').replace('FOV = 65', 'FOV = -12'));
  });

  await test('source editing undo and Tab preserve original newline mapping', async page => {
    await upload(page);
    await rawText(page);
    const source = page.getByRole('textbox', { name: 'Conteúdo do arquivo' });
    await source.fill(normalize(fixture).replace('FOV = 65', 'FOV = 99'));
    assert.equal(await downloadText(page), fixture.replace('FOV = 65', 'FOV = 99'));
    await source.focus();
    await source.press('Control+z');
    assert.equal(await source.inputValue(), normalize(fixture));
    await source.evaluate(field => { const offset = field.value.indexOf('Name ='); field.focus(); field.setSelectionRange(offset, offset); });
    await source.press('Tab');
    assert.equal(await downloadText(page), fixture.replace('Name = Test', '  Name = Test'));
  });

  await test('search and custom enum creation selection', async page => {
    await upload(page);
    const search = page.getByRole('textbox', { name: 'Buscar configurações' });
    await search.fill('motion');
    assert.equal(await page.getByRole('switch', { name: 'MotionBlur', exact: true }).count(), 1);
    assert.equal(await page.getByRole('textbox', { name: 'FOV', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Limpar busca', exact: true }).click();
    await page.getByRole('button', { name: 'Alterar tipo de Custom', exact: true }).click();
    await page.getByRole('button', { name: /^Enum/ }).click();
    await page.getByRole('button', { name: 'Nova lista', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Nova lista', exact: true });
    await modal.getByRole('textbox', { name: 'Nome', exact: true }).fill('Transport');
    const options = modal.getByRole('textbox', { name: /Opções/ });
    await options.fill('');
    await options.pressSequentially('alpha\nbeta\ngamma', { delay: 45 });
    assert.equal(await options.inputValue(), 'alpha\nbeta\ngamma');
    assert.equal(await modal.getByRole('textbox', { name: 'Nome', exact: true }).inputValue(), 'Transport');
    await modal.getByRole('button', { name: 'Salvar lista', exact: true }).click();
    await page.getByRole('button', { name: 'Alterar tipo de Custom', exact: true }).click();
    await page.getByRole('button', { name: /^Enum/ }).click();
    await page.getByRole('button', { name: 'Transport', exact: true }).click();
    await page.getByRole('button', { name: 'Escolher Custom', exact: true }).click();
    await page.getByRole('button', { name: 'beta', exact: true }).click();
    assert.equal(await downloadText(page), fixture.replace('Custom = alpha', 'Custom = beta'));
  });

  await test('add property keeps modal focus and preserves unknown CFG commands', async page => {
    await upload(page);
    await page.getByRole('button', { name: 'Adicionar propriedade a Other', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Nova propriedade', exact: true });
    await modal.getByRole('textbox', { name: 'Propriedade', exact: true }).fill('NewKey');
    const value = modal.getByRole('textbox', { name: 'Valor', exact: true });
    await value.pressSequentially('hello world', { delay: 45 });
    assert.equal(await modal.getByRole('textbox', { name: 'Propriedade', exact: true }).inputValue(), 'NewKey');
    assert.equal(await value.inputValue(), 'hello world');
    await modal.getByRole('button', { name: 'Adicionar', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: 'NewKey', exact: true }).inputValue(), 'hello world');
    assert.equal(await downloadText(page), fixture + 'NewKey=hello world\r\n');
  });

  await test('duplicate keys and sections edit only the selected original line', async page => {
    const duplicate = '[A]\r\nx=1\r\nx=2\r\n\r\n[A]\r\nx=3\r\n';
    await upload(page, duplicate, 'duplicates.ini');
    assert.equal(await page.locator('.row-modified').count(), 0, 'Duplicate defaults are not falsely marked changed');
    await editField(page, 'x', '20', 1);
    assert.equal(await page.locator('.row-modified').count(), 1);
    assert.equal(await downloadText(page), duplicate.replace('x=2', 'x=20'));
  });

  await test('close dialog cancellation and saving keep the intended data', async page => {
    await upload(page);
    await editField(page, 'FOV', '85');
    await page.getByRole('button', { name: 'Fechar qa-config.ini', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Salvar alterações?', exact: true });
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    assert.equal(await page.getByRole('tab', { name: /^qa-config\.ini(?:\s|$)/ }).count(), 1);
    await page.getByRole('button', { name: 'Fechar qa-config.ini', exact: true }).click();
    const text = await downloadText(page, () => dialog.getByRole('button', { name: 'Salvar', exact: true }).click());
    assert.equal(text, fixture.replace('FOV = 65', 'FOV = 85'));
    await page.getByRole('tab', { name: /^qa-config\.ini(?:\s|$)/ }).waitFor({ state: 'detached' });
  });

  await test('enum deletion confirmation remains above its parent modal', async page => {
    await page.getByRole('button', { name: 'Tipos', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir Quality', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Excluir lista?', exact: true });
    await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Tipos e listas', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByRole('button', { name: 'Excluir Quality', exact: true }).count(), 1);
  });

  await test('native canceled Save As preserves dirty tab and modal guards shortcuts', async page => {
    await page.getByRole('tab', { name: /^native\.ini(?:\s|$)/ }).waitFor();
    await editField(page, 'FOV', '87');
    await page.getByRole('button', { name: 'Fechar native.ini', exact: true }).click();
    await page.evaluate(() => { window.__configuraNativeQA.emit('new'); window.__configuraNativeQA.saveMode = 'cancel'; });
    assert.equal(await page.getByRole('tab').count(), 1, 'Native shortcut cannot create a tab behind a modal');
    await page.getByRole('dialog', { name: 'Salvar alterações?', exact: true }).getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('dialog', { name: 'Salvar alterações?', exact: true }).waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('tab', { name: /^native\.ini(?:\s|$)/ }).count(), 1, 'Canceled native save must not close tab');
    assert.equal(await page.getByRole('textbox', { name: 'FOV', exact: true }).inputValue(), '87');
    await page.evaluate(() => { window.__configuraNativeQA.saveMode = 'success'; });
    await page.getByRole('button', { name: 'Fechar native.ini', exact: true }).click();
    await page.getByRole('dialog', { name: 'Salvar alterações?', exact: true }).getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.getByRole('tab', { name: /^native\.ini(?:\s|$)/ }).waitFor({ state: 'detached' });
    const saves = await page.evaluate(() => window.__configuraNativeQA.saves);
    assert.equal(saves.at(-1).text, fixture.replace('FOV = 65', 'FOV = 87'));
  }, true);

  const failed = report.cases.filter(testCase => testCase.status === 'failed').length;
  console.log(JSON.stringify({ ...report, passed: report.cases.length - failed, failed }, null, 2));
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(JSON.stringify({ status: 'browser-launch-blocked', message: error.message, baseURL, executablePath }, null, 2));
  process.exitCode = 2;
} finally { await browser?.close(); server?.kill(); }
