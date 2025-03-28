import { FOUR_MEME_ADDRESS, ZERO_ADDRESS, STANDARD_TOTAL_SUPPLY } from './config/index.js';
import { getTokenData } from './tokenUtils.js';
import { isLikelyToken } from './tokenUtils.js';
import { calculateDevHolding, formatValue } from './utils.js';
import { debugLog, errorLog } from './utils/logging.js';

// Known infrastructure contracts that should be excluded from token detection
const INFRASTRUCTURE_CONTRACTS = [
  '0x5c952063c7fc8610ffdb798152d69f0b9550762b', // Four.meme platform
  '0x48735904455eda3aa9a0c9e43ee9999c795e30b9'  // Four.meme helper
].map(addr => addr.toLowerCase());

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
    
    // Skip infrastructure contracts
    if (INFRASTRUCTURE_CONTRACTS.includes(tokenAddress)) {
      debugLog(`Skipping infrastructure contract ${tokenAddress}`);
      continue;
    }
    
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
    
    // Skip tokens without mint operations
    if (!mintLog) continue;
    
    debugLog(`Found mint operation for token ${tokenAddress}`);
    
    // Verify this is actually an ERC20 token before proceeding
    try {
      // First check if it implements basic ERC20 interface
      const isToken = await isLikelyToken(tokenAddress);
      if (!isToken) {
        debugLog(`${tokenAddress} does not implement ERC20 interface, skipping`);
        continue;
      }
      
      // Get token data using the multicall approach from tokenUtils
      const tokenData = await getTokenData(tokenAddress);
      
      // Skip if we couldn't get basic token data
      if (!tokenData || !tokenData.success) {
        debugLog(`Could not get token data for ${tokenAddress}, skipping`);
        continue;
      }
      
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
      
      // Get the potential creator by finding the last event for this token
      const sortedTokenEvents = [...txLogs.filter(log => log.address.toLowerCase() === tokenAddress)]
        .sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
      
      // The last event's "to" address is likely the real creator
      const lastTokenEvent = sortedTokenEvents[sortedTokenEvents.length - 1];
      const creatorAddress = lastTokenEvent.args.to;
      
      debugLog(`Determined creator address: ${creatorAddress} (from last token event)`);
      debugLog(`Mint recipient was: ${mintLog.args.to} (for comparison)`);
      
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
      debugLog(`Error processing token ${tokenAddress}: ${error.message}`);
      continue;
    }
  }
  
  // No new tokens found
  return null;
} 
