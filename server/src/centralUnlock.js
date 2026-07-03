// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import crypto from 'node:crypto';

/**
 * Desbloqueo de la feature "PBI Central" (unlock de autor). La opción se ve en la
 * configuración pero está BLOQUEADA hasta introducir la contraseña correcta. Aquí NO
 * se guarda la contraseña: solo un hash lento (scrypt) contra el que se valida.
 *
 * Modelo: el hash va compilado en PBI (BUILTIN_UNLOCK_HASH). Como PBI es open source,
 * ese hash es público; la seguridad depende de que la contraseña sea larga y aleatoria
 * (20+ caracteres) para que no pueda romperse por fuerza bruta contra el hash.
 *
 * Se puede sobreescribir por instalación con la variable de entorno
 * PBI_CENTRAL_UNLOCK_HASH (p. ej. un hash propio fijado por SSH en /etc/pbi/pbi.env).
 *
 * Genera el hash con:  node scripts/gen-unlock-hash.mjs
 * Formato: scrypt$<N>$<r>$<p>$<salt_b64>$<hash_b64>
 */

const BUILTIN_UNLOCK_HASH = 'scrypt$16384$8$1$aylCUAEn0ymuEXSbHX3eSg==$MsJfczdXp79v5YxD4M/JN1AWbFXhULMUKPi5Z7buTIg=';

const UNLOCK_HASH = process.env.PBI_CENTRAL_UNLOCK_HASH || BUILTIN_UNLOCK_HASH;

export function isUnlockConfigured() {
  return /^scrypt\$/.test(UNLOCK_HASH);
}

export function verifyUnlock(password) {
  if (!isUnlockConfigured() || !password) return false;
  try {
    const [, N, r, p, saltB64, hashB64] = UNLOCK_HASH.split('$');
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const got = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 128 * 1024 * 1024,
    });
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}
