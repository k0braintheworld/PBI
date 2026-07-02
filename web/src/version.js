export const APP_VERSION = '1.9.1';
export const APP_COPYRIGHT = '© 2026 k0bra';
export const APP_LICENSE = 'GNU GPL v3';
export const APP_TAGLINE = 'Backup interface for Proxmox';

/** Compara versiones "1.8.5" / "v1.8.5". Devuelve -1, 0, 1. */
export function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
