#!/usr/bin/env node
/**
 * Generate blockchain from blocks.json transaction definitions.
 *
 * This script connects to a Geth dev node and executes all transactions
 * defined in blocks.json to create a blockchain that can be exported to blocks.bin.
 */

const fs = require('fs');
const { Web3 } = require('web3');

// Configuration from environment
const RPC_URL = process.env.RPC_URL || 'http://localhost:8545';
const BLOCKS_JSON = process.env.BLOCKS_JSON || '../chain-data/blocks.json';

/**
 * Wait for Geth to be ready
 */
async function waitForGeth(maxRetries = 30) {
    const web3 = new Web3(RPC_URL);

    for (let i = 0; i < maxRetries; i++) {
        try {
            const isListening = await web3.eth.net.isListening();
            if (isListening) {
                return web3;
            }
        } catch (err) {
            await sleep(100);
        }
    }

    throw new Error(`Could not connect to Geth at ${RPC_URL}`);
}

/**
 * Sleep helper
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Build and sign a transaction
 */
async function buildAndSignTransaction(web3, txDef, nonceTracker) {
    // Get account from secret key
    const account = web3.eth.accounts.privateKeyToAccount(txDef.secretKey);
    const address = account.address;

    // Get nonce - either from tracker or from chain
    if (!(address in nonceTracker)) {
        const chainNonce = await web3.eth.getTransactionCount(address, 'pending');
        nonceTracker[address] = Number(chainNonce);
    }

    const nonce = nonceTracker[address];

    // Build transaction (Web3 v4 uses BigInt for numeric values)
    const tx = {
        from: address,
        gas: BigInt(parseInt(txDef.gasLimit, 16)),
        gasPrice: BigInt(parseInt(txDef.gasPrice, 16)),
        nonce: BigInt(nonce),
        chainId: await web3.eth.getChainId(),
    };

    // Add optional fields
    if (txDef.to) {
        tx.to = web3.utils.toChecksumAddress(txDef.to);
    }

    if (txDef.value) {
        tx.value = BigInt(parseInt(txDef.value, 16));
    } else {
        tx.value = BigInt(0);
    }

    if (txDef.data) {
        let data = txDef.data;
        if (!data.startsWith('0x')) {
            data = '0x' + data;
        }
        tx.data = data;
    }

    // Sign transaction
    const signedTx = await account.signTransaction(tx);

    // Increment nonce for this account
    nonceTracker[address] += 1;

    return signedTx;
}

/**
 * Wait for transactions to be mined into blocks
 */
async function waitForBlockWithTxs(web3, txHashes, timeout = 30, initialBlock = null) {
    if (initialBlock === null) {
        initialBlock = await web3.eth.getBlockNumber();
    }
    const pendingTxs = new Set(txHashes);
    const maxRetries = timeout * 5; // Check every 0.2 seconds

    let warnedAboutPending = false;

    for (let i = 0; i < maxRetries; i++) {
        await sleep(200);

        // Check if any new blocks appeared
        const currentBlock = await web3.eth.getBlockNumber();
        if (currentBlock > initialBlock) {
            // Check blocks from initialBlock+1 to currentBlock
            for (let blockNum = Number(initialBlock) + 1; blockNum <= Number(currentBlock); blockNum++) {
                const block = await web3.eth.getBlock(blockNum);
                const blockTxHashes = new Set(block.transactions);

                // Remove mined transactions from pending set
                for (const txHash of blockTxHashes) {
                    pendingTxs.delete(txHash);
                }
            }

            // If all transactions are mined, we're done
            if (pendingTxs.size === 0) {
                return currentBlock;
            }
        }

        // After half the timeout, warn if transactions are still pending
        if (i === Math.floor(maxRetries / 2) && pendingTxs.size > 0 && !warnedAboutPending) {
            try {
                const txpoolStatus = await web3.eth.txpool.status();
                console.log(`  ⚠ Still waiting... Txpool: pending=${txpoolStatus.pending}, queued=${txpoolStatus.queued}`);
                warnedAboutPending = true;
            } catch (err) {
                // Ignore errors getting txpool status
            }
        }
    }

    // Timeout - check txpool status for debugging
    try {
        const txpoolStatus = await web3.eth.txpool.status();
        console.log(`  ⚠ Txpool status:`, txpoolStatus);
    } catch (err) {
        // Ignore
    }

    const pendingArray = Array.from(pendingTxs).map(tx => tx.substring(0, 18));
    throw new Error(`Timeout waiting for ${pendingTxs.size} transactions to be mined. Pending: ${pendingArray}`);
}

/**
 * Wait for the next block to be mined (for empty blocks)
 */
async function waitForNextBlock(web3, timeout = 15) {
    const initialBlock = await web3.eth.getBlockNumber();
    const maxRetries = timeout * 5;

    for (let i = 0; i < maxRetries; i++) {
        await sleep(200);
        const currentBlock = await web3.eth.getBlockNumber();
        if (currentBlock > initialBlock) {
            return currentBlock;
        }
    }

    throw new Error('Timeout waiting for next block');
}

/**
 * Wait for a specific block number to be mined
 */
async function waitForBlockNumber(web3, targetBlock, timeout = 20) {
    const maxRetries = timeout * 5; // Check every 0.2 seconds

    for (let i = 0; i < maxRetries; i++) {
        await sleep(200);
        const currentBlock = await web3.eth.getBlockNumber();
        if (Number(currentBlock) >= targetBlock) {
            return Number(currentBlock);
        }
    }

    throw new Error(`Timeout waiting for block ${targetBlock}`);
}

/**
 * Parse block number (handles both integer and hex string formats)
 */
function parseBlockNumber(blockNum) {
    if (typeof blockNum === 'string') {
        return blockNum.startsWith('0x') ? parseInt(blockNum, 16) : parseInt(blockNum, 10);
    }
    return parseInt(blockNum, 10);
}

/**
 * Main execution
 */
async function main() {
    // Load blocks.json FIRST (before connecting to Geth to save time)
    let blocksData;
    try {
        const data = fs.readFileSync(BLOCKS_JSON, 'utf8');
        blocksData = JSON.parse(data);
    } catch (err) {
        console.error(`✗ Error loading blocks.json: ${err.message}`);
        process.exit(1);
    }

    // Connect to Geth
    console.log('Connecting to Geth and starting block generation...');
    let web3;
    try {
        web3 = await waitForGeth();
    } catch (err) {
        console.error(`✗ ${err.message}`);
        process.exit(1);
    }

    // Synchronized block generation: wait for mining cycle, then submit transactions
    const startBlock = Number(await web3.eth.getBlockNumber());
    const chainId = await web3.eth.getChainId();
    console.log(`Starting with block ${startBlock}, chain ID ${chainId}`);
    console.log(`Synchronized mode: waiting for mining cycles before submitting transactions\n`);

    let txCount = 0;
    let blockCount = 0;

    // Track nonces for each account (resets after each block is mined)
    let nonceTracker = {};

    // Track expected block number (what we expect based on blocks.json)
    let expectedBlockNum = startBlock + 1;

    for (const blockDef of blocksData.blocks) {
        // Parse block number (handle both integer and hex string formats)
        const blockNum = parseBlockNumber(blockDef.number);

        // Skip blocks that don't match our expected sequence
        if (blockNum < expectedBlockNum) {
            console.log(`\nBlock ${blockNum}: Skipping (already processed or out of order)`);
            continue;
        }

        const transactions = blockDef.transactions || [];
        const blockComment = blockDef.comment || '';

        console.log(`\nBlock ${blockNum}: ${transactions.length} transaction(s)`);
        if (blockComment) {
            console.log(`  Comment: ${blockComment}`);
        }

        // SYNC STEP 1: Always wait for previous block to complete before sending transactions
        const targetPreviousBlock = blockNum - 1;
        console.log(`  ⏳ Waiting for block ${targetPreviousBlock} to complete before sending transactions...`);
        try {
            await waitForBlockNumber(web3, targetPreviousBlock, 20);
            console.log(`  ✓ Block ${targetPreviousBlock} mined, ready to send transactions for block ${blockNum}`);
        } catch (err) {
            console.error(`  ✗ Failed waiting for block ${targetPreviousBlock}: ${err.message}`);
            process.exit(1);
        }

        // Clear nonce tracker for this block (fresh start)
        nonceTracker = {};

        if (transactions.length === 0) {
            // Empty block - just wait for next mining period
            console.log(`  ⏳ Waiting for empty block ${blockNum} to be mined...`);
            try {
                const minedBlockNum = await waitForBlockNumber(web3, blockNum, 20);
                const minedBlock = await web3.eth.getBlock(minedBlockNum);
                console.log(`  ✓ Block ${minedBlockNum} mined (${minedBlock.transactions.length} transactions)`);

                if (minedBlock.transactions.length > 0) {
                    console.log(`  ⚠ Warning: Expected empty block but got ${minedBlock.transactions.length} transactions`);
                }

                blockCount++;
                expectedBlockNum = Number(minedBlockNum) + 1;
            } catch (err) {
                console.error(`  ✗ Failed to wait for empty block: ${err.message}`);
                process.exit(1);
            }
            continue;
        }

        // STEP 1: Build and sign all transactions for this block first
        const signedTxs = [];
        for (let i = 0; i < transactions.length; i++) {
            const txDef = transactions[i];
            const txComment = txDef.comment || 'No description';

            try {
                const signedTx = await buildAndSignTransaction(web3, txDef, nonceTracker);
                signedTxs.push({ signed: signedTx, comment: txComment });
            } catch (err) {
                console.error(`  ✗ Failed to build transaction: ${err.message}`);
                console.error(`     Comment: ${txComment}`);
                console.error(`     Transaction definition:`);
                console.error(JSON.stringify(txDef, null, 6));
                process.exit(1);
            }
        }

        // SYNC STEP 2: Send all signed transactions in parallel (fastest possible)
        console.log(`  ⚡ Sending all ${signedTxs.length} transaction(s) in parallel...`);

        // Send all transactions in parallel using HTTP JSON-RPC directly
        // This bypasses Web3.js validation that rejects txs designed to revert
        const sendPromises = signedTxs.map(async (signedTx, idx) => {
            try {
                // Use fetch to call JSON-RPC directly
                const response = await fetch(RPC_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: idx + 1,
                        method: 'eth_sendRawTransaction',
                        params: [signedTx.signed.rawTransaction]
                    })
                });

                const data = await response.json();

                if (data.error) {
                    throw new Error(data.error.message || JSON.stringify(data.error));
                }

                return { txHash: data.result, error: null };
            } catch (err) {
                console.log(`      ⚠ Transaction ${idx + 1} error: ${err.message.split('\n')[0]}`);
                return { txHash: null, error: err.message };
            }
        });

        const results = await Promise.all(sendPromises);
        const txHashes = results.map(r => r.txHash).filter(h => h);

        // Print after all transactions are sent
        for (let i = 0; i < signedTxs.length; i++) {
            if (results[i].txHash) {
                console.log(`  → Tx ${i + 1}/${transactions.length}: ${results[i].txHash.substring(0, 18)}... - ${signedTxs[i].comment}`);
            } else {
                console.log(`  → Tx ${i + 1}/${transactions.length}: SEND FAILED - ${signedTxs[i].comment}`);
            }
        }

        // SYNC STEP 3: Wait for block to be mined with our transactions
        console.log(`  ⏳ Waiting for block ${blockNum} to be mined with ${txHashes.length} transaction(s)...`);
        try {
            await waitForBlockNumber(web3, blockNum, 20);

            // Verify all transactions are in the expected block
            const block = await web3.eth.getBlock(blockNum);
            const blockTxHashes = new Set(block.transactions.map(tx => tx.toLowerCase()));

            let allInCorrectBlock = true;
            for (const txHash of txHashes) {
                if (!blockTxHashes.has(txHash.toLowerCase())) {
                    allInCorrectBlock = false;
                    break;
                }
            }

            if (allInCorrectBlock && blockTxHashes.size === txHashes.length) {
                console.log(`  ✓ All ${txHashes.length} transaction(s) mined in block ${blockNum} (EXACT MATCH!)`);
            } else {
                console.log(`  ⚠ Block ${blockNum} has ${blockTxHashes.size} transactions, expected ${txHashes.length}`);

                // Find where our transactions actually ended up
                const blocksWithTxs = {};
                for (const txHash of txHashes) {
                    const receipt = await web3.eth.getTransactionReceipt(txHash);
                    const actualBlock = Number(receipt.blockNumber);
                    if (!(actualBlock in blocksWithTxs)) {
                        blocksWithTxs[actualBlock] = [];
                    }
                    blocksWithTxs[actualBlock].push(txHash);
                }

                const blockNumbers = Object.keys(blocksWithTxs).map(Number).sort((a, b) => a - b);
                console.log(`  ⚠ Transactions spread across blocks: ${blockNumbers.join(', ')}`);
            }

            // Show transaction details
            for (let i = 0; i < txHashes.length; i++) {
                const receipt = await web3.eth.getTransactionReceipt(txHashes[i]);
                const status = receipt.status ? '✓' : '✗';

                console.log(`    ${status} ${txHashes[i].substring(0, 18)}... in block ${receipt.blockNumber} - Gas: ${receipt.gasUsed}`);

                if (!receipt.status) {
                    console.log(`       ⚠ Transaction reverted!`);
                }

                if (receipt.contractAddress) {
                    console.log(`       Contract deployed at: ${receipt.contractAddress}`);
                }
            }

            txCount += txHashes.length;
            blockCount++;
            expectedBlockNum = blockNum + 1;

        } catch (err) {
            console.error(`  ✗ Mining failed: ${err.message}`);
            process.exit(1);
        }
    }

    // Get final state
    const finalBlock = await web3.eth.getBlockNumber();

    console.log('\n' + '-'.repeat(70));
    console.log('\n4. Blockchain generation complete!');
    console.log(`   Blocks generated: ${blockCount}`);
    console.log(`   Transactions executed: ${txCount}`);
    console.log(`   Final block number: ${finalBlock}`);

    // Show some final block info
    const latestBlock = await web3.eth.getBlock('latest');
    console.log(`   Latest block hash: ${latestBlock.hash}`);

    // Count total transactions in chain
    let totalTxs = 0;
    for (let i = 1; i <= finalBlock; i++) {
        const block = await web3.eth.getBlock(i);
        totalTxs += block.transactions.length;
    }
    console.log(`   Total transactions in chain: ${totalTxs}`);

    console.log('\n' + '='.repeat(70));
    console.log('✓ Success! Ready for export.');
    console.log('='.repeat(70));
    console.log('');
}

// Run main function
if (require.main === module) {
    main()
        .then(() => process.exit(0))
        .catch((err) => {
            console.error('\n✗ Unexpected error:', err.message);
            console.error(err.stack);
            process.exit(1);
        });
}

module.exports = { main };
