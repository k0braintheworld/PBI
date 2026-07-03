// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { requireAdmin } from '../session.js';
import { audit } from '../auditLog.js';

/**
 * Copia de seguridad de la configuración de PBI: exporta/importa los JSON del
 * directorio de datos (hosts, PVE, usuarios, notificaciones, informes, trabajos
 * de restauración, seguridad). NO incluye el log de auditoría (puede ser grande)
 * ni el SESSION_SECRET (vive en /etc/pbi/pbi.env). Los secretos van cifrados tal
 * cual están en disco: para restaurar en OTRA instalación hay que conservar el
 * mismo SESSION_SECRET.
 */

const FILES = ['hosts.json', 'pve.json', 'users.json', 'notify.json', 'report.json', 'restore.json', 'security.json', 'audit-config.json'];

export const configBackupRouter = Router();

configBackupRouter.get('/export', requireAdmin, (req, res) => {
  const files = {};
  for (const name of FILES) {
    try {
      files[name] = JSON.parse(fs.readFileSync(path.join(config.dataDir, name), 'utf8'));
    } catch { /* fichero inexistente: omitir */ }
  }
  audit(req, 'config.export', '', 'ok', `${Object.keys(files).length} ficheros`);
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="pbi-config-${stamp}.json"`);
  res.send(JSON.stringify({ kind: 'pbi-config-backup', version: 1, exportedAt: new Date().toISOString(), files }, null, 2));
});

configBackupRouter.post('/import', requireAdmin, (req, res) => {
  const body = req.body || {};
  if (body.kind !== 'pbi-config-backup' || typeof body.files !== 'object' || body.files == null) {
    return res.status(400).json({ error: 'El fichero no es una copia de configuración de PBI válida' });
  }
  const written = [];
  for (const name of FILES) {
    if (body.files[name] === undefined) continue;
    try {
      fs.writeFileSync(path.join(config.dataDir, name), JSON.stringify(body.files[name], null, 2), { mode: 0o600 });
      try { fs.chmodSync(path.join(config.dataDir, name), 0o600); } catch { /* ignore */ }
      written.push(name);
    } catch (e) {
      return res.status(500).json({ error: `No se pudo escribir ${name}: ${e.message}`, written });
    }
  }
  audit(req, 'config.import', '', 'ok', written.join(', '));
  res.json({ ok: true, written });
});
