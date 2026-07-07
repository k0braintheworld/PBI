// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSwrCache } from '../src/swrCache.js';

const tick = () => new Promise((r) => setTimeout(r, 10));

test('sirve el valor fresco sin volver a producir', async () => {
  let t = 0; let calls = 0;
  const c = createSwrCache({ freshMs: 100, staleMs: 1000, clock: () => t });
  const prod = async () => { calls += 1; return `v${calls}`; };
  assert.equal(await c.get('k', prod), 'v1');
  t = 50;
  assert.equal(await c.get('k', prod), 'v1');
  assert.equal(calls, 1);
});

test('stale: devuelve lo viejo al instante y refresca en segundo plano', async () => {
  let t = 0; let calls = 0;
  const c = createSwrCache({ freshMs: 100, staleMs: 1000, clock: () => t });
  const prod = async () => { calls += 1; return `v${calls}`; };
  await c.get('k', prod);            // v1
  t = 200;                           // ventana stale
  assert.equal(await c.get('k', prod), 'v1'); // sirve lo viejo sin esperar
  await tick();                      // deja correr el refresco de fondo
  assert.equal(calls, 2);
  assert.equal(await c.get('k', prod), 'v2'); // ya refrescado
});

test('expirado: vuelve a producir esperando', async () => {
  let t = 0; let calls = 0;
  const c = createSwrCache({ freshMs: 100, staleMs: 1000, clock: () => t });
  await c.get('k', async () => { calls += 1; return 'a'; });
  t = 5000;
  const v = await c.get('k', async () => { calls += 1; return 'b'; });
  assert.equal(v, 'b');
  assert.equal(calls, 2);
});

test('invalidate fuerza recomputar', async () => {
  let calls = 0;
  const c = createSwrCache({ freshMs: 100000 });
  const prod = async () => { calls += 1; return calls; };
  await c.get('k', prod);
  c.invalidate('k');
  await c.get('k', prod);
  assert.equal(calls, 2);
});

test('claves independientes', async () => {
  const c = createSwrCache({ freshMs: 100000 });
  assert.equal(await c.get('a', async () => 1), 1);
  assert.equal(await c.get('b', async () => 2), 2);
  assert.equal(c.size(), 2);
});
