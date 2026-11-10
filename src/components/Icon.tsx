import type { CSSProperties } from 'react';

const paths: Record<string, React.ReactNode> = {
  plus: <path d="M10 4v12M4 10h12" />,
  close: <path d="m5 5 10 10M15 5 5 15" />,
  search: <><circle cx="8.5" cy="8.5" r="5" /><path d="m12.5 12.5 4 4" /></>,
  down: <path d="m5 7.5 5 5 5-5" />,
  left: <path d="m12.5 5-5 5 5 5" />,
  folder: <path d="M2.5 15.5V5a1 1 0 0 1 1-1H8l2 2h6.5a1 1 0 0 1 1 1v1.5M2.5 15.5 5 9h13l-2.5 7H3.5a1 1 0 0 1-1-1Z" />,
  settings: <><path d="m8 2-.5 2-2 .8L3.7 4 2 7l1.5 1.4v2.2L2 12l1.7 3 1.8-.8 2 .8.5 2h4l.5-2 2-.8 1.8.8 1.7-3-1.5-1.4V8.4L18 7l-1.7-3-1.8.8-2-.8-.5-2Z" /><circle cx="10" cy="9.5" r="2.5" /></>,
  code: <path d="m6 5-4 5 4 5m8-10 4 5-4 5M11.5 3l-3 14" />,
  sliders: <><path d="M4 3v14M10 3v14M16 3v14" /><path d="M2 7h4M8 13h4M14 7h4" /></>,
  save: <><path d="M3 3h11l3 3v11H3V3Z" /><path d="M6 3v5h7V3M6 17v-6h8v6" /></>,
  undo: <><path d="M3 8h8a5 5 0 0 1 0 10M3 8l4-4M3 8l4 4" /></>,
  download: <><path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4" /></>,
  check: <path d="m4 10 4 4 8-8" />,
  edit: <><path d="m3 13 10-10 4 4L7 17H3v-4Zm8-8 4 4" /></>,
  trash: <><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6m4-6v6" /></>,
  file: <><path d="M4 2h8l4 4v12H4V2Z" /><path d="M12 2v5h4M7 11h6M7 14h4" /></>,
  more: <><circle cx="4" cy="10" r="1" /><circle cx="10" cy="10" r="1" /><circle cx="16" cy="10" r="1" /></>,
  maximize: <rect x="5" y="5" width="10" height="10" rx=".5" />,
  minimize: <path d="M4 10h12" />,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 5.5v.5" /></>,
  keyboard: <><rect x="2" y="4" width="16" height="12" rx="2" /><path d="M5 7h.1M8 7h.1M11 7h.1M14 7h.1M5 10h.1M8 10h.1M11 10h.1M14 10h.1M6 13h8" /></>,
};
export default function Icon({ name, size = 20, className = '', style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const exported: Record<string, string> = { folder: 'open-folder', down: 'chevron-down', left: 'chevron-left', plus: 'plus', close: 'close', search: 'search', settings: 'settings', code: 'code', sliders: 'sliders', save: 'save', undo: 'undo', download: 'download', check: 'check', edit: 'edit', trash: 'trash', file: 'file', maximize: 'maximize', minimize: 'minimize' };
  if (exported[name]) return <span aria-hidden="true" className={`figma-icon ${className}`} style={{ width: size, height: size, maskImage: `url(./icons/${exported[name]}.svg)`, WebkitMaskImage: `url(./icons/${exported[name]}.svg)`, ...style }} />;
  return <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name] ?? paths.file}</svg>;
}
