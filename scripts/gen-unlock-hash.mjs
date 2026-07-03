#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import crypto from 'node:crypto';

/**
 * Genera el hash scrypt de la contraseña de desbloqueo de "PBI Central".
 * La contraseña NO se muestra ni se guarda: solo se imprime su hash, que es lo que
 * se pega en server/src/centralUnlock.js (BUILTIN_UNLOCK_HASH) o se pone en la
 * variable de entorno PBI_CENTRAL_UNLOCK_HASH.
 *
 * Uso:  node scripts/gen-unlock-hash.mjs
 *
 * Recomendación: usa una contraseña larga y aleatoria (20+ caracteres). El hash es
 * público (PBI es open source), así que la seguridad depende de que no se pueda
 * adivinar por fuerza bruta.
 */

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

// Lee una línea de stdin con el eco desactivado (modo raw en TTY; lectura directa
// si la entrada viene por pipe).
function askHidden(query) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    stdout.write(query);

    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (c) => { data += c; });
      stdin.on('end', () => { stdout.write('\n'); resolve(data.split(/\r?\n/)[0] || ''); });
      stdin.on('error', reject);
      return;
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 10 || code === 13 || code === 4) { // Enter / EOF (Ctrl-D)
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener('data', onData);
          stdout.write('\n');
          resolve(input);
          return;
        }
        if (code === 3) { stdout.write('\n'); process.exit(1); } // Ctrl-C
        else if (code === 127 || code === 8) input = input.slice(0, -1); // backspace
        else input += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const pass = await askHidden('Contraseña de desbloqueo: ');
if (!pass || pass.length < 8) {
  console.error('La contraseña es demasiado corta. Usa 20+ caracteres aleatorios.');
  process.exit(1);
}
if (process.stdin.isTTY) {
  const pass2 = await askHidden('Repite la contraseña: ');
  if (pass !== pass2) {
    console.error('Las contraseñas no coinciden.');
    process.exit(1);
  }
}

const salt = crypto.randomBytes(16);
const hash = crypto.scryptSync(pass, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * 1024 * 1024 });
const line = `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;

if (pass.length < 20) {
  console.log('\nAVISO: contraseña de menos de 20 caracteres. El hash es público; usa una más larga si puedes.');
}
console.log('\nHash de desbloqueo (pégalo en centralUnlock.js -> BUILTIN_UNLOCK_HASH,');
console.log('o ponlo en PBI_CENTRAL_UNLOCK_HASH en /etc/pbi/pbi.env):\n');
console.log(line);
console.log('');
process.exit(0);
