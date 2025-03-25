process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import fs from 'fs';
import { clientHttp as client, clientWebsocket } from './src/clients/client.js';
import { parseAbiItem } from 'viem';
import { FOUR_MEME_ADDRESS } from './src/config/index.js';
import { detectNewToken, logTokenCreation } from './src/tokenDetector.js';

// Create a logs directory if it doesn't exist
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

const seenTokens = new Set();

// Parse the Transfer event signature for use in filters
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/**
 * Write a log message to both console and log file
 */
function log(message, showInConsole = true) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `${timestamp}: ${message}`;
  
  // Show in console if requested
  if (showInConsole) {
    console.log(message);
  }
  
  // Append to today's log file
  const today = new Date().toISOString().split('T')[0];
  const logFile = `${logsDir}/token_tracker_${today}.log`;
  fs.appendFileSync(logFile, formattedMessage + '\n');
}

/**
 * Process a specific block to detect new token creations
 */
async function processBlock(blockNumber) {
  try {
    log(`Processing block ${blockNumber}`, false); // Set to false to hide from console
    
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
    
    log(`Found ${logs.length} Transfer events in block ${blockNumber}`, false); // Set to false to hide from console
    
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
    
    log(`Grouped into ${Object.keys(txGroups).length} transactions`, false); // Set to false to hide from console
    
    for (const [txHash, txLogs] of Object.entries(txGroups)) {
      const tokenInfo = await detectNewToken({ txLogs, txHash, blockNumber, logFunction: log, logsDir, seenTokens });
      
      if (tokenInfo) {
        logTokenCreation({ tokenInfo, logFunction: log, logsDir });
      }
    }
  } catch (error) {
    const errorMsg = `Error processing block ${blockNumber}: ${error.message}`;
    log(errorMsg);
    console.error(error);
  }
}

async function main() {
  log('🔍 Four.meme Token Tracker started');
  log('Watching for new tokens on: ' + FOUR_MEME_ADDRESS);
  
  // Watch for new blocks
  const unwatch = clientWebsocket.watchBlockNumber({
    onBlockNumber: async (blockNumber) => {
      log(`New block detected: ${blockNumber}`, false); // Hide from console
      await processBlock(blockNumber);
    },
    onError: (error) => {
      log(`Block watcher error: ${error.message}`);
      console.error('Block watcher error:', error);
    },
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    log('Stopping token tracking...');
    unwatch();
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  log(`Fatal error: ${error.message}`);
  process.exit(1);
});