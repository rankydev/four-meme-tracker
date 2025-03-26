import TokenStats from '../models/TokenStats.js';

/**
 * Save or update token information in the database
 * @param {string} tokenAddress - The token address
 * @param {Object} tokenInfo - The token information
 * @returns {Promise<Object>} - The saved token document
 */
export async function saveToken(tokenAddress, tokenInfo) {
  try {
    // Prepare token data for MongoDB
    const tokenData = { ...tokenInfo };
    
    // Convert Sets to Arrays for storage
    if (tokenData.uniqueBuyers instanceof Set) {
      tokenData.uniqueBuyers = Array.from(tokenData.uniqueBuyers);
      tokenData.uniqueBuyersCount = tokenData.uniqueBuyers.length;
    }
    
    if (tokenData.uniqueSellers instanceof Set) {
      tokenData.uniqueSellers = Array.from(tokenData.uniqueSellers);
      tokenData.uniqueSellersCount = tokenData.uniqueSellers.length;
    }
    
    // Set last updated timestamp
    tokenData.lastUpdated = new Date();
    
    // Use upsert to create if doesn't exist or update if it does
    const result = await TokenStats.findOneAndUpdate(
      { tokenAddress: tokenAddress.toLowerCase() },
      tokenData,
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true
      }
    );
    
    return result;
  } catch (error) {
    console.error(`Error saving token ${tokenAddress} to database:`, error);
    throw error;
  }
}

/**
 * Get token information from the database
 * @param {string} tokenAddress - The token address
 * @returns {Promise<Object>} - The token document
 */
export async function getToken(tokenAddress) {
  try {
    const token = await TokenStats.findOne({ 
      tokenAddress: tokenAddress.toLowerCase() 
    });
    return token;
  } catch (error) {
    console.error(`Error retrieving token ${tokenAddress} from database:`, error);
    throw error;
  }
}

/**
 * Add a trade to a token's trade history
 * @param {string} tokenAddress - The token address
 * @param {Object} trade - Trade information
 * @returns {Promise<Object>} - The updated token document
 */
export async function addTrade(tokenAddress, trade) {
  try {
    // Update different fields based on trade type
    const updateQuery = { $push: { trades: trade } };
    
    // Update buy or sell counts and volumes
    if (trade.type === 'buy') {
      updateQuery.$inc = { buyCount: 1 };
      updateQuery.$addToSet = { uniqueBuyers: trade.buyer };
      updateQuery.$set = { 
        lastUpdated: new Date() 
      };
      
      // Use BigInt-safe string operations for totalBuyVolume
      const token = await TokenStats.findOne({ tokenAddress: tokenAddress.toLowerCase() });
      if (token) {
        const newTotalBuyVolume = (BigInt(token.totalBuyVolume || "0") + BigInt(trade.amount)).toString();
        updateQuery.$set.totalBuyVolume = newTotalBuyVolume;
      }
    } else {
      updateQuery.$inc = { sellCount: 1 };
      updateQuery.$addToSet = { uniqueSellers: trade.seller };
      updateQuery.$set = { 
        lastUpdated: new Date() 
      };
      
      // Use BigInt-safe string operations for totalSellVolume
      const token = await TokenStats.findOne({ tokenAddress: tokenAddress.toLowerCase() });
      if (token) {
        const newTotalSellVolume = (BigInt(token.totalSellVolume || "0") + BigInt(trade.amount)).toString();
        updateQuery.$set.totalSellVolume = newTotalSellVolume;
      }
    }
    
    // Update the token
    const result = await TokenStats.findOneAndUpdate(
      { tokenAddress: tokenAddress.toLowerCase() },
      updateQuery,
      { new: true }
    );
    
    // Update the uniqueBuyersCount and uniqueSellersCount
    if (result) {
      await TokenStats.findOneAndUpdate(
        { tokenAddress: tokenAddress.toLowerCase() },
        { 
          uniqueBuyersCount: result.uniqueBuyers?.length || 0,
          uniqueSellersCount: result.uniqueSellers?.length || 0
        },
        { new: true }
      );
    }
    
    return result;
  } catch (error) {
    console.error(`Error adding trade for token ${tokenAddress} to database:`, error);
    throw error;
  }
}

/**
 * Get all tokens in the database
 * @returns {Promise<Array>} - Array of token documents
 */
export async function getAllTokens() {
  try {
    return await TokenStats.find({}).sort({ detectedAt: -1 });
  } catch (error) {
    console.error('Error retrieving all tokens from database:', error);
    throw error;
  }
}

/**
 * Get tokens created within a specific time range
 * @param {Date} startTime - Start time
 * @param {Date} endTime - End time
 * @returns {Promise<Array>} - Array of token documents
 */
export async function getTokensInTimeRange(startTime, endTime) {
  try {
    return await TokenStats.find({
      detectedAt: {
        $gte: startTime,
        $lte: endTime || new Date()
      }
    }).sort({ detectedAt: -1 });
  } catch (error) {
    console.error('Error retrieving tokens in time range from database:', error);
    throw error;
  }
}

/**
 * Get recent trades for all tokens
 * @param {number} limit - Maximum number of trades to return
 * @returns {Promise<Array>} - Array of trades with token information
 */
export async function getRecentTrades(limit = 50) {
  try {
    const tokens = await TokenStats.find({ 'trades.0': { $exists: true } });
    
    // Extract all trades from all tokens
    let allTrades = [];
    tokens.forEach(token => {
      token.trades.forEach(trade => {
        allTrades.push({
          ...trade.toObject(),
          tokenAddress: token.tokenAddress,
          tokenName: token.name,
          tokenSymbol: token.symbol
        });
      });
    });
    
    // Sort by timestamp, most recent first
    allTrades.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Return only the requested number of trades
    return allTrades.slice(0, limit);
  } catch (error) {
    console.error('Error retrieving recent trades from database:', error);
    throw error;
  }
} 