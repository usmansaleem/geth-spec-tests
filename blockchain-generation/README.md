# Blockchain Generation

This directory contains tools for generating test blockchains by replaying transactions from `blocks.json` on a Geth node initialized with `genesis.json`.

## Contents

**Chain Data:**
- `chain-data/genesis.json` - Genesis block configuration (Chain ID 1982)
- `chain-data/blocks.json` - Transaction definitions to replay (33 blocks, 53 transactions)

**Docker Files:**
- `docker-compose.generate-node.yml` - Blockchain generation service
- `Dockerfile.combined-node` - Combined Geth + Node.js image

**Scripts:**
- `generate-blocks.js` - Transaction executor (Node.js + Web3.js v4)
- `package.json` - Node.js dependencies

**Generated Data:**
- `geth-data/` - Generated blockchain database (bind mount)

## Quick Start

### Generate Blockchain

Generate the complete blockchain from blocks.json:

```bash
docker compose -f docker-compose.generate-node.yml up
```

This will:
1. Initialize Geth with `genesis.json` (Chain ID 1982)
2. Start Geth with 5-second mining periods
3. Execute all 53 transactions from `blocks.json` across 33 blocks
4. Stop Geth automatically after completion (prevents extra empty blocks)
5. Store the result in `geth-data/` directory

**Output:** You'll see real-time progress with "EXACT MATCH" confirmations for each block.

### Clean Up After Generation

```bash
# Stop and remove containers
docker compose -f docker-compose.generate-node.yml down

# Remove generated blockchain data (stored in ./geth-data/)
rm -rf geth-data
```

**Note:** The blockchain data is stored in a local directory `./geth-data/` (bind mount) rather than a Docker volume to avoid Docker Desktop disk space limitations.

## How It Works

### Synchronization Strategy

The script uses a synchronized approach to ensure exact block matching:

1. **Wait for previous block** - Before sending transactions for block N, wait for block N-1 to complete
2. **Parallel transaction sending** - Send all transactions for a block in parallel (50-100ms total)
3. **Direct JSON-RPC** - Uses fetch API to bypass Web3.js validation, allowing reverting transactions
4. **Verify block contents** - Confirms all transactions are in the correct block

This ensures:
- ✅ No transactions spread across multiple blocks
- ✅ No transactions in wrong blocks
- ✅ Reverting transactions are sent and mined (stack underflows, invalid opcodes, etc.)
- ✅ 100% exact block matching

### Key Features

**Handles Exceptional Cases:**
- Stack underflows during contract creation (blocks 29, 33)
- Invalid opcodes (block 16)
- Invalid jump destinations (block 16)
- Reverts and out-of-gas scenarios (block 18)

**Fast Generation:**
- 5-second mining periods
- ~3 minutes for 33 blocks
- Parallel transaction submission per block

**Clean Shutdown:**
- Geth stops automatically after all blocks.json transactions
- No extra empty blocks created
- Blockchain frozen at block 33

## Modifying Transactions

Edit `chain-data/blocks.json` to add or modify transactions:

```json
{
  "blocks": [
    {
      "number": 34,
      "comment": "Your new test case",
      "transactions": [
        {
          "comment": "Description of what this transaction does",
          "secretKey": "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3",
          "gasLimit": "0xFFFFF2",
          "gasPrice": "0xEF",
          "to": "0x...",
          "value": "0x01",
          "data": "0x..."
        }
      ]
    }
  ]
}
```

Then regenerate:
```bash
# Clean previous data
docker compose -f docker-compose.generate-node.yml down -v

# Generate new blockchain
docker compose -f docker-compose.generate-node.yml up
```

## Configuration

### Mining Period

Adjust the mining period in `docker-compose.generate-node.yml`:

```yaml
geth --dev.period 5  # 5-second mining (default)
```

Lower values = faster generation but higher risk of transaction timing issues.

### RPC Endpoint

Generation node runs on port 8547 (mapped from container's 8545):

```bash
# While generation is running:
curl -X POST http://localhost:8547 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}'
```

## Troubleshooting

### Check Generation Logs

```bash
# View real-time logs
docker compose -f docker-compose.generate-node.yml logs -f

# View specific section
docker logs blockchain-generator 2>&1 | grep "Block [0-9]"
```

### Verify Final State

```bash
docker logs blockchain-generator 2>&1 | grep -E "(Blockchain generation complete|Final block number)"
```

Expected output:
```
✓ Blockchain generation complete!
   Blocks generated: 32
   Transactions executed: 53
   Final block number: 33
```

### Common Issues

**Issue:** Transactions spreading across blocks
- **Cause:** Mining period too short
- **Fix:** Increase `--dev.period` to 5 or 10 seconds

**Issue:** Some transactions not sent
- **Cause:** Web3.js validation blocking reverting transactions
- **Fix:** Already handled - script uses direct JSON-RPC to bypass validation

**Issue:** Container exits before completion
- **Cause:** Geth initialization delay
- **Fix:** Script waits for Geth to be ready before starting

## Generated Data Structure

After generation, `geth-data/` contains:
```
geth-data/
├── geth/
│   ├── chaindata/        # Blockchain database with all 33 blocks
│   │   ├── ancient/      # Ancient data (blocks, receipts, etc.)
│   │   └── ...
│   ├── lightchaindata/
│   └── LOCK
└── keystore/             # Auto-generated dev account keystores
```

**Storage:** Data is stored in a local directory (bind mount) for better disk space availability on Docker Desktop.

## Test Coverage

The default `blocks.json` contains 33 blocks (53 transactions) covering:

**Basic Operations:**
- Simple ETH transfers
- Contract deployments (CREATE, CREATE2)
- Contract calls (CALL, CALLCODE, DELEGATECALL, STATICCALL)
- Storage operations (SSTORE, SLOAD)
- Memory operations

**Advanced Cases:**
- Self-destructs (SELFDESTRUCT)
- ERC20 token transfers
- Precompiled contract calls
- Proxy contracts

**Error Cases:**
- Transaction reverts
- Out-of-gas scenarios
- Stack underflows (blocks 16, 29, 33)
- Invalid opcodes (block 16)
- Invalid jump destinations (block 16)

All test cases achieve **EXACT MATCH** - transactions are in the correct blocks with correct ordering.

## Technical Details

**Technology Stack:**
- Geth v1.14.12 (Ethereum client)
- Node.js 20.x + Web3.js v4.15.0
- Docker + Docker Compose

**Synchronization:**
- Waits for block N-1 before submitting transactions for block N
- Sends all transactions for a block in parallel
- Verifies all transactions mined in correct block

**Transaction Sending:**
- Uses direct HTTP JSON-RPC (`eth_sendRawTransaction`)
- Bypasses Web3.js pre-execution validation
- Allows reverting transactions to be sent and mined on-chain

**Auto-Shutdown:**
- Geth stops after completing all blocks.json transactions
- Prevents creation of unnecessary empty blocks
- Blockchain ready for immediate export

## Next Steps

After generation completes:
1. Blockchain data is in `geth-data/`
2. Ready for export to `blocks.bin` format (for Besu testing)
3. Can be copied to other nodes or test environments
4. State frozen at exactly block 33

See `chain-data/blocks.json` for the complete transaction list and test coverage details.
