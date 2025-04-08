// Disable certificate checking (only for development/testing)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { clientHttp as client } from './src/clients/client.js';

const TOKEN_TO_ANALYZE = '0x4b9c0b5dbe4c1283bc6b7b48128f3be68a6fc0eb';

async function analyzeWalletTransactions(walletAddress, tokenAddress) {
  console.log(`\nAnalyzing all transactions for wallet: ${walletAddress}`);
  console.log(`Looking for involvement with token: ${tokenAddress}`);
  
  try {
    // Get the current block
    const currentBlock = await client.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);
    
    // Look at last 100 blocks since these are fresh wallets
    const fromBlock = currentBlock - 100n;
    console.log(`\nFetching transactions from block ${fromBlock} to ${currentBlock}`);
    
    // First get all transactions where this address is the sender
    const sentTxLogs = await client.getLogs({
      topics: [null], // any event
      fromBlock: fromBlock,
      toBlock: currentBlock,
      address: null // any contract
    });

    console.log(`Found ${sentTxLogs.length} total events in range`);
    
    // For each transaction, get the full receipt and check for our token
    for (const log of sentTxLogs) {
      const receipt = await client.getTransactionReceipt({ hash: log.transactionHash });
      const tx = await client.getTransaction({ hash: log.transactionHash });
      
      // Skip if this transaction is not from our target address
      if (tx.from.toLowerCase() !== walletAddress.toLowerCase()) {
        continue;
      }
      
      console.log(`\nAnalyzing transaction ${log.transactionHash}:`);
      console.log(`Block: ${log.blockNumber}`);
      console.log(`From: ${tx.from}`);
      console.log(`To: ${tx.to}`);
      console.log(`Method: ${tx.input.slice(0, 10)}`);
      
      // Check if our token is involved in any of the logs
      const tokenLogs = receipt.logs.filter(l => 
        l.address.toLowerCase() === tokenAddress.toLowerCase()
      );
      
      if (tokenLogs.length > 0) {
        console.log('\nTOKEN INVOLVEMENT FOUND!');
        console.log('Token-related events:');
        for (const tokenLog of tokenLogs) {
          if (tokenLog.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            // This is a transfer event
            const from = `0x${tokenLog.topics[1].slice(26)}`.toLowerCase();
            const to = `0x${tokenLog.topics[2].slice(26)}`.toLowerCase();
            console.log(`  Transfer: ${from} -> ${to}`);
            console.log(`  Amount: ${tokenLog.data}`);
          } else {
            console.log(`  Other event: ${tokenLog.topics[0]}`);
          }
        }
      }
    }
    
    // Also check for transactions where this address is the recipient
    const receivedTxLogs = await client.getLogs({
      topics: [
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // Transfer
        null,
        `0x000000000000000000000000${walletAddress.slice(2)}` // to address
      ],
      fromBlock: fromBlock,
      toBlock: currentBlock,
      address: tokenAddress // only look at our token
    });

    if (receivedTxLogs.length > 0) {
      console.log(`\nFound ${receivedTxLogs.length} transfers to this address`);
      for (const log of receivedTxLogs) {
        const from = `0x${log.topics[1].slice(26)}`.toLowerCase();
        console.log(`\nTransfer in tx ${log.transactionHash}:`);
        console.log(`Block: ${log.blockNumber}`);
        console.log(`From: ${from}`);
        console.log(`Amount: ${log.data}`);
      }
    }
    
  } catch (error) {
    console.error('Error analyzing wallet transactions:', error);
  }
}

// Run the analysis for both addresses
const ADDRESSES_TO_CHECK = [
  '0x009f7abd56adfc470bf0ce324cef73e49b464bbc',
  '0x017848839fd9f59e72ffea806a6961d1d3ac4e11'
];

(async () => {
  for (const address of ADDRESSES_TO_CHECK) {
    await analyzeWalletTransactions(address, TOKEN_TO_ANALYZE);
  }
})(); 