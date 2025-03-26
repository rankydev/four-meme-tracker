process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import fs from 'fs';
import { clientHttp as client, clientWebsocket } from './src/clients/client.js';
import { parseAbiItem } from 'viem';
import { FOUR_MEME_ADDRESS } from './src/config/index.js';
import { detectNewToken, logTokenCreation } from './src/tokenDetector.js';
import { log } from './src/utils.js';

// Create a logs directory if it doesn't exist
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const seenTokens = new Map();

// Parse the Transfer event signature for use in filters
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/**
 * Process a specific block to detect new token creations
 */
async function processBlock(blockNumber) {
  try {    
    // Create filter for Transfer events in this block
    // Note: We use parseAbiItem for the event structure but we're aware that 
    // TRANSFER_EVENT_SIGNATURE from config has the correct event signature
    const filter = await client.createEventFilter({
      event: transferEvent,
      fromBlock: blockNumber,
      toBlock: blockNumber,
    });
    
    // Get logs using the filter
    const logs = await client.getFilterLogs({ filter });
    
    log(`Found ${logs.length} Transfer events in block ${blockNumber}`, false, logsDir); // Set to false to hide from console
    
    // Skip if no events
    if (logs.length === 0) return;
    
    // Group logs by transaction hash
    const txGroups = {};
    logs.forEach(log => {
      if (!txGroups[log.transactionHash]) {
        txGroups[log.transactionHash] = [];
      }
      txGroups[log.transactionHash].push(log);
    });
    
    for (const [txHash, txLogs] of Object.entries(txGroups)) {
      // We need to create a custom logFunction that passes logsDir to the imported log function
      const logWithDir = (msg, showInConsole = true) => log(msg, showInConsole, logsDir);
      
      const tokenInfo = await detectNewToken({ 
        txLogs, 
        txHash, 
        blockNumber, 
        logFunction: logWithDir, 
        logsDir, 
        seenTokens 
      });
      
      if (tokenInfo) {
        logTokenCreation({ 
          tokenInfo, 
          logFunction: logWithDir, 
          logsDir 
        });
        console.log(`Currently tracking ${seenTokens.size} tokens`);
        console.log(seenTokens)
      }
    }
  } catch (error) {
    const errorMsg = `Error processing block ${blockNumber}: ${error.message}`;
    log(errorMsg, true, logsDir);
    console.error(error);
  }
}

async function main() {
  log('🔍 Four.meme Token Tracker started', true, logsDir);
  log('Watching for new tokens on: ' + FOUR_MEME_ADDRESS, true, logsDir);
  
  // Watch for new blocks
  const unwatch = clientWebsocket.watchBlockNumber({
    onBlockNumber: async (blockNumber) => {
      await processBlock(blockNumber);
    },
    onError: (error) => {
      log(`Block watcher error: ${error.message}`, true, logsDir);
      console.error('Block watcher error:', error);
    },
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('Stopping token tracking...', true, logsDir);
    unwatch();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  log(`Fatal error: ${error.message}`, true, logsDir);
  process.exit(1);
});
