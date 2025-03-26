import { FOUR_MEME_ADDRESS } from './config/index.js';
import { formatValue } from './utils.js';

/**
 * Initialize trade tracking for a token
 * @param {Object} tokenInfo - Token information object
 * @returns {Object} - Updated token information with trade tracking initialized
 */
export function initializeTradeTracking(tokenInfo) {
  if (!tokenInfo.trades) {
    return {
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
  return tokenInfo;
}

/**
 * Track trades for tokens in the seenTokens map
 * @param {Object} params - Parameters object
 * @param {Array} params.logs - Array of transaction logs
 * @param {Map} params.seenTokens - Map of tracked token addresses to their details
 * @returns {Array} - Array of tokens that had new trades
 */
export function trackTrades({
  logs,
  seenTokens
}) {
  const tokensWithNewTrades = [];
  
  // Process logs to find trades for tokens we're tracking
  for (const log of logs) {
    // Skip if not a Transfer event or missing topics
    if (!log.topics || log.topics.length < 3) continue;
    
    const tokenAddress = log.address.toLowerCase();
    
    // Skip if we're not tracking this token
    if (!seenTokens.has(tokenAddress)) continue;
    
    // Get token info from our map
    let tokenInfo = seenTokens.get(tokenAddress);
    
    // Initialize trade tracking if needed
    if (!tokenInfo.trades) {
      tokenInfo = initializeTradeTracking(tokenInfo);
    }
    
    // Decode from/to addresses
    const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
    const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
    
    // Get token amount
    const tokenAmount = log.args.value ? log.args.value.toString() : "0";
    
    // Skip if no amount (shouldn't happen with valid tokens)
    if (tokenAmount === "0") continue;
    
    let tradeDetected = false;
    
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
        formattedAmount: formatValue(tokenAmount, tokenInfo.decimals || 18),
        buyer: toAddress,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        timestamp: new Date().toISOString()
      });
      
      tradeDetected = true;
    } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
      // It's a SELL (tokens from user to Four.meme)
      tokenInfo.sellCount++;
      tokenInfo.uniqueSellers.add(fromAddress);
      tokenInfo.totalSellVolume = (BigInt(tokenInfo.totalSellVolume) + BigInt(tokenAmount)).toString();
      
      // Add to trades array
      tokenInfo.trades.push({
        type: 'sell',
        amount: tokenAmount,
        formattedAmount: formatValue(tokenAmount, tokenInfo.decimals || 18),
        seller: fromAddress,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber.toString(),
        timestamp: new Date().toISOString()
      });
      
      tradeDetected = true;
    }
    
    // If we detected a trade, update the token in the map and add to result array
    if (tradeDetected) {
      seenTokens.set(tokenAddress, tokenInfo);
      if (!tokensWithNewTrades.includes(tokenAddress)) {
        tokensWithNewTrades.push(tokenAddress);
      }
    }
  }
  
  return tokensWithNewTrades;
}

/**
 * Get trade statistics for a token
 * @param {Object} tokenInfo - Token information object
 * @returns {Object} - Object with trade statistics
 */
export function getTradeStats(tokenInfo) {
  // Return empty stats if no trades
  if (!tokenInfo.trades) {
    return {
      buyCount: 0,
      sellCount: 0,
      uniqueBuyerCount: 0,
      uniqueSellerCount: 0,
      totalBuyVolume: "0",
      totalSellVolume: "0",
      recentTrades: []
    };
  }
  
  return {
    buyCount: tokenInfo.buyCount || 0,
    sellCount: tokenInfo.sellCount || 0,
    uniqueBuyerCount: tokenInfo.uniqueBuyers ? tokenInfo.uniqueBuyers.size : 0,
    uniqueSellerCount: tokenInfo.uniqueSellers ? tokenInfo.uniqueSellers.size : 0,
    totalBuyVolume: tokenInfo.totalBuyVolume || "0",
    totalSellVolume: tokenInfo.totalSellVolume || "0",
    formattedBuyVolume: formatValue(tokenInfo.totalBuyVolume || "0", tokenInfo.decimals || 18),
    formattedSellVolume: formatValue(tokenInfo.totalSellVolume || "0", tokenInfo.decimals || 18),
    recentTrades: tokenInfo.trades.slice(-5).reverse() // Last 5 trades, most recent first
  };
} 