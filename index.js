/**
 * MRC20 - Fungible tokens on Blocktrails
 * Monochrome profile implementation
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';

// ============================================
// JCS (JSON Canonicalization Scheme - RFC 8785)
// ============================================

/**
 * Serialize object to JCS canonical form
 */
export function jcs(obj) {
  return JSON.stringify(obj, (_, v) => {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      return Object.keys(v).sort().reduce((sorted, key) => {
        sorted[key] = v[key];
        return sorted;
      }, {});
    }
    return v;
  });
}

/**
 * Hash state using JCS serialization
 */
export function hashState(state) {
  const canonical = jcs(state);
  const bytes = new TextEncoder().encode(canonical);
  return bytesToHex(sha256(bytes));
}

// ============================================
// Monochrome Base
// ============================================

export const OPS = {
  SET: 'urn:mono:op:set',
  APPEND: 'urn:mono:op:append',
  MINT: 'urn:mono:op:mint',
  TRANSFER: 'urn:mono:op:transfer',
  BURN: 'urn:mono:op:burn'
};

/**
 * Create a Monochrome state object
 */
export function createState(op, data, prev, seq, meta = null) {
  const state = {
    op,
    data,
    prev,
    seq
  };
  if (meta !== null) {
    state.meta = meta;
  }
  return state;
}

/**
 * Validate Monochrome state structure
 */
export function validateStateStructure(state) {
  if (typeof state !== 'object' || state === null) {
    return { valid: false, error: 'State must be an object' };
  }
  if (typeof state.op !== 'string' || !state.op.startsWith('urn:mono:op:')) {
    return { valid: false, error: 'Invalid op URN' };
  }
  if (typeof state.data !== 'object' || state.data === null) {
    return { valid: false, error: 'data must be an object' };
  }
  if (state.prev !== null && typeof state.prev !== 'string') {
    return { valid: false, error: 'prev must be null or string' };
  }
  if (typeof state.seq !== 'number' || state.seq < 0 || !Number.isInteger(state.seq)) {
    return { valid: false, error: 'seq must be a non-negative integer' };
  }
  return { valid: true };
}

// ============================================
// MRC20 Token Profile
// ============================================

/**
 * MRC20 token metadata
 */
export function createMeta(name, symbol, decimals = 8, maxSupply = null) {
  return {
    name,
    symbol,
    decimals,
    max_supply: maxSupply
  };
}

/**
 * Validate MRC20 metadata
 */
export function validateMeta(meta) {
  if (typeof meta !== 'object' || meta === null) {
    return { valid: false, error: 'meta must be an object' };
  }
  if (typeof meta.name !== 'string' || meta.name.length === 0) {
    return { valid: false, error: 'meta.name must be a non-empty string' };
  }
  if (typeof meta.symbol !== 'string' || meta.symbol.length === 0) {
    return { valid: false, error: 'meta.symbol must be a non-empty string' };
  }
  if (typeof meta.decimals !== 'number' || meta.decimals < 0 || meta.decimals > 18) {
    return { valid: false, error: 'meta.decimals must be 0-18' };
  }
  if (meta.max_supply !== null && (typeof meta.max_supply !== 'number' || meta.max_supply <= 0)) {
    return { valid: false, error: 'meta.max_supply must be null or positive number' };
  }
  return { valid: true };
}

/**
 * Validate pubkey format (32-byte hex, lowercase)
 */
export function validatePubkey(pubkey) {
  if (typeof pubkey !== 'string') return false;
  if (pubkey.length !== 64) return false;
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return false;
  return true;
}

/**
 * MRC20 Ledger - tracks balances and validates operations
 */
export class MRC20 {
  constructor(meta) {
    const validation = validateMeta(meta);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    this.meta = meta;
    this.balances = new Map();
    this.supply = 0n;
    this.states = [];
    this.seq = 0;
  }

  /**
   * Get balance for a pubkey
   */
  balance(pubkey) {
    return this.balances.get(pubkey.toLowerCase()) || 0n;
  }

  /**
   * Get total supply
   */
  totalSupply() {
    return this.supply;
  }

  /**
   * Create genesis state (first mint)
   */
  genesis(to, amount) {
    if (!validatePubkey(to)) {
      throw new Error('Invalid pubkey format');
    }
    const amountBig = BigInt(amount);
    if (amountBig <= 0n) {
      throw new Error('Amount must be positive');
    }
    if (this.meta.max_supply !== null && amountBig > BigInt(this.meta.max_supply)) {
      throw new Error('Amount exceeds max_supply');
    }

    const state = createState(
      OPS.MINT,
      { to: to.toLowerCase(), amount: Number(amountBig) },
      null,
      0,
      this.meta
    );

    // Apply
    this.balances.set(to.toLowerCase(), amountBig);
    this.supply = amountBig;
    this.states.push(state);
    this.seq = 1;

    return state;
  }

  /**
   * Mint new tokens
   */
  mint(to, amount) {
    if (this.states.length === 0) {
      return this.genesis(to, amount);
    }

    if (!validatePubkey(to)) {
      throw new Error('Invalid pubkey format');
    }
    const amountBig = BigInt(amount);
    if (amountBig <= 0n) {
      throw new Error('Amount must be positive');
    }
    if (this.meta.max_supply !== null) {
      if (this.supply + amountBig > BigInt(this.meta.max_supply)) {
        throw new Error('Mint would exceed max_supply');
      }
    }

    const prev = hashState(this.states[this.states.length - 1]);
    const state = createState(
      OPS.MINT,
      { to: to.toLowerCase(), amount: Number(amountBig) },
      prev,
      this.seq,
      this.meta
    );

    // Apply
    const current = this.balance(to);
    this.balances.set(to.toLowerCase(), current + amountBig);
    this.supply += amountBig;
    this.states.push(state);
    this.seq++;

    return state;
  }

  /**
   * Transfer tokens
   */
  transfer(from, to, amount) {
    if (this.states.length === 0) {
      throw new Error('No genesis state');
    }
    if (!validatePubkey(from)) {
      throw new Error('Invalid from pubkey format');
    }
    if (!validatePubkey(to)) {
      throw new Error('Invalid to pubkey format');
    }
    const amountBig = BigInt(amount);
    if (amountBig <= 0n) {
      throw new Error('Amount must be positive');
    }
    const fromBalance = this.balance(from);
    if (fromBalance < amountBig) {
      throw new Error(`Insufficient balance: ${fromBalance} < ${amountBig}`);
    }

    const prev = hashState(this.states[this.states.length - 1]);
    const state = createState(
      OPS.TRANSFER,
      { from: from.toLowerCase(), to: to.toLowerCase(), amount: Number(amountBig) },
      prev,
      this.seq,
      this.meta
    );

    // Apply
    this.balances.set(from.toLowerCase(), fromBalance - amountBig);
    const toBalance = this.balance(to);
    this.balances.set(to.toLowerCase(), toBalance + amountBig);
    this.states.push(state);
    this.seq++;

    return state;
  }

  /**
   * Burn tokens
   */
  burn(from, amount) {
    if (this.states.length === 0) {
      throw new Error('No genesis state');
    }
    if (!validatePubkey(from)) {
      throw new Error('Invalid from pubkey format');
    }
    const amountBig = BigInt(amount);
    if (amountBig <= 0n) {
      throw new Error('Amount must be positive');
    }
    const fromBalance = this.balance(from);
    if (fromBalance < amountBig) {
      throw new Error(`Insufficient balance: ${fromBalance} < ${amountBig}`);
    }

    const prev = hashState(this.states[this.states.length - 1]);
    const state = createState(
      OPS.BURN,
      { from: from.toLowerCase(), amount: Number(amountBig) },
      prev,
      this.seq,
      this.meta
    );

    // Apply
    this.balances.set(from.toLowerCase(), fromBalance - amountBig);
    this.supply -= amountBig;
    this.states.push(state);
    this.seq++;

    return state;
  }

  /**
   * Export all states
   */
  export() {
    return {
      meta: this.meta,
      states: this.states,
      balances: Object.fromEntries(
        Array.from(this.balances.entries()).map(([k, v]) => [k, v.toString()])
      ),
      supply: this.supply.toString()
    };
  }

  /**
   * Replay states to rebuild ledger (for verification)
   */
  static replay(states) {
    if (states.length === 0) {
      throw new Error('No states to replay');
    }

    // Get meta from first state
    const meta = states[0].meta;
    if (!meta) {
      throw new Error('Genesis state missing meta');
    }

    const ledger = new MRC20(meta);
    // Clear auto-created state
    ledger.states = [];
    ledger.seq = 0;

    for (let i = 0; i < states.length; i++) {
      const state = states[i];
      const validation = validateStateStructure(state);
      if (!validation.valid) {
        throw new Error(`State ${i}: ${validation.error}`);
      }

      // Verify prev hash
      if (i === 0) {
        if (state.prev !== null) {
          throw new Error('Genesis state prev must be null');
        }
      } else {
        const expectedPrev = hashState(states[i - 1]);
        if (state.prev !== expectedPrev) {
          throw new Error(`State ${i}: prev hash mismatch`);
        }
      }

      // Verify seq
      if (state.seq !== i) {
        throw new Error(`State ${i}: seq mismatch (expected ${i}, got ${state.seq})`);
      }

      // Verify meta unchanged
      if (JSON.stringify(state.meta) !== JSON.stringify(meta)) {
        throw new Error(`State ${i}: meta changed (immutable after genesis)`);
      }

      // Apply operation
      const data = state.data;
      switch (state.op) {
        case OPS.MINT: {
          const amountBig = BigInt(data.amount);
          if (meta.max_supply !== null) {
            if (ledger.supply + amountBig > BigInt(meta.max_supply)) {
              throw new Error(`State ${i}: mint exceeds max_supply`);
            }
          }
          const current = ledger.balance(data.to);
          ledger.balances.set(data.to, current + amountBig);
          ledger.supply += amountBig;
          break;
        }
        case OPS.TRANSFER: {
          const amountBig = BigInt(data.amount);
          const fromBalance = ledger.balance(data.from);
          if (fromBalance < amountBig) {
            throw new Error(`State ${i}: insufficient balance for transfer`);
          }
          ledger.balances.set(data.from, fromBalance - amountBig);
          const toBalance = ledger.balance(data.to);
          ledger.balances.set(data.to, toBalance + amountBig);
          break;
        }
        case OPS.BURN: {
          const amountBig = BigInt(data.amount);
          const fromBalance = ledger.balance(data.from);
          if (fromBalance < amountBig) {
            throw new Error(`State ${i}: insufficient balance for burn`);
          }
          ledger.balances.set(data.from, fromBalance - amountBig);
          ledger.supply -= amountBig;
          break;
        }
        default:
          throw new Error(`State ${i}: unknown op ${state.op}`);
      }

      ledger.states.push(state);
      ledger.seq++;
    }

    return ledger;
  }

  /**
   * Verify a state chain
   */
  static verify(states) {
    try {
      MRC20.replay(states);
      return { valid: true };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }
}

// Re-export for convenience
export { bytesToHex };
