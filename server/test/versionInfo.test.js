// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2026 Jairo Alvarez Caballero ("k0bra")
import test from 'node:test';
import assert from 'node:assert/strict';
import { cmpVersion } from '../src/versionInfo.js';

test('cmpVersion ordena correctamente', () => {
  assert.equal(cmpVersion('1.18.0', '1.17.0'), 1);
  assert.equal(cmpVersion('1.17.0', '1.18.0'), -1);
  assert.equal(cmpVersion('1.17.0', '1.17.0'), 0);
  assert.equal(cmpVersion('1.17.1', '1.17.0'), 1);
  assert.equal(cmpVersion('2.0.0', '1.99.99'), 1);
});

test('cmpVersion tolera prefijo v y longitudes distintas', () => {
  assert.equal(cmpVersion('v1.17.0', '1.17.0'), 0);
  assert.equal(cmpVersion('1.2', '1.2.0'), 0);
  assert.equal(cmpVersion('1.2.1', '1.2'), 1);
});
