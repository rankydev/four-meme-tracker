// Disable certificate validation for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Import required modules
import { clientHttp, clientWebsocket } from './src/clients/client.js';
import { connectToDatabase } from './src/db/connection.js';
import { saveToken, getTokens } from './src/db/tokenRepository.js';
import { delay, retryWithBackoff } from './src/utils.js';
import { detectNewToken } from './src/tokenDetector.js';
import { processTokenTrades } from './src/services/tokenProcessor.js';
import { analyzeToken } from './src/services/tokenAnalyzer.js';
import { debugLog, errorLog, infoLog, successLog, warnLog } from './src/utils/logging.js';
import { FOUR_MEME_ADDRESS, TRANSFER_EVENT_SIGNATURE } from './src/config/index.js';

// Global state
const seenTokens = new Map();
let globalFilter = null;
let shutdownRequested = false;
let isConnected = false;

// Constants
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Main application entry point
 */
async function main() {
  infoLog('Starting Four.meme Token Tracker...');
  
  try {
    // Initialize database connection
    await connectToDatabase();
    infoLog('Database connection established');
    
    // Load previously tracked tokens
    await loadTokensFromDatabase();
    
    // Setup graceful shutdown handlers
    setupShutdownHandlers();
    
    // Set up event filter for transfer events
    globalFilter = await setupEventFilter();
    
    // Start the block watcher
    await setupBlockWatcher();
    
    infoLog('Four.meme Token Tracker is running');
  } catch (error) {
    errorLog(`Error starting application: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Load previously tracked tokens from the database
 */
async function loadTokensFromDatabase() {
  try {
    infoLog('Loading tokens from database...');
    
    const tokens = await getTokens();
    
    if (tokens && tokens.length > 0) {
      tokens.forEach(token => {
        // Convert Set-like objects back to actual Sets
        if (token.uniqueBuyers && !token.uniqueBuyers instanceof Set) {
          token.uniqueBuyers = new Set(token.uniqueBuyers);
        }
        if (token.uniqueSellers && !token.uniqueSellers instanceof Set) {
          token.uniqueSellers = new Set(token.uniqueSellers);
        }
        
        seenTokens.set(token.tokenAddress.toLowerCase(), token);
      });
      
      successLog(`Loaded ${tokens.length} tokens from database`);
    } else {
      infoLog('No tokens found in database');
    }
  } catch (error) {
    errorLog(`Error loading tokens from database: ${error.message}`);
    // Continue despite error - we can still track new tokens
  }
}

/**
 * Set up the event filter for tracking token transfers
 */
async function setupEventFilter() {
  try {
    infoLog('Setting up event filter for Transfer events');
    
    // Create a filter for the Transfer event
    const filter = await clientHttp.createEventFilter({
      event: 'Transfer(address,address,uint256)',
    });
    
    infoLog(`Event filter created: ${filter.id}`);
    return filter;
  } catch (error) {
    errorLog(`Error setting up event filter: ${error.message}`);
    throw error;
  }
}

/**
 * Set up the block watcher for tracking new blocks
 */
async function setupBlockWatcher() {
  try {
    infoLog('Setting up block watcher');
    
    // Create a websocket subscription for new block headers
    clientWebsocket.watchBlockNumber(
      { emitMissed: true, emitOnBegin: true },
      {
        onBlock: async (blockNumber) => {
          try {
            await processBlock(blockNumber);
            isConnected = true;
          } catch (error) {
            handleBlockProcessingError(error);
          }
        },
        onError: (error) => {
          handleWatcherError(error);
        },
      }
    );
    
    infoLog('Block watcher set up successfully');
  } catch (error) {
    errorLog(`Error setting up block watcher: ${error.message}`);
    
    // Attempt to reconnect after a delay if not shutting down
    if (!shutdownRequested) {
      infoLog(`Attempting to reconnect in ${RECONNECT_DELAY_MS/1000} seconds...`);
      await delay(RECONNECT_DELAY_MS);
      await setupBlockWatcher();
    }
  }
}

/**
 * Process a single block
 * 
 * @param {BigInt} blockNumber - Block number to process
 */
async function processBlock(blockNumber) {
  try {
    const blockNumberInt = parseInt(blockNumber.toString());
    
    // Only log every 10 blocks to reduce noise
    if (blockNumberInt % 10 === 0) {
      infoLog(`Processing block ${blockNumberInt}`);
    }
    
    // Ensure we have an event filter
    if (!globalFilter) {
      globalFilter = await setupEventFilter();
    }
    
    // Get logs from the block using our filter
    const logs = await clientHttp.getFilterChanges({ filter: globalFilter });
    
    // Skip if no logs
    if (!logs || logs.length === 0) {
      debugLog(`No logs in block ${blockNumberInt}`);
      return;
    }
    
    debugLog(`Found ${logs.length} Transfer events in block ${blockNumberInt}`);
    
    // Group logs by transaction for more efficient processing
    const logsByTx = groupLogsByTransaction(logs);
    
    // Process each transaction
    const updatedTokens = new Set();
    const newTokens = [];
    
    for (const [txHash, txLogs] of logsByTx) {
      // First check for new token creations
      const detectedToken = await checkForNewToken(txLogs, txHash, blockNumber);
      
      if (detectedToken) {
        newTokens.push(detectedToken);
        updatedTokens.add(detectedToken.tokenAddress);
      }
      
      // Then check for trades in existing tokens
      const { updatedTokenAddresses } = await checkForTokenTrades(txLogs, txHash, blockNumber);
      
      // Add updated token addresses to the set
      for (const addr of updatedTokenAddresses) {
        updatedTokens.add(addr);
      }
    }
    
    // Save all updated tokens to database
    if (updatedTokens.size > 0) {
      await saveUpdatedTokens(Array.from(updatedTokens));
    }
    
    // Log results if we found new tokens or updates
    if (newTokens.length > 0) {
      successLog(`Detected ${newTokens.length} new tokens in block ${blockNumberInt}`);
      
      // Log each new token
      newTokens.forEach(token => {
        successLog(`  - ${token.name} (${token.symbol}) at ${token.tokenAddress}`);
      });
    }
    
    if (updatedTokens.size > newTokens.length) {
      infoLog(`Updated ${updatedTokens.size - newTokens.length} existing tokens with new trade data`);
    }
  } catch (error) {
    errorLog(`Error processing block ${blockNumber}: ${error.message}`);
    if (error.stack) {
      debugLog(error.stack);
    }
  }
}

/**
 * Group logs by transaction hash
 * 
 * @param {Array} logs - Logs to group
 * @returns {Map} - Map of transaction hash to logs
 */
function groupLogsByTransaction(logs) {
  const logsByTx = new Map();
  
  for (const log of logs) {
    const txHash = log.transactionHash;
    if (!logsByTx.has(txHash)) {
      logsByTx.set(txHash, []);
    }
    logsByTx.get(txHash).push(log);
  }
  
  return logsByTx;
}

/**
 * Check for new token creation in transaction logs
 * 
 * @param {Array} txLogs - Transaction logs
 * @param {string} txHash - Transaction hash
 * @param {BigInt} blockNumber - Block number
 * @returns {Object|null} - Detected token or null
 */
async function checkForNewToken(txLogs, txHash, blockNumber) {
  // Look for transfer events that are mints (from zero address) to Four.meme
  for (const log of txLogs) {
    if (log.topics && 
        log.topics[0] === TRANSFER_EVENT_SIGNATURE && // Transfer event
        log.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000' && // From zero address
        `0x${log.topics[2].slice(26)}`.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()) { // To Four.meme
      
      // Use the token detector module to extract token info
      const tokenInfo = await detectNewToken({ 
        txLogs, 
        txHash, 
        blockNumber, 
        logFunction: debugLog, 
        seenTokens 
      });
      
      if (tokenInfo) {
        // Add creation metadata if not already present
        if (!tokenInfo.creationBlockNumber) {
          tokenInfo.creationBlockNumber = blockNumber.toString();
        }
        if (!tokenInfo.creationTxHash) {
          tokenInfo.creationTxHash = txHash;
        }
        
        // Save new token to seenTokens map
        seenTokens.set(tokenInfo.tokenAddress.toLowerCase(), tokenInfo);
        
        // Save to database
        try {
          await saveToken(tokenInfo.tokenAddress, tokenInfo);
        } catch (error) {
          errorLog(`Error saving new token ${tokenInfo.tokenAddress} to database: ${error.message}`);
        }
        
        return tokenInfo;
      }
    }
  }
  
  return null;
}

/**
 * Check for trades in existing tokens
 * 
 * @param {Array} txLogs - Transaction logs
 * @param {string} txHash - Transaction hash
 * @param {BigInt} blockNumber - Block number
 * @returns {Object} - Result with updated token addresses
 */
async function checkForTokenTrades(txLogs, txHash, blockNumber) {
  const updatedTokenAddresses = new Set();
  
  // Find all logs involving tokens we're tracking
  const relevantLogs = txLogs.filter(log => 
    seenTokens.has(log.address.toLowerCase())
  );
  
  if (relevantLogs.length === 0) {
    return { updatedTokenAddresses };
  }
  
  // Process trades for each token separately
  for (const log of relevantLogs) {
    const tokenAddress = log.address.toLowerCase();
    const tokenInfo = seenTokens.get(tokenAddress);
    
    // Skip if token not found (shouldn't happen)
    if (!tokenInfo) continue;
    
    // Process this token's trades
    const updatedTokenInfo = await processTokenTrades({
      log,
      txLogs,
      txHash,
      blockNumber,
      tokenInfo,
      client: clientHttp
    });
    
    // If token was updated, add to results and update seenTokens
    if (updatedTokenInfo) {
      seenTokens.set(tokenAddress, updatedTokenInfo);
      updatedTokenAddresses.add(tokenAddress);
      
      // Run analysis on updated token data if needed
      if (updatedTokenInfo.trades && updatedTokenInfo.trades.length > 0) {
        const analysis = analyzeToken(updatedTokenInfo);
        
        // Log any suspicious activity
        if (analysis.flags && analysis.flags.length > 0) {
          warnLog(`⚠️ Suspicious activity detected for ${tokenInfo.name} (${tokenInfo.symbol}):`);
          analysis.flags.forEach(flag => warnLog(`  - ${flag}`));
        }
      }
    }
  }
  
  return { updatedTokenAddresses };
}

/**
 * Save updated tokens to the database
 * 
 * @param {Array} tokenAddresses - Token addresses to save
 */
async function saveUpdatedTokens(tokenAddresses) {
  const savePromises = [];
  
  for (const tokenAddress of tokenAddresses) {
    const tokenInfo = seenTokens.get(tokenAddress);
    if (tokenInfo) {
      savePromises.push(
        saveToken(tokenAddress, tokenInfo)
          .catch(error => errorLog(`Error saving token ${tokenAddress} to database: ${error.message}`))
      );
    }
  }
  
  if (savePromises.length > 0) {
    await Promise.all(savePromises);
  }
}

/**
 * Handle errors in block processing
 * 
 * @param {Error} error - The error that occurred
 */
async function handleBlockProcessingError(error) {
  errorLog(`Block processing error: ${error.message}`);
  
  // Check if this is a filter-related error
  if (error.message.includes('filter not found') || 
      error.message.includes('invalid filter') ||
      error.message.includes('filter timeout')) {
    errorLog('Filter appears to be invalid, resetting...');
    globalFilter = null;
    
    // Create a new filter
    try {
      globalFilter = await setupEventFilter();
      successLog('Filter reset successfully');
    } catch (resetError) {
      errorLog(`Failed to reset filter: ${resetError.message}`);
    }
  }
}

/**
 * Handle errors in the block watcher
 * 
 * @param {Error} error - The error that occurred
 */
async function handleWatcherError(error) {
  errorLog(`Block watcher error: ${error.message}`);
  
  // Update connection status
  isConnected = false;
  
  // If shutting down, don't attempt reconnection
  if (shutdownRequested) return;
  
  infoLog('Attempting to reconnect block watcher...');
  
  try {
    // Use exponential backoff for reconnection
    await retryWithBackoff(
      setupBlockWatcher,
      {
        maxRetries: MAX_RECONNECT_ATTEMPTS,
        initialDelayMs: RECONNECT_DELAY_MS,
        maxDelayMs: 60000 // 1 minute max
      }
    );
    
    successLog('Block watcher reconnected successfully');
  } catch (reconnectError) {
    errorLog(`Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts. Exiting.`);
    process.exit(1);
  }
}

/**
 * Set up handlers for graceful shutdown
 */
function setupShutdownHandlers() {
  // Handle termination signals
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  
  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    errorLog(`Uncaught exception: ${error.message}`);
    errorLog(error.stack);
    gracefulShutdown('uncaughtException');
  });
}

/**
 * Perform a graceful shutdown of the application
 * 
 * @param {string} signal - The signal that triggered the shutdown
 */
async function gracefulShutdown(signal) {
  infoLog(`\nReceived ${signal}, shutting down gracefully...`);
  
  // Set flag to prevent reconnection attempts
  shutdownRequested = true;
  
  try {
    // Clean up resources
    if (globalFilter) {
      infoLog('Uninstalling event filter...');
      await clientHttp.uninstallFilter({ filter: globalFilter }).catch(e => 
        errorLog(`Error uninstalling filter: ${e.message}`)
      );
    }
    
    infoLog('Closing database connection...');
    // Close database connection if needed
    
    infoLog('Shutdown complete');
  } catch (error) {
    errorLog(`Error during shutdown: ${error.message}`);
  } finally {
    // Force exit after a timeout to prevent hanging
    setTimeout(() => {
      infoLog('Forcing exit');
      process.exit(0);
    }, 2000);
  }
}

// Start the application
main().catch(error => {
  errorLog(`Startup error: ${error.message}`);
  process.exit(1);
}); 