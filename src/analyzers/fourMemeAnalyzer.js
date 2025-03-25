import { FOUR_MEME_ADDRESS, EXCLUDE_TOKENS } from '../config/index.js';

/**
 * Analyzes a block for Four.meme platform activity
 * Optimized for single-pass processing to maximize performance
 * 
 * @param {Object} block - The block data with transactions
 * @param {Array} transferLogs - Transfer event logs from the block
 * @returns {Object} Analysis results
 */
export function analyzeFourMemeActivity(block, transferLogs) {
  // Start time to measure performance
  const startTime = performance.now();
  
  // Results object
  const results = {
    blockNumber: block.number,
    timestamp: block.timestamp,
    fourMemeTransactions: [],
    fourMemeInvolvedTokens: new Set(),
    tokensWithActivity: {},
    processingTime: 0
  };
  
  // Skip analysis if no transactions
  if (!block.transactions || block.transactions.length === 0) {
    results.processingTime = performance.now() - startTime;
    return results;
  }
  
  // Get Four.meme transactions and create hash lookup for O(1) access
  const fourMemeTransactionMap = new Map();
  
  // Single-pass through transactions
  for (const tx of block.transactions) {
    const isFourMemeTx = 
      (tx.to && tx.to.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()) || 
      (tx.from && tx.from.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase());
      
    if (isFourMemeTx) {
      results.fourMemeTransactions.push(tx);
      fourMemeTransactionMap.set(tx.hash, tx);
    }
  }
  
  // Skip further processing if no Four.meme transactions
  if (results.fourMemeTransactions.length === 0) {
    results.processingTime = performance.now() - startTime;
    return results;
  }
  
  // Process transfer logs in a single pass
  if (transferLogs && transferLogs.length > 0) {
    for (const log of transferLogs) {
      const tokenAddress = log.address.toLowerCase();
      
      // Skip well-known tokens
      if (EXCLUDE_TOKENS.includes(tokenAddress)) {
        continue;
      }
      
      // Check if this transfer is related to Four.meme
      const isInFourMemeTx = fourMemeTransactionMap.has(log.transactionHash);
      const fromAddr = log.topics && log.topics.length >= 2 ? '0x' + log.topics[1].slice(26).toLowerCase() : null;
      const toAddr = log.topics && log.topics.length >= 3 ? '0x' + log.topics[2].slice(26).toLowerCase() : null;
      const isDirectFourMemeTransfer = 
        fromAddr === FOUR_MEME_ADDRESS.toLowerCase() || 
        toAddr === FOUR_MEME_ADDRESS.toLowerCase();
      
      // If this token is involved with Four.meme
      if (isInFourMemeTx || isDirectFourMemeTransfer) {
        // Add to the set of Four.meme involved tokens
        results.fourMemeInvolvedTokens.add(tokenAddress);
        
        // Initialize token data structure if it doesn't exist
        if (!results.tokensWithActivity[tokenAddress]) {
          results.tokensWithActivity[tokenAddress] = {
            address: tokenAddress,
            transfers: [],
            isFourMemeInvolved: false,
            involvementReasons: []
          };
        }
        
        // Mark token as Four.meme involved and record reason
        if (isInFourMemeTx) {
          results.tokensWithActivity[tokenAddress].isFourMemeInvolved = true;
          results.tokensWithActivity[tokenAddress].involvementReasons.push('Four.meme transaction');
        }
        
        if (isDirectFourMemeTransfer) {
          results.tokensWithActivity[tokenAddress].isFourMemeInvolved = true;
          results.tokensWithActivity[tokenAddress].involvementReasons.push('Transfer to/from Four.meme');
        }
        
        // Add the transfer to token activity
        results.tokensWithActivity[tokenAddress].transfers.push(log);
      }
    }
  }
  
  // Calculate processing time
  results.processingTime = performance.now() - startTime;
  
  return results;
}

/**
 * Checks if a transaction involves the Four.meme platform
 * 
 * @param {Object} tx - Transaction object
 * @returns {boolean} Whether the transaction involves Four.meme
 */
export function isFourMemeTransaction(tx) {
  return (
    (tx.to && tx.to.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()) || 
    (tx.from && tx.from.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase())
  );
}

/**
 * Checks if a log event is a transfer to or from Four.meme
 * 
 * @param {Object} log - Log event object
 * @returns {boolean} Whether the log is a transfer involving Four.meme
 */
export function isDirectFourMemeTransfer(log) {
  if (!log.topics || log.topics.length < 3) {
    return false;
  }
  
  const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
  const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
  
  return (
    fromAddr === FOUR_MEME_ADDRESS.toLowerCase() || 
    toAddr === FOUR_MEME_ADDRESS.toLowerCase()
  );
} 