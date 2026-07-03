// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { useEffect, useState } from 'react';
import { api } from './api.js';

/**
 * Mapa vmid -> nombre de la VM/CT, obtenido de Proxmox VE (la fuente fiable
 * del nombre; PBS solo guarda el id numérico). Se cachea a nivel de módulo
 * para no repetir la llamada entre vistas. Si no hay PVE configurado o falla,
 * devuelve un mapa vacío y las vistas muestran solo el id.
 */

let cache = null;
let inflight = null;

export function loadGuestNames() {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const pve = await api.pveList();
      const def = pve.find((p) => p.isDefault) || pve[0];
      if (!def) { cache = {}; return cache; }
      const guests = await api.pveGuests(def.id);
      const map = {};
      for (const g of guests || []) map[String(g.vmid)] = g.name;
      cache = map;
      return map;
    } catch {
      cache = {};
      return cache;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export function useGuestNames() {
  const [map, setMap] = useState(cache || {});
  useEffect(() => { loadGuestNames().then(setMap); }, []);
  return map;
}

/** Extrae el vmid de un id de tarea tipo "store:vm/103" o "store::vm/103/time". */
export function vmidFromTaskId(id) {
  const m = /(?:vm|ct|qemu|lxc)[/-](\d+)/i.exec(id || '');
  return m ? m[1] : null;
}

/** Devuelve "id · nombre" para vm/ct si se conoce el nombre; si no, solo el id. */
export function nameFor(map, type, id) {
  if (!id) return '—';
  if (type === 'host') return id; // los host backups ya usan el hostname
  const n = map[String(id)];
  return n ? `${id} · ${n}` : String(id);
}
