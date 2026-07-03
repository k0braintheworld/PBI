// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * VMs/CTs de Proxmox VE que NO requieren copia de seguridad (por diseño) y que, por
 * tanto, no deben contar como "sin proteger" ni generar alerta —ni en el panel de PBI,
 * ni en el resumen por email, ni en el informe a PBI Central—. Lista de VMIDs con un
 * nombre y un motivo opcionales. Persistente en el directorio de datos.
 */

const FILE = path.join(config.dataDir, 'excluded-vms.json');

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).items || []; } catch { return []; }
}
function write(items) {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify({ items }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** Lista de excluidas: [{ vmid, name, reason, at }]. */
export const list = () => read();

/** Conjunto de VMIDs excluidos (como strings), para filtrar rápido. */
export const excludedSet = () => new Set(read().map((x) => String(x.vmid)));

export function add({ vmid, name, reason }) {
  const id = String(vmid || '').trim();
  if (!id) throw httpErr(400, 'VMID obligatorio');
  const items = read();
  if (!items.some((x) => String(x.vmid) === id)) {
    items.push({ vmid: id, name: name || '', reason: reason || '', at: new Date().toISOString() });
    write(items);
  }
  return list();
}

export function remove(vmid) {
  const id = String(vmid || '');
  write(read().filter((x) => String(x.vmid) !== id));
  return list();
}

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }
