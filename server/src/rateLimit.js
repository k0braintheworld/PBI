// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Limitador de intentos en memoria, con purga automática para no crecer sin límite.
 * Se usa para operaciones sensibles del panel (activar/desactivar 2FA, etc.) como
 * defensa anti fuerza bruta. Los contadores se reinician al reiniciar el servidor.
 */

const MAX_ENTRIES = 10000; // tope duro del Map (defensa anti-DoS de memoria)

export function createLimiter({ max = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const byKey = new Map(); // key -> { fails, first, until }

  const sweep = () => {
    const now = Date.now();
    for (const [k, s] of byKey) {
      if ((s.until && now > s.until) || (!s.until && now - s.first > windowMs)) byKey.delete(k);
    }
    // Si aún así se dispara (ataque con muchas claves distintas), recorta a la fuerza.
    if (byKey.size > MAX_ENTRIES) {
      const excess = byKey.size - MAX_ENTRIES;
      let i = 0;
      for (const k of byKey.keys()) { byKey.delete(k); if (++i >= excess) break; }
    }
  };

  const timer = setInterval(sweep, 5 * 60 * 1000);
  timer.unref?.();

  return {
    /** Segundos que quedan de bloqueo para la clave (0 = no bloqueada). */
    locked(key) {
      const s = byKey.get(key);
      if (!s || !s.until) return 0;
      const rem = Math.ceil((s.until - Date.now()) / 1000);
      return rem > 0 ? rem : 0;
    },
    /** Registra un intento; ok=true lo limpia, ok=false suma y bloquea al llegar a max. */
    record(key, ok) {
      if (ok) { byKey.delete(key); return; }
      if (byKey.size >= MAX_ENTRIES) sweep();
      const now = Date.now();
      let s = byKey.get(key);
      if (!s || (s.until && now > s.until) || (!s.until && now - s.first > windowMs)) {
        s = { fails: 0, first: now, until: 0 };
        byKey.set(key, s);
      }
      s.fails += 1;
      if (s.fails >= max) s.until = now + windowMs;
    },
  };
}

/** Limitador compartido para las operaciones de 2FA del autoservicio de cuenta. */
export const twofaLimiter = createLimiter({ max: 5, windowMs: 15 * 60 * 1000 });
