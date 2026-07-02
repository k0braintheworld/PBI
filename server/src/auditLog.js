import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const AUDIT_FILE = () => path.join(config.dataDir, 'audit.jsonl');
const CFG_FILE = () => path.join(config.dataDir, 'audit-config.json');
const DEFAULTS = { maxSizeMb: 10, maxFiles: 5 };

let _cfgCache = null; // la config de auditoría se lee en cada audit(); cacheamos
export function getAuditConfig() {
  if (_cfgCache) return _cfgCache;
  try { _cfgCache = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(CFG_FILE(), 'utf8')) }; }
  catch { _cfgCache = { ...DEFAULTS }; }
  return _cfgCache;
}

export function saveAuditConfig({ maxSizeMb, maxFiles }) {
  const out = { maxSizeMb: Number(maxSizeMb), maxFiles: Number(maxFiles) };
  fs.writeFileSync(CFG_FILE(), JSON.stringify(out, null, 2), { mode: 0o600 });
  _cfgCache = { ...DEFAULTS, ...out };
}

function rotate(file, maxFiles) {
  for (let i = maxFiles; i >= 1; i--) {
    const src = i === 1 ? file : `${file}.${i - 1}`;
    const dst = `${file}.${i}`;
    if (!fs.existsSync(src)) continue;
    try { if (i === maxFiles) fs.unlinkSync(dst); } catch { /* already gone */ }
    try { fs.renameSync(src, dst); } catch { /* ignore */ }
  }
}

/**
 * Registra una acción en el log de auditoría.
 * userOverride: { username, role } para eventos sin sesión activa (ej: login).
 */
export function audit(req, action, resource = '', result = 'ok', detail = '', userOverride = null) {
  try {
    const cfg = getAuditConfig();
    const file = AUDIT_FILE();
    try {
      if (fs.existsSync(file) && fs.statSync(file).size >= cfg.maxSizeMb * 1024 * 1024) {
        rotate(file, cfg.maxFiles);
      }
    } catch { /* rotation errors must not crash the server */ }

    const u = userOverride || req.user || { username: 'system', role: 'system' };
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      user: u.username || 'system',
      role: u.role || 'system',
      action,
      resource: String(resource),
      ip: req.ip || req.socket?.remoteAddress || '',
      result,
      detail: String(detail || '').slice(0, 500),
    });
    fs.appendFileSync(file, entry + '\n', { mode: 0o600 });
  } catch { /* audit must never crash the server */ }
}

export function listAudit({ page = 1, limit = 100, user, action, from, to } = {}) {
  const cfg = getAuditConfig();
  const file = AUDIT_FILE();
  const allLines = [];

  const files = [file];
  for (let i = 1; i <= cfg.maxFiles; i++) {
    const f = `${file}.${i}`;
    if (fs.existsSync(f)) files.push(f);
  }

  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    try {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (line.trim()) allLines.push(line);
      }
    } catch { /* skip unreadable files */ }
  }

  const entries = [];
  for (const line of allLines) {
    try {
      const e = JSON.parse(line);
      if (user && e.user !== user) continue;
      if (action && e.action !== action) continue;
      if (from && e.ts < from) continue;
      if (to && e.ts > to) continue;
      entries.push(e);
    } catch { /* skip malformed lines */ }
  }

  entries.sort((a, b) => (b.ts > a.ts ? 1 : b.ts < a.ts ? -1 : 0));

  const total = entries.length;
  return { total, page, limit, entries: entries.slice((page - 1) * limit, page * limit) };
}
