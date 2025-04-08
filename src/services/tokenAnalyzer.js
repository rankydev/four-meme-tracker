/**
 * Token Analyzer Service
 * Responsible for identifying new tokens and analyzing token trades
 */

import { FOUR_MEME_ADDRESS, TRANSFER_EVENT_SIGNATURE, ZERO_ADDRESS } from '../config/index.js';
import { getTokenData, isLikelyToken } from '../tokenUtils.js';
import { formatValue, calculateDevHolding } from '../utils.js';
import { saveToken } from '../db/tokenRepository.js';
import { debugLog, errorLog, infoLog, successLog, warnLog } from '../utils/logging.js';

// Known infrastructure contracts that should be excluded from token detection
const INFRASTRUCTURE_CONTRACTS = [
  '0x5c952063c7fc8610ffdb798152d69f0b9550762b', // Four.meme main contract
  '0x48735904455eda3aa9a0c9e43ee9999c795e30b9'  // Four.meme helper
].map(addr => addr.toLowerCase());

// Four.meme related addresses to exclude from trade tracking
const FOUR_MEME_RELATED_ADDRESSES = new Set([
  '0x5c952063c7fc8610ffdb798152d69f0b9550762b', // Four.meme main contract
  FOUR_MEME_ADDRESS, // Current Four.meme address from config
  '0x48735904455eda3aa9a0c9e43ee9999c795e30b9'  // Four.meme helper contract
].map(addr => addr.toLowerCase()));

// DEX contracts
const KNOWN_DEX_CONTRACTS = new Set([
  '0x7fa69aa3cd15409f424f3bf91576c97f78166a12', // DEX Aggregator
  '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap Router
  '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap Router v3
  '0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7', // ApeSwap Router
  '0x05ff2b0db69458a0750badebc4f9e13add608c7f', // PancakeSwap Router v1
  '0x2b6e6e4def77583229299cf386438a227e683b28', // gmgn.ai Router
  '0x1de460f363af910f51726def188f9004276bf4bc'  // Four.meme Trading Contract
].map(addr => addr.toLowerCase()));

// Platform contracts
const PLATFORM_CONTRACTS = {
  'four.meme': [
    '0x5c952063c7fc8610ffdb798152d69f0b9550762b',
    '0x1de460f363af910f51726def188f9004276bf4bc'
  ].map(addr => addr.toLowerCase()),
  'gmgn.ai': [
    '0x2b6e6e4def77583229299cf386438a227e683b28'
  ].map(addr => addr.toLowerCase())
};

/**
 * Process logs from a block to analyze token creations, trades, and transfers
 * @param {Object} params - Parameters
 * @param {Array} params.logs - Array of logs to process
 * @param {BigInt} params.blockNumber - Block number
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @returns {Object} - Processing results
 */
export async function processBlockLogs({ logs, blockNumber, seenTokens }) {
  // Group logs by transaction hash for more efficient processing
  const logsByTx = new Map();
  for (const log of logs) {
    const txHash = log.transactionHash;
    if (!logsByTx.has(txHash)) {
      logsByTx.set(txHash, []);
    }
    logsByTx.get(txHash).push(log);
  }

  debugLog(`Grouped ${logs.length} logs into ${logsByTx.size} transactions`);
  
  // Track results
  const updatedTokens = new Set();
  const newTokens = [];
  const tradesByToken = new Map();

  // Process all transactions in a single pass
  for (const [txHash, txLogs] of logsByTx) {
    // First check for new token creations
    const createdTokens = await detectNewTokens({ 
      txLogs, 
      txHash, 
      blockNumber, 
      seenTokens 
    });
    
    if (createdTokens.length > 0) {
      for (const tokenInfo of createdTokens) {
        try {
          // Save to database
          await saveToken(tokenInfo.tokenAddress, tokenInfo);
          updatedTokens.add(tokenInfo.tokenAddress);
          newTokens.push(tokenInfo);
          
          // Log new token information
          successLog('\n🆕 NEW TOKEN DETECTED 🆕');
          infoLog('Token Details:');
          infoLog(`  Name: ${tokenInfo.name}`);
          infoLog(`  Symbol: ${tokenInfo.symbol}`);
          infoLog(`  Address: ${tokenInfo.tokenAddress}`);
          infoLog(`  Creator: ${tokenInfo.creator}`);
          infoLog(`  Total Supply: ${formatValue(tokenInfo.totalSupply || "0", tokenInfo.decimals)} tokens`);
          infoLog(`  Creation Block: ${tokenInfo.blockNumber}`);
          infoLog(`  Creation Tx: ${tokenInfo.transactionHash}`);
        } catch (error) {
          errorLog(`Error saving new token ${tokenInfo.tokenAddress} to database: ${error.message}`);
        }
      }
    }
    
    // Then check for trades in existing tokens
    const trades = detectTrades({ txLogs, seenTokens });
    
    if (trades.length > 0) {
      for (const trade of trades) {
        const { tokenAddress, type, tradeInfo } = trade;
        
        if (!tradesByToken.has(tokenAddress)) {
          tradesByToken.set(tokenAddress, { buys: [], sells: [], transfers: [] });
        }
        
        if (type === 'buy') {
          tradesByToken.get(tokenAddress).buys.push(tradeInfo);
        } else if (type === 'sell') {
          tradesByToken.get(tokenAddress).sells.push(tradeInfo);
        } else if (type === 'transfer') {
          tradesByToken.get(tokenAddress).transfers.push(tradeInfo);
        }
        
        updatedTokens.add(tokenAddress);
      }
    }
  }
  
  // Update token stats for all affected tokens
  for (const tokenAddress of updatedTokens) {
    const tokenInfo = seenTokens.get(tokenAddress);
    const trades = tradesByToken.get(tokenAddress);
    
    // Skip if no trade data found
    if (!trades) continue;
    
    // Update token stats based on trades
    updateTokenStats({
      tokenInfo,
      buys: trades.buys,
      sells: trades.sells,
      transfers: trades.transfers
    });
    
    // Save updated token to database
    try {
      await saveToken(tokenAddress, tokenInfo);
    } catch (error) {
      errorLog(`Error saving token ${tokenAddress} to database: ${error.message}`);
    }
  }
  
  return { 
    updatedTokens: Array.from(updatedTokens),
    newTokens,
    tradesByToken
  };
}

/**
 * Detect new token creations in transaction logs
 * @param {Object} params - Parameters
 * @param {Array} params.txLogs - Logs from a transaction
 * @param {String} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @returns {Array} - Array of detected tokens
 */
async function detectNewTokens({ txLogs, txHash, blockNumber, seenTokens }) {
  const detectedTokens = [];
  
  // Extract mint events (transfers from zero address)
  const mintEvents = txLogs.filter(log => 
    log.topics && 
    log.topics[0] === TRANSFER_EVENT_SIGNATURE && 
    log.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000' // From zero address
  );
  
  // Filter for mints to Four.meme
  const mintsToFourMeme = mintEvents.filter(log => {
    const recipient = `0x${log.topics[2].slice(26)}`.toLowerCase();
    return recipient === FOUR_MEME_ADDRESS.toLowerCase();
  });
  
  // Return early if no mints to Four.meme found
  if (mintsToFourMeme.length === 0) return detectedTokens;
  
  // Process each mint to Four.meme
  for (const mintLog of mintsToFourMeme) {
    const tokenAddress = mintLog.address.toLowerCase();
    
    // Skip infrastructure contracts
    if (INFRASTRUCTURE_CONTRACTS.includes(tokenAddress)) continue;
    
    // Skip if we've already seen this token
    if (seenTokens.has(tokenAddress)) continue;
    
    // Verify it's a valid ERC20 token
    try {
      // Check if it implements basic ERC20 interface
      const isToken = await isLikelyToken(tokenAddress);
      if (!isToken) continue;
      
      // Get token data
      const tokenData = await getTokenData(tokenAddress);
      if (!tokenData || !tokenData.success) continue;
      
      // Get the potential creator by finding subsequent transfers
      const transfersFromFourMeme = txLogs.filter(log => 
        log.address.toLowerCase() === tokenAddress &&
        log.topics[0] === TRANSFER_EVENT_SIGNATURE &&
        `0x${log.topics[1].slice(26)}`.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
      );
      
      let creatorAddress = null;
      
      if (transfersFromFourMeme.length > 0) {
        // The first recipient of tokens from Four.meme is likely the creator
        const transferLog = transfersFromFourMeme[0];
        creatorAddress = `0x${transferLog.topics[2].slice(26)}`;
      } else {
        // Fallback: use the sender of the transaction as creator
        const sortedEvents = txLogs
          .filter(log => log.address.toLowerCase() === tokenAddress)
          .sort((a, b) => Number(a.logIndex) - Number(b.logIndex));
        
        if (sortedEvents.length > 0) {
          const lastEvent = sortedEvents[sortedEvents.length - 1];
          creatorAddress = lastEvent.args?.to || `0x${lastEvent.topics[2]?.slice(26)}`;
        }
      }
      
      // Calculate dev holding
      const devHolding = calculateDevHolding({
        txLogs,
        tokenAddress,
        creatorAddress,
        logFunction: debugLog
      });
      
      // Prepare token info
      const tokenInfo = {
        tokenAddress,
        name: tokenData.name,
        symbol: tokenData.symbol,
        decimals: tokenData.decimals || 18,
        totalSupply: tokenData.totalSupply,
        creator: creatorAddress,
        transactionHash: txHash,
        blockNumber: blockNumber.toString(),
        detectedAt: new Date().toISOString(),
        devHolding,
        
        // Initialize trading stats
        trades: [],
        buyCount: 1, // Start at 1 to count the creator's initial tokens
        sellCount: 0,
        uniqueBuyers: new Set([creatorAddress?.toLowerCase()]), // Initialize with creator
        uniqueSellers: new Set(),
        totalBuyVolume: tokenData.totalSupply || "0", // Initial supply counts as first buy
        totalSellVolume: "0",
        devHoldings: tokenData.totalSupply || "0" // Initialize dev holdings with total supply
      };
      
      // Add to seen tokens and detected tokens
      seenTokens.set(tokenAddress, tokenInfo);
      detectedTokens.push(tokenInfo);
      
    } catch (error) {
      errorLog(`Error processing potential token ${tokenAddress}: ${error.message}`);
    }
  }
  
  return detectedTokens;
}

/**
 * Detect trades (buys/sells) and transfers in transaction logs
 * @param {Object} params - Parameters
 * @param {Array} params.txLogs - Logs from a transaction
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @returns {Array} - Array of detected trades
 */
function detectTrades({ txLogs, seenTokens }) {
  const trades = [];
  
  // Process only transfer events
  const transferEvents = txLogs.filter(log => 
    log.topics && 
    log.topics[0] === TRANSFER_EVENT_SIGNATURE &&
    log.topics.length >= 3
  );
  
  for (const log of transferEvents) {
    const tokenAddress = log.address.toLowerCase();
    
    // Skip if we're not tracking this token
    if (!seenTokens.has(tokenAddress)) continue;
    
    // Extract transfer details
    const fromAddress = `0x${log.topics[1].slice(26)}`.toLowerCase();
    const toAddress = `0x${log.topics[2].slice(26)}`.toLowerCase();
    const tokenAmount = log.data ? log.data : '0x0';
    
    // Skip zero-amount transfers
    if (tokenAmount === '0x0') continue;
    
    // Skip if either address is a Four.meme related address (except the main contract for actual trades)
    if ((fromAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(fromAddress)) || 
        (toAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(toAddress))) {
      continue;
    }
    
    const tokenInfo = seenTokens.get(tokenAddress);
    const tradeInfo = {
      txHash: log.transactionHash,
      blockNumber: log.blockNumber.toString(),
      logIndex: log.logIndex.toString(),
      amount: tokenAmount,
      formattedAmount: formatValue(tokenAmount, tokenInfo.decimals || 18),
      timestamp: new Date().toISOString()
    };
    
    // Determine trade type
    if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
      // It's a BUY (tokens from Four.meme to user)
      trades.push({
        tokenAddress,
        type: 'buy',
        tradeInfo: {
          ...tradeInfo,
          buyer: toAddress,
          isCreator: toAddress === tokenInfo.creator?.toLowerCase()
        }
      });
    } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
      // It's a SELL (tokens from user to Four.meme)
      trades.push({
        tokenAddress,
        type: 'sell',
        tradeInfo: {
          ...tradeInfo,
          seller: fromAddress,
          isCreator: fromAddress === tokenInfo.creator?.toLowerCase()
        }
      });
    } else if (!FOUR_MEME_RELATED_ADDRESSES.has(fromAddress) && !FOUR_MEME_RELATED_ADDRESSES.has(toAddress)) {
      // It's a wallet-to-wallet TRANSFER
      
      // Check if either address is a DEX contract
      const isDexInvolved = KNOWN_DEX_CONTRACTS.has(fromAddress) || KNOWN_DEX_CONTRACTS.has(toAddress);
      
      // Skip if DEX is involved (we'll handle DEX interactions separately)
      if (isDexInvolved) continue;
      
      trades.push({
        tokenAddress,
        type: 'transfer',
        tradeInfo: {
          ...tradeInfo,
          from: fromAddress,
          to: toAddress,
          isCreatorSending: fromAddress === tokenInfo.creator?.toLowerCase(),
          isCreatorReceiving: toAddress === tokenInfo.creator?.toLowerCase()
        }
      });
    }
  }
  
  return trades;
}

/**
 * Update token stats based on trades
 * @param {Object} params - Parameters
 * @param {Object} params.tokenInfo - Token info object to update
 * @param {Array} params.buys - Buy trades
 * @param {Array} params.sells - Sell trades
 * @param {Array} params.transfers - Transfer trades
 */
function updateTokenStats({ tokenInfo, buys = [], sells = [], transfers = [] }) {
  // Process buys
  for (const buy of buys) {
    const { buyer, amount, isCreator } = buy;
    
    // Update stats
    tokenInfo.buyCount++;
    tokenInfo.uniqueBuyers.add(buyer);
    tokenInfo.totalBuyVolume = (BigInt(tokenInfo.totalBuyVolume) + BigInt(amount)).toString();
    
    // Track creator buys
    if (isCreator) {
      tokenInfo.devHoldings = (BigInt(tokenInfo.devHoldings) + BigInt(amount)).toString();
    }
    
    // Add to trades array
    tokenInfo.trades.push({
      type: 'buy',
      ...buy
    });
  }
  
  // Process sells
  for (const sell of sells) {
    const { seller, amount, isCreator } = sell;
    
    // Update stats
    tokenInfo.sellCount++;
    tokenInfo.uniqueSellers.add(seller);
    tokenInfo.totalSellVolume = (BigInt(tokenInfo.totalSellVolume) + BigInt(amount)).toString();
    
    // Track creator sells
    if (isCreator) {
      tokenInfo.devHoldings = (BigInt(tokenInfo.devHoldings) - BigInt(amount)).toString();
    }
    
    // Add to trades array
    tokenInfo.trades.push({
      type: 'sell',
      ...sell
    });
  }
  
  // Process transfers
  for (const transfer of transfers) {
    const { from, to, amount, isCreatorSending, isCreatorReceiving } = transfer;
    
    // Track creator holdings
    if (isCreatorSending) {
      tokenInfo.devHoldings = (BigInt(tokenInfo.devHoldings) - BigInt(amount)).toString();
    } else if (isCreatorReceiving) {
      tokenInfo.devHoldings = (BigInt(tokenInfo.devHoldings) + BigInt(amount)).toString();
    }
    
    // Initialize wallet transfers array if needed
    if (!tokenInfo.walletTransfers) {
      tokenInfo.walletTransfers = [];
    }
    
    // Add to wallet transfers array
    tokenInfo.walletTransfers.push(transfer);
  }
}

/**
 * Enhanced token detection using the comprehensive approach from test3.js
 * Useful for detecting tokens in a specific block independent of real-time events
 * @param {Object} params - Parameters
 * @param {BigInt} params.blockNumber - Block number to analyze
 * @param {Object} params.client - Viem client
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @returns {Array} - Array of detected tokens
 */
export async function detectTokenCreationsInBlock({ blockNumber, client, seenTokens }) {
  debugLog(`\n=== ANALYZING BLOCK ${blockNumber} FOR FOUR.MEME TOKEN CREATION ===`);
  const startTime = Date.now();
  
  try {
    // Fetch the block with full transaction data
    debugLog(`Fetching block ${blockNumber} with full transaction data...`);
    const block = await client.getBlock({
      blockNumber: BigInt(blockNumber),
      includeTransactions: true
    });
    
    debugLog(`Block ${blockNumber} contains ${block.transactions.length} transactions`);
    
    // Look for ALL Transfer events in this block 
    debugLog("\nFetching Transfer events in this block...");
    const transferLogs = await client.getLogs({
      fromBlock: BigInt(blockNumber),
      toBlock: BigInt(blockNumber),
      topics: [TRANSFER_EVENT_SIGNATURE]
    });
    
    debugLog(`Found ${transferLogs.length} Transfer events`);
    
    // Group logs by contract address
    const contractEvents = {};
    
    // Process Transfer events
    for (const log of transferLogs) {
      const address = log.address.toLowerCase();
      if (!contractEvents[address]) {
        contractEvents[address] = {
          transfers: [],
          mints: [],
          burns: [],
          fourMemeInvolved: false,
          fourMemeReason: []
        };
      }
      
      // Add transfer
      contractEvents[address].transfers.push(log);
      
      // Identify transfer type if this is a Transfer event
      if (log.topics && log.topics[0] === TRANSFER_EVENT_SIGNATURE && log.topics.length >= 3) {
        const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
        const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
        
        // Check if Four.meme is directly involved in the transfer
        if (fromAddr === FOUR_MEME_ADDRESS.toLowerCase() || toAddr === FOUR_MEME_ADDRESS.toLowerCase()) {
          contractEvents[address].fourMemeInvolved = true;
          contractEvents[address].fourMemeReason.push('Transfer to/from Four.meme');
        }
        
        // Mint (from zero address)
        if (fromAddr === ZERO_ADDRESS.toLowerCase()) {
          contractEvents[address].mints.push(log);
          
          // Check if mint is to Four.meme
          if (toAddr === FOUR_MEME_ADDRESS.toLowerCase()) {
            contractEvents[address].fourMemeInvolved = true;
            contractEvents[address].fourMemeReason.push('Mint to Four.meme');
          }
        }
      }
    }
    
    // Potential token creations found
    const potentialTokens = [];
    
    // Filter to tokens with Four.meme involvement and mints
    const fourMemeTokens = Object.keys(contractEvents).filter(address => {
      const events = contractEvents[address];
      return events.fourMemeInvolved && events.mints.length > 0;
    });
    
    debugLog(`\nFound ${fourMemeTokens.length} potential token creations with Four.meme involvement`);
    
    // Process each potential token
    for (const tokenAddress of fourMemeTokens) {
      const events = contractEvents[tokenAddress];
      
      try {
        // Only process if not already seen
        if (seenTokens.has(tokenAddress)) {
          debugLog(`Token ${tokenAddress} already tracked, skipping`);
          continue;
        }
        
        // Get token data
        const tokenData = await getTokenData(tokenAddress);
        if (!tokenData || !tokenData.success) continue;
        
        infoLog(`\nVerified token: ${tokenData.name} (${tokenData.symbol})`);
        
        // Determine creator address by finding transfers from Four.meme
        let creatorAddress = null;
        
        // Find transfers from Four.meme
        const transfersFromFourMeme = events.transfers.filter(log => 
          `0x${log.topics[1].slice(26)}`.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
        );
        
        if (transfersFromFourMeme.length > 0) {
          // The first recipient is likely the creator
          creatorAddress = `0x${transfersFromFourMeme[0].topics[2].slice(26)}`;
          debugLog(`Determined creator: ${creatorAddress}`);
        }
        
        // Find mint to Four.meme
        const mintToFourMeme = events.mints.find(log => 
          `0x${log.topics[2].slice(26)}`.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
        );
        
        if (!mintToFourMeme) continue;
        
        // Create token info
        const tokenInfo = {
          tokenAddress,
          name: tokenData.name,
          symbol: tokenData.symbol,
          decimals: tokenData.decimals || 18,
          totalSupply: tokenData.totalSupply,
          creator: creatorAddress,
          transactionHash: mintToFourMeme.transactionHash,
          blockNumber: blockNumber.toString(),
          detectedAt: new Date().toISOString(),
          
          // Initialize trading stats
          trades: [],
          buyCount: 1, // Start at 1 to count the creator's initial tokens
          sellCount: 0,
          uniqueBuyers: new Set([creatorAddress?.toLowerCase()]), // Initialize with creator
          uniqueSellers: new Set(),
          totalBuyVolume: tokenData.totalSupply || "0", // Initial supply counts as first buy
          totalSellVolume: "0",
          devHoldings: tokenData.totalSupply || "0" // Initialize dev holdings with total supply
        };
        
        // Add to potential tokens
        potentialTokens.push(tokenInfo);
        
        // Add to seen tokens
        seenTokens.set(tokenAddress, tokenInfo);
        
        // Save to database
        try {
          await saveToken(tokenAddress, tokenInfo);
        } catch (error) {
          errorLog(`Error saving token ${tokenAddress} to database: ${error.message}`);
        }
      } catch (error) {
        errorLog(`Error analyzing token ${tokenAddress}: ${error.message}`);
      }
    }
    
    infoLog(`\nAnalysis completed in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
    return potentialTokens;
    
  } catch (error) {
    errorLog(`Error in block analysis: ${error.message}`);
    return [];
  }
}

/**
 * Analyze token data for suspicious activity patterns
 * 
 * @param {Object} tokenInfo - Token information object
 * @returns {Object} - Analysis results including any flags
 */
export function analyzeToken(tokenInfo) {
  // Initialize analysis result
  const result = {
    tokenAddress: tokenInfo.tokenAddress,
    name: tokenInfo.name,
    symbol: tokenInfo.symbol,
    flags: [],
    riskScore: 0,
    insights: {}
  };
  
  // Calculate metrics
  const tradeCount = (tokenInfo.buyCount || 0) + (tokenInfo.sellCount || 0);
  const devPercentage = tokenInfo.devHoldings && tokenInfo.totalSupply 
    ? (BigInt(tokenInfo.devHoldings) * BigInt(100) / BigInt(tokenInfo.totalSupply)).toString()
    : "0";
  
  // Check for high creator holdings
  if (Number(devPercentage) > 50) {
    result.flags.push(`Creator holds ${devPercentage}% of supply (high concentration risk)`);
    result.riskScore += 2;
  }
  
  // Check if creator has sold a significant amount
  if (tokenInfo.trades && tokenInfo.trades.some(t => 
    t.type === 'sell' && 
    t.isCreator && 
    BigInt(t.amount) > (BigInt(tokenInfo.totalSupply) * BigInt(10) / BigInt(100))
  )) {
    result.flags.push("Creator has made large sell transactions (>10% of supply)");
    result.riskScore += 3;
  }
  
  // Check buy/sell ratio
  if (tokenInfo.sellCount > 0 && tokenInfo.buyCount > 0) {
    const sellBuyRatio = tokenInfo.sellCount / tokenInfo.buyCount;
    if (sellBuyRatio > 2) {
      result.flags.push(`High sell/buy ratio: ${sellBuyRatio.toFixed(2)}`);
      result.riskScore += 2;
    }
  }
  
  // Check for unusual transfer patterns
  if (tokenInfo.walletTransfers && tokenInfo.walletTransfers.length > 0) {
    // Group transfers by recipient
    const transfersByRecipient = {};
    for (const transfer of tokenInfo.walletTransfers) {
      if (!transfersByRecipient[transfer.to]) {
        transfersByRecipient[transfer.to] = [];
      }
      transfersByRecipient[transfer.to].push(transfer);
    }
    
    // Check for addresses receiving multiple transfers
    const multiTransferRecipients = Object.keys(transfersByRecipient)
      .filter(addr => transfersByRecipient[addr].length > 3);
    
    if (multiTransferRecipients.length > 0) {
      result.flags.push(`${multiTransferRecipients.length} addresses received multiple transfers (potential distribution)`);
      result.riskScore += multiTransferRecipients.length;
      
      // Store insight data
      result.insights.multiTransferRecipients = multiTransferRecipients;
    }
  }
  
  // Check cross-platform trades
  if (tokenInfo.crossPlatformTrades && tokenInfo.crossPlatformTrades.length > 0) {
    result.flags.push(`${tokenInfo.crossPlatformTrades.length} cross-platform trades detected`);
    
    // Check for quick cross-platform trades
    const quickTrades = tokenInfo.crossPlatformTrades.filter(t => 
      t.timeSinceFirstBuy && t.timeSinceFirstBuy < 300 // Less than 5 minutes
    );
    
    if (quickTrades.length > 0) {
      result.flags.push(`${quickTrades.length} rapid cross-platform trades (<5min after buy)`);
      result.riskScore += 3;
    }
  }
  
  // Set risk level based on score
  if (result.riskScore >= 7) {
    result.riskLevel = "high";
  } else if (result.riskScore >= 4) {
    result.riskLevel = "medium";
  } else if (result.riskScore > 0) {
    result.riskLevel = "low";
  } else {
    result.riskLevel = "none";
  }
  
  return result;
} 