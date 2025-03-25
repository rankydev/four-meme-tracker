process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp as client, clientWebsocket } from './src/clients/client.js';
import { parseAbi, parseAbiItem } from 'viem';
import fs from 'fs';
import { getTokenData } from './src/tokenUtils.js';
import { 
  FOUR_MEME_ADDRESS, 
  TRANSFER_EVENT_SIGNATURE, 
  ZERO_ADDRESS,
  STANDARD_TOTAL_SUPPLY
} from './src/config/index.js';

// Create a logs directory if it doesn't exist
const logsDir = './logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Track tokens we've already seen
const seenTokens = new Set();

// Basic token ABI for getting information
const tokenABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
]);

// Parse the Transfer event signature for use in filters
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/**
 * Custom JSON serializer that handles BigInt values
 * @param {Object} data - The data to stringify
 * @returns {string} - The JSON string
 */
function safeStringify(data, indent = 2) {
  return JSON.stringify(data, (key, value) => {
    // Convert BigInt to string
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, indent);
}

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
    
    // Process each transaction
    for (const [txHash, txLogs] of Object.entries(txGroups)) {
      // Find tokens sent to four.meme
      const toFourMeme = txLogs.filter(log => 
        log.args.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
      );
      
      // Skip if no transfers to four.meme
      if (toFourMeme.length === 0) continue;
      
      log(`Found ${toFourMeme.length} transfers to four.meme in transaction ${txHash}`, false); // Set to false to hide from console
      
      // Check each token
      for (const fmLog of toFourMeme) {
        const tokenAddress = fmLog.address.toLowerCase();
        
        // Skip if we've already seen this token
        if (seenTokens.has(tokenAddress)) {
          log(`Token ${tokenAddress} already seen, skipping`, false);
          continue;
        }
        
        // Save all logs for this transaction for later analysis
        const tokenLogsDir = `${logsDir}/token_logs`;
        if (!fs.existsSync(tokenLogsDir)) {
          fs.mkdirSync(tokenLogsDir, { recursive: true });
        }
        
        // Save all transaction logs to help debug token creation
        const txLogsFile = `${tokenLogsDir}/tx_logs_${tokenAddress}_${txHash}.json`;
        const detailedTxLogs = txLogs.map(log => ({
          address: log.address,
          blockNumber: log.blockNumber.toString(),
          logIndex: log.logIndex,
          transactionHash: log.transactionHash,
          transactionIndex: log.transactionIndex,
          from: log.args.from,
          to: log.args.to,
          value: log.args.value ? log.args.value.toString() : 'N/A',
          topics: log.topics,
          data: log.data
        }));
        
        fs.writeFileSync(txLogsFile, safeStringify(detailedTxLogs));
        log(`Saved detailed transaction logs for token ${tokenAddress} to ${txLogsFile}`, false);
        
        // Check if there's a mint operation for this token in the same tx
        const mintLog = txLogs.find(log => 
          log.address.toLowerCase() === tokenAddress &&
          log.args.from === ZERO_ADDRESS
        );
        
        // Log all token events for analysis
        const tokenEvents = txLogs.filter(log => log.address.toLowerCase() === tokenAddress);
        const tokenEventsFile = `${tokenLogsDir}/token_events_${tokenAddress}.json`;
        fs.writeFileSync(tokenEventsFile, safeStringify(tokenEvents.map(log => ({
          blockNumber: log.blockNumber.toString(),
          transactionHash: log.transactionHash,
          from: log.args.from,
          to: log.args.to,
          value: log.args.value ? log.args.value.toString() : 'N/A',
          logIndex: log.logIndex
        }))));
        
        // Skip tokens without mint operations - don't log the skip
        if (!mintLog) continue;
        
        log(`Found mint operation for token ${tokenAddress}`, false); // Set to false to hide from console
        
        // If we found both a mint and transfer to four.meme, we have a new token
        seenTokens.add(tokenAddress);
        
        // Get the potential creator by finding the last event for this token
        // Sort token events by logIndex to find the last one
        const sortedTokenEvents = [...tokenEvents].sort((a, b) => 
          Number(a.logIndex) - Number(b.logIndex)
        );
        
        // The last event's "to" address is likely the real creator
        const lastTokenEvent = sortedTokenEvents[sortedTokenEvents.length - 1];
        const creatorAddress = lastTokenEvent.args.to;
        
        log(`Determined creator address: ${creatorAddress} (from last token event)`, false);
        log(`Mint recipient was: ${mintLog.args.to} (for comparison)`, false);
        
        // Fetch token name and symbol
        log(`Fetching token data for ${tokenAddress}...`, false);
        
        // Create token detection message
        const tokenCreatedMsg = '\n🚨 NEW FOUR.MEME TOKEN CREATED!';
        let details = [];
        let tokenInfo = {};
        
        try {
          // Get token data using the multicall approach from tokenUtils
          const tokenData = await getTokenData(tokenAddress);
          
          // Use standard total supply instead of fetching it - saves an RPC call
          const totalSupply = STANDARD_TOTAL_SUPPLY;
          
          // Log token data and handle null values properly
          const nameDisplay = tokenData.name || 'Unknown';
          const symbolDisplay = tokenData.symbol || 'Unknown'; 
          const decimalsDisplay = tokenData.decimals !== null ? tokenData.decimals : 18;
          
          log(`Token data fetched: ${nameDisplay} (${symbolDisplay})`, false);
          
          // Log any errors that occurred during token data fetching
          if (tokenData.errors) {
            log(`Token data fetching had errors:`, false);
            tokenData.errors.forEach(err => {
              log(`  - ${err.field}: ${err.error}`, false);
            });
          }
          
          // Log the token created message - SHOW IN CONSOLE
          log(tokenCreatedMsg); 
          
          // Prepare details
          details = [
            `- Token address: ${tokenAddress}`,
            `- Name: ${nameDisplay}`,
            `- Symbol: ${symbolDisplay}`,
            `- Decimals: ${decimalsDisplay}`,
            `- Creator: ${creatorAddress}`,
            `- Transaction: ${txHash}`,
            `- Block: ${blockNumber.toString()}`,
            `- Value: ${fmLog.args.value ? fmLog.args.value.toString() : 'N/A'}`,
            `- Time detected: ${new Date().toISOString()}`
          ];
          
          // Prepare token info
          tokenInfo = {
            tokenAddress,
            name: tokenData.name,
            symbol: tokenData.symbol,
            decimals: tokenData.decimals,
            totalSupply: totalSupply,
            creator: creatorAddress,
            mintRecipient: mintLog.args.to,
            transactionHash: txHash,
            blockNumber: blockNumber.toString(),
            value: fmLog.args.value ? fmLog.args.value.toString() : 'N/A',
            detectedAt: new Date().toISOString(),
            dataErrors: tokenData.errors,
            mintLog: {
              from: mintLog.args.from,
              to: mintLog.args.to,
              value: mintLog.args.value ? mintLog.args.value.toString() : 'N/A',
              logIndex: mintLog.logIndex
            },
            fourMemeTransfer: {
              from: fmLog.args.from,
              to: fmLog.args.to,
              value: fmLog.args.value ? fmLog.args.value.toString() : 'N/A',
              logIndex: fmLog.logIndex
            }
          };
        } catch (error) {
          // Continue with minimal token data if fetching fails
          const errorMsg = `Error fetching token data for ${tokenAddress}: ${error.message}`;
          log(errorMsg); // Show errors in console
          console.error(error); // Show full error in console
          
          // Log the token created message
          log(tokenCreatedMsg); // Show token detection in console
          
          // Prepare minimal details
          details = [
            `- Token address: ${tokenAddress}`,
            `- Creator: ${creatorAddress}`,
            `- Transaction: ${txHash}`,
            `- Block: ${blockNumber.toString()}`,
            `- Value: ${fmLog.args.value ? fmLog.args.value.toString() : 'N/A'}`,
            `- Time detected: ${new Date().toISOString()}`
          ];
          
          // Prepare minimal token info
          tokenInfo = {
            tokenAddress,
            creator: creatorAddress,
            mintRecipient: mintLog.args.to,
            transactionHash: txHash,
            blockNumber: blockNumber.toString(),
            value: fmLog.args.value ? fmLog.args.value.toString() : 'N/A',
            detectedAt: new Date().toISOString(),
            totalSupply: STANDARD_TOTAL_SUPPLY,
            error: error.message
          };
        }
        
        // Log each detail line to console
        details.forEach(detail => log(detail));
        
        // Save token info to file
        const tokenFilename = `${logsDir}/new_token_${tokenAddress}_${Date.now()}.json`;
        fs.writeFileSync(tokenFilename, safeStringify(tokenInfo));
        log(`Saved token info to ${tokenFilename}`, false); // Hide from console
      }
    }
  } catch (error) {
    const errorMsg = `Error processing block ${blockNumber}: ${error.message}`;
    log(errorMsg); // Show errors in console
    console.error(error); // Show full error in console
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
    emitOnBegin: true, // Process the current block when starting
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