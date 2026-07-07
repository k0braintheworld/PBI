// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Versión de PBI en el lado servidor y comparación de versiones. El servidor NO
 * puede importar estáticamente de web/src (no se empaqueta en el .deb), así que la
 * versión actual se toma de PBI_VERSION (inyectada por el .deb) y, solo en
 * desarrollo, se intenta leer web/src/version.js dinámicamente.
 */

let _cache;
export async function resolveVersion() {
  if (_cache !== undefined) return _cache;
  if (process.env.PBI_VERSION) { _cache = process.env.PBI_VERSION; return _cache; }
  try { _cache = (await import('../../web/src/version.js')).APP_VERSION || ''; }
  catch { _cache = ''; }
  return _cache;
}

/** Compara "1.17.0" / "v1.17.0". Devuelve -1, 0, 1 (a<b, a==b, a>b). */
export function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
