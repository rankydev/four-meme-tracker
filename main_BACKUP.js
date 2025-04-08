process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp as client, clientWebsocket } from './src/clients/client.js';
import { parseAbiItem, parseAbi } from 'viem';
import { FOUR_MEME_ADDRESS, TRANSFER_EVENT_SIGNATURE } from './src/config/index.js';
import { detectNewToken, logTokenCreation } from './src/tokenDetector.js';
import { formatValue } from './src/utils.js';
import { connectToDatabase } from './src/db/connection.js';
import { saveToken } from './src/db/tokenRepository.js';

const seenTokens = new Map();
let globalFilter = null;

// Parse the Transfer event signature for use in filters
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

async function createFilter() {
  try {
    globalFilter = await clientWebsocket.createEventFilter({
      events: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
    });
    console.log('Created persistent event filter');
  } catch (error) {
    console.error(`Failed to create event filter: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Process a specific block to detect new token creations
 */
async function processBlock(blockNumber) {
  try {    
    // Create filter for Transfer events in this block
    // Note: We use parseAbiItem for the event structure but we're aware that 
    // TRANSFER_EVENT_SIGNATURE from config has the correct event signature
    // const filter = await client.createEventFilter({
    //   event: transferEvent,
    //   fromBlock: blockNumber,
    //   toBlock: blockNumber,
    // });
    
    // Get logs using the filter
    const logs = await clientWebsocket.getFilterChanges({ filter: globalFilter });
    
    // console.log(`Found ${logs.length} Transfer events in block ${blockNumber}`);
    
    // Skip if no events
    if (logs.length === 0) return;
    
    // Group logs by transaction hash and track trades in a single pass
    const txGroups = {};
    
    // Track which tokens were updated in this block for saving to database
    const updatedTokens = new Set();
    
    // Process each log only once - for both tracking trades and grouping by tx
    logs.forEach(log => {
      // Add to transaction groups for new token detection
      if (!txGroups[log.transactionHash]) {
        txGroups[log.transactionHash] = [];
      }
      txGroups[log.transactionHash].push(log);
      
      // Check for trades in existing tokens (avoiding a second loop)
      const tokenAddress = log.address.toLowerCase();
      
      // Skip if we're not tracking this token
      if (!seenTokens.has(tokenAddress)) return;
      
      // Skip if not a Transfer event or missing topics
      if (!log.topics || log.topics.length < 3) return;
      
      // Get token info from our map
      let tokenInfo = seenTokens.get(tokenAddress);
      
      // Initialize trade tracking if needed
      if (!tokenInfo.trades) {
        tokenInfo = {
          ...tokenInfo,
          trades: [],
          buyCount: 0,
          sellCount: 0,
          uniqueBuyers: new Set(),
          uniqueSellers: new Set(),
          totalBuyVolume: "0",
          totalSellVolume: "0"
        };
      }
      
      // Decode from/to addresses
      const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
      const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
      
      // Get token amount
      const tokenAmount = log.args.value ? log.args.value.toString() : "0";
      
      // Skip if no amount (shouldn't happen with valid tokens)
      if (tokenAmount === "0") return;
      
      // Check if this is a buy or sell
      if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
        // It's a BUY (tokens from Four.meme to user)
        tokenInfo.buyCount++;
        tokenInfo.uniqueBuyers.add(toAddress);
        tokenInfo.totalBuyVolume = (BigInt(tokenInfo.totalBuyVolume) + BigInt(tokenAmount)).toString();
        
        // Add to trades array
        tokenInfo.trades.push({
          type: 'buy',
          amount: tokenAmount,
          formattedAmount: formatValue(tokenAmount, 18),
          buyer: toAddress,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          timestamp: new Date().toISOString()
        });
        
        // Mark token as updated
        updatedTokens.add(tokenAddress);
      } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
        // It's a SELL (tokens from user to Four.meme)
        tokenInfo.sellCount++;
        tokenInfo.uniqueSellers.add(fromAddress);
        tokenInfo.totalSellVolume = (BigInt(tokenInfo.totalSellVolume) + BigInt(tokenAmount)).toString();
        
        // Add to trades array
        tokenInfo.trades.push({
          type: 'sell',
          amount: tokenAmount,
          formattedAmount: formatValue(tokenAmount, 18),
          seller: fromAddress,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          timestamp: new Date().toISOString()
        });
        
        // Mark token as updated
        updatedTokens.add(tokenAddress);
      }
      
      // Update the token in our map
      seenTokens.set(tokenAddress, tokenInfo);
    });
    
    // Save updated tokens to database
    for (const tokenAddress of updatedTokens) {
      const tokenInfo = seenTokens.get(tokenAddress);
      try {
        await saveToken(tokenAddress, tokenInfo);
        console.log(`Updated token ${tokenAddress} in database`);
      } catch (error) {
        console.error(`Error saving token ${tokenAddress} to database: ${error.message}`);
      }
    }
    
    for (const [txHash, txLogs] of Object.entries(txGroups)) {
      const tokenInfo = await detectNewToken({ 
        txLogs, 
        txHash, 
        blockNumber, 
        logFunction: console.log, 
        seenTokens 
      });
      
      if (tokenInfo) {
        logTokenCreation({ 
          tokenInfo, 
          logFunction: console.log 
        });
        console.log(`Currently tracking ${seenTokens.size} tokens`);
        
        // Save new token to database
        try {
          await saveToken(tokenInfo.tokenAddress, tokenInfo);
          // console.log(`Saved new token ${tokenInfo.tokenAddress} to database`);
        } catch (error) {
          console.error(`Error saving new token ${tokenInfo.tokenAddress} to database: ${error.message}`);
        }
      }
    }
  } catch (error) {
    console.error(`Error processing block ${blockNumber}: ${error.message}`);
    console.error(error);
  }
}

async function main() {
  console.log('🔍 Four.meme Token Tracker started');
  console.log('Watching for new tokens on: ' + FOUR_MEME_ADDRESS);
  
  // Connect to MongoDB
  try {
    await connectToDatabase();
    console.log('Connected to MongoDB database');
  } catch (error) {
    console.error(`Failed to connect to MongoDB: ${error.message}`);
    process.exit(1);
  }

  await createFilter();
  
  // Watch for new blocks
  const unwatch = clientWebsocket.watchBlockNumber({
    onBlockNumber: async (blockNumber) => {
      console.log(blockNumber);
      await processBlock(blockNumber);
    },
    onError: (error) => {
      console.error(`Block watcher error: ${error.message}`);
      console.error('Block watcher error:', error);
    },
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Stopping token tracking...');
    unwatch();

    if (globalFilter) {
      try {
        await clientWebsocket.uninstallFilter({ filter: globalFilter });
        console.log('Cleaned up event filter');
      } catch (error) {
        console.log(`Filter cleanup warning: ${error.message}`);
      }
    }

    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
