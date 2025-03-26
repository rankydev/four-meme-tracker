import fs from 'fs';
import { getTokenData } from './tokenUtils.js';
import { 
  FOUR_MEME_ADDRESS, 
  ZERO_ADDRESS,
  STANDARD_TOTAL_SUPPLY
} from './config/index.js';
import { safeStringify, log, formatValue } from './utils.js';

/**
 * Calculate dev holding based on the transfer from Four.meme back to the creator
 * @param {Object} params - Parameters object
 * @param {Array} params.txLogs - All transaction logs
 * @param {string} params.tokenAddress - The token contract address
 * @param {string} params.creatorAddress - The creator's address
 * @param {number} params.decimals - Token decimals
 * @param {Function} params.logFunction - Function to use for logging
 * @returns {Object} - Object containing dev holding amount and percentage
 */
function calculateDevHolding({
  txLogs,
  tokenAddress,
  creatorAddress,
  decimals,
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
      logFunction(`No dev transfer found from ${FOUR_MEME_ADDRESS} to ${creatorAddress}`, false);
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
      formattedAmount: formatValue(amount, decimals)
    };
  } catch (error) {
    logFunction(`Error calculating dev holding: ${error.message}`, false);
    return {
      amount: '0',
      percentage: '0',
      formattedAmount: '0',
      error: error.message
    };
  }
}

/**
 * Log token creation details to console and save to file
 * @param {Object} params - Parameters object
 * @param {Object} params.tokenInfo - Token information object
 * @param {Function} params.logFunction - Function to use for logging
 * @param {String} params.logsDir - Directory to save logs
 * @returns {void}
 */
export function logTokenCreation({
  tokenInfo,
  logFunction = console.log,
  logsDir = './logs'
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
    `- Decimals: ${tokenInfo.decimals !== null ? tokenInfo.decimals : 18}`,
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
  
  // Save token info to file
  const tokenFilename = `${logsDir}/new_token_${tokenInfo.tokenAddress}_${Date.now()}.json`;
  fs.writeFileSync(tokenFilename, safeStringify(tokenInfo));
  logFunction(`Saved token info to ${tokenFilename}`, false); // Hide from console
}

/**
 * Detect new token mints and return token details
 * @param {Object} params - Parameters object
 * @param {Array} params.txLogs - Array of transaction logs
 * @param {String} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Function} params.logFunction - Function to use for logging
 * @param {String} params.logsDir - Directory to save logs
 * @param {Map} params.seenTokens - Map of already seen token addresses to their details
 * @returns {Object|null} - Token details if a new token is found, null otherwise
 */
export async function detectNewToken({
  txLogs,
  txHash,
  blockNumber,
  logFunction = console.log,
  logsDir = './logs',
  seenTokens = new Map()
}) {
  // Find tokens sent to four.meme
  const toFourMeme = txLogs.filter(log => 
    log.args.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
  );
  
  // Skip if no transfers to four.meme
  if (toFourMeme.length === 0) return null;
  
  logFunction(`Found ${toFourMeme.length} transfers to four.meme in transaction ${txHash}`, false);
  
  // Check each token sent to four.meme
  for (const fmLog of toFourMeme) {
    const tokenAddress = fmLog.address.toLowerCase();
    
    // Skip if we've already seen this token
    if (seenTokens.has(tokenAddress)) {
      logFunction(`Token ${tokenAddress} already seen, skipping`, false);
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
    logFunction(`Saved detailed transaction logs for token ${tokenAddress} to ${txLogsFile}`, false);
    
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
    
    // Skip tokens without mint operations
    if (!mintLog) continue;
    
    logFunction(`Found mint operation for token ${tokenAddress}`, false);
    
    // Get the potential creator by finding the last event for this token
    // Sort token events by logIndex to find the last one
    const sortedTokenEvents = [...tokenEvents].sort((a, b) => 
      Number(a.logIndex) - Number(b.logIndex)
    );
    
    // The last event's "to" address is likely the real creator
    const lastTokenEvent = sortedTokenEvents[sortedTokenEvents.length - 1];
    const creatorAddress = lastTokenEvent.args.to;
    
    logFunction(`Determined creator address: ${creatorAddress} (from last token event)`, false);
    logFunction(`Mint recipient was: ${mintLog.args.to} (for comparison)`, false);
    
    // Fetch token name and symbol
    logFunction(`Fetching token data for ${tokenAddress}...`, false);
    
    try {
      // Get token data using the multicall approach from tokenUtils
      const tokenData = await getTokenData(tokenAddress);
      
      // Log token data and handle null values properly
      const nameDisplay = tokenData.name || 'Unknown';
      const symbolDisplay = tokenData.symbol || 'Unknown'; 
      const decimalsDisplay = tokenData.decimals !== null ? tokenData.decimals : 18;
      
      logFunction(`Token data fetched: ${nameDisplay} (${symbolDisplay})`, false);
      
      // Log any errors that occurred during token data fetching
      if (tokenData.errors) {
        logFunction(`Token data fetching had errors:`, false);
        tokenData.errors.forEach(err => {
          logFunction(`  - ${err.field}: ${err.error}`, false);
        });
      }
      
      // Calculate dev holding based on the transfer from Four.meme back to the creator
      const devHolding = calculateDevHolding({
        txLogs,
        tokenAddress,
        creatorAddress,
        decimals: decimalsDisplay,
        logFunction
      });
      
      // Calculate current supply (total supply - dev holding)
      const currentSupply = (BigInt(STANDARD_TOTAL_SUPPLY) - BigInt(devHolding.amount)).toString();
      
      // Prepare token info
      const tokenInfo = {
        tokenAddress,
        name: tokenData.name,
        symbol: tokenData.symbol,
        decimals: tokenData.decimals,
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
