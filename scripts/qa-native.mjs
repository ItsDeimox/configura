/**
 * Real Electron smoke test. Run after `npm run build` with `node scripts/qa-native.mjs`.
 * On Linux, a display/Xvfb is recommended. CI containers may opt into --no-sandbox;
 * production BrowserWindow settings remain sandboxed and are asserted below.
 */
import assert from 'node:assert/strict';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { _electron as electron } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packagedTest = Boolean(process.env.CONFIGURA_QA_EXECUTABLE);
await fs.access(path.join(root, 'dist/index.html')).catch(() => { throw new Error('Build the interface first: npm run build'); });
let executablePath;
try { executablePath = packagedTest ? path.resolve(process.env.CONFIGURA_QA_EXECUTABLE) : require('electron'); }
catch (error) { throw new Error(`The Electron runtime is not installed: ${error.message}`); }
await fs.access(executablePath);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'configura-native-qa-'));
const output = process.env.CONFIGURA_QA_OUTPUT ? path.resolve(process.env.CONFIGURA_QA_OUTPUT) : temporary;
await fs.mkdir(output, { recursive: true });
const userData = path.join(temporary, 'user-data');
await fs.mkdir(userData);
const mainFixture = path.join(temporary, 'QA-GameData.ini');
const secondFixture = path.join(temporary, 'QA-Second.cfg');
const bootstrap = path.join(temporary, 'bootstrap.cjs');
const initialText = '; comentário preservado\r\n[Users]\r\nMotionBlur = true ; keep this\r\nFOV = 65\r\nPlayer = "João"\r\n\r\n[Unknown]\r\n; trailing note\r\n';
const originalBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(initialText)]);
await fs.writeFile(mainFixture, originalBytes);
await fs.writeFile(secondFixture, '[Network]\r\nPort=8080\r\n');
await fs.writeFile(bootstrap, `const { app } = require('electron');\napp.setPath('userData', ${JSON.stringify(userData)});\napp.setAppPath(${JSON.stringify(root)});\nrequire(${JSON.stringify(path.join(root, 'electron/main.cjs'))});\n`);

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;
delete environment.ELECTRON_RENDERER_URL;
const extraArgs = [];
if (process.platform === 'linux') {
  const container = existsSync('/.dockerenv') || process.env.CI === 'true' || process.env.CONFIGURA_QA_NO_SANDBOX === '1';
  if (container) extraArgs.push('--no-sandbox');
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) extraArgs.push('--ozone-platform=headless', '--headless', '--disable-gpu');
}
let application;
let secondProcess;
let successful = false;
const pageErrors = [];
const checks = [];
const poll = async (predicate, label, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 70)); }
  throw new Error(`Timed out: ${label}`);
};
const pass = (label) => { checks.push(label); console.log(`PASS ${label}`); };

try {
  application = await electron.launch({ executablePath, args: [...(packagedTest ? [] : [bootstrap]), mainFixture, ...extraArgs], env: environment, timeout: 20000 });
  const page = await application.firstWindow({ timeout: 15000 });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.getByRole('tab', { name: 'QA-GameData.ini' }).waitFor();
  await page.getByRole('switch', { name: 'MotionBlur', exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'FOV', exact: true }).inputValue(), '65');
  assert.equal(await page.getByRole('switch', { name: 'MotionBlur', exact: true }).getAttribute('aria-checked'), 'true');
  assert.equal((await page.evaluate(() => window.configura.getAppInfo())).isPackaged, packagedTest);
  pass(packagedTest ? 'installed executable opened the CLI file in its native renderer' : 'CLI file opened in the actual native renderer');

  const security = await application.evaluate(({ BrowserWindow }) => {
    const settings = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: settings.sandbox, nodeIntegration: settings.nodeIntegration, contextIsolation: settings.contextIsolation };
  });
  assert.deepEqual(security, { sandbox: true, nodeIntegration: false, contextIsolation: true });
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  pass('sandbox, isolated preload and no renderer Node access');

  await page.getByRole('switch', { name: 'MotionBlur', exact: true }).click();
  await page.getByRole('textbox', { name: 'FOV', exact: true }).fill('90');
  await page.getByRole('textbox', { name: 'FOV', exact: true }).press('Enter');
  await page.getByTitle('Salvar · Ctrl+S').click();
  const expectedText = initialText.replace('MotionBlur = true', 'MotionBlur = false').replace('FOV = 65', 'FOV = 90');
  const expectedBytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(expectedText)]);
  await poll(async () => (await fs.readFile(mainFixture)).equals(expectedBytes), 'saved edited BOM/CRLF file');
  assert.deepEqual(await fs.readFile(`${mainFixture}.configura.bak`), originalBytes);
  pass('visual boolean and number save preserves BOM, CRLF, comments and backup');

  await page.getByRole('switch', { name: 'MotionBlur', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar QA-GameData.ini', exact: true }).click();
  await page.getByRole('dialog', { name: 'Salvar alterações?', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await page.getByRole('tab', { name: 'QA-GameData.ini' }).count(), 1);
  assert.equal(await page.getByRole('switch', { name: 'MotionBlur', exact: true }).getAttribute('aria-checked'), 'true');
  assert.deepEqual(await fs.readFile(mainFixture), expectedBytes);
  pass('canceling dirty-tab close retains edits and leaves disk untouched');

  // Exercise the real application menu, which drives native keyboard accelerators.
  await application.evaluate(({ Menu }) => {
    const edit = Menu.getApplicationMenu().items.find(item => item.label === 'Editar');
    const undo = edit.submenu.items.find(item => item.label === 'Desfazer');
    undo.click();
  });
  await poll(async () => await page.getByRole('switch', { name: 'MotionBlur', exact: true }).getAttribute('aria-checked') === 'false', 'native undo');
  pass('native Undo reverses visual toggle edits');

  secondProcess = spawn(executablePath, [...(packagedTest ? [] : [bootstrap]), secondFixture, ...extraArgs], { env: environment, stdio: ['ignore', 'ignore', 'pipe'] });
  let secondErrors = '';
  secondProcess.stderr.on('data', chunk => { secondErrors += chunk.toString(); });
  await page.getByRole('tab', { name: 'QA-Second.cfg' }).waitFor({ timeout: 15000 }).catch(error => { throw new Error(`${error.message}\nSecond process: ${secondErrors.slice(-3000)}`); });
  assert.equal((await application.windows()).length, 1);
  pass('second Open With process sends its file to the existing window');

  if (packagedTest) {
    // The initial release does not exist yet; verify readiness without a network check.
    assert.equal((await page.evaluate(() => window.configura.getUpdateState())).status, 'idle');
    pass('installed updater initializes without querying an unpublished release');
  } else {
    assert.equal((await page.evaluate(() => window.configura.getUpdateState())).status, 'unavailable');
    assert.equal((await page.evaluate(() => window.configura.checkForUpdates())).status, 'unavailable');
    pass('development build reports updater unavailable honestly');
  }

  await page.getByRole('tab', { name: 'QA-GameData.ini' }).click();
  await page.getByRole('textbox', { name: 'FOV', exact: true }).fill('100');
  await page.getByRole('button', { name: 'Fechar aplicativo', exact: true }).click();
  await page.getByRole('dialog', { name: 'Salvar alterações?', exact: true }).getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'FOV', exact: true }).inputValue(), '100');
  pass('window close checks unsaved edits and can be canceled');

  await page.screenshot({ path: path.join(output, 'native-editor.png') });
  assert.deepEqual(pageErrors, [], 'Renderer must not raise JavaScript errors');
  await fs.writeFile(path.join(output, 'native-qa.json'), JSON.stringify({ checks, security, rendererErrors: pageErrors }, null, 2));
  successful = true;
} finally {
  if (secondProcess && secondProcess.exitCode === null) secondProcess.kill();
  if (application) {
    await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
    await application.close().catch(() => {});
  }
  if (!successful) console.error(`Native QA evidence retained at ${temporary}`);
  else {
    console.log(`Native smoke passed: ${checks.length} checks.`);
    if (output !== temporary) console.log(`Evidence: ${output}`);
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
