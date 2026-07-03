import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../centralStore.js';
import { sendNow } from '../centralReporter.js';
import { verifyUnlock, isUnlockConfigured } from '../centralUnlock.js';
import { isCentralUnlocked, setCentralUnlocked } from '../featureStore.js';
import { config } from '../config.js';
import { audit } from '../auditLog.js';

/**
 * Configuración del emisor hacia PBI Central. Solo admin (se monta con requireAdmin).
 * La feature está BLOQUEADA hasta que un admin introduce la contraseña de autor
 * (POST /unlock). Mientras siga bloqueada, las rutas de configuración responden 404
 * (como si la feature no existiera). El endpoint de unlock/estado sí responde.
 */

export const centralRouter = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Rate-limit sencillo en memoria para los intentos de desbloqueo (anti fuerza bruta
// online). El riesgo real (offline, contra el hash público) se mitiga con una
// contraseña larga y aleatoria; esto solo frena los intentos por la API.
const attempts = new Map(); // key -> { count, until }
const MAX = 5;
const WINDOW_MS = 15 * 60 * 1000;
function limited(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (a && a.until > now && a.count >= MAX) return true;
  return false;
}
function bump(key, ok) {
  const now = Date.now();
  if (ok) { attempts.delete(key); return; }
  const a = attempts.get(key);
  if (!a || a.until <= now) attempts.set(key, { count: 1, until: now + WINDOW_MS });
  else a.count += 1;
}

// Estado de la feature (para que la GUI muestre bloqueado/desbloqueado).
centralRouter.get('/state', (_req, res) => {
  res.json({ unlocked: isCentralUnlocked(), unlockConfigured: isUnlockConfigured() });
});

// Desbloqueo con la contraseña de autor.
centralRouter.post('/unlock', wrap(async (req, res) => {
  const key = `${req.user?.username || '?'}:${req.ip}`;
  if (limited(key)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  if (!isUnlockConfigured()) {
    return res.status(409).json({ error: 'Esta build no tiene configurada la contraseña de desbloqueo.' });
  }
  const ok = verifyUnlock(req.body?.password || '');
  bump(key, ok);
  audit(req, 'central.unlock', '', ok ? 'ok' : 'fail', ok ? 'Feature desbloqueada' : 'Contraseña incorrecta');
  if (!ok) return res.status(403).json({ error: 'Contraseña incorrecta.' });
  setCentralUnlocked(true, req.user?.username);
  res.json({ ok: true, unlocked: true });
}));

// Volver a bloquear (oculta la config; el emisor deja de enviar).
centralRouter.post('/lock', wrap(async (req, res) => {
  setCentralUnlocked(false);
  audit(req, 'central.lock', '', 'ok', 'Feature bloqueada');
  res.json({ ok: true, unlocked: false });
}));

// A partir de aquí, todo requiere que la feature esté desbloqueada.
centralRouter.use((_req, res, next) => {
  if (!isCentralUnlocked()) return res.status(404).json({ error: 'No disponible' });
  next();
});

// Importar un paquete de enrolamiento (.pbic) emitido por PBI Central: escribe los
// certificados en disco (clave 600) y rellena la configuración del emisor (URL, site,
// rutas). Evita tener que copiar ficheros por SSH ni teclear rutas.
centralRouter.post('/enroll', wrap(async (req, res) => {
  const b = req.body || {};
  if (b.kind !== 'pbi-central-enrollment' || !b.cert || !b.key || !b.site?.id) {
    return res.status(400).json({ error: 'El fichero no es un paquete de sede válido' });
  }
  const dir = path.join(config.dataDir, 'central');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const siteId = String(b.site.id).replace(/[^a-zA-Z0-9._-]/g, '_');
  const certPath = path.join(dir, `${siteId}.crt`);
  const keyPath = path.join(dir, `${siteId}.key`);
  // caPath = certificado de SERVIDOR del central (para verificar/pinear la conexión).
  // Si el paquete no lo trae (central con certificado real, p.ej. Let's Encrypt), se
  // deja vacío y la sede valida contra las CAs del sistema.
  const serverCaPem = b.serverCa || null;
  const caPath = path.join(dir, 'server-ca.crt');
  try {
    fs.writeFileSync(certPath, b.cert, { mode: 0o644 });
    fs.writeFileSync(keyPath, b.key, { mode: 0o600 });
    try { fs.chmodSync(keyPath, 0o600); } catch { /* ignore */ }
    if (serverCaPem) fs.writeFileSync(caPath, serverCaPem, { mode: 0o644 });
  } catch (e) {
    return res.status(500).json({ error: `No se pudieron escribir los certificados: ${e.message}` });
  }
  const out = store.update({
    url: b.central?.url || store.getRaw().url,
    siteId: b.site.id,
    siteName: b.site.name || b.site.id,
    clientCertPath: certPath,
    clientKeyPath: keyPath,
    caPath: serverCaPem ? caPath : '',
  });
  audit(req, 'central.enroll', '', 'ok', `Paquete importado para ${b.site.id}`);
  res.json(out);
}));

centralRouter.get('/', (req, res) => res.json(store.masked()));

centralRouter.put('/', wrap(async (req, res) => {
  const out = store.update(req.body || {});
  audit(req, 'central.update', '', 'ok', `Emisor ${out.enabled ? 'activado' : 'desactivado'}${out.url ? ` → ${out.url}` : ''}`);
  res.json(out);
}));

// Fuerza una recolección + envío inmediato (para probar la conexión al central).
centralRouter.post('/test', wrap(async (req, res) => {
  const r = await sendNow();
  audit(req, 'central.test', '', r.ok ? 'ok' : 'fail', r.ok ? `Enviado (seq ${r.sequence})` : `Error: ${r.error}`);
  res.json(r);
}));
