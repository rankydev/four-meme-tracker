import { clientHttp, clientWebsocket } from '../clients/client.js';
import { parseAbiItem } from 'viem';

// Four.meme contract address on BSC
const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';

/**
 * Track new token creations on four.meme platform
 * This tracks transfers from the null address (0x0) to the four.meme contract,
 * which indicates new token minting/creation
 */
export async function trackNewTokenCreations(callback) {
  console.log('Starting to track new token creations on four.meme...');
  
  // ERC20 Transfer event signature
  const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  
  try {
    // Start watching for Transfer events
    const unwatch = clientWebsocket.watchEvent({
      event: transferEvent,
      onLogs: (logs) => {
        console.log(`Received ${logs.length} Transfer events`);
        for (const log of logs) {
          // Debug log to see all events
          console.log(`Transfer from ${log.args.from} to ${log.args.to || 'undefined'}, token: ${log.address || 'unknown'}`);
          
          // Filter for transfers from null address to four.meme contract
          if (
            log.args.from === '0x0000000000000000000000000000000000000000' && 
            log.args.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() &&
            log.address
          ) {
            const tokenInfo = {
              tokenAddress: log.address,
              transactionHash: log.transactionHash,
              blockNumber: log.blockNumber,
              timestamp: new Date().toISOString() // You could fetch the block timestamp for more accuracy
            };
            
            console.log('New token created on four.meme:', tokenInfo);
            
            // Call the user-provided callback if available
            if (typeof callback === 'function') {
              callback(tokenInfo);
            }
          }
        }
      },
    });
    
    console.log('Successfully set up event watching');
    return unwatch;
  } catch (error) {
    console.error('Error setting up event watching:', error);
    throw error;
  }
}

/**
 * Get historical token creations from a specific block range
 */
export async function getHistoricalTokenCreations(fromBlock, toBlock) {
  console.log(`Fetching historical token creations from block ${fromBlock} to ${toBlock}...`);
  
  const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  
  try {
    // Get logs for the specified block range
    console.log('Making request to get logs...');
    const logs = await clientHttp.getLogs({
      event: transferEvent,
      fromBlock: BigInt(fromBlock),
      toBlock: toBlock ? BigInt(toBlock) : null,
    });
    
    console.log(`Received ${logs.length} total Transfer events, filtering for token creations...`);
    
    // Filter for transfers from null address to four.meme contract
    const tokenCreations = logs.filter(log => {
        console.log(log);
      const matches = log.args.from === '0x0000000000000000000000000000000000000000' && 
        log.args.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() &&
        log.address;
        
      // Add debug logging for matching events
      if (matches) {
        console.log(`Found matching token creation: ${log.address}`);
      }
      
      return matches;
    }).map(log => ({
      tokenAddress: log.address,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
    }));
    
    console.log(`Found ${tokenCreations.length} token creations`);
    return tokenCreations;
  } catch (error) {
    console.error('Error fetching historical token creations:', error);
    console.error('Error details:', error.message);
    
    // Try with a smaller block range if the request is too large
    if (error.message && (error.message.includes('exceed maximum block range') || 
                          error.message.includes('requested block range is too large'))) {
      console.log('Block range too large, try with a smaller block range');
    }
    
    throw error;
  }
}

/**
 * Get recent token creations from the last N blocks
 */
export async function getRecentTokenCreations(blockCount = 1000) {
  try {
    console.log('Getting current block number...');
    const currentBlock = await clientHttp.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);
    
    const fromBlock = currentBlock - BigInt(blockCount);
    console.log(`Will search from block ${fromBlock} to ${currentBlock}`);
    
    // Use a smaller block range if the requested one is too large
    const MAX_BLOCK_RANGE = 2000; // Some providers limit block range
    
    if (blockCount > MAX_BLOCK_RANGE) {
      console.log(`Block range (${blockCount}) is large. Splitting into smaller chunks...`);
      
      const allTokens = [];
      let startBlock = fromBlock;
      
      while (startBlock < currentBlock) {
        const endBlock = startBlock + BigInt(MAX_BLOCK_RANGE) > currentBlock 
          ? currentBlock 
          : startBlock + BigInt(MAX_BLOCK_RANGE);
          
        console.log(`Processing chunk: ${startBlock} to ${endBlock}`);
        
        try {
          const tokens = await getHistoricalTokenCreations(startBlock, endBlock);
          allTokens.push(...tokens);
        } catch (error) {
          console.error(`Error processing chunk ${startBlock}-${endBlock}:`, error.message);
        }
        
        startBlock = endBlock + BigInt(1);
      }
      
      console.log(`All chunks processed. Found ${allTokens.length} tokens in total.`);
      return allTokens;
    }
    
    return getHistoricalTokenCreations(fromBlock, currentBlock);
  } catch (error) {
    console.error('Error getting block number:', error);
    throw error;
  }
} 