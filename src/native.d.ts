export interface NativeDocument { id: string; name: string; path: string; text: string; encoding: string }
export interface UpdateState { status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unavailable'; version?: string; percent?: number; message?: string }
export interface AppInfo { version: string; platform: string; isPackaged: boolean }
export interface ConfiguraAPI {
  getAppInfo(): Promise<AppInfo>;
  getInitialFiles(): Promise<NativeDocument[]>;
  openFiles(): Promise<NativeDocument[]>;
  openPaths(paths: string[]): Promise<NativeDocument[]>;
  openRecent(path: string): Promise<NativeDocument | null>;
  saveFile(file: { id?: string; text: string; saveAs?: boolean; name?: string }): Promise<NativeDocument | null>;
  closeFile(id: string): Promise<void>;
  setDirty(dirty: boolean): void;
  window(action: 'minimize' | 'maximize' | 'close'): void;
  confirmClose(): void;
  cancelClose(): void;
  getPreferences(): Promise<{ recentFiles: string[]; [key: string]: unknown }>;
  setPreferences(patch: Record<string, unknown>): Promise<void>;
  getUpdateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<unknown>;
  onOpenFiles(cb: (files: NativeDocument[]) => void): () => void;
  onMenuAction(cb: (action: string) => void): () => void;
  onUpdateState(cb: (state: UpdateState) => void): () => void;
  getPathForFile(file: File): string;
}
declare global { interface Window { configura?: ConfiguraAPI } }
