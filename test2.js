process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { parseAbi, formatEther } from 'viem';
import { clientHttp as client } from './src/clients/client.js';

// Four.meme contract address on BSC
const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';

/**
 * A simpler token price finder that focuses on analyzing real transactions
 * rather than guessing function names and event structures
 */
async function findTokenPrice(tokenAddress) {
  console.log(`\n=== FINDING PRICE FOR ${tokenAddress} ===\n`);
  
  try {
    // Get recent blocks - use a smaller range to avoid timeout
    const currentBlock = await client.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);
    
    // Use a smaller block range (last 10,000 blocks ~ 8 hours) to avoid timeout
    const fromBlock = currentBlock - BigInt(10000);
    console.log(`Searching for events in blocks ${fromBlock} to ${currentBlock}...`);
    
    // APPROACH 1: Find transfers to/from the Four.meme contract involving our token
    console.log("\n--- APPROACH 1: Recent Token Transfers with Four.meme ---");
    try {
      // ERC20 Transfer event signature
      const transferEvent = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0];
      
      // Find transfers to the Four.meme contract (sells)
      console.log(`Looking for token transfers TO Four.meme (sells)...`);
      const sellLogs = await client.getLogs({
        address: tokenAddress,
        event: transferEvent,
        args: { 
          to: FOUR_MEME_ADDRESS 
        },
        fromBlock,
        toBlock: currentBlock
      });
      
      console.log(`Found ${sellLogs.length} sell transfers`);
      
      // Find transfers from the Four.meme contract (buys)
      console.log(`Looking for token transfers FROM Four.meme (buys)...`);
      const buyLogs = await client.getLogs({
        address: tokenAddress,
        event: transferEvent,
        args: { 
          from: FOUR_MEME_ADDRESS 
        },
        fromBlock,
        toBlock: currentBlock
      });
      
      console.log(`Found ${buyLogs.length} buy transfers`);
      
      if (sellLogs.length > 0 || buyLogs.length > 0) {
        // Get the most recent transaction regardless of type
        const allLogs = [...sellLogs, ...buyLogs].sort((a, b) => 
          Number(b.blockNumber) - Number(a.blockNumber) || 
          Number(b.logIndex) - Number(a.logIndex)
        );
        
        const mostRecentTx = allLogs[0];
        console.log(`\nMost recent transaction: ${mostRecentTx.transactionHash}`);
        console.log(`Block: ${mostRecentTx.blockNumber}`);
        console.log(`Type: ${mostRecentTx.args.from.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() ? 'BUY' : 'SELL'}`);
        
        // This approach will help us get pricing from a specific transaction
        const result = await analyzeSpecificTransaction(
          mostRecentTx.transactionHash, 
          tokenAddress
        );
        
        if (result.success) {
          console.log("\nSUCCESS! Price determined from transaction analysis:");
          console.log(`- Price: ${result.price} BNB/token`);
          console.log(`- Token Amount: ${result.tokenAmount}`);
          console.log(`- BNB Amount: ${result.bnbAmount}`);
          return result;
        }
      }
    } catch (error) {
      console.log(`Error finding transfers: ${error.message}`);
    }
    
    // APPROACH 2: Look for any Four.meme logs mentioning our token
    console.log("\n--- APPROACH 2: Four.meme Logs Mentioning Token ---");
    try {
      // Get all logs from the Four.meme contract - use smaller block range
      const smallerFromBlock = currentBlock - BigInt(5000);
      console.log(`Searching for Four.meme logs in blocks ${smallerFromBlock} to ${currentBlock}...`);
      
      const fourMemeLogs = await client.getLogs({
        address: FOUR_MEME_ADDRESS,
        fromBlock: smallerFromBlock,
        toBlock: currentBlock
      });
      
      console.log(`Found ${fourMemeLogs.length} Four.meme logs`);
      
      // Filter for logs that mention our token
      const tokenHex = tokenAddress.slice(2).toLowerCase(); // Remove 0x prefix
      const relevantLogs = fourMemeLogs.filter(log => 
        log.data.toLowerCase().includes(tokenHex)
      );
      
      console.log(`Found ${relevantLogs.length} logs mentioning the token`);
      
      if (relevantLogs.length > 0) {
        // Get the most recent relevant log
        const recentLog = relevantLogs[0];
        console.log(`\nMost recent transaction: ${recentLog.transactionHash}`);
        
        // Analyze the transaction to find price
        const result = await analyzeSpecificTransaction(
          recentLog.transactionHash, 
          tokenAddress
        );
        
        if (result.success) {
          console.log("\nSUCCESS! Price determined from transaction analysis:");
          console.log(`- Price: ${result.price} BNB/token`);
          console.log(`- Token Amount: ${result.tokenAmount}`);
          console.log(`- BNB Amount: ${result.bnbAmount}`);
          return result;
        }
      }
    } catch (error) {
      console.log(`Error searching Four.meme logs: ${error.message}`);
    }
    
    // APPROACH 3: Use a known working transaction 
    // (if you've found one for this token in the past)
    console.log("\n--- APPROACH 3: Using Known Transaction ---");
    console.log("Looking for a known transaction for this token...");
    
    // Check if we have a known transaction from previous methods
    // Otherwise, this will serve as a failover method when others didn't work
    const knownTxs = getKnownTransactions(tokenAddress);
    
    if (knownTxs.length > 0) {
      console.log(`Found ${knownTxs.length} known transactions for this token`);
      
      // Try each known transaction until we find one that works
      for (const txHash of knownTxs) {
        console.log(`\nAnalyzing known transaction: ${txHash}`);
        
        const result = await analyzeSpecificTransaction(txHash, tokenAddress);
        
        if (result.success) {
          console.log("\nSUCCESS! Price determined from known transaction:");
          console.log(`- Price: ${result.price} BNB/token`);
          console.log(`- Token Amount: ${result.tokenAmount}`);
          console.log(`- BNB Amount: ${result.bnbAmount}`);
          return result;
        }
      }
    } else {
      console.log("No known transactions available for this token");
    }
    
    // APPROACH 4: Direct inspection of most recent transaction
    console.log("\n--- APPROACH 4: Direct Inspection of Most Recent Transaction ---");
    try {
      // First find the most recent transaction by looking for ANY transfer
      const transferEvent = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0];
      console.log("Looking for any token transfers...");
      
      const transfers = await client.getLogs({
        address: tokenAddress,
        event: transferEvent,
        fromBlock: currentBlock - BigInt(1000), // Look at last 1000 blocks only
        toBlock: currentBlock
      });
      
      if (transfers.length > 0) {
        console.log(`Found ${transfers.length} token transfers`);
        
        // Get the most recent
        const mostRecentTransfer = transfers.sort((a, b) => 
          Number(b.blockNumber) - Number(a.blockNumber)
        )[0];
        
        console.log(`Examining transaction: ${mostRecentTransfer.transactionHash}`);
        
        // Get the full transaction receipt for manual inspection
        const receipt = await client.getTransactionReceipt({ 
          hash: mostRecentTransfer.transactionHash 
        });
        
        // Look for BNB Transfer events in the same transaction
        const bnbTransferLogs = receipt.logs.filter(log => {
          // WBNB contract address
          return log.address.toLowerCase() === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'.toLowerCase() &&
                 log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
        });
        
        // If we found BNB transfers, try to extract value
        if (bnbTransferLogs.length > 0) {
          console.log(`Found ${bnbTransferLogs.length} BNB transfers in this transaction`);
          
          // Get the token transfer amount
          const tokenAmount = mostRecentTransfer.args.value;
          console.log(`Token transfer amount: ${formatEther(tokenAmount)}`);
          
          // Extract BNB amount from the transfer
          const bnbTransfer = bnbTransferLogs[0];
          let bnbAmount;
          
          try {
            const transferAbi = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
            const decodedBnb = client.decodeEventLog({
              abi: transferAbi,
              data: bnbTransfer.data,
              topics: bnbTransfer.topics
            });
            
            bnbAmount = decodedBnb.value;
            console.log(`BNB transfer amount: ${formatEther(bnbAmount)}`);
            
            // Calculate price
            const price = Number(formatEther(bnbAmount)) / Number(formatEther(tokenAmount));
            console.log(`Calculated price: ${price} BNB/token`);
            
            return {
              success: true,
              price,
              tokenAmount: formatEther(tokenAmount),
              bnbAmount: formatEther(bnbAmount),
              transactionHash: mostRecentTransfer.transactionHash
            };
          } catch (error) {
            console.log(`Error decoding BNB transfer: ${error.message}`);
          }
        } else {
          console.log("No BNB transfers found in this transaction");
        }
      } else {
        console.log("No recent token transfers found");
      }
    } catch (error) {
      console.log(`Error in direct transaction inspection: ${error.message}`);
    }

    // APPROACH 5: Use manual inspection of a specific transaction
    console.log("\n--- APPROACH 5: Manual Transaction Debugging ---");
    console.log("Performing a low-level analysis of the transaction...");

    try {
      // Use a known transaction hash - replace with your most recent one that should work
      const debugTxHash = knownTxs.length > 0 ? knownTxs[0] : "0xfab90567700c38d8d6c54acaac9f8ec0984c95b7bf11c44e994c0f6f3afda8f0";
      
      console.log(`Debugging transaction: ${debugTxHash}`);
      const receipt = await client.getTransactionReceipt({ hash: debugTxHash });
      
      // Get the token logs
      const tokenLogs = receipt.logs.filter(log => 
        log.address.toLowerCase() === tokenAddress.toLowerCase()
      );
      
      console.log(`Found ${tokenLogs.length} token logs`);
      
      // Get the main event from Four.meme contract
      const fourMemeLogs = receipt.logs.filter(log => 
        log.address.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
      );
      
      // Focus on logs with the most data
      if (tokenLogs.length > 0 && fourMemeLogs.length > 0) {
        console.log("Examining Four.meme logs in detail:");
        
        // Sort the logs by data length
        const sortedLogs = [...fourMemeLogs].sort((a, b) => b.data.length - a.data.length);
        
        for (let i = 0; i < Math.min(sortedLogs.length, 3); i++) {
          const log = sortedLogs[i];
          console.log(`\nLog #${i+1} - Topic: ${log.topics[0]}`);
          console.log(`Data length: ${log.data.length} bytes`);
          
          // Split the data into 32-byte (64 hex char) chunks for easier inspection
          const data = log.data.slice(2); // Remove 0x prefix
          console.log("Data chunks:");
          
          for (let j = 0; j < data.length; j += 64) {
            const chunk = data.slice(j, j + 64);
            console.log(`  [${j/64}]: 0x${chunk}`);
            
            // Try to interpret as token amount if it contains non-zero values
            if (chunk.match(/[1-9a-f]/i)) {
              try {
                const value = BigInt("0x" + chunk);
                console.log(`    As number: ${value.toString()}`);
                console.log(`    As ether: ${formatEther(value)}`);
              } catch (err) {
                // Skip if not a valid number
              }
            }
          }
        }
        
        // Extract token amount from the token transfer
        let tokenAmount;
        try {
          const transferEvent = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0];
          // Look for token transfers to Four.meme (sells)
          const tokenTransfer = tokenLogs.find(log => 
            log.topics.length === 3 && 
            log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
            log.topics[2].toLowerCase().includes(FOUR_MEME_ADDRESS.slice(2).toLowerCase())
          );
          
          if (tokenTransfer) {
            console.log("\nFound token transfer to Four.meme");
            const decoded = client.decodeEventLog({
              abi: [transferEvent],
              data: tokenTransfer.data,
              topics: tokenTransfer.topics
            });
            
            tokenAmount = decoded.value;
            console.log(`Token amount: ${formatEther(tokenAmount)}`);
            
            // Now try to find a reasonable BNB value in Four.meme logs
            // This is the main event with the swap data
            const mainEvent = sortedLogs[0];
            const data = mainEvent.data.slice(2);
            
            // Last resort: try the very specific indices we know work for some transactions
            // For sells, BNB amount is often at index 5 (params[5]) - 6th parameter
            if (data.length >= 6*64) {
              const bnbChunk = data.slice(5*64, 6*64);
              const bnbAmount = BigInt("0x" + bnbChunk);
              console.log(`Potential BNB amount from index 5: ${formatEther(bnbAmount)}`);
              
              // Calculate price
              const price = Number(formatEther(bnbAmount)) / Number(formatEther(tokenAmount));
              console.log(`Calculated price: ${price} BNB/token`);
              
              if (price > 0 && price < 1) {
                return {
                  success: true,
                  price,
                  tokenAmount: formatEther(tokenAmount),
                  bnbAmount: formatEther(bnbAmount),
                  transactionHash: debugTxHash
                };
              }
            }
            
            // Try a more general approach - look for a chunk that results in a reasonable price
            for (let j = 0; j < data.length; j += 64) {
              const chunk = data.slice(j, j + 64);
              if (chunk.match(/[1-9a-f]/i)) {
                try {
                  const value = BigInt("0x" + chunk);
                  const price = Number(formatEther(value)) / Number(formatEther(tokenAmount));
                  
                  // If price is in a reasonable range (very small but non-zero)
                  if (price > 1e-20 && price < 1e-2) {
                    console.log(`\nFound likely BNB amount at index ${j/64}: ${formatEther(value)}`);
                    console.log(`Calculated price: ${price} BNB/token`);
                    
                    return {
                      success: true,
                      price,
                      tokenAmount: formatEther(tokenAmount),
                      bnbAmount: formatEther(value),
                      transactionHash: debugTxHash
                    };
                  }
                } catch (err) {
                  // Skip if not a valid number
                }
              }
            }
          } else {
            console.log("No token transfer to Four.meme found");
          }
        } catch (error) {
          console.log(`Error extracting token amount: ${error.message}`);
        }
      }
    } catch (error) {
      console.log(`Error in manual transaction debugging: ${error.message}`);
    }
    
    console.log("\nFAILED TO DETERMINE PRICE: All methods exhausted");
    return { success: false };
    
  } catch (error) {
    console.error('Error finding token price:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Analyze a specific transaction to extract price information
 */
async function analyzeSpecificTransaction(txHash, tokenAddress) {
  console.log(`\nAnalyzing transaction: ${txHash}`);
  
  try {
    // Fetch transaction receipt
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    
    // Filter logs from the token address (transfers)
    const tokenLogs = receipt.logs.filter(log => 
      log.address.toLowerCase() === tokenAddress.toLowerCase()
    );
    
    // Filter logs from the Four.meme contract
    const fourMemeLogs = receipt.logs.filter(log => 
      log.address.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
    );
    
    console.log(`Found ${tokenLogs.length} token logs and ${fourMemeLogs.length} Four.meme logs`);
    
    // If we have token transfers and Four.meme logs, we can try to analyze
    if (tokenLogs.length > 0 && fourMemeLogs.length > 0) {
      // Look for Transfer logs to determine amount of tokens
      const transferEvent = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])[0];
      
      // Try to decode the token transfer logs
      const decodedTokenLogs = [];
      
      for (const log of tokenLogs) {
        try {
          if (log.topics.length === 3 && 
              log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
            
            const decoded = client.decodeEventLog({
              abi: [transferEvent],
              data: log.data,
              topics: log.topics
            });
            
            decodedTokenLogs.push({
              from: decoded.from,
              to: decoded.to,
              value: decoded.value,
              logIndex: log.logIndex
            });
          }
        } catch (error) {
          // Silent fail for logs that don't match our expected format
          console.log(`Warning: Failed to decode log: ${error.message}`);
        }
      }
      
      console.log(`Successfully decoded ${decodedTokenLogs.length} Transfer events`);
      
      // Find a transfer to or from Four.meme (depending on buy or sell)
      const fourMemeTransfers = decodedTokenLogs.filter(log =>
        log.from.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() ||
        log.to.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
      );
      
      if (fourMemeTransfers.length > 0) {
        console.log(`Found ${fourMemeTransfers.length} transfers involving Four.meme`);
        
        // Get the token amount
        const tokenTransfer = fourMemeTransfers[0];
        const tokenAmount = tokenTransfer.value;
        const isSell = tokenTransfer.to.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase();
        
        console.log(`Transaction type: ${isSell ? 'SELL' : 'BUY'}`);
        console.log(`Token amount: ${formatEther(tokenAmount)}`);
        
        // Now find the Four.meme event that has the BNB data
        // The main swap event is typically the one with the most data
        const swapEvent = fourMemeLogs
          .filter(log => log.data.length > 66) // Filter for events with substantial data
          .sort((a, b) => b.data.length - a.data.length)[0]; // Get the one with most data
        
        if (swapEvent) {
          console.log(`Found likely swap event with topic: ${swapEvent.topics[0]}`);
          console.log(`Event data length: ${swapEvent.data.length} bytes`);
          
          // Extract the data parameters
          const data = swapEvent.data.slice(2); // Remove 0x prefix
          
          // Parse the data into 32-byte chunks
          const params = [];
          for (let i = 0; i < data.length; i += 64) {
            params.push('0x' + data.slice(i, i + 64));
          }
          
          console.log(`Parsed ${params.length} parameters from event data`);
          
          // Print the first few params for debugging
          for (let i = 0; i < Math.min(params.length, 8); i++) {
            console.log(`Param ${i}: ${params[i]}`);
            
            try {
              // Try to convert to a number if it looks like one
              if (params[i].match(/0x[0-9a-f]+/i)) {
                const bigValue = BigInt(params[i]);
                if (bigValue > 0) {
                  console.log(`  As number: ${bigValue.toString()}`);
                  console.log(`  As ether: ${formatEther(bigValue)}`);
                }
              }
            } catch (e) {
              // Ignore conversion errors
            }
          }
          
          // Based on our analysis of Four.meme transactions:
          // Try multiple approaches to find the BNB amount
          
          // APPROACH 1: Hardcoded indices based on analysis
          if (params.length >= 8) {
            try {
              // For sells, check params[4] through params[7] for the BNB amount
              const candidateIndices = isSell ? [5, 4, 6, 7] : [4, 5, 6, 7];
              
              for (const idx of candidateIndices) {
                if (idx < params.length) {
                  try {
                    const amount = BigInt(params[idx]);
                    const price = Number(formatEther(amount)) / Number(formatEther(tokenAmount));
                    
                    // Filter for reasonable prices (between 10^-20 and 10^-1 BNB per token)
                    if (price > 1e-20 && price < 1e-1) {
                      console.log(`\nFound reasonable BNB amount at param[${idx}]: ${formatEther(amount)}`);
                      console.log(`Calculated price: ${price} BNB/token`);
                      
                      return {
                        success: true,
                        price,
                        tokenAmount: formatEther(tokenAmount),
                        bnbAmount: formatEther(amount),
                        isSell,
                        transactionHash: txHash
                      };
                    } else {
                      console.log(`Param[${idx}] gives unreasonable price: ${price} BNB/token`);
                    }
                  } catch (error) {
                    console.log(`Failed to convert param[${idx}] to number: ${error.message}`);
                  }
                }
              }
            } catch (error) {
              console.log(`Error extracting BNB amount with approach 1: ${error.message}`);
            }
            
            // APPROACH 2: Check all parameters for a reasonable price
            try {
              console.log("\nTrying all parameters for a reasonable price...");
              
              for (let i = 0; i < params.length; i++) {
                try {
                  if (params[i].match(/0x[0-9a-f]+/i)) {
                    const amount = BigInt(params[i]);
                    // Only consider non-zero values
                    if (amount > 0) {
                      const price = Number(formatEther(amount)) / Number(formatEther(tokenAmount));
                      
                      // Filter for very reasonable prices (four.meme tokens are often very cheap)
                      if (price > 1e-20 && price < 1e-3) {
                        console.log(`\nFound highly reasonable BNB amount at param[${i}]: ${formatEther(amount)}`);
                        console.log(`Calculated price: ${price} BNB/token`);
                        
                        return {
                          success: true,
                          price,
                          tokenAmount: formatEther(tokenAmount),
                          bnbAmount: formatEther(amount),
                          isSell,
                          transactionHash: txHash
                        };
                      }
                      // Allow slightly higher prices as a fallback
                      else if (price > 1e-12 && price < 1e-1) {
                        console.log(`Found potentially reasonable BNB amount at param[${i}]: ${formatEther(amount)}`);
                        console.log(`Potential price: ${price} BNB/token`);
                        
                        // Save as potential result but keep looking for better matches
                        const potentialResult = {
                          success: true,
                          price,
                          tokenAmount: formatEther(tokenAmount),
                          bnbAmount: formatEther(amount),
                          isSell,
                          transactionHash: txHash
                        };
                        
                        // If we don't find a better match, we'll return this later
                        if (i === params.length - 1) {
                          console.log("Using this as our best guess");
                          return potentialResult;
                        }
                      }
                    }
                  }
                } catch (error) {
                  // Silent fail for conversion errors
                }
              }
            } catch (error) {
              console.log(`Error extracting BNB amount with approach 2: ${error.message}`);
            }
          }
        } else {
          console.log("No suitable swap event found");
        }
      } else {
        console.log("No transfers involving Four.meme found");
      }
    }
    
    console.log("Transaction analysis failed to extract price data");
    return { success: false, reason: "Couldn't extract price data from transaction" };
  } catch (error) {
    console.error('Error analyzing transaction:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get a list of known working transactions for a specific token
 */
function getKnownTransactions(tokenAddress) {
  // Store known working transactions for different tokens
  const knownTransactions = {
    // Use lowercase addresses as keys
    "0xa017494f03cee746eb55c77c60dca3a31e375aa2": [
      "0xfab90567700c38d8d6c54acaac9f8ec0984c95b7bf11c44e994c0f6f3afda8f0"
    ],
    "0x8bfcc66828214dd7c76d15198e34fef9e117f242": [
      "0x41786981a8ac027a966f8e7e60d2e2a197ddb0fa170d60494ff560964881159b"
    ]
    // Add more tokens and their transactions as you discover them
  };
  
  return knownTransactions[tokenAddress.toLowerCase()] || [];
}

async function main() {
  // Replace this with your token address
  const tokenAddress = '0xa017494f03cee746eb55c77c60dca3a31e375aa2';
  
  // Find the token price using our consolidated approach
  const priceInfo = await findTokenPrice(tokenAddress);
  
  // Summary at the end
  console.log("\n=== SUMMARY ===");
  if (priceInfo.success) {
    console.log("✅ Successfully determined token price:");
    console.log(`- Token: ${tokenAddress}`);
    console.log(`- Price: ${priceInfo.price} BNB/token`);
    console.log(`- Last transaction: ${priceInfo.transactionHash}`);
    console.log(`- Trade type: ${priceInfo.isSell ? 'SELL' : 'BUY'}`);
  } else {
    console.log("❌ Failed to determine token price");
    if (priceInfo.reason) console.log(`- Reason: ${priceInfo.reason}`);
    if (priceInfo.error) console.log(`- Error: ${priceInfo.error}`);
  }
}

main().catch(console.error); 