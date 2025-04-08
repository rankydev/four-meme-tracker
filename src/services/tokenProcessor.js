/**
 * Token log processing service
 * 
 * This module is responsible for:
 * 1. Processing blockchain logs to find new tokens
 * 2. Detecting and analyzing token trades (buys/sells)
 * 3. Tracking wallet-to-wallet transfers
 */

import { FOUR_MEME_ADDRESS, TRANSFER_EVENT_SIGNATURE } from '../config/index.js';
import { detectNewToken } from '../tokenDetector.js';
import { formatValue } from '../utils.js';
import { saveToken } from '../db/tokenRepository.js';
import { debugLog, infoLog, errorLog, successLog, warnLog } from '../utils/logging.js';

// Four.meme related addresses to exclude from trade tracking
const FOUR_MEME_RELATED_ADDRESSES = new Set([
  '0x5c952063c7fc8610ffdb798152d69f0b9550762b', // Four.meme main contract
  FOUR_MEME_ADDRESS, // Current Four.meme address from config
  '0x48735904455eda3aa9a0c9e43ee9999c795e30b9'  // Four.meme helper contract
].map(addr => addr.toLowerCase()));

// WBNB address for tracking
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'.toLowerCase();

// Known DEX contracts
const KNOWN_DEX_CONTRACTS = new Set([
  '0x7fa69aa3cd15409f424f3bf91576c97f78166a12', // DEX Aggregator
  '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap Router
  '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap Router v3
  '0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7', // ApeSwap Router
  '0x05ff2b0db69458a0750badebc4f9e13add608c7f', // PancakeSwap Router v1
  '0x2b6e6e4def77583229299cf386438a227e683b28', // gmgn.ai Router
  '0x1de460f363af910f51726def188f9004276bf4bc'  // Four.meme Trading Contract
].map(addr => addr.toLowerCase()));

// Platform identification
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
 * Process logs from a block to detect new tokens and trades
 * 
 * @param {Object} params - Processing parameters
 * @param {Array} params.logs - Logs from the blockchain
 * @param {BigInt} params.blockNumber - Block number
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @param {Object} params.client - Blockchain client
 * @returns {Object} - Processing results
 */
export async function processTokenLogs({ logs, blockNumber, seenTokens, client }) {
  const updatedTokens = new Set();
  const newTokens = [];
  
  // Group logs by transaction for more efficient processing
  const logsByTx = groupLogsByTransaction(logs);
  debugLog(`Grouped ${logs.length} logs into ${logsByTx.size} transactions`);
  
  // Process each transaction in a single pass
  for (const [txHash, txLogs] of logsByTx) {
    // First phase: detect new tokens
    const tokenInfoList = await detectTokensInTransaction({
      txHash, 
      txLogs, 
      blockNumber, 
      seenTokens
    });
    
    if (tokenInfoList.length > 0) {
      // Save new tokens to database and track them
      for (const tokenInfo of tokenInfoList) {
        try {
          await saveToken(tokenInfo.tokenAddress, tokenInfo);
          updatedTokens.add(tokenInfo.tokenAddress);
          newTokens.push(tokenInfo);
        } catch (error) {
          errorLog(`Error saving new token ${tokenInfo.tokenAddress} to database: ${error.message}`);
        }
      }
    }
    
    // Second phase: process trades for all tokens (new and existing)
    await processTradesInTransaction({
      txHash,
      txLogs,
      blockNumber,
      seenTokens,
      updatedTokens,
      client
    });
  }
  
  // Save all updated tokens to database
  await saveUpdatedTokens(seenTokens, updatedTokens);
  
  return {
    newTokens,
    updatedTokenCount: updatedTokens.size - newTokens.length
  };
}

/**
 * Group logs by transaction hash
 * 
 * @param {Array} logs - Logs to process
 * @returns {Map} - Map of transaction hashes to logs
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
 * Detect new tokens in transaction logs
 * 
 * @param {Object} params - Detection parameters
 * @param {string} params.txHash - Transaction hash
 * @param {Array} params.txLogs - Transaction logs
 * @param {BigInt} params.blockNumber - Block number
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @returns {Array} - Array of detected token info objects
 */
async function detectTokensInTransaction({ txHash, txLogs, blockNumber, seenTokens }) {
  const detectedTokens = [];
  
  for (const log of txLogs) {
    // Look for transfer events that are mints (from zero address) to Four.meme
    if (log.topics && 
        log.topics[0] === TRANSFER_EVENT_SIGNATURE && // Transfer
        log.topics[1] === '0x0000000000000000000000000000000000000000000000000000000000000000' && // From zero address
        `0x${log.topics[2].slice(26)}`.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()) { // To Four.meme's address
      
      // Use the token detector to get token info
      const tokenInfo = await detectNewToken({ 
        txLogs, 
        txHash, 
        blockNumber: log.blockNumber, 
        logFunction: debugLog, 
        seenTokens 
      });
      
      if (tokenInfo) {
        // Add creation metadata
        tokenInfo.creationBlockNumber = blockNumber;
        tokenInfo.creationTxHash = txHash;
        
        // Add to detected tokens
        detectedTokens.push(tokenInfo);
      }
    }
  }
  
  return detectedTokens;
}

/**
 * Process trades within a transaction
 * 
 * @param {Object} params - Processing parameters
 * @param {string} params.txHash - Transaction hash
 * @param {Array} params.txLogs - Transaction logs
 * @param {BigInt} params.blockNumber - Block number
 * @param {Map} params.seenTokens - Map of tracked tokens
 * @param {Set} params.updatedTokens - Set of updated token addresses
 * @param {Object} params.client - Blockchain client
 */
async function processTradesInTransaction({ txHash, txLogs, blockNumber, seenTokens, updatedTokens, client }) {
  for (const log of txLogs) {
    // Only process transfer events for tokens we're tracking
    const tokenAddress = log.address.toLowerCase();
    if (!seenTokens.has(tokenAddress)) continue;
    
    // Skip if missing required data
    if (!log.args?.from || !log.args?.to || !log.args?.value) continue;
    
    const fromAddress = log.args.from.toLowerCase();
    const toAddress = log.args.to.toLowerCase();
    
    // Skip if either address is a Four.meme related address (except the main contract for actual trades)
    if ((fromAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(fromAddress)) || 
        (toAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(toAddress))) {
      continue;
    }
    
    // Get token info and initialize if needed
    let tokenInfo = seenTokens.get(tokenAddress);
    tokenInfo = initializeTokenTradeTracking(tokenInfo);
    
    const tokenAmount = log.args.value.toString();
    if (tokenAmount === "0") continue; // Skip zero-amount transfers
    
    // Log for debugging
    debugLog(`\nProcessing trade for token ${tokenInfo.name} (${tokenAddress})`);
    debugLog(`From: ${fromAddress}`);
    debugLog(`To: ${toAddress}`);
    debugLog(`Amount: ${formatValue(tokenAmount, tokenInfo.decimals)} tokens`);
    
    // Process based on transfer type
    if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
      // Buy transaction
      await processBuyTransaction({
        tokenInfo,
        toAddress,
        tokenAmount,
        txHash,
        blockNumber: log.blockNumber,
        updatedTokens
      });
    } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
      // Sell transaction
      await processSellTransaction({
        tokenInfo,
        fromAddress,
        tokenAmount,
        txHash,
        blockNumber: log.blockNumber,
        updatedTokens
      });
    } else {
      // Wallet-to-wallet transfer
      await processWalletTransfer({
        tokenInfo,
        fromAddress,
        toAddress,
        tokenAmount,
        txHash,
        blockNumber: log.blockNumber,
        client,
        updatedTokens
      });
    }
    
    // Update token in map
    seenTokens.set(tokenAddress, tokenInfo);
  }
}

/**
 * Initialize token trade tracking if not already initialized
 * 
 * @param {Object} tokenInfo - Token info object
 * @returns {Object} - Initialized token info
 */
function initializeTokenTradeTracking(tokenInfo) {
  if (!tokenInfo.trades) {
    return {
      ...tokenInfo,
      trades: [],
      buyCount: 1, // Start at 1 to count the creator's initial tokens
      sellCount: 0,
      uniqueBuyers: new Set([tokenInfo.creator.toLowerCase()]), // Initialize with creator
      uniqueSellers: new Set(),
      totalBuyVolume: tokenInfo.totalSupply || "0", // Initial supply counts as first buy
      totalSellVolume: "0",
      devHoldings: tokenInfo.totalSupply || "0" // Initialize dev holdings with total supply
    };
  }
  return tokenInfo;
}

/**
 * Process a buy transaction (tokens from Four.meme to user)
 * 
 * @param {Object} params - Processing parameters
 * @param {Object} params.tokenInfo - Token info
 * @param {string} params.toAddress - Buyer address
 * @param {string} params.tokenAmount - Amount of tokens
 * @param {string} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Set} params.updatedTokens - Set of updated token addresses
 * @returns {Object} - Updated token info
 */
async function processBuyTransaction({ tokenInfo, toAddress, tokenAmount, txHash, blockNumber, updatedTokens }) {
  const updatedTokenInfo = { ...tokenInfo };
  
  updatedTokenInfo.buyCount = (updatedTokenInfo.buyCount || 0) + 1;
  updatedTokenInfo.uniqueBuyers.add(toAddress);
  updatedTokenInfo.totalBuyVolume = (BigInt(updatedTokenInfo.totalBuyVolume || "0") + BigInt(tokenAmount)).toString();
  
  successLog('\n🛍️ BUY DETECTED');
  infoLog(`Token: ${updatedTokenInfo.name} (${updatedTokenInfo.symbol})`);
  infoLog(`Buyer: ${toAddress}`);
  infoLog(`Amount: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
  infoLog(`Total buyers: ${updatedTokenInfo.uniqueBuyers.size}`);
  infoLog(`Total buy volume: ${formatValue(updatedTokenInfo.totalBuyVolume, updatedTokenInfo.decimals)} tokens`);
  
  // Track if creator is buying back
  if (toAddress === updatedTokenInfo.creator.toLowerCase()) {
    updatedTokenInfo.devHoldings = (BigInt(updatedTokenInfo.devHoldings || "0") + BigInt(tokenAmount)).toString();
    successLog('\n👨‍💻 CREATOR BUY DETECTED 👨‍💻');
    infoLog(`Creator bought: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
    infoLog(`New creator holdings: ${formatValue(updatedTokenInfo.devHoldings, updatedTokenInfo.decimals)} tokens`);
  }
  
  // Add to trades array
  if (!updatedTokenInfo.trades) {
    updatedTokenInfo.trades = [];
  }
  
  updatedTokenInfo.trades.push({
    type: 'buy',
    amount: tokenAmount,
    formattedAmount: formatValue(tokenAmount, updatedTokenInfo.decimals),
    buyer: toAddress,
    txHash,
    blockNumber: blockNumber.toString(),
    timestamp: new Date().toISOString(),
    isCreator: toAddress === updatedTokenInfo.creator.toLowerCase()
  });
  
  // Mark token as updated
  updatedTokens.add(updatedTokenInfo.tokenAddress);
  
  return updatedTokenInfo;
}

/**
 * Process a sell transaction (tokens from user to Four.meme)
 * 
 * @param {Object} params - Processing parameters
 * @param {Object} params.tokenInfo - Token info
 * @param {string} params.fromAddress - Seller address
 * @param {string} params.tokenAmount - Amount of tokens
 * @param {string} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Set} params.updatedTokens - Set of updated token addresses
 * @returns {Object} - Updated token info
 */
async function processSellTransaction({ tokenInfo, fromAddress, tokenAmount, txHash, blockNumber, updatedTokens }) {
  const updatedTokenInfo = { ...tokenInfo };
  
  updatedTokenInfo.sellCount = (updatedTokenInfo.sellCount || 0) + 1;
  updatedTokenInfo.uniqueSellers.add(fromAddress);
  updatedTokenInfo.totalSellVolume = (BigInt(updatedTokenInfo.totalSellVolume || "0") + BigInt(tokenAmount)).toString();
  
  successLog('\n💰 SELL DETECTED');
  infoLog(`Token: ${updatedTokenInfo.name} (${updatedTokenInfo.symbol})`);
  infoLog(`Seller: ${fromAddress}`);
  infoLog(`Amount: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
  infoLog(`Total sellers: ${updatedTokenInfo.uniqueSellers.size}`);
  infoLog(`Total sell volume: ${formatValue(updatedTokenInfo.totalSellVolume, updatedTokenInfo.decimals)} tokens`);
  
  // Track if creator is selling
  if (fromAddress === updatedTokenInfo.creator.toLowerCase()) {
    updatedTokenInfo.devHoldings = (BigInt(updatedTokenInfo.devHoldings || "0") - BigInt(tokenAmount)).toString();
    successLog('\n👨‍💻 CREATOR SELL DETECTED 👨‍💻');
    infoLog(`Creator sold: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
    infoLog(`New creator holdings: ${formatValue(updatedTokenInfo.devHoldings, updatedTokenInfo.decimals)} tokens`);
    
    // Calculate percentage of total supply sold
    const percentSold = (BigInt(tokenAmount) * BigInt(100) * BigInt(1000000)) / BigInt(updatedTokenInfo.totalSupply || "1");
    infoLog(`Percentage of total supply: ${(Number(percentSold) / 1000000).toFixed(2)}%`);
  }
  
  // Add to trades array
  if (!updatedTokenInfo.trades) {
    updatedTokenInfo.trades = [];
  }
  
  updatedTokenInfo.trades.push({
    type: 'sell',
    amount: tokenAmount,
    formattedAmount: formatValue(tokenAmount, updatedTokenInfo.decimals),
    seller: fromAddress,
    txHash,
    blockNumber: blockNumber.toString(),
    timestamp: new Date().toISOString(),
    isCreator: fromAddress === updatedTokenInfo.creator.toLowerCase()
  });
  
  // Mark token as updated
  updatedTokens.add(updatedTokenInfo.tokenAddress);
  
  return updatedTokenInfo;
}

/**
 * Process a wallet-to-wallet transfer
 * 
 * @param {Object} params - Processing parameters
 * @param {Object} params.tokenInfo - Token info
 * @param {string} params.fromAddress - Sender address
 * @param {string} params.toAddress - Recipient address
 * @param {string} params.tokenAmount - Amount of tokens
 * @param {string} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Object} params.client - Blockchain client
 * @returns {Object} - Result with updated token info and status
 */
async function processWalletTransfer({ tokenInfo, fromAddress, toAddress, tokenAmount, txHash, blockNumber, client }) {
  let updated = false;
  let updatedTokenInfo = { ...tokenInfo };
  
  // Only process transfers between non-Four.meme addresses
  if (!FOUR_MEME_RELATED_ADDRESSES.has(fromAddress) && !FOUR_MEME_RELATED_ADDRESSES.has(toAddress)) {
    // Track creator transfers
    if (fromAddress === tokenInfo.creator.toLowerCase()) {
      updatedTokenInfo.devHoldings = (BigInt(updatedTokenInfo.devHoldings) - BigInt(tokenAmount)).toString();
      successLog('\n👨‍💻 CREATOR TRANSFER DETECTED 👨‍💻');
      infoLog(`Token: ${updatedTokenInfo.name} (${updatedTokenInfo.symbol})`);
      infoLog(`Creator transferred: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
      infoLog(`To address: ${toAddress}`);
      infoLog(`New creator holdings: ${formatValue(updatedTokenInfo.devHoldings, updatedTokenInfo.decimals)} tokens`);
      updated = true;
    } else if (toAddress === tokenInfo.creator.toLowerCase()) {
      updatedTokenInfo.devHoldings = (BigInt(updatedTokenInfo.devHoldings) + BigInt(tokenAmount)).toString();
      successLog('\n👨‍💻 CREATOR RECEIVED TRANSFER 👨‍💻');
      infoLog(`Token: ${updatedTokenInfo.name} (${updatedTokenInfo.symbol})`);
      infoLog(`Creator received: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
      infoLog(`From address: ${fromAddress}`);
      infoLog(`New creator holdings: ${formatValue(updatedTokenInfo.devHoldings, updatedTokenInfo.decimals)} tokens`);
      updated = true;
    }
    
    // Check if this is a transfer to a DEX
    const isDexContract = KNOWN_DEX_CONTRACTS.has(toAddress);
    
    // Check if the transaction involves WBNB (potential external DEX trade)
    const isWBNBTransferInTx = await client.getTransactionReceipt({ hash: txHash }).then(receipt => 
      receipt.logs.some(txLog => 
        txLog.address.toLowerCase() === WBNB_ADDRESS &&
        txLog.topics[0] === TRANSFER_EVENT_SIGNATURE // Transfer event
      )
    );
    
    // Process cross-platform trading
    if (isDexContract) {
      const result = await processCrossPlatformTrade({
        tokenInfo: updatedTokenInfo,
        fromAddress,
        toAddress,
        tokenAmount,
        blockNumber,
        txHash
      });
      
      if (result) {
        updatedTokenInfo = result;
        updated = true;
      }
      
      return { tokenInfo: updatedTokenInfo, updated };
    }
    
    // Process regular wallet transfer (non-DEX and non-WBNB)
    if (!isDexContract && !isWBNBTransferInTx) {
      const transfer = {
        from: fromAddress,
        to: toAddress,
        amount: tokenAmount,
        formattedAmount: formatValue(tokenAmount, updatedTokenInfo.decimals),
        txHash,
        blockNumber: blockNumber.toString(),
        timestamp: new Date().toISOString()
      };

      // Initialize wallet transfers if needed
      if (!updatedTokenInfo.walletTransfers) {
        updatedTokenInfo.walletTransfers = [];
      }
      updatedTokenInfo.walletTransfers.push(transfer);
      updated = true;

      // Log the transfer
      successLog('\n🔄 BUYER TRANSFER DETECTED 🔄');
      infoLog(`Token: ${updatedTokenInfo.name} (${updatedTokenInfo.symbol})`);
      infoLog(`Address: ${updatedTokenInfo.tokenAddress}`);
      infoLog('Transfer details:');
      infoLog(`  From: ${fromAddress} (Previous buyer)`);
      infoLog(`  To: ${toAddress}`);
      infoLog(`  Amount: ${transfer.formattedAmount} tokens`);
      infoLog(`  Tx: ${transfer.txHash}`);
      infoLog(`  Block: ${transfer.blockNumber}`);

      // Track transfers to same address
      const transfersToAddress = updatedTokenInfo.walletTransfers.filter(t => t.to === toAddress);
      if (transfersToAddress.length > 1) {
        const totalAmount = transfersToAddress.reduce((sum, t) => sum + BigInt(t.amount), BigInt(0));
        warnLog('\n⚠️ Multiple transfers detected to same address:');
        warnLog(`Total transfers: ${transfersToAddress.length}`);
        warnLog(`Total amount: ${formatValue(totalAmount.toString(), updatedTokenInfo.decimals)} tokens`);
        warnLog(`Receiving address: ${toAddress}`);
      }
    }
  }
  
  return { tokenInfo: updatedTokenInfo, updated };
}

/**
 * Process a cross-platform trade (transfer to another platform)
 * 
 * @param {Object} params - Processing parameters
 * @param {Object} params.tokenInfo - Token info
 * @param {string} params.fromAddress - Sender address
 * @param {string} params.toAddress - Recipient address (DEX)
 * @param {string} params.tokenAmount - Amount of tokens
 * @param {BigInt} params.blockNumber - Block number
 * @param {string} params.txHash - Transaction hash
 * @returns {Object|null} - Updated token info or null if no update
 */
async function processCrossPlatformTrade({ tokenInfo, fromAddress, toAddress, tokenAmount, blockNumber, txHash }) {
  let wasUpdated = false;
  const updatedTokenInfo = { ...tokenInfo };
  
  // Determine which platform this address belongs to
  let platform = null;
  for (const [name, addresses] of Object.entries(PLATFORM_CONTRACTS)) {
    if (addresses.includes(toAddress)) {
      platform = name;
      break;
    }
  }

  // If this is a different platform than Four.meme, log it
  if (platform && platform !== 'four.meme') {
    // Calculate total amount bought by this address
    const buyerTrades = updatedTokenInfo.trades.filter(t => 
      t.type === 'buy' && 
      t.buyer.toLowerCase() === fromAddress.toLowerCase()
    );
    
    const totalBought = buyerTrades.reduce((sum, t) => sum + BigInt(t.amount), BigInt(0));
    const numberOfBuys = buyerTrades.length;
    
    // Calculate time since first buy
    if (buyerTrades.length > 0) {
      const firstBuyTime = new Date(buyerTrades[0].timestamp);
      const timeSinceFirstBuy = Math.floor((new Date() - firstBuyTime) / 1000); // in seconds
      
      successLog('\n🔄 CROSS-PLATFORM TRADE DETECTED 🔄');
      infoLog(`Token: ${updatedTokenInfo.name} (${updatedTokenInfo.symbol})`);
      infoLog(`Address: ${updatedTokenInfo.tokenAddress}`);
      infoLog('Trade details:');
      infoLog(`  From: Four.meme buyer (${fromAddress})`);
      infoLog(`  To: ${platform} (${toAddress})`);
      infoLog(`  Current transfer amount: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
      infoLog('\nPosition Analysis:');
      infoLog(`  Number of buys on Four.meme: ${numberOfBuys}`);
      infoLog(`  Total amount bought: ${formatValue(totalBought.toString(), updatedTokenInfo.decimals)} tokens`);
      infoLog(`  Time since first buy: ${Math.floor(timeSinceFirstBuy/60)} minutes`);
      infoLog(`  First buy block: ${buyerTrades[0].blockNumber}`);
      infoLog(`  Current block: ${blockNumber.toString()}`);
      infoLog(`  Blocks between: ${parseInt(blockNumber) - parseInt(buyerTrades[0].blockNumber)}`);
      
      // Add trade history
      infoLog('\nBuy History:');
      buyerTrades.forEach((trade, index) => {
        infoLog(`  Buy #${index + 1}:`);
        infoLog(`    Amount: ${trade.formattedAmount} tokens`);
        infoLog(`    Block: ${trade.blockNumber}`);
        infoLog(`    Tx: ${trade.txHash}`);
      });
      
      // Add cross-platform trade to token info
      if (!updatedTokenInfo.crossPlatformTrades) {
        updatedTokenInfo.crossPlatformTrades = [];
      }
      
      updatedTokenInfo.crossPlatformTrades.push({
        from: fromAddress,
        to: toAddress,
        platform,
        amount: tokenAmount,
        formattedAmount: formatValue(tokenAmount, updatedTokenInfo.decimals),
        txHash,
        blockNumber: blockNumber.toString(),
        timestamp: new Date().toISOString(),
        timeSinceFirstBuy: Math.floor(timeSinceFirstBuy/60) // in minutes
      });
      
      wasUpdated = true;
    }
  }
  
  return wasUpdated ? updatedTokenInfo : null;
}

/**
 * Save all updated tokens to the database
 * 
 * @param {Map} seenTokens - Map of all tracked tokens
 * @param {Set} updatedTokens - Set of token addresses that were updated
 */
async function saveUpdatedTokens(seenTokens, updatedTokens) {
  const savePromises = [];
  
  for (const tokenAddress of updatedTokens) {
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

// Add the processTokenTrades function as a focused handler for single token trades

/**
 * Process trades for a specific token
 * 
 * @param {Object} params - Processing parameters
 * @param {Object} params.log - The log to process
 * @param {Array} params.txLogs - All logs from this transaction
 * @param {string} params.txHash - Transaction hash
 * @param {BigInt} params.blockNumber - Block number
 * @param {Object} params.tokenInfo - Token information
 * @param {Object} params.client - Blockchain client
 * @returns {Object|null} - Updated token info or null if no update
 */
export async function processTokenTrades({ log, txLogs, txHash, blockNumber, tokenInfo, client }) {
  // Skip if missing required data
  if (!log.args?.from || !log.args?.to || !log.args?.value) return null;
  
  const fromAddress = log.args.from.toLowerCase();
  const toAddress = log.args.to.toLowerCase();
  const tokenAddress = log.address.toLowerCase();
  
  // Skip if either address is a Four.meme related address (except the main contract for actual trades)
  if ((fromAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(fromAddress)) || 
      (toAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(toAddress))) {
    return null;
  }
  
  // Initialize token trade tracking if needed
  let updatedTokenInfo = initializeTokenTradeTracking(tokenInfo);
  const tokenAmount = log.args.value.toString();
  let wasUpdated = false;
  
  // Skip if no amount
  if (tokenAmount === "0") return null;
  
  // Log for debugging
  debugLog(`\nProcessing trade for token ${updatedTokenInfo.name} (${tokenAddress})`);
  debugLog(`From: ${fromAddress}`);
  debugLog(`To: ${toAddress}`);
  debugLog(`Amount: ${formatValue(tokenAmount, updatedTokenInfo.decimals)} tokens`);
  
  // Process based on transfer type
  if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
    // Buy transaction
    updatedTokenInfo = await processBuyTransaction({
      tokenInfo: updatedTokenInfo,
      toAddress,
      tokenAmount,
      txHash,
      blockNumber: log.blockNumber,
    });
    wasUpdated = true;
  } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
    // Sell transaction
    updatedTokenInfo = await processSellTransaction({
      tokenInfo: updatedTokenInfo,
      fromAddress,
      tokenAmount,
      txHash,
      blockNumber: log.blockNumber,
    });
    wasUpdated = true;
  } else {
    // Wallet-to-wallet transfer
    const result = await processWalletTransfer({
      tokenInfo: updatedTokenInfo,
      fromAddress,
      toAddress,
      tokenAmount,
      txHash,
      blockNumber: log.blockNumber,
      client,
    });
    
    if (result.updated) {
      updatedTokenInfo = result.tokenInfo;
      wasUpdated = true;
    }
  }
  
  return wasUpdated ? updatedTokenInfo : null;
} 