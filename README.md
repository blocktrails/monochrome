# MRC20

Fungible tokens on [Blocktrails](https://blocktrails.org) — Monochrome profile implementation.

## Install

```bash
npm install mrc20
```

## CLI Usage

```bash
# Create a new token
mrc20 init --name "My Token" --symbol MTK --max-supply 21000000

# Mint tokens
mrc20 mint --to <pubkey> --amount 1000000

# Transfer tokens
mrc20 transfer --from <pubkey> --to <pubkey> --amount 500

# Burn tokens
mrc20 burn --from <pubkey> --amount 100

# Show token info and balances
mrc20 show

# Verify ledger integrity
mrc20 verify

# Check balance
mrc20 balance <pubkey>

# Export for Blocktrails
mrc20 export
```

## Library Usage

```javascript
import { MRC20, createMeta } from 'mrc20';

// Create token
const meta = createMeta('My Token', 'MTK', 8, 21000000);
const ledger = new MRC20(meta);

// Mint to a pubkey (32-byte hex, lowercase)
const pubkey = 'abc123...'; // x-only pubkey
ledger.mint(pubkey, 1000000);

// Transfer
ledger.transfer(fromPubkey, toPubkey, 500);

// Burn
ledger.burn(fromPubkey, 100);

// Check balance
const balance = ledger.balance(pubkey); // BigInt

// Export states for Blocktrails
const exported = ledger.export();

// Verify a state chain
const result = MRC20.verify(states);
if (result.valid) {
  console.log('Valid!');
} else {
  console.log('Invalid:', result.error);
}

// Replay states to rebuild ledger
const rebuilt = MRC20.replay(states);
```

## State Format (Monochrome)

Each state follows the Monochrome profile:

```json
{
  "op": "urn:mono:op:mint",
  "data": {
    "to": "<pubkey>",
    "amount": 1000000
  },
  "prev": "<sha256_of_previous_state>",
  "seq": 0,
  "meta": {
    "name": "My Token",
    "symbol": "MTK",
    "decimals": 8,
    "max_supply": 21000000
  }
}
```

### Operations

| Operation | Data Fields |
|-----------|-------------|
| `urn:mono:op:mint` | `to`, `amount` |
| `urn:mono:op:transfer` | `from`, `to`, `amount` |
| `urn:mono:op:burn` | `from`, `amount` |

### Validation Rules

- `mint`: `supply + amount <= max_supply` (if set)
- `transfer`: `balances[from] >= amount`
- `burn`: `balances[from] >= amount`
- `meta` is immutable after genesis
- `prev` must be SHA256 of previous state (JCS serialized)
- `seq` must be monotonically increasing from 0

## Integration with Blocktrails

MRC20 states are designed to be committed to Bitcoin via Blocktrails:

```javascript
import { Blocktrail } from 'blocktrails';
import { MRC20, jcs } from 'mrc20';

const trail = new Blocktrail(privateKey);
const ledger = new MRC20(meta);

// Each MRC20 state becomes a Blocktrails state
const mintState = ledger.mint(pubkey, 1000);
trail.genesis(jcs(mintState));

// Advance trail with each operation
const transferState = ledger.transfer(from, to, 500);
trail.advance(jcs(transferState));
```

## Links

- [Blocktrails](https://blocktrails.org)
- [Blocktrails Spec](https://blocktrails.org/spec/)
- [Monochrome Profile Spec](https://blocktrails.org/spec/profiles.html)

## License

MIT
