import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { addEntry, addSection, parseConfig, removeEntry, setEntryValue, toggleBoolean } from './core/config';
import type { ConfigEntry, ConfigSection, ValueKind } from './core/config';
import { defaultPresets, guessPreset, sampleConfig, sampleGame } from './core/samples';
import type { EnumPreset } from './core/samples';
import type { AppInfo, NativeDocument, UpdateState } from './native';
import Icon from './components/Icon';
import { applySourceEdit } from './core/textEdits';

type EditorTab = { uid: string; fileId?: string; name: string; path: string; encoding: string; text: string; savedText: string; example?: boolean; history: string[]; historyIndex: number };
type TypeOverride = { kind: ValueKind; preset?: string };
type Target = { entry: ConfigEntry; section: ConfigSection; overrideKey: string };
type Popup = { kind: 'types' | 'enums' | 'values'; x: number; y: number; target: Target } | { kind: 'app'; x: number; y: number };
type DialogState = { title: string; message: string; kind: 'save' | 'confirm'; confirmLabel?: string; resolve: (answer: 'save' | 'discard' | 'cancel') => void };
type FieldForm = { kind: 'field'; sectionId: string; key: string; value: string } | { kind: 'section'; name: string };
const api = window.configura;
const kinds: { kind: ValueKind; label: string; hint: string }[] = [
  { kind: 'string', label: 'String', hint: 'Texto livre' },
  { kind: 'boolean', label: 'Bool', hint: 'Ligado / desligado' },
  { kind: 'number', label: 'Number', hint: 'Valor numérico' },
  { kind: 'enum', label: 'Enum', hint: 'Lista de opções' },
];
const makeTab = (name: string, text: string, example = false): EditorTab => ({ uid: crypto.randomUUID(), name, path: '', encoding: 'UTF-8', text, savedText: text, example, history: [text], historyIndex: 0 });
const tabFromNative = (file: NativeDocument): EditorTab => ({ ...makeTab(file.name, file.text), fileId: file.id, path: file.path, encoding: file.encoding });
const dirty = (tab: EditorTab) => tab.text !== tab.savedText;

function Modal({ title, children, onClose, className = '' }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]') ?? [];
    const timer = setTimeout(() => { const items = focusable(); (Array.from(items).find(el => el.tagName === 'INPUT') ?? items[0])?.focus(); }, 30);
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(); }
      if (e.key === 'Tab') { const items = focusable(); if (!items.length) return; const first = items[0], last = items[items.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', keydown, true); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} className={`modal ${className}`}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} title="Fechar" aria-label="Fechar diálogo"><Icon name="close" /></button></div>{children}</div></div>;
}

export default function App() {
  const initialTabs = useMemo(() => [makeTab('GameData.ini', sampleGame, true), makeTab('Config.ini', sampleConfig, true)], []);
  const [tabs, setTabs] = useState<EditorTab[]>(initialTabs);
  const [activeId, setActiveId] = useState(initialTabs[0].uid);
  const [mode, setMode] = useState<'visual' | 'text'>('visual');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ 'GameData.ini:KeyBinds': true, 'GameData.ini:Sounds': true, 'GameData.ini:Advanced': true });
  const [menu, setMenu] = useState<Popup | null>(null);
  const [overrides, setOverrides] = useState<Record<string, TypeOverride>>({});
  const [presets, setPresets] = useState<EnumPreset[]>(defaultPresets);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [enumManagerOpen, setEnumManagerOpen] = useState(false);
  const [editingPreset, setEditingPreset] = useState<EnumPreset | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<DialogState | null>(null);
  const [form, setForm] = useState<FieldForm | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const [backupOnSave, setBackupOnSave] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [ready, setReady] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo>({ version: '1.0.0', platform: 'web', isPackaged: false });
  const [update, setUpdate] = useState<UpdateState>({ status: 'idle' });
  const tabsRef = useRef(tabs); tabsRef.current = tabs;
  const draftsRef = useRef(drafts); draftsRef.current = drafts;
  const closingRef = useRef(new Set<string>());
  const modalOpenRef = useRef(false); modalOpenRef.current = !!(dialog || form || editingPreset || enumManagerOpen || settingsOpen);
  const activeRef = useRef(activeId); activeRef.current = activeId;
  const actionsRef = useRef<Record<string, () => void>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingSave = useRef(false);
  const active = tabs.find(tab => tab.uid === activeId);
  const parsed = useMemo(() => parseConfig(active?.text ?? ''), [active?.text]);
  const savedEntries = useMemo(() => new Map(parseConfig(active?.savedText ?? '').sections.flatMap(section => section.entries.map(entry => [entry.id, entry.value] as const))), [active?.savedText]);
  const isDirty = (tab: EditorTab) => dirty(tab) || Object.keys(draftsRef.current).some(key => key.startsWith(`${tab.uid}::`));
  const entryCount = useMemo(() => parsed.sections.reduce((count, section) => count + section.entries.length, 0), [parsed]);
  const visibleSections = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return parsed.sections;
    return parsed.sections.map(section => ({ ...section, entries: section.name.toLocaleLowerCase().includes(query) ? section.entries : section.entries.filter(entry => `${entry.key} ${entry.value}`.toLocaleLowerCase().includes(query)) })).filter(section => section.entries.length);
  }, [parsed, search]);

  const notify = useCallback((message: string, error = false) => { clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), error ? 8000 : 3500); }, []);
  const report = useCallback((error: unknown) => notify(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(error), true), [notify]);
  const openNativeDocuments = useCallback((files: NativeDocument[]) => {
    if (!files.length) return;
    let nextActive = '';
    setTabs(current => {
      const next = current.filter(tab => !tab.example || isDirty(tab));
      for (const file of files) {
        const existing = next.find(tab => tab.fileId === file.id || (file.path && tab.path === file.path));
        if (existing) nextActive = existing.uid;
        else { const added = tabFromNative(file); next.push(added); nextActive = added.uid; }
      }
      if (nextActive) setActiveId(nextActive);
      return next;
    });
    setSearch(''); setMenu(null);
    if (api) void api.getPreferences().then(p => setRecentFiles(p.recentFiles ?? [])).catch(report);
  }, [report]);

  useEffect(() => {
    let disposed = false;
    const init = async () => {
      try {
        if (api) {
          const [info, prefs, files, updateState] = await Promise.all([api.getAppInfo(), api.getPreferences(), api.getInitialFiles(), api.getUpdateState()]);
          if (disposed) return;
          setAppInfo(info); setRecentFiles(prefs.recentFiles ?? []); setUpdate(updateState);
          if (prefs.typeOverrides && typeof prefs.typeOverrides === 'object') setOverrides(prefs.typeOverrides as Record<string, TypeOverride>);
          if (Array.isArray(prefs.enumPresets) && prefs.enumPresets.every(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.values) && p.values.every((v: unknown) => typeof v === 'string'))) setPresets(prefs.enumPresets as EnumPreset[]);
          if (typeof prefs.backupOnSave === 'boolean') setBackupOnSave(prefs.backupOnSave);
          if (typeof prefs.reducedMotion === 'boolean') setReducedMotion(prefs.reducedMotion);
          openNativeDocuments(files);
        } else {
          const stored = localStorage.getItem('configura.preferences');
          if (stored) { const prefs = JSON.parse(stored); if (prefs.typeOverrides) setOverrides(prefs.typeOverrides); if (Array.isArray(prefs.enumPresets)) setPresets(prefs.enumPresets); if (typeof prefs.backupOnSave === 'boolean') setBackupOnSave(prefs.backupOnSave); if (typeof prefs.reducedMotion === 'boolean') setReducedMotion(prefs.reducedMotion); }
        }
      } catch (error) { report(error); }
      finally { if (!disposed) setReady(true); }
    };
    void init();
    const offFiles = api?.onOpenFiles(openNativeDocuments);
    const offUpdate = api?.onUpdateState(setUpdate);
    const offMenu = api?.onMenuAction(action => { if (!modalOpenRef.current || action === 'request-close') actionsRef.current[action]?.(); });
    return () => { disposed = true; offFiles?.(); offUpdate?.(); offMenu?.(); clearTimeout(toastTimer.current); };
  }, [openNativeDocuments, report]);

  useEffect(() => {
    if (!ready) return;
    const prefs = { typeOverrides: overrides, enumPresets: presets, backupOnSave, reducedMotion };
    const timeout = setTimeout(() => { if (api) void api.setPreferences(prefs).catch(report); else { try { localStorage.setItem('configura.preferences', JSON.stringify(prefs)); } catch { /* Private browser preview may not persist preferences. */ } } }, 400);
    return () => clearTimeout(timeout);
  }, [ready, overrides, presets, backupOnSave, reducedMotion, report]);
  useEffect(() => { api?.setDirty(tabs.some(isDirty)); }, [tabs, drafts]);
  useEffect(() => { document.documentElement.dataset.motion = reducedMotion ? 'reduced' : 'full'; }, [reducedMotion]);
  useEffect(() => { setMenu(null); }, [activeId, mode]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(null); e.stopPropagation(); } };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menu]);

  const updateText = useCallback((uid: string, text: string) => {
    const next = tabsRef.current.map(tab => {
      if (tab.uid !== uid || tab.text === text) return tab;
      const history = [...tab.history.slice(0, tab.historyIndex + 1), text].slice(-160);
      return { ...tab, text, history, historyIndex: history.length - 1 };
    });
    tabsRef.current = next; setTabs(next);
  }, []);
  const clearDrafts = (uid: string) => { const next = Object.fromEntries(Object.entries(draftsRef.current).filter(([key]) => !key.startsWith(`${uid}::`))); draftsRef.current = next; setDrafts(next); };
  const setDraft = (uid: string, entry: ConfigEntry, value: string) => { const key = `${uid}::${entry.id}`; const next = { ...draftsRef.current }; if (value === entry.value) delete next[key]; else next[key] = value; draftsRef.current = next; setDrafts(next); };
  const flushDrafts = (uid: string): string | null => {
    const tab = tabsRef.current.find(t => t.uid === uid); if (!tab) return null;
    try {
      let text = tab.text;
      for (const [key, value] of Object.entries(draftsRef.current)) { if (key.startsWith(`${uid}::`)) text = setEntryValue(text, key.slice(uid.length + 2), value); }
      if (text !== tab.text) updateText(uid, text);
      clearDrafts(uid); return text;
    } catch (error) { report(error); return null; }
  };
  const changeValue = (entryId: string, value: string) => { if (!active) return; try { updateText(active.uid, setEntryValue(active.text, entryId, value)); } catch (error) { report(error); } };
  const historyMove = (direction: -1 | 1) => { if (Object.keys(draftsRef.current).some(key => key.startsWith(`${activeRef.current}::`))) { clearDrafts(activeRef.current); return; } setTabs(current => current.map(tab => { if (tab.uid !== activeRef.current) return tab; const index = Math.min(tab.history.length - 1, Math.max(0, tab.historyIndex + direction)); return { ...tab, text: tab.history[index], historyIndex: index }; })); };

  const saveTab = async (uid: string, saveAs = false): Promise<boolean> => {
    if (flushDrafts(uid) === null) return false;
    const tab = tabsRef.current.find(t => t.uid === uid);
    if (!tab || pendingSave.current) return false;
    pendingSave.current = true; setSaving(true);
    try {
      if (api) {
        const result = await api.saveFile({ id: tab.fileId, text: tab.text, name: tab.name, saveAs: saveAs || !tab.fileId });
        if (!result) return false;
        const nextTabs = tabsRef.current.map(t => t.uid === uid ? { ...t, fileId: result.id, name: result.name, path: result.path, encoding: result.encoding, savedText: tab.text, example: false } : t); tabsRef.current = nextTabs; setTabs(nextTabs);
        setRecentFiles((await api.getPreferences()).recentFiles ?? []);
      } else {
        const blob = new Blob([tab.text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = tab.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        const nextTabs = tabsRef.current.map(t => t.uid === uid ? { ...t, savedText: tab.text } : t); tabsRef.current = nextTabs; setTabs(nextTabs);
      }
      notify(`${tab.name} salvo.`); return true;
    } catch (error) { report(error); return false; }
    finally { pendingSave.current = false; setSaving(false); }
  };
  const ask = (options: Omit<DialogState, 'resolve'>): Promise<'save' | 'discard' | 'cancel'> => { if (dialogRef.current) return Promise.resolve('cancel'); return new Promise(resolve => { const next = { ...options, resolve }; dialogRef.current = next; setDialog(next); }); };
  const resolveDialog = (answer: 'save' | 'discard' | 'cancel') => { dialogRef.current?.resolve(answer); dialogRef.current = null; setDialog(null); };
  const saveBeforeClose = async (tab: EditorTab) => {
    const currentTab = tabsRef.current.find(t => t.uid === tab.uid);
    if (!currentTab || !isDirty(currentTab)) return true;
    const answer = await ask({ kind: 'save', title: 'Salvar alterações?', message: `“${tab.name}” tem alterações que ainda não foram salvas.` });
    if (answer === 'cancel') return false;
    if (answer === 'discard') { clearDrafts(tab.uid); return true; }
    if (!(await saveTab(tab.uid))) return false;
    const afterSave = tabsRef.current.find(t => t.uid === tab.uid);
    if (afterSave && isDirty(afterSave)) return saveBeforeClose(afterSave);
    return true;
  };
  const closeTab = async (uid: string) => {
    if (closingRef.current.has(uid) || modalOpenRef.current) return;
    closingRef.current.add(uid);
    try {
      const tab = tabsRef.current.find(t => t.uid === uid); if (!tab || !(await saveBeforeClose(tab))) return;
      if (tab.fileId) await api?.closeFile(tab.fileId);
      clearDrafts(uid);
      setTabs(current => { const index = current.findIndex(t => t.uid === uid); const next = current.filter(t => t.uid !== uid); if (activeRef.current === uid) setActiveId(next[Math.min(index, next.length - 1)]?.uid ?? ''); return next; });
    } catch (error) { report(error); } finally { closingRef.current.delete(uid); }
  };
  const closeApp = async () => { if (closingRef.current.has('app')) return; if (dialog) { api?.cancelClose(); return; } setSettingsOpen(false); setEnumManagerOpen(false); setEditingPreset(null); setForm(null); closingRef.current.add('app'); try { for (const tab of tabsRef.current) { if (!(await saveBeforeClose(tab))) { api?.cancelClose(); return; } } api?.confirmClose(); } finally { closingRef.current.delete('app'); } };
  const openFiles = async () => { setMenu(null); try { if (api) openNativeDocuments(await api.openFiles()); else fileInputRef.current?.click(); } catch (error) { report(error); } };
  const readBrowserFiles = async (files: File[]) => {
    try {
      for (const file of files) {
        if (file.size > 10 * 1024 * 1024) throw new Error('Abra arquivos de até 10 MB.');
        const text = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true }).decode(await file.arrayBuffer()); if (text.includes('\0')) throw new Error('Use o aplicativo instalado para abrir arquivos UTF-16.');
        const tab = makeTab(file.name, text); setTabs(current => [...current.filter(t => !t.example || isDirty(t)), tab]); setActiveId(tab.uid);
      }
    } catch (error) { report(error); }
  };
  const newFile = () => { setMenu(null); const n = tabsRef.current.filter(t => t.name.startsWith('Sem título')).length; const tab = makeTab(`Sem título${n ? ` ${n + 1}` : ''}.ini`, ''); setTabs(current => [...current.filter(t => !t.example || isDirty(t)), tab]); setActiveId(tab.uid); setSearch(''); };
  const openRecent = async (path: string) => { setMenu(null); try { const file = await api?.openRecent(path); if (file) openNativeDocuments([file]); } catch (error) { report(error); } };
  const resetFile = async () => { if (!active || !isDirty(active)) return; const answer = await ask({ kind: 'confirm', title: 'Restaurar o arquivo?', message: 'As alterações desta aba serão revertidas para a última versão salva. Você pode desfazer com Ctrl+Z.', confirmLabel: 'Restaurar' }); if (answer === 'discard') { clearDrafts(active.uid); updateText(active.uid, active.savedText); notify('Última versão salva restaurada.'); } };

  actionsRef.current = {
    new: newFile, open: () => void openFiles(), save: () => void saveTab(activeRef.current), 'save-as': () => void saveTab(activeRef.current, true), 'close-tab': () => void closeTab(activeRef.current), find: () => searchRef.current?.focus(), settings: () => setSettingsOpen(true), updates: () => { setSettingsOpen(true); void checkUpdates(); }, 'request-close': () => void closeApp(), undo: () => historyMove(-1), redo: () => historyMove(1),
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (modalOpenRef.current) return;
      const commands: Record<string, string> = { o: 'open', n: 'new', s: e.shiftKey ? 'save-as' : 'save', w: 'close-tab', f: 'find', z: e.shiftKey ? 'redo' : 'undo', y: 'redo', ',': 'settings' };
      if (commands[key]) { e.preventDefault(); if (!api) actionsRef.current[commands[key]]?.(); }
      if (key === 'tab') { e.preventDefault(); const current = tabsRef.current; if (!current.length) return; const i = current.findIndex(t => t.uid === activeRef.current); setActiveId(current[(i + (e.shiftKey ? current.length - 1 : 1)) % current.length].uid); }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (!api && tabsRef.current.some(isDirty)) e.preventDefault(); };
    window.addEventListener('keydown', onKey); window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); };
  }, [dialog, form, editingPreset]);

  const popupAt = (element: HTMLElement, target: Target, kind: 'types' | 'enums' | 'values') => { const rect = element.getBoundingClientRect(); setMenu({ kind, x: Math.max(12, Math.min(rect.right - 224, window.innerWidth - 240)), y: Math.max(40, Math.min(rect.bottom + 8, window.innerHeight - 310)), target }); };
  const overrideKey = (entry: ConfigEntry, section: ConfigSection) => { const sectionOccurrence = parsed.sections.filter(s => s.name === section.name).findIndex(s => s.id === section.id); const keyOccurrence = section.entries.filter(e => e.key === entry.key).findIndex(e => e.id === entry.id); return `${active?.path || active?.name}::${section.name}[${sectionOccurrence}]::${entry.key}[${keyOccurrence}]`; };
  const kindFor = (entry: ConfigEntry, section: ConfigSection): ValueKind => { const chosen = overrides[overrideKey(entry, section)]; if (chosen) return chosen.kind; return guessPreset(entry.key) && entry.kind === 'string' && !/^['"]/.test(entry.value) ? 'enum' : entry.kind; };
  const presetFor = (target: Target) => presets.find(preset => preset.id === (overrides[target.overrideKey]?.preset ?? guessPreset(target.entry.key))) ?? presets[0];
  const chooseKind = (target: Target, kind: ValueKind, preset?: string) => { setOverrides(current => ({ ...current, [target.overrideKey]: { kind, preset } })); setMenu(null); };
  const checkUpdates = async () => { if (!api) { setUpdate({ status: 'unavailable', message: 'As atualizações ficam disponíveis no aplicativo instalado.' }); return; } try { setUpdate(await api.checkForUpdates()); } catch (error) { report(error); } };
  const onDrop = async (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragOver(false); const files = Array.from(event.dataTransfer.files); if (!files.length) return; try { if (api) openNativeDocuments(await api.openPaths(files.map(file => api.getPathForFile(file)))); else await readBrowserFiles(files); } catch (error) { report(error); } };
  const submitForm = () => {
    if (!form || !active) return;
    try {
      const source = flushDrafts(active.uid); if (source === null) return;
      const next = form.kind === 'section' ? addSection(source, form.name.trim()) : addEntry(source, form.sectionId, form.key.trim(), form.value);
      updateText(active.uid, next); setForm(null); setSearch('');
      if (form.kind === 'section') setCollapsed(current => ({ ...current, [`${active.name}:${form.name.trim()}`]: false }));
    } catch (error) { report(error); }
  };
  const renderEntry = (entry: ConfigEntry, section: ConfigSection) => {
    const kind = kindFor(entry, section);
    const target: Target = { entry, section, overrideKey: overrideKey(entry, section) };
    const draftKey = `${active?.uid}::${entry.id}`;
    const inputValue = drafts[draftKey] ?? entry.value;
    const changed = savedEntries.get(entry.id) !== inputValue;
    const isBool = /^(true|yes|on|1)$/i.test(entry.value);
    return <div className={`config-row type-${kind} ${changed ? 'row-modified' : ''}`} key={entry.id}>
      <div className="key-area"><span className="property-name" title={entry.key}>{entry.key}</span><button className={`type-trigger color-${kind}`} aria-label={`Alterar tipo de ${entry.key}`} title="Tipo de valor" onClick={event => popupAt(event.currentTarget, target, 'types')}>{kind === 'boolean' ? 'bool' : kind === 'number' ? '#' : kind === 'enum' ? 'enum' : 'Aa'}</button></div>
      <span className="equals" aria-hidden="true">=</span>
      <div className="value-area">
        {kind === 'boolean' ? <button type="button" role="switch" aria-checked={isBool} aria-label={entry.key} className={`toggle ${isBool ? 'on' : ''}`} onClick={() => changeValue(entry.id, /^(true|false|yes|no|on|off)$/i.test(entry.value) ? toggleBoolean(entry.value) : entry.value === '1' ? '0' : entry.value === '0' ? '1' : 'true')}><span /></button>
        : kind === 'enum' ? <button className="value-pill enum-value" aria-label={`Escolher ${entry.key}`} onClick={event => popupAt(event.currentTarget, target, 'values')}><Icon name="down" size={16} /><span>{entry.value || 'Escolher'}</span></button>
        : <div className={`value-pill editable-value ${kind === 'number' ? 'numeric' : ''}`}>{kind === 'number' && <div className="number-stepper"><button aria-label={`Aumentar ${entry.key}`} tabIndex={-1} onClick={() => { const n = Number(entry.value); if (Number.isFinite(n)) changeValue(entry.id, String(Math.round((n + 1) * 1e8) / 1e8)); }}><Icon name="down" size={12} /></button><button aria-label={`Diminuir ${entry.key}`} tabIndex={-1} onClick={() => { const n = Number(entry.value); if (Number.isFinite(n)) changeValue(entry.id, String(Math.round((n - 1) * 1e8) / 1e8)); }}><Icon name="down" size={12} /></button></div>}<input aria-label={entry.key} spellCheck={false} inputMode={kind === 'number' ? 'decimal' : 'text'} value={inputValue} style={{ width: `${Math.max(kind === 'number' ? 2 : 4, Math.min(inputValue.length, 38)) + .6}ch` }} onChange={event => { if (active) setDraft(active.uid, entry, event.target.value); }} onBlur={() => { if (active) flushDrafts(active.uid); }} onKeyDown={event => { if (event.key === 'Enter') { if (active && flushDrafts(active.uid) !== null) event.currentTarget.blur(); } if (event.key === 'Escape' && active) { clearDrafts(active.uid); event.currentTarget.blur(); } }} /></div>}
      </div>
    </div>;
  };

  return <div className={`app-shell ${dragOver ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (event.dataTransfer.types.includes('Files')) setDragOver(true); }} onDragLeave={event => { if (!event.relatedTarget) setDragOver(false); }} onDrop={event => void onDrop(event)}>
    <div className="titlebar"><span className="titlebar-name">CONFIGURA</span><div className="window-controls"><button aria-label="Minimizar" tabIndex={-1} onClick={() => api?.window('minimize')}><Icon name="minimize" size={16} /></button><button aria-label="Maximizar" tabIndex={-1} onClick={() => api?.window('maximize')}><Icon name="maximize" size={14} /></button><button className="window-close" aria-label="Fechar aplicativo" tabIndex={-1} onClick={() => api ? api.window('close') : notify('Use o instalador para abrir o aplicativo no Windows.')}><Icon name="close" size={19} /></button></div></div>
    <header className="app-header">
      <button className="brand" aria-label="Menu do Configura" onClick={() => setMenu(menu?.kind === 'app' ? null : { kind: 'app', x: 27, y: 111 })}><span className="brand-mark" /><span className="brand-name">configura<span>seu arquivo, do seu jeito.</span></span></button>
      <div className="tabs-area"><div className="file-tabs" role="tablist" aria-label="Arquivos abertos">{tabs.map(tab => <div key={tab.uid} className={`file-tab ${tab.uid === activeId ? 'active' : ''} ${isDirty(tab) ? 'modified' : ''}`}><button className="tab-label" role="tab" aria-selected={tab.uid === activeId} title={tab.path || `${tab.name}${tab.example ? ' · exemplo' : ''}`} onClick={() => { if (active && flushDrafts(active.uid) === null) return; setActiveId(tab.uid); setSearch(''); }}><span>{tab.name}</span>{isDirty(tab) && <span className="dirty-dot" aria-label="Alterações não salvas" />}</button><button className="tab-close" aria-label={`Fechar ${tab.name}`} onClick={() => void closeTab(tab.uid)}><Icon name="close" size={16} /></button></div>)}</div><button className="add-tab icon-button" title="Abrir arquivo · Ctrl+O" aria-label="Abrir arquivo" onClick={() => void openFiles()}><Icon name="plus" size={23} /></button></div>
      <div className={`search-box ${search ? 'has-query' : ''}`}><input ref={searchRef} aria-label="Buscar configurações" placeholder="Buscar configuração" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { setSearch(''); event.currentTarget.blur(); } }} /><button aria-label={search ? 'Limpar busca' : 'Buscar'} onClick={() => search ? setSearch('') : searchRef.current?.focus()}><Icon name={search ? 'close' : 'search'} size={18} /></button></div>
    </header>

    <main className="workspace">
      {active ? <>
        <div className="workspace-topline"><div className="file-caption"><span className="tiny-dot" />{active.example ? 'ARQUIVO DE EXEMPLO' : active.path ? 'EDITOR DE CONFIGURAÇÕES' : 'NOVO ARQUIVO'}<span className="caption-divider">/</span><span>{entryCount} {entryCount === 1 ? 'propriedade' : 'propriedades'}</span></div><div className="view-switch" role="group" aria-label="Modo de edição"><button className={mode === 'visual' ? 'selected' : ''} onClick={() => { if (active && flushDrafts(active.uid) === null) return; setMode('visual'); }} title="Editor visual"><Icon name="sliders" size={14} /><span>Visual</span></button><button className={mode === 'text' ? 'selected' : ''} onClick={() => { if (active && flushDrafts(active.uid) === null) return; setMode('text'); }} title="Editar texto original"><Icon name="code" size={15} /><span>Texto</span></button></div></div>
        <div className={`editor-scroll ${mode === 'text' ? 'source-scroll' : ''}`} key={`${active.uid}:${mode}`}>
          {mode === 'visual' ? <div className="sections-column">
            {parsed.warnings.length > 0 && <div className="parser-notice"><Icon name="info" size={16} /><p>{parsed.warnings[0]} <button onClick={() => { if (active && flushDrafts(active.uid) === null) return; setMode('text'); }}>Ver texto original</button></p></div>}
            {entryCount > 1500 ? <div className="empty-search"><Icon name="file" size={28} /><h2>Arquivo extenso</h2><p>Use o modo de texto para editar suas {entryCount} propriedades com fluidez.</p><button className="primary-button" onClick={() => { if (active && flushDrafts(active.uid) === null) return; setMode('text'); }}>Abrir editor de texto</button></div> : visibleSections.map(section => {
              const sectionOccurrence = parsed.sections.filter(s => s.name === section.name).findIndex(s => s.id === section.id); const collapseKey = `${active.name}:${section.name}${sectionOccurrence ? ':' + sectionOccurrence : ''}`; const isCollapsed = !search && !!collapsed[collapseKey];
              return <section className={`config-section ${isCollapsed ? 'collapsed' : ''}`} key={section.id}>
                <div className="section-heading"><button className="section-toggle" aria-expanded={!isCollapsed} aria-label={`${isCollapsed ? 'Expandir' : 'Recolher'} ${section.name}`} onClick={() => setCollapsed(current => ({ ...current, [collapseKey]: !isCollapsed }))}><Icon name="down" size={22} /><h2><span>[</span> {section.name} <span>]</span></h2></button><button className="section-add icon-button" aria-label={`Adicionar propriedade a ${section.name}`} title="Adicionar propriedade" onClick={() => setForm({ kind: 'field', sectionId: section.id, key: '', value: '' })}><Icon name="plus" size={18} /></button></div>
                <div className="section-collapse"><div className="section-rows">{section.entries.map(entry => renderEntry(entry, section))}{!section.entries.length && <button className="empty-section" onClick={() => setForm({ kind: 'field', sectionId: section.id, key: '', value: '' })}><Icon name="plus" size={16} />Adicionar primeira propriedade</button>}</div></div>
              </section>;
            })}
            {!visibleSections.length && search && <div className="empty-search"><Icon name="search" size={30} /><h2>Nenhum resultado</h2><p>Nenhuma configuração corresponde a “{search}”.</p><button className="text-button" onClick={() => setSearch('')}>Limpar busca</button></div>}
            {!search && entryCount <= 1500 && <button className="add-section-button" onClick={() => setForm({ kind: 'section', name: '' })}><Icon name="plus" size={18} />Adicionar seção</button>}
            {!parsed.sections.length && !search && <p className="empty-file-note">Comece com uma seção ou escreva diretamente no <button onClick={() => { if (active && flushDrafts(active.uid) === null) return; setMode('text'); }}>modo de texto</button>.</p>}
          </div> : <div className="source-editor"><div className="source-heading"><span><Icon name="code" size={15} />{active.name}</span><span>TEXTO ORIGINAL</span></div><div className="source-body"><pre className="line-numbers" aria-hidden="true">{active.text.split(/\r\n|\n|\r/).map((_, i) => i + 1).join('\n')}</pre><textarea ref={sourceRef} aria-label="Conteúdo do arquivo" value={active.text} spellCheck={false} wrap="off" onChange={event => updateText(active.uid, applySourceEdit(active.text, event.target.value))} onScroll={event => { const numbers = event.currentTarget.previousElementSibling; if (numbers) numbers.scrollTop = event.currentTarget.scrollTop; }} onKeyDown={(event: ReactKeyboardEvent<HTMLTextAreaElement>) => { if (event.key === 'Tab') { event.preventDefault(); const field = event.currentTarget; const start = field.selectionStart, end = field.selectionEnd; updateText(active.uid, applySourceEdit(active.text, field.value.slice(0, start) + '  ' + field.value.slice(end))); requestAnimationFrame(() => field.setSelectionRange(start + 2, start + 2)); } }} /></div></div>}
        </div>
      </> : <div className="welcome"><span className="welcome-logo brand-mark" /><div className="eyebrow">CONFIGURA</div><h1>Configurações.<br /><span>Sem complicação.</span></h1><p>Abra um arquivo e dê forma às suas configurações.</p><button className="primary-button welcome-open" onClick={() => void openFiles()}><Icon name="folder" />Abrir arquivo<span>Ctrl + O</span></button><button className="text-button" onClick={newFile}>ou crie um arquivo vazio</button><div className="supported-formats">.ini<span>·</span>.cfg<span>·</span>.conf<span>·</span>.properties<span>·</span>.env</div>{recentFiles.length > 0 && <div className="welcome-recents"><span>RECENTES</span>{recentFiles.slice(0, 3).map(path => <button key={path} onClick={() => void openRecent(path)}><Icon name="file" size={16} /><span>{path.split(/[\\/]/).at(-1)}</span><span>{path}</span></button>)}</div>}</div>}
    </main>

    <footer className="app-footer"><div className="footer-left"><button className="icon-button settings-button" title="Preferências · Ctrl+," aria-label="Preferências" onClick={() => setSettingsOpen(true)}><Icon name="settings" size={19} /></button><span className="footer-divider" /><div className="file-status"><span className={`status-dot ${active && isDirty(active) ? 'unsaved' : ''}`} /><span>{active ? isDirty(active) ? 'Alterações não salvas' : active.example ? 'Exemplo · pronto para explorar' : 'Todas as alterações salvas' : 'Pronto para abrir um arquivo'}</span></div>{active && <span className="encoding-label">{active.encoding.toUpperCase()}<span>·</span>{parsed.lineEnding === '\r\n' ? 'CRLF' : parsed.lineEnding === '\r' ? 'CR' : 'LF'}</span>}</div><div className="footer-actions">{active && <><button className="enum-library-button" title="Gerenciar tipos e listas" onClick={() => setEnumManagerOpen(true)}><span className="type-dots"><i /><i /><i /></span><span>Tipos</span></button><button className="reset-button" disabled={!isDirty(active) || saving} onClick={() => void resetFile()}>reset</button><button className={`save-button ${saving ? 'saving' : ''}`} disabled={saving} title="Salvar · Ctrl+S" onClick={() => void saveTab(active.uid)}>{saving ? 'salvando' : 'save'}<Icon name={saving ? 'more' : 'check'} size={17} /></button></>}</div></footer>

    <input className="sr-only" ref={fileInputRef} type="file" multiple accept=".ini,.cfg,.conf,.cnf,.properties,.env,.config,.toml,.txt" tabIndex={-1} onChange={event => { void readBrowserFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    {dragOver && <div className="drop-overlay"><Icon name="folder" size={48} /><h2>Solte seus arquivos aqui</h2><p>Cada arquivo abre em uma nova aba.</p></div>}
    {toast && <div className={`toast ${toast.error ? 'toast-error' : ''}`} role={toast.error ? 'alert' : 'status'}><Icon name={toast.error ? 'info' : 'check'} size={18} /><span>{toast.message}</span><button aria-label="Fechar notificação" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}

    {menu && <><div className="popup-dismiss" onMouseDown={() => setMenu(null)} /><div className={`popup popup-${menu.kind}`} style={{ left: menu.x, top: menu.y }} role="dialog" aria-label={menu.kind === 'app' ? 'Menu do aplicativo' : 'Tipo de configuração'}>
      {menu.kind === 'app' ? <><div className="popup-label">ARQUIVOS</div><button className="menu-row" onClick={() => void openFiles()}><Icon name="folder" size={17} />Abrir arquivo<kbd>Ctrl O</kbd></button><button className="menu-row" onClick={newFile}><Icon name="plus" size={17} />Novo arquivo<kbd>Ctrl N</kbd></button><button className="menu-row" disabled={!active} onClick={() => { setMenu(null); void saveTab(activeRef.current, true); }}><Icon name="save" size={17} />Salvar como<kbd>Ctrl ⇧ S</kbd></button>{recentFiles.length > 0 && <><div className="popup-divider" /><div className="popup-label">RECENTES</div>{recentFiles.slice(0, 5).map(path => <button key={path} className="menu-row recent-menu" title={path} onClick={() => void openRecent(path)}><Icon name="file" size={16} /><span>{path.split(/[\\/]/).at(-1)}</span></button>)}</>}<div className="popup-divider" /><button className="menu-row" onClick={() => { setMenu(null); setEnumManagerOpen(true); }}><Icon name="sliders" size={17} />Tipos e listas</button><button className="menu-row" onClick={() => { setMenu(null); setSettingsOpen(true); }}><Icon name="settings" size={17} />Preferências<kbd>Ctrl ,</kbd></button></>
      : menu.kind === 'types' ? <><div className="popup-label">TIPO DE VALOR</div>{kinds.map(item => <button key={item.kind} className={`type-menu-option color-${item.kind}`} onClick={() => item.kind === 'enum' ? setMenu({ ...menu, kind: 'enums' }) : chooseKind(menu.target, item.kind)}><span>{item.label}</span><small>{item.hint}</small>{kindFor(menu.target.entry, menu.target.section) === item.kind && <Icon name="check" size={14} />}</button>)}<div className="popup-divider" /><button className="menu-row subtle-danger" onClick={async () => { const target = menu.target; setMenu(null); const answer = await ask({ kind: 'confirm', title: 'Remover propriedade?', message: `A linha “${target.entry.key}” será removida. Você pode desfazer com Ctrl+Z.`, confirmLabel: 'Remover' }); if (answer === 'discard' && active) { try { const source = flushDrafts(active.uid); if (source !== null) updateText(active.uid, removeEntry(source, target.entry.id)); } catch (error) { report(error); } } }}><Icon name="trash" size={15} />Remover propriedade</button></>
      : menu.kind === 'enums' ? <><div className="enum-menu-heading"><button className="icon-button" aria-label="Voltar aos tipos" onClick={() => setMenu({ ...menu, kind: 'types' })}><Icon name="left" size={16} /></button><span>Enum</span></div>{presets.map(preset => <div className="preset-option" key={preset.id}><button onClick={() => chooseKind(menu.target, 'enum', preset.id)}>{preset.name}</button><button aria-label={`Editar lista ${preset.name}`} onClick={() => { setEditingPreset({ ...preset, values: [...preset.values] }); setMenu(null); }}><Icon name="edit" size={14} /></button></div>)}<button className="popup-add" aria-label="Nova lista" onClick={() => { setEditingPreset({ id: crypto.randomUUID(), name: '', values: [''] }); setMenu(null); }}><Icon name="plus" size={19} /></button></>
      : <><div className="popup-label">{presetFor(menu.target)?.name ?? 'VALORES'}</div><div className="enum-options">{Array.from(new Set([menu.target.entry.value, ...(presetFor(menu.target)?.values ?? [])])).map(value => <button key={value} className={`enum-choice ${value === menu.target.entry.value ? 'chosen' : ''}`} onClick={() => { changeValue(menu.target.entry.id, value); setMenu(null); }}><span>{value || '(vazio)'}</span>{value === menu.target.entry.value && <Icon name="check" size={15} />}</button>)}</div><div className="popup-divider" /><button className="menu-row" onClick={() => setMenu({ ...menu, kind: 'enums' })}><Icon name="sliders" size={15} />Trocar lista</button><button className="menu-row" onClick={() => chooseKind(menu.target, 'string')}><Icon name="edit" size={15} />Editar como texto</button></>}
    </div></>}

    {dialog && <Modal title={dialog.title} onClose={() => resolveDialog('cancel')} className="confirmation-modal"><p className="dialog-message">{dialog.message}</p><div className="modal-actions"><button className="secondary-button" onClick={() => resolveDialog('cancel')}>Cancelar</button>{dialog.kind === 'save' ? <><button className="text-button" onClick={() => resolveDialog('discard')}>Não salvar</button><button className="primary-button" onClick={() => resolveDialog('save')}>Salvar</button></> : <button className="primary-button" onClick={() => resolveDialog('discard')}>{dialog.confirmLabel ?? 'Confirmar'}</button>}</div></Modal>}

    {form && !dialog && <Modal title={form.kind === 'section' ? 'Nova seção' : 'Nova propriedade'} onClose={() => setForm(null)}><form onSubmit={event => { event.preventDefault(); submitForm(); }}>
      {form.kind === 'section' ? <label className="form-label">Nome da seção<input autoFocus value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Ex.: Graphics" required /></label> : <><label className="form-label">Propriedade<input value={form.key} onChange={event => setForm({ ...form, key: event.target.value })} placeholder="Ex.: MaxFPS" required /></label><label className="form-label">Valor<input value={form.value} onChange={event => setForm({ ...form, value: event.target.value })} placeholder="Ex.: 144" /></label></>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setForm(null)}>Cancelar</button><button type="submit" className="primary-button">Adicionar</button></div></form></Modal>}

    {enumManagerOpen && !editingPreset && !dialog && <Modal title="Tipos e listas" onClose={() => setEnumManagerOpen(false)} className="types-modal"><p className="modal-description">Cada valor tem seu próprio jeito de editar.</p><div className="type-legend">{kinds.map(item => <div key={item.kind}><span className={`color-${item.kind}`}>{item.label}</span><span>{item.hint}</span></div>)}</div><div className="settings-section-title">LISTAS ENUM<button className="icon-button" title="Nova lista" aria-label="Nova lista" onClick={() => setEditingPreset({ id: crypto.randomUUID(), name: '', values: [''] })}><Icon name="plus" size={18} /></button></div><div className="preset-list">{presets.map(preset => <div key={preset.id}><button onClick={() => setEditingPreset({ ...preset, values: [...preset.values] })}><span>{preset.name}</span><small>{preset.values.length} opções</small></button><button className="icon-button" aria-label={`Editar ${preset.name}`} onClick={() => setEditingPreset({ ...preset, values: [...preset.values] })}><Icon name="edit" size={16} /></button><button className="icon-button" aria-label={`Excluir ${preset.name}`} onClick={async () => { const answer = await ask({ kind: 'confirm', title: 'Excluir lista?', message: `A lista “${preset.name}” será excluída. Os valores dos arquivos serão preservados.`, confirmLabel: 'Excluir' }); if (answer === 'discard') { setPresets(current => current.filter(p => p.id !== preset.id)); setOverrides(current => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, value.preset === preset.id ? { kind: 'string' } : value]))); } }}><Icon name="trash" size={15} /></button></div>)}</div><p className="settings-help">Passe sobre uma propriedade e clique no tipo para escolher como editá-la. As listas ficam salvas no aplicativo.</p></Modal>}

    {editingPreset && !dialog && <Modal title={presets.some(p => p.id === editingPreset.id) ? 'Editar lista' : 'Nova lista'} onClose={() => setEditingPreset(null)}><form onSubmit={event => { event.preventDefault(); const values = Array.from(new Set(editingPreset.values.map(v => v.trim()).filter(Boolean))); if (!values.length) { notify('Adicione pelo menos uma opção à lista.', true); return; } const result = { ...editingPreset, name: editingPreset.name.trim(), values }; setPresets(current => current.some(p => p.id === result.id) ? current.map(p => p.id === result.id ? result : p) : [...current, result]); setEditingPreset(null); notify('Lista salva.'); }}><label className="form-label">Nome<input value={editingPreset.name} onChange={event => setEditingPreset({ ...editingPreset, name: event.target.value })} placeholder="Ex.: Quality" required /></label><label className="form-label">Opções <span>uma por linha</span><textarea rows={6} value={editingPreset.values.join('\n')} onChange={event => setEditingPreset({ ...editingPreset, values: event.target.value.split('\n') })} placeholder={'Low\nMedium\nHigh\nUltra'} required /></label><div className="modal-actions"><button type="button" className="secondary-button" onClick={() => setEditingPreset(null)}>Cancelar</button><button type="submit" className="primary-button">Salvar lista</button></div></form></Modal>}

    {settingsOpen && !dialog && <Modal title="Preferências" onClose={() => setSettingsOpen(false)} className="settings-modal"><div className="about-app"><span className="brand-mark" /><div><strong>configura</strong><span>Versão {appInfo.version}<i>·</i>Deimox</span></div><span className="license-badge">MIT</span></div><div className="settings-section-title">EDITOR</div><label className="settings-toggle"><div><span>Backup ao salvar</span><small>Guarda a versão anterior em .configura.bak</small></div><button type="button" role="switch" aria-checked={backupOnSave} aria-label="Backup ao salvar" className={`toggle ${backupOnSave ? 'on' : ''}`} onClick={() => setBackupOnSave(!backupOnSave)}><span /></button></label><label className="settings-toggle"><div><span>Reduzir animações</span><small>Transições mais discretas na interface</small></div><button type="button" role="switch" aria-checked={reducedMotion} aria-label="Reduzir animações" className={`toggle ${reducedMotion ? 'on' : ''}`} onClick={() => setReducedMotion(!reducedMotion)}><span /></button></label><div className="settings-section-title">ATUALIZAÇÕES</div><div className="update-box"><div className={`update-icon ${update.status === 'checking' || update.status === 'downloading' ? 'working' : ''}`}><Icon name={update.status === 'downloaded' || update.status === 'not-available' ? 'check' : 'download'} size={20} /></div><div><strong>{update.status === 'checking' ? 'Procurando atualizações…' : update.status === 'available' ? `Versão ${update.version} disponível` : update.status === 'downloading' ? `Baixando… ${Math.round(update.percent ?? 0)}%` : update.status === 'downloaded' ? 'Pronto para atualizar' : update.status === 'not-available' ? 'Você está na versão mais recente' : update.status === 'error' ? 'Não foi possível verificar' : 'Sempre na sua melhor versão'}</strong><p>{update.message || (update.status === 'downloaded' ? 'Suas alterações serão verificadas antes de reiniciar.' : 'Novas versões chegam pelo GitHub Releases.')}</p></div></div>{update.status === 'downloading' && <div className="update-progress"><span style={{ width: `${update.percent ?? 0}%` }} /></div>}<button className="secondary-button update-button" disabled={update.status === 'checking' || update.status === 'downloading'} onClick={() => { if (update.status === 'available' && api) void api.downloadUpdate().then(setUpdate).catch(report); else if (update.status === 'downloaded' && api) void api.installUpdate().catch(report); else void checkUpdates(); }}><Icon name="download" size={16} />{update.status === 'available' ? 'Baixar atualização' : update.status === 'downloaded' ? 'Reiniciar e atualizar' : 'Verificar atualizações'}</button><div className="settings-section-title">NO WINDOWS</div><p className="settings-help">Depois de instalar, clique com o botão direito em um arquivo → <strong>Abrir com → Configura</strong>. Também funciona arrastando o arquivo para esta janela.</p><div className="shortcut-grid"><span>Abrir arquivo<kbd>Ctrl O</kbd></span><span>Salvar<kbd>Ctrl S</kbd></span><span>Buscar<kbd>Ctrl F</kbd></span><span>Desfazer<kbd>Ctrl Z</kbd></span></div><div className="settings-bottom">Feito para os detalhes.<span>ItsDeimox / configura</span></div></Modal>}
  </div>;
}
