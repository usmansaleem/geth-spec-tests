#!/usr/bin/env python3
"""
Generate 4ByteTracer specs for all blocks by querying live Geth node
"""

import json
import os
import requests

# RPC endpoint (can be overridden by environment variable)
RPC_URL = os.environ.get("RPC_URL", "http://localhost:8545")

# Block definitions from call-tracer (block number and description)
BLOCKS = [
    ("0x0", "genesis"),
    ("0x1", "empty"),
    ("0x2", "simple-transfer"),
    ("0x3", "self-destruct-contract"),
    ("0x4", "set-contract-storage"),
    ("0x5", "clear-storage"),
    ("0x6", "self-destruct-send-funds"),
    ("0x7", "increment-bytes"),
    ("0x8", "call-one-level-deep"),
    ("0x9", "call-multi-level-deep"),
    ("0xa", "callcode-one-level"),
    ("0xb", "delegate-call-one-level-deep"),
    ("0xc", "sequence-memory"),
    ("0xd", "MSTORE"),
    ("0xe", "increment-storage"),
    ("0xf", "logs"),
    ("0x10", "halts"),
    ("0x11", "push-swap"),
    ("0x12", "memory-read-revert"),
    ("0x13", "self-destruct"),
    ("0x14", "create-create2"),
    ("0x15", "set-and-clean-storage"),
    ("0x16", "set-and-clean-storage"),
    ("0x17", "static-call-one-level-deep"),
    ("0x18", "static-call-multiple-level-deeep"),
    ("0x19", "erc20-contract-transfer"),
    ("0x1a", "call-one-level-gas-refund"),
    ("0x1b", "self-destruct-send-self"),
    ("0x1c", "self-destruct-sender"),
    ("0x1d", "stack-underflow"),
    ("0x1e", "0g0v0_Istanbul"),
    ("0x1f", "precompile"),
    ("0x20", "contract-creation-fails-level-1"),
    ("0x21", "stack-underflow"),
]

def rpc_call(method, params):
    """Make an RPC call to Geth"""
    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    }
    response = requests.post(RPC_URL, json=payload)
    return response.json()

def generate_4byte_spec(block_hex, description, index):
    """Generate a 4ByteTracer spec file for a block"""

    # Create request
    request = {
        "jsonrpc": "2.0",
        "method": "debug_traceBlockByNumber",
        "params": [
            block_hex,
            {
                "tracer": "4byteTracer"
            }
        ],
        "id": 1
    }

    # Query Geth
    print(f"Querying block {block_hex} ({description})...")
    response = rpc_call("debug_traceBlockByNumber", [block_hex, {"tracer": "4byteTracer"}])

    # Build spec
    spec = {
        "request": request,
        "response": response,
        "statusCode": 200
    }

    # Generate filename
    filename = f"{index}-debug-4byte-tracer-{block_hex}-{description}.json"
    filepath = os.path.join("specs", "4byte-tracer", filename)

    # Write file
    with open(filepath, 'w') as f:
        json.dump(spec, f, indent=2)

    print(f"  ✓ Created {filename}")

    # Return result info for summary
    result = response.get("result", [])
    if isinstance(result, list):
        tx_count = len(result)
        signatures = set()
        for tx_result in result:
            if isinstance(tx_result, dict) and "result" in tx_result:
                for sig in tx_result["result"].keys():
                    signatures.add(sig)
        return tx_count, signatures
    return 0, set()

def main():
    print("=" * 60)
    print("4ByteTracer Spec Generator")
    print("=" * 60)
    print()

    # Check if Geth is running
    try:
        response = rpc_call("eth_blockNumber", [])
        block_num = int(response.get("result", "0x0"), 16)
        print(f"✓ Connected to Geth node")
        print(f"✓ Current block: {block_num}")
        print()
    except Exception as e:
        print(f"✗ Cannot connect to Geth node at {RPC_URL}")
        print(f"  Error: {e}")
        print(f"\nPlease start the node first:")
        print(f"  docker compose up -d geth")
        return 1

    # Generate specs for all blocks
    total_txs = 0
    all_signatures = set()

    for index, (block_hex, description) in enumerate(BLOCKS):
        tx_count, signatures = generate_4byte_spec(block_hex, description, index)
        total_txs += tx_count
        all_signatures.update(signatures)

    print()
    print("=" * 60)
    print("✓ Generation Complete!")
    print("=" * 60)
    print()
    print(f"Generated: {len(BLOCKS)} spec files")
    print(f"Total transactions: {total_txs}")
    print(f"Unique function signatures found: {len(all_signatures)}")
    if all_signatures:
        print(f"\nSignatures detected:")
        for sig in sorted(all_signatures):
            print(f"  - {sig}")
    print()
    print(f"Files created in: specs/4byte-tracer/")

    return 0

if __name__ == "__main__":
    exit(main())
