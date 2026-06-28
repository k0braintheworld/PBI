import { Router } from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import * as users from '../userStore.js';

/**
 * Auto-actualización segura.
 *  - Solo admins, y exige re-autenticación con la contraseña del propio usuario.
 *  - La instalación real la hace un actualizador root muy acotado
 *    (/opt/pbi/pbi-update vía una regla sudoers que solo permite ESE script),
 *    que descarga el .deb de la release oficial y VERIFICA su SHA-256 antes de
 *    instalar. La contraseña de root nunca toca la aplicación.
 */
export const updateRouter = Router();

const UPDATER = '/opt/pbi/pbi-update';
const RELEASE_RE = /^https:\/\/github\.com\/k0braintheworld\/PBI\/releases\/download\/[^/]+\/[\w.+-]+\.deb$/;

const hasUpdater = () => {
  try { return fs.statSync(UPDATER).isFile(); } catch { return false; }
};
const hasSudo = () => ['/usr/bin/sudo', '/bin/sudo', '/usr/local/bin/sudo'].some((p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
});
const hasCapability = () => hasUpdater() && hasSudo();

// Estado de la auto-instalación: si el script está y si 'sudo' está disponible.
updateRouter.get('/capability', (req, res) => {
  const updater = hasUpdater();
  const sudo = hasSudo();
  res.json({ selfUpdate: updater && sudo, updater, sudo });
});

// Lanza la instalación de un .deb concreto (con re-auth + verificación de checksum)
updateRouter.post('/apply', (req, res) => {
  const { password, url, sha256 } = req.body || {};

  if (!hasUpdater()) {
    return res.status(400).json({ error: 'La auto-instalación no está disponible en este sistema (instala el .deb o actualiza manualmente).' });
  }
  if (!hasSudo()) {
    return res.status(400).json({ error: "Falta 'sudo' en el servidor. Instálalo (apt install -y sudo) o actualiza manualmente." });
  }
  // Re-autenticación: contraseña del admin que la solicita
  const u = users.getById(req.user.userId);
  if (!u || !users.verifyPassword(password || '', u.salt, u.hash)) {
    return res.status(401).json({ error: 'Contraseña incorrecta.' });
  }
  // Validar paquete y checksum (defensa en profundidad; el script vuelve a comprobarlo)
  if (!RELEASE_RE.test(url || '')) {
    return res.status(400).json({ error: 'URL del paquete no válida (debe ser una release oficial de PBI).' });
  }
  if (!/^[a-f0-9]{64}$/i.test(sha256 || '')) {
    return res.status(400).json({ error: 'Checksum SHA-256 no válido.' });
  }

  // sudo -n: no interactivo; usa la regla sudoers acotada. El script descarga,
  // verifica el checksum y lanza dpkg en una unidad transitoria desacoplada.
  const child = spawn('sudo', ['-n', UPDATER, url, sha256], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('error', (e) => {
    if (!res.headersSent) res.status(500).json({ error: `No se pudo ejecutar el actualizador: ${e.message}` });
  });
  child.on('close', (code) => {
    if (res.headersSent) return;
    if (code === 0) res.json({ ok: true, message: 'Actualización lanzada. El servicio se reiniciará en unos segundos.' });
    else res.status(500).json({ error: (out.trim() || `El actualizador falló (código ${code}).`) });
  });
});
