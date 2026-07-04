// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { requireAdmin } from '../session.js';
import { audit } from '../auditLog.js';

/**
 * Copia de seguridad de la configuración de PBI: exporta/importa los JSON del
 * directorio de datos (hosts, PVE, usuarios, notificaciones, informes, trabajos
 * de restauración, seguridad).
 *
 * El fichero de copia va SIEMPRE cifrado con una contraseña que elige el usuario
 * (scrypt para derivar la clave + AES-256-GCM). Sin esa contraseña el contenido
 * no es explorable: los secretos —incluidos los `totpSecret` y las credenciales,
 * que dentro ya están cifrados con SESSION_SECRET— quedan bajo una segunda capa.
 * Para restaurar hay que introducir la misma contraseña. Se mantiene la lectura
 * de copias antiguas en claro (kind `pbi-config-backup`) por compatibilidad.
 *
 * NO incluye el log de auditoría (puede ser grande) ni el SESSION_SECRET (vive en
 * /etc/pbi/pbi.env). Para restaurar en OTRA instalación hay que conservar el mismo
 * SESSION_SECRET (los secretos internos siguen cifrados con él).
 */

const FILES = ['hosts.json', 'pve.json', 'users.json', 'notify.json', 'report.json', 'restore.json', 'security.json', 'audit-config.json'];

const ENC_KIND = 'pbi-config-backup-enc';
const PLAIN_KIND = 'pbi-config-backup';
const KDF = { algo: 'scrypt', N: 16384, r: 8, p: 1 };

function httpErr(status, message) { const e = new Error(message); e.status = status; return e; }

function deriveKey(password, salt) {
  return crypto.scryptSync(String(password), salt, 32, { N: KDF.N, r: KDF.r, p: KDF.p, maxmem: 64 * 1024 * 1024 });
}

function encryptBackup(payload, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(payload), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    kind: ENC_KIND,
    v: 1,
    kdf: { ...KDF, salt: salt.toString('base64') },
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ct.toString('base64'),
  };
}

function decryptBackup(env, password) {
  const salt = Buffer.from(env.kdf?.salt || '', 'base64');
  const iv = Buffer.from(env.iv || '', 'base64');
  const tag = Buffer.from(env.tag || '', 'base64');
  const ct = Buffer.from(env.data || '', 'base64');
  if (!salt.length || iv.length !== 12 || tag.length !== 16 || !ct.length) {
    throw httpErr(400, 'El fichero de copia está incompleto o dañado.');
  }
  const key = crypto.scryptSync(String(password), salt, 32, {
    N: env.kdf?.N || KDF.N, r: env.kdf?.r || KDF.r, p: env.kdf?.p || KDF.p, maxmem: 64 * 1024 * 1024,
  });
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let pt;
  try {
    pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    // El tag GCM no cuadra: contraseña incorrecta o fichero manipulado.
    throw httpErr(400, 'Contraseña incorrecta o fichero dañado.');
  }
  try { return JSON.parse(pt.toString('utf8')); } catch { throw httpErr(400, 'Contenido de la copia no válido.'); }
}

// Claves peligrosas que nunca deben restaurarse tal cual (defensa anti prototype-pollution).
const isSafeKey = (k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
function assertNoPollution(value) {
  if (Array.isArray(value)) { value.forEach(assertNoPollution); return; }
  if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (!isSafeKey(k)) throw httpErr(400, `Clave no permitida en la copia: ${k}`);
      assertNoPollution(value[k]);
    }
  }
}

export const configBackupRouter = Router();

// Exporta la configuración CIFRADA con la contraseña indicada por el usuario.
configBackupRouter.post('/export', requireAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 8) {
    return res.status(400).json({ error: 'Indica una contraseña de al menos 8 caracteres para cifrar la copia.' });
  }
  const files = {};
  for (const name of FILES) {
    try { files[name] = JSON.parse(fs.readFileSync(path.join(config.dataDir, name), 'utf8')); }
    catch { /* fichero inexistente: omitir */ }
  }
  const payload = { kind: PLAIN_KIND, version: 1, exportedAt: new Date().toISOString(), files };
  const envelope = encryptBackup(payload, password);
  audit(req, 'config.export', '', 'ok', `${Object.keys(files).length} ficheros (cifrado)`);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="pbi-config-${stamp}.pbibak"`);
  res.send(JSON.stringify(envelope));
});

// Importa (y descifra) una copia. Requiere la contraseña con la que se cifró.
configBackupRouter.post('/import', requireAdmin, (req, res) => {
  const body = req.body || {};
  const { password } = body;
  let payload;

  if (body.kind === ENC_KIND) {
    if (!password) return res.status(400).json({ error: 'Introduce la contraseña de la copia.' });
    payload = decryptBackup(body, password); // lanza 400 si la contraseña no cuadra
  } else if (body.kind === PLAIN_KIND) {
    // Copia antigua sin cifrar (compatibilidad).
    payload = body;
  } else {
    return res.status(400).json({ error: 'El fichero no es una copia de configuración de PBI válida.' });
  }

  if (typeof payload.files !== 'object' || payload.files == null) {
    return res.status(400).json({ error: 'La copia no contiene datos de configuración.' });
  }
  assertNoPollution(payload.files);

  const written = [];
  for (const name of FILES) {
    if (payload.files[name] === undefined) continue;
    try {
      fs.writeFileSync(path.join(config.dataDir, name), JSON.stringify(payload.files[name], null, 2), { mode: 0o600 });
      try { fs.chmodSync(path.join(config.dataDir, name), 0o600); } catch { /* ignore */ }
      written.push(name);
    } catch (e) {
      return res.status(500).json({ error: `No se pudo escribir ${name}: ${e.message}`, written });
    }
  }
  audit(req, 'config.import', '', 'ok', written.join(', '));
  res.json({ ok: true, written });
});
