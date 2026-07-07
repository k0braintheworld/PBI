// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
/**
 * Caché en memoria con estrategia stale-while-revalidate.
 *
 *  - Dentro de `freshMs`: devuelve el valor cacheado tal cual (rápido).
 *  - Entre `freshMs` y `staleMs`: devuelve el valor cacheado AL INSTANTE y lanza un
 *    refresco en segundo plano (no bloquea la petición). Ideal para el dashboard:
 *    si PBS va lento durante un backup, el panel sigue mostrando el último estado
 *    conocido sin quedarse "cargando", y se actualiza cuando el refresco termina.
 *  - Pasado `staleMs` (o sin valor previo): produce el valor y espera.
 *
 * `clock` es inyectable para poder testear el comportamiento temporal.
 */
export function createSwrCache({ freshMs = 8000, staleMs = 60000, clock = () => Date.now() } = {}) {
  const store = new Map(); // key -> { value, at, refreshing }

  function refreshInBackground(key, producer) {
    const e = store.get(key);
    if (!e || e.refreshing) return;
    e.refreshing = true;
    Promise.resolve()
      .then(producer)
      .then((value) => { store.set(key, { value, at: clock() }); })
      .catch(() => { const cur = store.get(key); if (cur) cur.refreshing = false; });
  }

  async function get(key, producer) {
    const now = clock();
    const e = store.get(key);
    if (e && now - e.at < freshMs) return e.value;          // fresco
    if (e && now - e.at < staleMs) {                        // stale: sirve ya + refresca en bg
      refreshInBackground(key, producer);
      return e.value;
    }
    const value = await producer();                         // ausente/muy viejo: espera
    store.set(key, { value, at: clock() });
    return value;
  }

  return {
    get,
    /** Invalida una clave (o todo si no se indica) — p. ej. tras una mutación. */
    invalidate(key) { if (key === undefined) store.clear(); else store.delete(key); },
    size: () => store.size,
  };
}
