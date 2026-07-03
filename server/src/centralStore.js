// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

/**
 * Configuración persistente del emisor hacia PBI Central (panel multi-sede).
 * Esta instancia de PBI hace PUSH saliente de su estado agregado al colector
 * central. NO se guardan secretos aquí: la identidad de la sede es un certificado
 * cliente cuyo fichero (clave privada incluida) vive en disco y solo se referencia
 * por RUTA — la clave nunca pasa por la API ni por el navegador.
 */

const FILE = path.join(config.dataDir, 'central.json');

const DEFAULTS = {
  enabled: false,
  url: '',                 // p.ej. https://central.midominio.com:4100
  siteId: '',              // debe coincidir con el CN del certificado cliente
  siteName: '',
  clientCertPath: '',      // certificado cliente de la sede (mTLS)
  clientKeyPath: '',       // clave privada del certificado cliente
  caPath: '',              // CA que valida el certificado de SERVIDOR del central (opcional)
  intervalMinutes: 10,
  sendMachineNames: true,  // enviar nombres de VM/CT además de IDs
  sequence: 0,             // contador monótono anti-replay (lo gestiona el emisor)
  lastResult: null,        // { at, ok, error?, status? } del último envío
};

function ensure() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(DEFAULTS, null, 2), { mode: 0o600 });
}

export function getRaw() {
  ensure();
  try {
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(cfg) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch { /* ignore */ }
}

/** No hay secretos que enmascarar (solo rutas); se devuelve tal cual. */
export function masked() {
  return getRaw();
}

/** Actualiza la configuración (mezcla). Los campos internos no se tocan por API. */
export function update(input) {
  const cur = getRaw();
  const { sequence, lastResult, ...safe } = input || {}; // ignorar campos internos
  const next = { ...cur, ...safe };
  next.intervalMinutes = Math.max(1, Math.min(1440, Number(next.intervalMinutes) || 10));
  next.sequence = cur.sequence;
  next.lastResult = cur.lastResult;
  write(next);
  return masked();
}

/** Reserva y persiste el siguiente número de secuencia (monótono). */
export function nextSequence() {
  const cur = getRaw();
  const seq = (Number(cur.sequence) || 0) + 1;
  write({ ...cur, sequence: seq });
  return seq;
}

export function setLastResult(result) {
  const cur = getRaw();
  write({ ...cur, lastResult: result });
}
