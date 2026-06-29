// Iconos de línea (stroke currentColor). viewBox 24x24.
const S = (props) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" {...props} />
);

export const Icon = {
  dashboard: (p) => (<S {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></S>),
  database: (p) => (<S {...p}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></S>),
  jobs: (p) => (<S {...p}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="M12 13v3l2 1.5" /></S>),
  activity: (p) => (<S {...p}><path d="M3 12h4l3 7 4-14 3 7h4" /></S>),
  report: (p) => (<S {...p}><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="11" width="3" height="6" rx="1" /><rect x="12" y="7" width="3" height="10" rx="1" /><rect x="17" y="13" width="3" height="4" rx="1" /></S>),
  settings: (p) => (<S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7.7 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1A2 2 0 1 1 7 4.6l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></S>),
  shield: (p) => (<S {...p}><path d="M12 3l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></S>),
  server: (p) => (<S {...p}><rect x="3" y="4" width="18" height="7" rx="1.5" /><rect x="3" y="13" width="18" height="7" rx="1.5" /><path d="M7 7.5h.01M7 16.5h.01" /></S>),
  desktop: (p) => (<S {...p}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></S>),
  layers: (p) => (<S {...p}><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /></S>),
  hdd: (p) => (<S {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 14h.01M11 14h6" /></S>),
  file: (p) => (<S {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></S>),
  check: (p) => (<S {...p}><path d="M5 12l4 4L19 6" /></S>),
  x: (p) => (<S {...p}><path d="M6 6l12 12M18 6L6 18" /></S>),
  clock: (p) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>),
  download: (p) => (<S {...p}><path d="M12 3v12M7 11l5 5 5-5" /><path d="M5 21h14" /></S>),
  play: (p) => (<S {...p}><path d="M7 5l11 7-11 7z" /></S>),
  refresh: (p) => (<S {...p}><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></S>),
  bolt: (p) => (<S {...p}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></S>),
  restore: (p) => (<S {...p}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 4v4h4" /><path d="M12 8v4l3 2" /></S>),
  folder: (p) => (<S {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></S>),
  chevronRight: (p) => (<S {...p}><path d="M9 6l6 6-6 6" /></S>),
  cpu: (p) => (<S {...p}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" /></S>),
  arrowLeft: (p) => (<S {...p}><path d="M15 6l-6 6 6 6" /></S>),
  trash: (p) => (<S {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" /></S>),
  broom: (p) => (<S {...p}><path d="M19 5l-7 7M14 7l3 3M11 10l-5 5c-1 1-1 3 0 4s3 1 4 0l5-5M6 19l-2 2" /></S>),
  info: (p) => (<S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></S>),
  audit: (p) => (<S {...p}><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" /><rect x="9" y="3" width="6" height="4" rx="1.5" /><path d="M9 12h6M9 16h4" /></S>),
};
