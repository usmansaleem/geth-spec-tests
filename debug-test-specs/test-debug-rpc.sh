#!/bin/bash

# Test the debug_traceBlockByNumber RPC call

echo "Testing debug_traceBlockByNumber on block 0x0..."
echo ""

curl -X POST \
  -H "Content-Type: application/json" \
  --data '{
    "jsonrpc": "2.0",
    "method": "debug_traceBlockByNumber",
    "params": [
      "0x0",
      {
        "tracer": "callTracer"
      }
    ],
    "id": 1
  }' \
  http://localhost:8545

echo ""
echo ""
echo "Testing debug_traceBlockByNumber on block 0x1..."
echo ""

curl -X POST \
  -H "Content-Type: application/json" \
  --data '{
    "jsonrpc": "2.0",
    "method": "debug_traceBlockByNumber",
    "params": [
      "0x1",
      {
        "tracer": "callTracer"
      }
    ],
    "id": 1
  }' \
  http://localhost:8545

echo ""
