import { getTokenData } from './tokenUtils.js';
import { 
  FOUR_MEME_ADDRESS, 
  ZERO_ADDRESS,
  STANDARD_TOTAL_SUPPLY
} from './config/index.js';
import { formatValue } from './utils.js';

// Helper for debug logs - only log when debug is true
const debugLog = (message, debug = false) => {
  if (debug) {
    console.log(message);
  }
};

/**
 * Calculate dev holding based on the transfer from Four.meme back to the creator
 * @param {Object} params - Parameters object
 * @param {Array} params.txLogs - All transaction logs
 * @param {string} params.tokenAddress - The token contract address
 * @param {string} params.creatorAddress - The creator's address
 * @param {Function} params.logFunction - Function to use for logging
 * @returns {Object} - Object containing dev holding amount and percentage
 */
function calculateDevHolding({
  txLogs,
  tokenAddress,
  creatorAddress,
  logFunction = console.log
}) {
  try {
    // Find the transfer from four.meme back to the creator
    const devTransfer = txLogs.find(log => 
      log.address.toLowerCase() === tokenAddress.toLowerCase() &&
      log.args.from?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() &&
      log.args.to?.toLowerCase() === creatorAddress.toLowerCase()
    );
    
    if (!devTransfer || !devTransfer.args.value) {
      debugLog(`No dev transfer found from ${FOUR_MEME_ADDRESS} to ${creatorAddress}`);
      return {
        amount: '0',
        percentage: '0',
        formattedAmount: '0'
      };
    }
    
    const amount = devTransfer.args.value.toString();
    // Calculate percentage (dev holding / total supply * 100)
    const devHoldingPercent = (Number(amount) / Number(STANDARD_TOTAL_SUPPLY)) * 100;
    
    return {
      amount,
      percentage: devHoldingPercent.toFixed(2),
      formattedAmount: formatValue(amount, 18) // Fixed 18 decimals for all tokens
    };
  } catch (error) {
    debugLog(`Error calculating dev holding: ${error.message}`);
    return {
      amount: '0',
      percentage: '0',
      formattedAmount: '0',
      error: error.message
    };
  }
}

/**
 * Log token creation details to console
 * @param {Object} params - Parameters object
 * @param {Object} params.tokenInfo - Token information object
 * @param {Function} params.logFunction - Function to use for logging
 * @returns {void}
 */
export function logTokenCreation({
  tokenInfo,
  logFunction = console.log
}) {
  if (!tokenInfo) return;
  
  // Create token detection message
  const tokenCreatedMsg = '\n🚨 NEW FOUR.MEME TOKEN CREATED!';
  logFunction(tokenCreatedMsg);
  
  // Prepare display details
  const details = [
    `- Token address: ${tokenInfo.tokenAddress}`,
    `- Name: ${tokenInfo.name || 'Unknown'}`,
    `- Symbol: ${tokenInfo.symbol || 'Unknown'}`,
    `- Creator: ${tokenInfo.creator}`,
    `- Transaction: ${tokenInfo.transactionHash}`,
    `- Block: ${tokenInfo.blockNumber}`,
    `- Value: ${tokenInfo.value}`,
    `- Time detected: ${tokenInfo.detectedAt}`,
    `- Total Supply: ${tokenInfo.totalSupply}`,
    `- Current Supply: ${tokenInfo.currentSupply}`,
    `- Dev Holding: ${tokenInfo.devHolding.formattedAmount} (${tokenInfo.devHolding.percentage}%)`
  ];
  
  // Log each detail line to console
  details.forEach(detail => logFunction(detail));
}

/**
 * Detect new token mints and return token details
 * @param {Object} params - Parameters object
 * @param {Array} params.txLogs - Array of transaction logs
 * @param {String} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Function} params.logFunction - Function to use for logging
 * @param {Map} params.seenTokens - Map of already seen token addresses to their details
 * @returns {Object|null} - Token details if a new token is found, null otherwise
 */
export async function detectNewToken({
  txLogs,
  txHash,
  blockNumber,
  logFunction = console.log,
  seenTokens = new Map()
}) {
  // Find tokens sent to four.meme
  const toFourMeme = txLogs.filter(log => 
    log.args.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
  );
  
  // Skip if no transfers to four.meme
  if (toFourMeme.length === 0) return null;
  
  debugLog(`Found ${toFourMeme.length} transfers to four.meme in transaction ${txHash}`);
  
  // Check each token sent to four.meme
  for (const fmLog of toFourMeme) {
    const tokenAddress = fmLog.address.toLowerCase();
    
    // Skip if we've already seen this token
    if (seenTokens.has(tokenAddress)) {
      debugLog(`Token ${tokenAddress} already seen, skipping`);
      continue;
    }
    
    // Check if there's a mint operation for this token in the same tx
    const mintLog = txLogs.find(log => 
      log.address.toLowerCase() === tokenAddress &&
      log.args.from === ZERO_ADDRESS
    );
    
    // Log all token events for analysis
    const tokenEvents = txLogs.filter(log => log.address.toLowerCase() === tokenAddress);
    
    // Skip tokens without mint operations
    if (!mintLog) continue;
    
    debugLog(`Found mint operation for token ${tokenAddress}`);
    
    // Get the potential creator by finding the last event for this token
    // Sort token events by logIndex to find the last one
    const sortedTokenEvents = [...tokenEvents].sort((a, b) => 
      Number(a.logIndex) - Number(b.logIndex)
    );
    
    // The last event's "to" address is likely the real creator
    const lastTokenEvent = sortedTokenEvents[sortedTokenEvents.length - 1];
    const creatorAddress = lastTokenEvent.args.to;
    
    debugLog(`Determined creator address: ${creatorAddress} (from last token event)`);
    debugLog(`Mint recipient was: ${mintLog.args.to} (for comparison)`);
    
    // Fetch token name and symbol
    debugLog(`Fetching token data for ${tokenAddress}...`);
    
    try {
      // Get token data using the multicall approach from tokenUtils
      const tokenData = await getTokenData(tokenAddress);
      
      // Log token data and handle null values properly
      const nameDisplay = tokenData.name || 'Unknown';
      const symbolDisplay = tokenData.symbol || 'Unknown'; 
      
      debugLog(`Token data fetched: ${nameDisplay} (${symbolDisplay})`);
      
      // Log any errors that occurred during token data fetching
      if (tokenData.errors) {
        debugLog(`Token data fetching had errors:`);
        tokenData.errors.forEach(err => {
          debugLog(`  - ${err.field}: ${err.error}`);
        });
      }
      
      // Calculate dev holding based on the transfer from Four.meme back to the creator
      const devHolding = calculateDevHolding({
        txLogs,
        tokenAddress,
        creatorAddress,
        logFunction
      });
      
      // Calculate current supply (total supply - dev holding)
      const currentSupply = (BigInt(STANDARD_TOTAL_SUPPLY) - BigInt(devHolding.amount)).toString();
      
      // Prepare token info
      const tokenInfo = {
        tokenAddress,
        name: tokenData.name,
        symbol: tokenData.symbol,
        totalSupply: STANDARD_TOTAL_SUPPLY,
        currentSupply,
        creator: creatorAddress,
        mintRecipient: mintLog.args.to,
        transactionHash: txHash,
        blockNumber: blockNumber.toString(),
        value: fmLog.args.value ? fmLog.args.value.toString() : 'N/A',
        detectedAt: new Date().toISOString(),
        dataErrors: tokenData.errors,
        devHolding,
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
      
      // Store token info in seenTokens map
      seenTokens.set(tokenAddress, tokenInfo);
      
      return tokenInfo;
    } catch (error) {
      // Continue with minimal token data if fetching fails
      const errorMsg = `Error fetching token data for ${tokenAddress}: ${error.message}`;
      logFunction(errorMsg); // Show errors in console
      console.error(error); // Show full error in console
      
      // Return minimal token info
      const tokenInfo = {
        tokenAddress,
        creator: creatorAddress,
        mintRecipient: mintLog.args.to,
        transactionHash: txHash,
        blockNumber: blockNumber.toString(),
        value: fmLog.args.value ? fmLog.args.value.toString() : 'N/A',
        detectedAt: new Date().toISOString(),
        totalSupply: STANDARD_TOTAL_SUPPLY,
        currentSupply: STANDARD_TOTAL_SUPPLY,
        devHolding: {
          amount: '0',
          percentage: '0',
          formattedAmount: '0',
          error: 'Failed to calculate dev holding'
        },
        error: error.message
      };
      
      // Store minimal token info in seenTokens map
      seenTokens.set(tokenAddress, tokenInfo);
      
      return tokenInfo;
    }
  }
  
  // No new tokens found
  return null;
} 
