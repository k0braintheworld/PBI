// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Guardrail anti-SSRF para los destinos que el usuario configura (hosts PBS/PVE y
 * el colector de PBI Central). El panel habla legítimamente con servidores en la
 * LAN del usuario, así que NO se bloquean rangos privados (RFC-1918) ni loopback
 * —Proxmox suele estar ahí—. Solo se rechaza lo que no tiene uso legítimo:
 *   - esquemas que no sean http/https,
 *   - el rango link-local 169.254.0.0/16 (incluye el endpoint de metadatos cloud
 *     169.254.169.254) y su equivalente IPv6 fe80::/10.
 * Es una barrera deliberadamente estrecha: evita el pivote clásico a metadatos sin
 * romper el caso de uso normal (PBS/PVE en IP privada o localhost).
 */

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

/** ¿Es una IPv4/IPv6 del rango link-local (metadata)? */
export function isLinkLocalHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;          // IPv4 link-local
  if (h === 'fe80::' || h.startsWith('fe80:')) return true;         // IPv6 link-local
  return false;
}

/**
 * Valida la URL de un destino configurable. Lanza un error 400 si no es apta.
 * Devuelve el objeto URL ya parseado por comodidad.
 */
export function assertSafeTargetUrl(raw) {
  if (!raw) throw httpErr(400, 'URL de destino vacía');
  let u;
  try { u = new URL(String(raw)); } catch { throw httpErr(400, 'URL de destino no válida'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw httpErr(400, 'Solo se permiten destinos http:// o https://');
  }
  if (isLinkLocalHost(u.hostname)) {
    throw httpErr(400, 'Destino no permitido: rango link-local/metadatos (169.254.0.0/16).');
  }
  return u;
}
