'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, shell, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { FileStore, FileStoreError, atomicWrite, MAX_BYTES } = require('./file-store.cjs');

app.setName('Configura');
app.setAppUserModelId('io.github.itsdeimox.configura');
const store = new FileStore();
const fileFilters = [
  { name: 'Arquivos de configuração', extensions: ['ini', 'cfg', 'conf', 'cnf', 'properties', 'env', 'config', 'toml', 'txt'] },
  { name: 'Todos os arquivos', extensions: ['*'] },
];
let mainWindow;
let preferences = { recentFiles: [], backupOnSave: true };
let preferencesPath;
let preferencesWrite = Promise.resolve();
let dirty = false;
let closeConfirmed = false;
let closeRequestPending = false;
let installing = false;
let rendererReady = false;
let initialRead;
let queuedPaths = [];
let updater;
let updateState = { status: 'idle' };
let updateBusy = false;
const productionUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;
const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
if (devUrl && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/.test(devUrl)) {
  throw new Error('ELECTRON_RENDERER_URL must be a loopback HTTP URL.');
}

function emit(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(`configura:${channel}`, payload);
  }
}
function trusted(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || !event.senderFrame || event.senderFrame !== mainWindow.webContents.mainFrame) return false;
  const actual = event.senderFrame.url.split('#')[0].split('?')[0];
  const expected = devUrl ? new URL(devUrl).origin : productionUrl;
  try { return devUrl ? new URL(actual).origin === expected : actual === expected; }
  catch { return false; }
}
function handle(channel, callback) {
  ipcMain.handle(`configura:${channel}`, async (event, ...args) => {
    if (!trusted(event)) throw new Error('Origem não autorizada.');
    try { return await callback(...args); }
    catch (error) { throw new Error(userError(error)); }
  });
}
function userError(error) {
  if (error instanceof FileStoreError) return error.message;
  if (error?.code === 'ENOENT') return 'Este arquivo não existe mais. Escolha o arquivo novamente.';
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'Sem permissão para acessar este arquivo. Tente Salvar como em uma pasta sua.';
  if (error?.code === 'ENOSPC') return 'Não há espaço suficiente no disco para salvar.';
  return error?.message || 'Não foi possível concluir esta operação.';
}
function persistPreferences() {
  const data = JSON.stringify(preferences, null, 2);
  preferencesWrite = preferencesWrite.catch(() => {}).then(() => atomicWrite(preferencesPath, Buffer.from(data)));
  return preferencesWrite;
}
async function addRecent(filePath) {
  preferences.recentFiles = [filePath, ...(preferences.recentFiles || []).filter((p) => p !== filePath)].slice(0, 12);
  await persistPreferences().catch(() => {});
}
async function openMany(paths, showErrors = false) {
  if (!Array.isArray(paths) || paths.length > 32 || paths.some((p) => typeof p !== 'string' || p.length > 32768)) throw new Error('Lista de arquivos inválida.');
  const documents = [];
  for (const filePath of [...new Set(paths)]) {
    try {
      const document = await store.open(filePath);
      documents.push(document);
      await addRecent(document.path);
    } catch (error) {
      if (!showErrors) throw error;
      await dialog.showMessageBox(mainWindow, { type: 'error', title: 'Não foi possível abrir', message: path.basename(filePath), detail: userError(error) });
    }
  }
  return documents;
}
function commandLinePaths(argv, cwd = process.cwd()) {
  return argv.slice(app.isPackaged ? 1 : 2).filter((arg) => typeof arg === 'string' && !arg.startsWith('-')).map((arg) => path.resolve(cwd, arg)).slice(0, 32);
}
async function receivePaths(paths) {
  if (!rendererReady) { queuedPaths.push(...paths); return; }
  const documents = await openMany(paths, true);
  if (documents.length) emit('open-files', documents);
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
}
function setUpdateState(next) {
  updateState = next;
  emit('update-state', updateState);
  return updateState;
}
async function initializeUpdater() {
  if (!app.isPackaged || process.platform !== 'win32' || process.env.PORTABLE_EXECUTABLE_DIR) {
    setUpdateState({ status: 'unavailable', message: 'As atualizações automáticas estão disponíveis na versão instalada para Windows.' });
    return;
  }
  try {
    await fs.access(path.join(path.dirname(process.execPath), 'Uninstall Configura.exe'));
  } catch {
    setUpdateState({ status: 'unavailable', message: 'Esta é a versão ZIP. Instale o Configura com o instalador para receber atualizações pelo aplicativo.' });
    return;
  }
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = false;
    updater.disableDifferentialDownload = true;
    if ('autoInstallEvent' in updater) updater.autoInstallEvent = 'manual';
    else updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.on('checking-for-update', () => setUpdateState({ status: 'checking' }));
    updater.on('update-available', (info) => setUpdateState({ status: 'available', version: info.version }));
    updater.on('update-not-available', (info) => setUpdateState({ status: 'not-available', version: info.version }));
    updater.on('download-progress', (progress) => setUpdateState({ status: 'downloading', version: updateState.version, percent: Math.max(0, Math.min(100, progress.percent)) }));
    updater.on('update-downloaded', (info) => setUpdateState({ status: 'downloaded', version: info.version, percent: 100 }));
    updater.on('error', (error) => setUpdateState({ status: 'error', message: `Não foi possível atualizar: ${error.message}` }));
  } catch (error) { setUpdateState({ status: 'error', message: userError(error) }); }
}
function finishClose() {
  closeConfirmed = true; closeRequestPending = false;
  if (installing && updater) {
    try {
      // v7 adds an options object; v6 accepts (isSilent, isForceRunAfter).
      const packageVersion = require('electron-updater/package.json').version;
      if (Number(packageVersion.split('.')[0]) >= 7) updater.quitAndInstall({ isSilent: false, isForceRunAfter: true });
      else updater.quitAndInstall(false, true);
    } catch (error) {
      closeConfirmed = false; installing = false;
      setUpdateState({ status: 'error', message: userError(error) });
    }
  } else app.quit();
}
function requestClose() {
  if (closeRequestPending) return;
  if (!rendererReady) { closeConfirmed = true; app.quit(); return; }
  closeRequestPending = true;
  emit('menu-action', 'request-close');
}

function setupIpc() {
  handle('app-info', () => ({ version: app.getVersion(), platform: process.platform, isPackaged: app.isPackaged }));
  handle('initial-files', async () => {
    rendererReady = true;
    if (!initialRead) initialRead = openMany(queuedPaths.splice(0, 32), true);
    await initialRead;
    return [...store.documents.values()].map((record) => store.public(record));
  });
  handle('open-files', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Abrir configuração', properties: ['openFile', 'multiSelections'], filters: fileFilters });
    return result.canceled ? [] : openMany(result.filePaths, true);
  });
  handle('open-paths', (paths) => openMany(paths, true));
  handle('open-recent', async (filePath) => {
    if (!(preferences.recentFiles || []).includes(filePath)) throw new Error('Este arquivo não está na lista de recentes.');
    const [document] = await openMany([filePath], false);
    return document ?? null;
  });
  handle('save-file', async (request) => {
    if (!request || typeof request !== 'object' || typeof request.text !== 'string' || request.text.length > MAX_BYTES || (request.id !== undefined && typeof request.id !== 'string')) throw new Error('Conteúdo inválido para salvar.');
    const { id, text } = request;
    const original = id ? store.get(id) : undefined;
    if (id && !original) throw new Error('O arquivo não está aberto.');
    let targetPath;
    let utf8 = false;
    if (request.saveAs || !id) {
      const requestedName = typeof request.name === 'string' ? path.basename(request.name).slice(0, 255) : 'Sem título.ini';
      const result = await dialog.showSaveDialog(mainWindow, { title: 'Salvar configuração como', defaultPath: original?.path ?? requestedName, filters: fileFilters, properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (result.canceled || !result.filePath) return null;
      targetPath = result.filePath;
      // Save As is an explicit escape hatch for characters outside legacy encodings.
      if (original?.encoding === 'Windows-1252') {
        try { require('./file-store.cjs').encodeText(text, original.encoding); }
        catch (error) {
          if (error.code !== 'UNREPRESENTABLE') throw error;
          const choice = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Salvar como UTF-8', message: 'Salvar esta cópia com codificação UTF-8?', detail: 'O texto contém caracteres que não existem na codificação Windows-1252 do arquivo original.', buttons: ['Salvar como UTF-8', 'Cancelar'], defaultId: 0, cancelId: 1, noLink: true });
          if (choice.response !== 0) return null;
          utf8 = true;
        }
      }
    }
    const options = { id, text, targetPath, backup: preferences.backupOnSave !== false, utf8 };
    let document;
    try { document = await store.save(options); }
    catch (error) {
      if (error.code !== 'CONFLICT') throw error;
      const choice = await dialog.showMessageBox(mainWindow, { type: 'warning', title: 'Arquivo alterado no disco', message: 'Outro programa alterou ou removeu este arquivo.', detail: 'Você pode cancelar para preservar a versão do disco ou substituí-la pelo conteúdo desta aba. Se existir, a versão do disco será copiada para um backup quando a opção estiver ativa.', buttons: ['Cancelar', 'Substituir arquivo'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response !== 1) return null;
      document = await store.save({ ...options, force: true });
    }
    await addRecent(document.path);
    return document;
  });
  handle('close-file', (id) => { if (typeof id !== 'string') throw new Error('Identificador inválido.'); store.close(id); });
  handle('preferences', () => ({ ...preferences, recentFiles: [...(preferences.recentFiles || [])] }));
  handle('set-preferences', async (patch) => {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Preferências inválidas.');
    const serialized = JSON.stringify(patch);
    if (serialized.length > 512 * 1024) throw new Error('As preferências excedem o tamanho permitido.');
    const safe = JSON.parse(serialized);
    delete safe.recentFiles; delete safe.windowBounds; delete safe.__proto__; delete safe.constructor; delete safe.prototype;
    preferences = { ...preferences, ...safe };
    await persistPreferences();
  });
  handle('update-state', () => updateState);
  handle('check-updates', async () => {
    if (!updater || updateBusy || updateState.status === 'downloading' || updateState.status === 'downloaded') return updateState;
    updateBusy = true;
    try { await updater.checkForUpdates(); }
    catch (error) { setUpdateState({ status: 'error', message: `Não foi possível consultar as releases: ${error.message}` }); }
    finally { updateBusy = false; }
    return updateState;
  });
  handle('download-update', async () => {
    if (!updater || updateBusy || updateState.status !== 'available') return updateState;
    updateBusy = true;
    try { setUpdateState({ status: 'downloading', version: updateState.version, percent: 0 }); await updater.downloadUpdate(); }
    catch (error) { setUpdateState({ status: 'error', message: userError(error) }); }
    finally { updateBusy = false; }
    return updateState;
  });
  handle('install-update', () => {
    if (!updater || updateState.status !== 'downloaded') return updateState;
    installing = true;
    requestClose();
    return updateState;
  });
  ipcMain.on('configura:dirty', (event, value) => { if (trusted(event)) dirty = value === true; });
  ipcMain.on('configura:window', (event, action) => {
    if (!trusted(event)) return;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
    else if (action === 'close') mainWindow.close();
  });
  ipcMain.on('configura:confirm-close', (event) => { if (trusted(event)) finishClose(); });
  ipcMain.on('configura:cancel-close', (event) => { if (trusted(event)) { installing = false; closeRequestPending = false; } });
}

function setupMenu() {
  const action = (name) => () => emit('menu-action', name);
  const template = [
    { label: 'Arquivo', submenu: [
      { label: 'Novo arquivo', accelerator: 'CommandOrControl+N', click: action('new') },
      { label: 'Abrir…', accelerator: 'CommandOrControl+O', click: action('open') },
      { type: 'separator' },
      { label: 'Salvar', accelerator: 'CommandOrControl+S', click: action('save') },
      { label: 'Salvar como…', accelerator: 'CommandOrControl+Shift+S', click: action('save-as') },
      { label: 'Fechar aba', accelerator: 'CommandOrControl+W', click: action('close-tab') },
      { type: 'separator' }, { label: 'Sair', accelerator: 'Alt+F4', click: () => mainWindow?.close() },
    ] },
    { label: 'Editar', submenu: [{ label: 'Desfazer', accelerator: 'CommandOrControl+Z', click: action('undo') }, { label: 'Refazer', accelerator: 'CommandOrControl+Shift+Z', click: action('redo') }, { label: 'Refazer', accelerator: 'CommandOrControl+Y', visible: false, acceleratorWorksWhenHidden: true, click: action('redo') }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }, { type: 'separator' }, { label: 'Buscar', accelerator: 'CommandOrControl+F', click: action('find') }] },
    { label: 'Visualizar', submenu: [{ role: 'resetZoom', label: 'Tamanho original' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { label: 'Preferências', accelerator: 'CommandOrControl+,', click: action('settings') }] },
    { label: 'Ajuda', submenu: [{ label: 'Repositório no GitHub', click: () => shell.openExternal('https://github.com/ItsDeimox/configura') }, { label: 'Atualizações', click: action('updates') }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow() {
  const bounds = preferences.windowBounds;
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const maxWidth = Math.max(360, workArea.width - 24), maxHeight = Math.max(400, workArea.height - 24);
  const minWidth = Math.min(860, maxWidth), minHeight = Math.min(620, maxHeight);
  const requestedWidth = Number.isFinite(bounds?.width) ? bounds.width : 1440;
  const requestedHeight = Number.isFinite(bounds?.height) ? bounds.height : 940;
  const width = Math.max(minWidth, Math.min(maxWidth, requestedWidth));
  const height = Math.max(minHeight, Math.min(maxHeight, requestedHeight));
  mainWindow = new BrowserWindow({ width, height, minWidth, minHeight, frame: false, show: false, backgroundColor: '#101010', title: 'Configura', icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(__dirname, '..', 'build', 'icon.png'), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false } });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== (devUrl || productionUrl)) event.preventDefault(); });
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  mainWindow.webContents.session.setPermissionCheckHandler(() => false);
  mainWindow.webContents.on('render-process-gone', async () => {
    rendererReady = false; closeRequestPending = false; installing = false;
    const detail = dirty ? 'Os arquivos salvos no disco permanecem intactos. Alterações ainda não salvas podem ter sido perdidas.' : 'Seus arquivos salvos permanecem intactos.';
    const choice = await dialog.showMessageBox(mainWindow, { type: 'error', title: 'A interface foi interrompida', message: 'O processo da interface parou de responder.', detail, buttons: ['Reabrir interface', 'Fechar'], defaultId: 0 });
    dirty = false;
    if (choice.response === 0) mainWindow.reload(); else { closeConfirmed = true; app.quit(); }
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('close', (event) => {
    if (!closeConfirmed) { event.preventDefault(); requestClose(); return; }
    if (!mainWindow.isMaximized()) preferences.windowBounds = mainWindow.getBounds();
    persistPreferences().catch(() => {});
  });
  mainWindow.on('closed', () => { mainWindow = undefined; });
  if (devUrl) mainWindow.loadURL(devUrl);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  queuedPaths.push(...commandLinePaths(process.argv));
  app.on('second-instance', (_event, argv, cwd) => receivePaths(commandLinePaths(argv, cwd)));
  app.on('open-file', (event, filePath) => { event.preventDefault(); receivePaths([filePath]); });
  app.on('before-quit', (event) => {
    if (!closeConfirmed && mainWindow) { event.preventDefault(); requestClose(); }
  });
  app.whenReady().then(async () => {
    preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    try {
      const data = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
      if (data && typeof data === 'object' && !Array.isArray(data)) preferences = { ...preferences, ...data };
      if (!Array.isArray(preferences.recentFiles)) preferences.recentFiles = [];
      preferences.recentFiles = preferences.recentFiles.filter((v) => typeof v === 'string').slice(0, 12);
    } catch { /* Missing or interrupted preferences never prevent opening the editor. */ }
    setupIpc(); createWindow(); setupMenu(); initializeUpdater();
  }).catch((error) => { dialog.showErrorBox('Configura', userError(error)); app.quit(); });
  app.on('window-all-closed', () => app.quit());
}
