process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp as client, clientWebsocket } from './src/clients/client.js';
import { parseAbi, parseAbiItem } from 'viem';
import { FOUR_MEME_ADDRESS, TRANSFER_EVENT_SIGNATURE } from './src/config/index.js';
import { detectNewToken, logTokenCreation } from './src/tokenDetector.js';
import { formatValue } from './src/utils.js';
import { connectToDatabase } from './src/db/connection.js';
import { saveToken } from './src/db/tokenRepository.js';

const seenTokens = new Map();

// Parse the Transfer event signature for use in filters
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

// Global filter reference
let globalFilter = null;

// Four.meme related addresses to exclude from trade tracking
const FOUR_MEME_RELATED_ADDRESSES = new Set([
  '0x5c952063c7fc8610ffdb798152d69f0b9550762b', // Four.meme main contract
  '0x8d68e48baee3264ecd62a8b85b80f8558cc1b499', // Four.meme related address
  '0x48735904455eda3aa9a0c9e43ee9999c795e30b9'  // Four.meme helper contract
].map(addr => addr.toLowerCase()));

// Add these constants at the top with other constants
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'.toLowerCase();
const KNOWN_DEX_CONTRACTS = new Set([
  '0x7fa69aa3cd15409f424f3bf91576c97f78166a12', // DEX Aggregator
  '0x10ed43c718714eb63d5aa57b78b54704e256024e', // PancakeSwap Router
  '0x13f4ea83d0bd40e75c8222255bc855a974568dd4', // PancakeSwap Router v3
  '0xcf0febd3f17cef5b47b0cd257acf6025c5bff3b7', // ApeSwap Router
  '0x05ff2b0db69458a0750badebc4f9e13add608c7f', // PancakeSwap Router v1
  '0x2b6e6e4def77583229299cf386438a227e683b28', // gmgn.ai Router
  '0x1de460f363af910f51726def188f9004276bf4bc'  // Four.meme Trading Contract
].map(addr => addr.toLowerCase()));

// Add platform identification
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
 * Process Transfer events from logs
 */
async function processLogs(logs, blockNumber) {
  const updatedTokens = new Set();
  
  // Group logs by transaction hash for first pass
  const logsByTx = new Map();
  for (const log of logs) {
    const txHash = log.transactionHash;
    if (!logsByTx.has(txHash)) {
      logsByTx.set(txHash, []);
    }
    logsByTx.get(txHash).push(log);
  }
  
  // First pass - process new token creations
  for (const [txHash, txLogs] of logsByTx) {
    for (const log of txLogs) {
      const tokenInfo = await detectNewToken({ 
        txLogs, 
        txHash, 
        blockNumber: log.blockNumber, 
        logFunction: console.log, 
        seenTokens 
      });
      
      if (tokenInfo) {
        logTokenCreation({ 
          tokenInfo, 
          logFunction: console.log 
        });
        console.log(`Currently tracking ${seenTokens.size} tokens`);
        
        // Save new token to database
        try {
          await saveToken(tokenInfo.tokenAddress, tokenInfo);
        } catch (error) {
          console.error(`Error saving new token ${tokenInfo.tokenAddress} to database: ${error.message}`);
        }
      }
    }
  }
  
  // Second pass - process trades and transfers
  for (const [txHash, txLogs] of logsByTx) {
    for (const log of txLogs) {
      // Check for trades in tokens
      const tokenAddress = log.address.toLowerCase();
      
      // Skip if we're not tracking this token
      if (!seenTokens.has(tokenAddress)) return;
      
      // Skip if missing required data
      if (!log.args?.from || !log.args?.to || !log.args?.value) return;
      
      const fromAddress = log.args.from.toLowerCase();
      const toAddress = log.args.to.toLowerCase();
      
      // Skip if either address is a Four.meme related address (except the main contract for actual trades)
      if ((fromAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(fromAddress)) || 
          (toAddress !== FOUR_MEME_ADDRESS.toLowerCase() && FOUR_MEME_RELATED_ADDRESSES.has(toAddress))) {
        return;
      }
      
      // Get token info from our map
      let tokenInfo = seenTokens.get(tokenAddress);
      
      // Initialize trade tracking if needed
      if (!tokenInfo.trades) {
        tokenInfo = {
          ...tokenInfo,
          trades: [],
          buyCount: 1, // Start at 1 to count the creator's initial tokens
          sellCount: 0,
          uniqueBuyers: new Set([tokenInfo.creator.toLowerCase()]), // Initialize with creator
          uniqueSellers: new Set(),
          totalBuyVolume: tokenInfo.totalSupply || "0", // Initial supply counts as first buy
          totalSellVolume: "0"
        };
      }
      
      const tokenAmount = log.args.value.toString();
      
      // Skip if no amount
      if (tokenAmount === "0") return;
      
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
          formattedAmount: formatValue(tokenAmount, 18),
          buyer: toAddress,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          timestamp: new Date().toISOString()
        });
        
        // Mark token as updated
        updatedTokens.add(tokenAddress);
      } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
        // It's a SELL (tokens from user to Four.meme)
        tokenInfo.sellCount++;
        tokenInfo.uniqueSellers.add(fromAddress);
        tokenInfo.totalSellVolume = (BigInt(tokenInfo.totalSellVolume) + BigInt(tokenAmount)).toString();
        
        // Add to trades array
        tokenInfo.trades.push({
          type: 'sell',
          amount: tokenAmount,
          formattedAmount: formatValue(tokenAmount, 18),
          seller: fromAddress,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber.toString(),
          timestamp: new Date().toISOString()
        });
        
        // Mark token as updated
        updatedTokens.add(tokenAddress);
      } else if (!FOUR_MEME_RELATED_ADDRESSES.has(fromAddress) && !FOUR_MEME_RELATED_ADDRESSES.has(toAddress)) {
        // This is a wallet-to-wallet transfer
        // Check if the sender is a known buyer
        if (tokenInfo.uniqueBuyers.has(fromAddress)) {
          // Check if this is a DEX trade by looking at the transaction logs
          const txLogs = await client.getTransactionReceipt({ hash: log.transactionHash });
          const isWBNBTransferInTx = txLogs.logs.some(txLog => 
            txLog.address.toLowerCase() === WBNB_ADDRESS &&
            txLog.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event
          );
          
          const isDexContract = KNOWN_DEX_CONTRACTS.has(toAddress);
          
          // Check for cross-platform trading
          if (isDexContract) {
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
              const buyerTrades = tokenInfo.trades.filter(t => 
                t.type === 'buy' && 
                t.buyer.toLowerCase() === fromAddress.toLowerCase()
              );
              
              const totalBought = buyerTrades.reduce((sum, t) => sum + BigInt(t.amount), BigInt(0));
              const numberOfBuys = buyerTrades.length;
              
              // Calculate time since first buy
              if (buyerTrades.length > 0) {
                const firstBuyTime = new Date(buyerTrades[0].timestamp);
                const timeSinceFirstBuy = Math.floor((new Date() - firstBuyTime) / 1000); // in seconds
                
                console.log('\n🔄 CROSS-PLATFORM TRADE DETECTED 🔄');
                console.log(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
                console.log(`Address: ${tokenInfo.tokenAddress}`);
                console.log('Trade details:');
                console.log(`  From: Four.meme buyer (${fromAddress})`);
                console.log(`  To: ${platform} (${toAddress})`);
                console.log(`  Current transfer amount: ${formatValue(tokenAmount, 18)} tokens`);
                console.log('\nPosition Analysis:');
                console.log(`  Number of buys on Four.meme: ${numberOfBuys}`);
                console.log(`  Total amount bought: ${formatValue(totalBought.toString(), 18)} tokens`);
                console.log(`  Time since first buy: ${Math.floor(timeSinceFirstBuy/60)} minutes`);
                console.log(`  First buy block: ${buyerTrades[0].blockNumber}`);
                console.log(`  Current block: ${log.blockNumber.toString()}`);
                console.log(`  Blocks between: ${parseInt(log.blockNumber) - parseInt(buyerTrades[0].blockNumber)}`);
                
                // Add trade history
                console.log('\nBuy History:');
                buyerTrades.forEach((trade, index) => {
                  console.log(`  Buy #${index + 1}:`);
                  console.log(`    Amount: ${trade.formattedAmount} tokens`);
                  console.log(`    Block: ${trade.blockNumber}`);
                  console.log(`    Tx: ${trade.txHash}`);
                });
              }
            }
            return; // Skip normal transfer processing for DEX trades
          }
          
          // Only process if it's not a DEX trade
          if (!isDexContract && !isWBNBTransferInTx) {
            const transfer = {
              from: fromAddress,
              to: toAddress,
              amount: tokenAmount,
              formattedAmount: formatValue(tokenAmount, 18),
              txHash: log.transactionHash,
              blockNumber: log.blockNumber.toString(),
              timestamp: new Date().toISOString()
            };

            // Initialize wallet transfers if needed
            if (!tokenInfo.walletTransfers) {
              tokenInfo.walletTransfers = [];
            }
            tokenInfo.walletTransfers.push(transfer);

            // Log the transfer immediately
            console.log('\n🔄 BUYER TRANSFER DETECTED 🔄');
            console.log(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
            console.log(`Address: ${tokenInfo.tokenAddress}`);
            console.log('Transfer details:');
            console.log(`  From: ${fromAddress} (Previous buyer)`);
            console.log(`  To: ${toAddress}`);
            console.log(`  Amount: ${transfer.formattedAmount} tokens`);
            console.log(`  Tx: ${transfer.txHash}`);
            console.log(`  Block: ${transfer.blockNumber}`);

            // Track transfers to same address
            const transfersToAddress = tokenInfo.walletTransfers.filter(t => t.to === toAddress);
            if (transfersToAddress.length > 1) {
              const totalAmount = transfersToAddress.reduce((sum, t) => sum + BigInt(t.amount), BigInt(0));
              console.log('\n⚠️ Multiple transfers detected to same address:');
              console.log(`  Total transfers: ${transfersToAddress.length}`);
              console.log(`  Total amount: ${formatValue(totalAmount.toString(), 18)} tokens`);
              console.log(`  Receiving address: ${toAddress}`);
            }

            // Mark token as updated
            updatedTokens.add(tokenAddress);
          }
        }
      }
      
      // Update the token in our map
      seenTokens.set(tokenAddress, tokenInfo);
    }
  }
  
  // Save updated tokens to database
  for (const tokenAddress of updatedTokens) {
    const tokenInfo = seenTokens.get(tokenAddress);
    try {
      await saveToken(tokenAddress, tokenInfo);
      console.log(`Updated token ${tokenAddress} in database`);
    } catch (error) {
      console.error(`Error saving token ${tokenAddress} to database: ${error.message}`);
    }
  }
  
  return updatedTokens;
}

async function main() {
  console.log('🔍 Four.meme Token Tracker started');
  console.log('Watching for new tokens on: ' + FOUR_MEME_ADDRESS);
  
  // Connect to MongoDB
  try {
    await connectToDatabase();
    console.log('Connected to MongoDB database');
  } catch (error) {
    console.error(`Failed to connect to MongoDB: ${error.message}`);
    process.exit(1);
  }
  
  // Create a persistent filter for Transfer events
  try {
    globalFilter = await client.createEventFilter({
      events: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
    });
    console.log('Created persistent event filter');
  } catch (error) {
    console.error(`Failed to create event filter: ${error.message}`);
    process.exit(1);
  }
  
  // Watch for new blocks
  const unwatch = clientWebsocket.watchBlockNumber({
    onBlockNumber: async (blockNumber) => {
      try {
        // Get new events since last check
        const logs = await client.getFilterChanges({ filter: globalFilter });
        await processLogs(logs, blockNumber);
        console.log(`Processed block ${blockNumber} (${logs.length} events)`);
      } catch (error) {
        console.error(`Error processing block ${blockNumber}: ${error.message}`);
        if (error.cause) {
          console.error('Caused by:', error.cause.message);
        }
        
        // If filter becomes invalid, recreate it
        if (error.message.includes('filter not found')) {
          console.log('Filter expired, recreating...');
          try {
            globalFilter = await client.createEventFilter({
              events: parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']),
            });
            console.log('Successfully recreated filter');
          } catch (recreateError) {
            console.error(`Failed to recreate filter: ${recreateError.message}`);
          }
        }
      }
    },
    onError: (error) => {
      console.error(`Block watcher error: ${error.message}`);
      console.error('Block watcher error:', error);
    },
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('Stopping token tracking...');
    unwatch();
    
    // Clean up the filter
    if (globalFilter) {
      try {
        await client.uninstallFilter({ filter: globalFilter });
        console.log('Cleaned up event filter');
      } catch (error) {
        console.log(`Filter cleanup warning: ${error.message}`);
      }
    }
    
    process.exit(0);
  });
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
