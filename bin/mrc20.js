#!/usr/bin/env node
/**
 * MRC20 CLI - Fungible tokens on Blocktrails
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { MRC20, jcs, hashState } from '../index.js';

const DEFAULT_FILE = '.mrc20.json';

// ============================================
// Key Management
// ============================================

function getPrivateKey(options) {
  if (options.key) {
    return options.key;
  }
  try {
    const gitKey = execSync('git config nostr.privkey', { encoding: 'utf8' }).trim();
    if (gitKey && /^[0-9a-fA-F]{64}$/.test(gitKey)) {
      return gitKey;
    }
  } catch {
    // not found
  }
  return null;
}

function getPubkeyFromPrivkey(privkey) {
  // Simple x-only pubkey derivation would need secp256k1
  // For now, require explicit pubkey or use privkey as identifier
  return privkey; // placeholder - in real use, derive pubkey
}

// ============================================
// Ledger File Management
// ============================================

function getLedgerPath(options) {
  return resolve(options.file || DEFAULT_FILE);
}

function loadLedger(options) {
  const path = getLedgerPath(options);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    return MRC20.replay(data.states);
  } catch (e) {
    console.error(`Error loading ledger: ${e.message}`);
    process.exit(1);
  }
}

function saveLedger(ledger, options) {
  const path = getLedgerPath(options);
  const data = ledger.export();
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
  return path;
}

// ============================================
// Commands
// ============================================

function cmdInit(options) {
  const existingPath = getLedgerPath(options);
  if (existsSync(existingPath) && !options.force) {
    console.error(`Ledger file already exists: ${existingPath}`);
    console.error('Use --force to overwrite');
    process.exit(1);
  }

  if (!options.name) {
    console.error('--name required');
    process.exit(1);
  }
  if (!options.symbol) {
    console.error('--symbol required');
    process.exit(1);
  }

  const meta = {
    name: options.name,
    symbol: options.symbol,
    decimals: options.decimals !== undefined ? parseInt(options.decimals) : 8,
    max_supply: options.maxSupply ? parseInt(options.maxSupply) : null
  };

  // Just save meta, no states yet
  const data = {
    meta,
    states: [],
    balances: {},
    supply: '0'
  };

  writeFileSync(existingPath, JSON.stringify(data, null, 2) + '\n');

  console.log(`Initialized MRC20 token: ${existingPath}`);
  console.log(`  Name: ${meta.name}`);
  console.log(`  Symbol: ${meta.symbol}`);
  console.log(`  Decimals: ${meta.decimals}`);
  console.log(`  Max Supply: ${meta.max_supply || 'unlimited'}`);
}

function cmdMint(options) {
  if (!options.to) {
    console.error('--to <pubkey> required');
    process.exit(1);
  }
  if (!options.amount) {
    console.error('--amount required');
    process.exit(1);
  }

  const path = getLedgerPath(options);
  let ledger;

  if (existsSync(path)) {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (data.states.length > 0) {
      ledger = MRC20.replay(data.states);
    } else {
      // Have meta but no states yet
      ledger = new MRC20(data.meta);
      ledger.states = [];
      ledger.seq = 0;
    }
  } else {
    console.error('No ledger found. Run "mrc20 init" first.');
    process.exit(1);
  }

  const state = ledger.mint(options.to, options.amount);
  saveLedger(ledger, options);

  console.log(`Minted ${options.amount} ${ledger.meta.symbol} to ${options.to.slice(0, 16)}...`);
  console.log(`  Total supply: ${ledger.totalSupply()}`);
  console.log(`  State #${state.seq}`);
}

function cmdTransfer(options) {
  if (!options.from) {
    console.error('--from <pubkey> required');
    process.exit(1);
  }
  if (!options.to) {
    console.error('--to <pubkey> required');
    process.exit(1);
  }
  if (!options.amount) {
    console.error('--amount required');
    process.exit(1);
  }

  const ledger = loadLedger(options);
  if (!ledger) {
    console.error('No ledger found.');
    process.exit(1);
  }

  const state = ledger.transfer(options.from, options.to, options.amount);
  saveLedger(ledger, options);

  console.log(`Transferred ${options.amount} ${ledger.meta.symbol}`);
  console.log(`  From: ${options.from.slice(0, 16)}...`);
  console.log(`  To: ${options.to.slice(0, 16)}...`);
  console.log(`  State #${state.seq}`);
}

function cmdBurn(options) {
  if (!options.from) {
    console.error('--from <pubkey> required');
    process.exit(1);
  }
  if (!options.amount) {
    console.error('--amount required');
    process.exit(1);
  }

  const ledger = loadLedger(options);
  if (!ledger) {
    console.error('No ledger found.');
    process.exit(1);
  }

  const state = ledger.burn(options.from, options.amount);
  saveLedger(ledger, options);

  console.log(`Burned ${options.amount} ${ledger.meta.symbol}`);
  console.log(`  From: ${options.from.slice(0, 16)}...`);
  console.log(`  Total supply: ${ledger.totalSupply()}`);
  console.log(`  State #${state.seq}`);
}

function cmdBalance(pubkey, options) {
  const ledger = loadLedger(options);
  if (!ledger) {
    console.error('No ledger found.');
    process.exit(1);
  }

  const balance = ledger.balance(pubkey);
  console.log(`${balance} ${ledger.meta.symbol}`);
}

function cmdShow(options) {
  const path = getLedgerPath(options);
  if (!existsSync(path)) {
    console.error('No ledger found.');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(path, 'utf8'));
  const meta = data.meta || (data.states[0] && data.states[0].meta);

  console.log(`Token: ${meta.name} (${meta.symbol})`);
  console.log(`Decimals: ${meta.decimals}`);
  console.log(`Max Supply: ${meta.max_supply || 'unlimited'}`);
  console.log(`States: ${data.states.length}`);
  console.log(`Supply: ${data.supply}`);
  console.log('');

  if (Object.keys(data.balances).length > 0) {
    console.log('Balances:');
    for (const [pubkey, balance] of Object.entries(data.balances)) {
      if (BigInt(balance) > 0n) {
        console.log(`  ${pubkey.slice(0, 16)}...: ${balance}`);
      }
    }
  }

  if (data.states.length > 0) {
    console.log('');
    console.log('History:');
    for (const state of data.states) {
      const op = state.op.replace('urn:mono:op:', '');
      const d = state.data;
      let desc;
      switch (op) {
        case 'mint':
          desc = `mint ${d.amount} to ${d.to.slice(0, 8)}...`;
          break;
        case 'transfer':
          desc = `transfer ${d.amount} from ${d.from.slice(0, 8)}... to ${d.to.slice(0, 8)}...`;
          break;
        case 'burn':
          desc = `burn ${d.amount} from ${d.from.slice(0, 8)}...`;
          break;
        default:
          desc = `${op}`;
      }
      console.log(`  [${state.seq}] ${desc}`);
    }
  }
}

function cmdVerify(options) {
  const path = getLedgerPath(options);
  if (!existsSync(path)) {
    console.error('No ledger found.');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(path, 'utf8'));

  if (data.states.length === 0) {
    console.log('No states to verify.');
    return;
  }

  const result = MRC20.verify(data.states);

  if (result.valid) {
    console.log(`✓ Ledger verified: ${data.states.length} states`);
    console.log(`  Token: ${data.meta.name} (${data.meta.symbol})`);
    console.log(`  Supply: ${data.supply}`);
  } else {
    console.error(`✗ Verification failed: ${result.error}`);
    process.exit(1);
  }
}

function cmdExport(options) {
  const path = getLedgerPath(options);
  if (!existsSync(path)) {
    console.error('No ledger found.');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(path, 'utf8'));

  // Export states as JCS for Blocktrails
  const states = data.states.map(s => jcs(s));

  const exportData = {
    meta: data.meta,
    states: data.states,
    statesJcs: states
  };

  if (options.output) {
    writeFileSync(options.output, JSON.stringify(exportData, null, 2) + '\n');
    console.log(`Exported to: ${options.output}`);
  } else {
    console.log(JSON.stringify(exportData, null, 2));
  }
}

// ============================================
// Argument Parsing
// ============================================

function parseArgs(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--key' || arg === '-k') {
      options.key = args[++i];
    } else if (arg === '--file' || arg === '-f') {
      options.file = args[++i];
    } else if (arg === '--name') {
      options.name = args[++i];
    } else if (arg === '--symbol') {
      options.symbol = args[++i];
    } else if (arg === '--decimals') {
      options.decimals = args[++i];
    } else if (arg === '--max-supply') {
      options.maxSupply = args[++i];
    } else if (arg === '--to') {
      options.to = args[++i];
    } else if (arg === '--from') {
      options.from = args[++i];
    } else if (arg === '--amount') {
      options.amount = args[++i];
    } else if (arg === '--output' || arg === '-o') {
      options.output = args[++i];
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { options, positional };
}

function showHelp() {
  console.log(`
mrc20 - Fungible tokens on Blocktrails (Monochrome profile)

Usage:
  mrc20 <command> [options]

Commands:
  init                    Create new token
  mint                    Mint tokens
  transfer                Transfer tokens
  burn                    Burn tokens
  balance <pubkey>        Show balance for pubkey
  show                    Show token info and history
  verify                  Verify ledger integrity
  export                  Export states for Blocktrails

Options:
  --name <name>           Token name (for init)
  --symbol <sym>          Token symbol (for init)
  --decimals <n>          Decimal places (default: 8)
  --max-supply <n>        Maximum supply (optional)
  --to <pubkey>           Recipient pubkey
  --from <pubkey>         Sender pubkey
  --amount <n>            Amount
  -f, --file <path>       Ledger file (default: .mrc20.json)
  -o, --output <path>     Output file for export
  --force                 Overwrite existing files
  -h, --help              Show this help
  -v, --version           Show version

Examples:
  mrc20 init --name "My Token" --symbol MTK --max-supply 21000000
  mrc20 mint --to <pubkey> --amount 1000000
  mrc20 transfer --from <pubkey> --to <pubkey> --amount 500
  mrc20 burn --from <pubkey> --amount 100
  mrc20 balance <pubkey>
  mrc20 show
  mrc20 verify
`);
}

function showVersion() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(`mrc20 v${pkg.version}`);
}

// ============================================
// Main
// ============================================

function main() {
  const { options, positional } = parseArgs(process.argv.slice(2));

  if (options.version) {
    showVersion();
    process.exit(0);
  }

  if (options.help || positional.length === 0) {
    showHelp();
    process.exit(options.help ? 0 : 1);
  }

  const command = positional[0];

  try {
    switch (command) {
      case 'init':
        cmdInit(options);
        break;

      case 'mint':
        cmdMint(options);
        break;

      case 'transfer':
        cmdTransfer(options);
        break;

      case 'burn':
        cmdBurn(options);
        break;

      case 'balance':
        if (!positional[1]) {
          console.error('Usage: mrc20 balance <pubkey>');
          process.exit(1);
        }
        cmdBalance(positional[1], options);
        break;

      case 'show':
        cmdShow(options);
        break;

      case 'verify':
        cmdVerify(options);
        break;

      case 'export':
        cmdExport(options);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
