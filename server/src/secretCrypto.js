// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import crypto from 'node:crypto';
import { config } from './config.js';

/**
 * Cifrado de secretos en reposo (AES-256-GCM).
 *
 * Los secretos (token secrets, contraseñas, claves SMTP) se guardan cifrados en
 * los ficheros JSON de `dataDir`. La clave se deriva del `SESSION_SECRET` del
 * servidor, que en la instalación .deb vive en `/etc/pbi/pbi.env` —separado del
 * directorio de datos `/var/lib/pbi`—, de modo que una copia del directorio de
 * datos no basta para recuperar los secretos.
 *
 * Compatibilidad: los valores sin el prefijo `enc:v1:` se tratan como texto
 * plano (instalaciones anteriores); se re-cifran en el siguiente guardado o con
 * la migración de arranque.
 *
 * Aviso: si cambias `SESSION_SECRET`, los secretos ya cifrados dejan de poder
 * descifrarse y habrá que reintroducirlos.
 */

const PREFIX = 'enc:v1:';
const KEY = crypto.scryptSync(String(config.sessionSecret || 'pbi-dev'), 'pbi-secret-store-v1', 32);

export function encryptSecret(plain) {
  if (plain == null || plain === '') return plain;
  const s = String(plain);
  if (s.startsWith(PREFIX)) return s; // ya cifrado
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value; // texto plano antiguo
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    // No se pudo descifrar (SESSION_SECRET distinto/rotado o dato corrupto). NUNCA
    // devolver el texto cifrado como si fuera el secreto: se entregaría basura a
    // PBS/PVE/SMTP. Se avisa de forma visible y se devuelve vacío para que la
    // operación falle limpiamente y el operador reintroduzca la credencial.
    console.warn('[secretCrypto] No se pudo descifrar un secreto guardado. '
      + '¿Ha cambiado SESSION_SECRET? Reintroduce las credenciales afectadas (host/PVE/SMTP).');
    return '';
  }
}

/** ¿El valor está cifrado con este esquema? */
export const isEncrypted = (v) => typeof v === 'string' && v.startsWith(PREFIX);
