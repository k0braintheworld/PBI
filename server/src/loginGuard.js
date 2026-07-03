// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Protección anti-fuerza-bruta del login: bloqueo temporal por usuario y por IP
 * tras varios intentos fallidos. Contadores en memoria (se reinician al reiniciar
 * el servidor, aceptable). Sin dependencias externas.
 */

const MAX_FAILS = 5; // intentos antes de bloquear
const LOCK_MS = 15 * 60 * 1000; // duración del bloqueo
const WINDOW_MS = 15 * 60 * 1000; // ventana para contar fallos

const byKey = new Map(); // key -> { fails, first, until }

function state(key) {
  const now = Date.now();
  let s = byKey.get(key);
  if (!s) { s = { fails: 0, first: now, until: 0 }; byKey.set(key, s); }
  if (s.until && now > s.until) { s.fails = 0; s.first = now; s.until = 0; }
  else if (!s.until && now - s.first > WINDOW_MS) { s.fails = 0; s.first = now; }
  return s;
}

/** Segundos que quedan de bloqueo entre las claves dadas (0 = no bloqueado). */
export function lockRemaining(...keys) {
  const now = Date.now();
  let max = 0;
  for (const k of keys) {
    if (!k) continue;
    const s = byKey.get(k);
    if (s && s.until && now < s.until) max = Math.max(max, Math.ceil((s.until - now) / 1000));
  }
  return max;
}

export function recordFail(...keys) {
  for (const k of keys) {
    if (!k) continue;
    const s = state(k);
    s.fails += 1;
    if (s.fails >= MAX_FAILS) s.until = Date.now() + LOCK_MS;
  }
}

export function recordSuccess(...keys) {
  for (const k of keys) if (k) byKey.delete(k);
}

// Limpieza periódica de entradas caducadas
const timer = setInterval(() => {
  const now = Date.now();
  for (const [k, s] of byKey) {
    if ((s.until && now > s.until + WINDOW_MS) || (!s.until && now - s.first > WINDOW_MS)) byKey.delete(k);
  }
}, 10 * 60 * 1000);
timer.unref?.();
