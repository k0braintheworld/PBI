import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import * as users from '../userStore.js';

/**
 * Auto-actualización segura, SIN que el servicio web escale privilegios.
 *  - Solo admins, con re-autenticación (contraseña del propio usuario).
 *  - El servicio solo ESCRIBE una solicitud (URL + SHA-256) en un fichero;
 *    una unidad systemd root independiente (pbi-update.path → .service) la
 *    detecta, descarga el .deb de la release OFICIAL, verifica el SHA-256 e
 *    instala. La contraseña de root nunca toca la aplicación.
 */
export const updateRouter = Router();

const UPDATER = '/opt/pbi/pbi-update';
const REQ_FILE = path.join(config.dataDir, '.update-request');
const RELEASE_RE = /^https:\/\/github\.com\/k0braintheworld\/PBI\/releases\/download\/[^/]+\/[\w.+-]+\.deb$/;

const hasUpdater = () => { try { return fs.statSync(UPDATER).isFile(); } catch { return false; } };
const hasDownloader = () => ['/usr/bin/curl', '/bin/curl', '/usr/bin/wget', '/bin/wget']
  .some((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });

updateRouter.get('/capability', (req, res) => {
  const updater = hasUpdater();
  const downloader = hasDownloader();
  res.json({ selfUpdate: updater && downloader, updater, downloader });
});

updateRouter.post('/apply', (req, res) => {
  const { password, url, sha256 } = req.body || {};

  if (!hasUpdater()) {
    return res.status(400).json({ error: 'La auto-instalación no está disponible en este sistema (instala el .deb o actualiza manualmente).' });
  }
  if (!hasDownloader()) {
    return res.status(400).json({ error: "Falta 'curl' (o 'wget') en el servidor. Instálalo (apt install -y curl) o actualiza manualmente." });
  }
  // Re-autenticación con la contraseña del admin que la solicita
  const u = users.getById(req.user.userId);
  if (!u || !users.verifyPassword(password || '', u.salt, u.hash)) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  if (!RELEASE_RE.test(url || '')) {
    return res.status(400).json({ error: 'URL del paquete no válida (debe ser una release oficial de PBI).' });
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256 || '')) {
    return res.status(400).json({ error: 'Checksum SHA-256 no válido.' });
  }

  // Escribir la solicitud de forma atómica; la unidad root la procesa.
  try {
    const tmp = `${REQ_FILE}.tmp`;
    fs.writeFileSync(tmp, `${url}\n${sha256.toLowerCase()}\n`, { mode: 0o600 });
    fs.renameSync(tmp, REQ_FILE);
  } catch (e) {
    return res.status(500).json({ error: `No se pudo registrar la solicitud: ${e.message}` });
  }
  res.json({ ok: true, message: 'Actualización solicitada: se descargará, verificará e instalará. El servicio se reiniciará en unos segundos.' });
});
