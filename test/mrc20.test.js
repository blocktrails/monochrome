/**
 * MRC20 test suite
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  MRC20,
  jcs,
  hashState,
  createState,
  createMeta,
  validateMeta,
  validatePubkey,
  validateStateStructure,
  OPS
} from '../index.js';

// Test pubkeys (x-only, 32 bytes hex)
const ALICE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BOB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const CHARLIE = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

describe('JCS', () => {
  test('sorts keys alphabetically', () => {
    const obj = { b: 2, a: 1 };
    const result = jcs(obj);
    assert.strictEqual(result, '{"a":1,"b":2}');
  });

  test('handles nested objects', () => {
    const obj = { z: { b: 2, a: 1 }, a: 1 };
    const result = jcs(obj);
    assert.strictEqual(result, '{"a":1,"z":{"a":1,"b":2}}');
  });

  test('handles arrays (no sorting)', () => {
    const obj = { arr: [3, 1, 2] };
    const result = jcs(obj);
    assert.strictEqual(result, '{"arr":[3,1,2]}');
  });
});

describe('hashState', () => {
  test('produces consistent hash', () => {
    const state = { op: 'test', data: { x: 1 } };
    const h1 = hashState(state);
    const h2 = hashState(state);
    assert.strictEqual(h1, h2);
  });

  test('produces 64 char hex', () => {
    const state = { op: 'test', data: {} };
    const h = hashState(state);
    assert.strictEqual(h.length, 64);
    assert.ok(/^[0-9a-f]{64}$/.test(h));
  });
});

describe('validatePubkey', () => {
  test('accepts valid pubkey', () => {
    assert.strictEqual(validatePubkey(ALICE), true);
  });

  test('rejects short pubkey', () => {
    assert.strictEqual(validatePubkey('aaa'), false);
  });

  test('rejects uppercase', () => {
    assert.strictEqual(validatePubkey(ALICE.toUpperCase()), false);
  });

  test('rejects non-hex', () => {
    assert.strictEqual(validatePubkey('gg' + ALICE.slice(2)), false);
  });
});

describe('validateMeta', () => {
  test('accepts valid meta', () => {
    const meta = createMeta('Test Token', 'TST', 8, 1000000);
    assert.strictEqual(validateMeta(meta).valid, true);
  });

  test('accepts unlimited supply', () => {
    const meta = createMeta('Test Token', 'TST', 8, null);
    assert.strictEqual(validateMeta(meta).valid, true);
  });

  test('rejects empty name', () => {
    const meta = createMeta('', 'TST', 8, null);
    assert.strictEqual(validateMeta(meta).valid, false);
  });

  test('rejects negative decimals', () => {
    const meta = createMeta('Test', 'TST', -1, null);
    assert.strictEqual(validateMeta(meta).valid, false);
  });
});

describe('MRC20', () => {
  test('creates token with meta', () => {
    const ledger = new MRC20(createMeta('Test Token', 'TST', 8, null));
    assert.strictEqual(ledger.meta.name, 'Test Token');
    assert.strictEqual(ledger.meta.symbol, 'TST');
  });

  test('mint creates genesis', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    const state = ledger.mint(ALICE, 1000);

    assert.strictEqual(state.op, OPS.MINT);
    assert.strictEqual(state.seq, 0);
    assert.strictEqual(state.prev, null);
    assert.strictEqual(ledger.balance(ALICE), 1000n);
    assert.strictEqual(ledger.totalSupply(), 1000n);
  });

  test('mint adds to supply', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.mint(BOB, 500);

    assert.strictEqual(ledger.balance(ALICE), 1000n);
    assert.strictEqual(ledger.balance(BOB), 500n);
    assert.strictEqual(ledger.totalSupply(), 1500n);
  });

  test('mint respects max_supply', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, 1000));
    ledger.mint(ALICE, 800);

    assert.throws(() => {
      ledger.mint(BOB, 300); // would exceed 1000
    }, /max_supply/);
  });

  test('transfer moves tokens', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.transfer(ALICE, BOB, 300);

    assert.strictEqual(ledger.balance(ALICE), 700n);
    assert.strictEqual(ledger.balance(BOB), 300n);
    assert.strictEqual(ledger.totalSupply(), 1000n);
  });

  test('transfer fails on insufficient balance', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);

    assert.throws(() => {
      ledger.transfer(ALICE, BOB, 1500);
    }, /Insufficient/);
  });

  test('burn removes tokens', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.burn(ALICE, 200);

    assert.strictEqual(ledger.balance(ALICE), 800n);
    assert.strictEqual(ledger.totalSupply(), 800n);
  });

  test('burn fails on insufficient balance', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);

    assert.throws(() => {
      ledger.burn(ALICE, 1500);
    }, /Insufficient/);
  });

  test('state chain has correct prev hashes', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.transfer(ALICE, BOB, 300);
    ledger.burn(BOB, 100);

    const states = ledger.states;
    assert.strictEqual(states[0].prev, null);
    assert.strictEqual(states[1].prev, hashState(states[0]));
    assert.strictEqual(states[2].prev, hashState(states[1]));
  });

  test('state chain has correct seq', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.transfer(ALICE, BOB, 300);
    ledger.burn(BOB, 100);

    const states = ledger.states;
    assert.strictEqual(states[0].seq, 0);
    assert.strictEqual(states[1].seq, 1);
    assert.strictEqual(states[2].seq, 2);
  });
});

describe('MRC20.replay', () => {
  test('rebuilds ledger from states', () => {
    const original = new MRC20(createMeta('Test', 'TST', 8, null));
    original.mint(ALICE, 1000);
    original.transfer(ALICE, BOB, 300);
    original.burn(BOB, 100);

    const rebuilt = MRC20.replay(original.states);

    assert.strictEqual(rebuilt.balance(ALICE), 700n);
    assert.strictEqual(rebuilt.balance(BOB), 200n);
    assert.strictEqual(rebuilt.totalSupply(), 900n);
  });

  test('detects invalid prev hash', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.transfer(ALICE, BOB, 300);

    // Tamper with prev hash
    const states = JSON.parse(JSON.stringify(ledger.states));
    states[1].prev = 'deadbeef'.repeat(8);

    assert.throws(() => {
      MRC20.replay(states);
    }, /prev hash mismatch/);
  });

  test('detects invalid seq', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);

    const states = JSON.parse(JSON.stringify(ledger.states));
    states[0].seq = 5;

    assert.throws(() => {
      MRC20.replay(states);
    }, /seq mismatch/);
  });

  test('detects changed meta', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.mint(BOB, 500);

    const states = JSON.parse(JSON.stringify(ledger.states));
    // Fix prev hash after changing meta
    states[1].meta.name = 'Changed Name';
    states[1].prev = hashState(states[0]);

    assert.throws(() => {
      MRC20.replay(states);
    }, /meta changed/);
  });
});

describe('MRC20.verify', () => {
  test('valid chain returns true', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.transfer(ALICE, BOB, 300);

    const result = MRC20.verify(ledger.states);
    assert.strictEqual(result.valid, true);
  });

  test('invalid chain returns error', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, null));
    ledger.mint(ALICE, 1000);
    ledger.transfer(ALICE, BOB, 300);

    const states = JSON.parse(JSON.stringify(ledger.states));
    // Tamper with genesis - this breaks state[1].prev hash
    states[0].data.amount = 999999;

    const result = MRC20.verify(states);
    assert.strictEqual(result.valid, false);
  });
});

describe('export', () => {
  test('exports all data', () => {
    const ledger = new MRC20(createMeta('Test', 'TST', 8, 1000000));
    ledger.mint(ALICE, 1000);

    const exported = ledger.export();

    assert.strictEqual(exported.meta.name, 'Test');
    assert.strictEqual(exported.states.length, 1);
    assert.strictEqual(exported.supply, '1000');
    assert.strictEqual(exported.balances[ALICE], '1000');
  });
});
