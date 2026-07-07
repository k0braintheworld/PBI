// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret, isEncrypted } from '../src/secretCrypto.js';

test('cifra y descifra ida y vuelta', () => {
  const enc = encryptSecret('s3cr3t-token');
  assert.ok(isEncrypted(enc));
  assert.notEqual(enc, 's3cr3t-token');
  assert.equal(decryptSecret(enc), 's3cr3t-token');
});

test('valores vacíos/nulos no se tocan', () => {
  assert.equal(encryptSecret(''), '');
  assert.equal(encryptSecret(null), null);
});

test('texto plano antiguo (sin prefijo) se devuelve tal cual', () => {
  assert.equal(decryptSecret('valor-en-claro'), 'valor-en-claro');
  assert.equal(isEncrypted('valor-en-claro'), false);
});

test('un valor cifrado ya cifrado no se re-cifra', () => {
  const enc = encryptSecret('x');
  assert.equal(encryptSecret(enc), enc);
});

test('descifrado corrupto devuelve vacío (fail-visible, nunca el cifrado)', () => {
  const enc = encryptSecret('importante');
  const body = enc.slice('enc:v1:'.length);
  const flip = body[4] === 'A' ? 'B' : 'A';
  const corrupted = `enc:v1:${body.slice(0, 4)}${flip}${body.slice(5)}`;
  const out = decryptSecret(corrupted);
  assert.equal(out, '');
  assert.notEqual(out, corrupted); // nunca devuelve el texto cifrado
});
