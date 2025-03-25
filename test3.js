process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp as client } from './src/clients/client.js'
import { formatEther, parseEther, parseAbi, decodeEventLog, decodeFunctionData } from 'viem';

const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';
const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';

// Known Four.meme function signatures discovered from BSCScan
const FOUR_MEME_METHODS = {
  // Buy functions
  "0x7771fdb0": "buyMemeToken(address,address,address,uint256,uint256)",
  "0x87f27655": "buyTokenAMAP(address,uint256,uint256)",
  
  // Sell functions
  "0xf464e7db": "sellToken(address,uint256)",
  "0x3e11741f": "sellToken(address,uint256,uint256)", // Another sellToken variant with deadline parameter
  "0x233b15d0": "sellMoreToken(address[])",
  "0x7f79f6df": "sellToken_variant(address)", // Observed in transactions
  
  // Other functions
  "0x519ebb10": "createToken(bytes,bytes)",
  "0x00000001": "relay1GsWnfsIQROy()",
  "0x1c25dd39": "unknown_buy_function(uint256)", // Observed in buy transactions
  
  // Unknown but observed functions
  "0xb934943f": "unknown_b934943f",
  "0xedf9e251": "unknown_edf9e251",
  "0x0da74935": "unknown_0da74935",
  "0x3b164a8e": "unknown_3b164a8e",
  "0xc0da15e1": "unknown_c0da15e1",
  "0x95fa3d77": "unknown_95fa3d77"
};

// Known Four.meme event signatures
const FOUR_MEME_EVENTS = {
  "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942": "SellEvent_First",
  "0x48063b1239b68b5d50123408787a6df1f644d9160f0e5f702fefddb9a855954d": "SellEvent_Second",
  "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19": "BuyEvent_First",
  "0x741ffc4605df23259462547defeab4f6e755bdc5fbb6d0820727d6d3400c7e0d": "BuyEvent_Second",
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": "Transfer"
};

// ERC20 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Basic ABIs for decoding
const TRANSFER_ABI = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)']);
const SELL_TOKEN_ABI = parseAbi(['function sellToken(address token, uint256 amount)']);
const SELL_TOKEN_WITH_DEADLINE_ABI = parseAbi(['function sellToken(address token, uint256 amount, uint256 deadline)']);
const BUY_TOKEN_AMAP_ABI = parseAbi(['function buyTokenAMAP(address token, uint256 maxAmount, uint256 deadline)']);
const BUY_MEME_TOKEN_ABI = parseAbi(['function buyMemeToken(address token, address sender, address recipient, uint256 amount, uint256 deadline)']);

// Add ERC20 ABI for token interactions
const ERC20_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
]);

async function analyzePriceFromSpecificTransaction({
  tokenAddress,
  txHash,
  blockNumber,
  transactionType // 'buy' or 'sell'
}) {
  console.log("\n===== ANALYZING SPECIFIC TRANSACTION WITH ENHANCED UNDERSTANDING =====\n");
  console.log(`Transaction: ${txHash}`);
  console.log(`Token: ${tokenAddress}`);
  console.log(`Block: ${blockNumber}`);
  console.log(`Type: ${transactionType.toUpperCase()}`);
  
  try {
    // Get full transaction details
    const tx = await client.getTransaction({ hash: txHash });
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    
    // Get method signature and identify function
    const methodSignature = tx.input.slice(0, 10);
    const methodName = FOUR_MEME_METHODS[methodSignature] || "Unknown method";
    
    console.log(`\nMethod signature: ${methodSignature}`);
    console.log(`Method name: ${methodName}`);
    console.log(`Gas used: ${receipt.gasUsed.toString()}`);
    console.log(`Status: ${receipt.status === 1 || receipt.status === "success" ? 'SUCCESS' : 'FAILED'}`);
    
    // Variables for price calculation - moved here before first use
    let tokenAmount = null;
    let bnbAmount = null;
    
    // Check transaction value for buy transactions
    if (transactionType === 'buy' && tx.value > 0) {
      console.log(`Transaction value: ${formatEther(tx.value)} BNB`);
      bnbAmount = tx.value;
      console.log(`Setting initial BNB amount from transaction value`);
    }
    
    // Try to decode the input data based on the function signature
    if (methodSignature === '0xf464e7db') { // sellToken
      try {
        // Decode parameters
        const inputData = tx.input;
        const decodedParams = decodeFunctionData({
          abi: SELL_TOKEN_ABI,
          data: inputData
        });
        console.log("\nDecoded parameters:");
        console.log(`- Token address: ${decodedParams.token}`);
        console.log(`- Amount: ${decodedParams.amount.toString()}`);
      } catch (e) {
        console.log(`Error decoding input data: ${e.message}`);
      }
    } else if (methodSignature === '0x3e11741f') { // sellToken with deadline
      try {
        // Decode parameters
        const inputData = tx.input;
        const decodedParams = decodeFunctionData({
          abi: SELL_TOKEN_WITH_DEADLINE_ABI,
          data: inputData
        });
        console.log("\nDecoded parameters:");
        if (decodedParams && decodedParams.token) {
          console.log(`- Token address: ${decodedParams.token}`);
          console.log(`- Amount: ${decodedParams.amount.toString()}`);
          console.log(`- Deadline: ${new Date(Number(decodedParams.deadline) * 1000).toISOString()}`);
        } else {
          console.log("Could not extract parameters from decoded data");
          
          // Let's try manual extraction from the input data
          try {
            if (inputData.length >= 10 + 64 * 3) { // Method sig + 3 params of 32 bytes each
              const tokenAddressHex = '0x' + inputData.slice(10, 10 + 64).slice(24); // First param (address)
              const amountHex = '0x' + inputData.slice(10 + 64, 10 + 64 * 2); // Second param (uint256)
              const deadlineHex = '0x' + inputData.slice(10 + 64 * 2, 10 + 64 * 3); // Third param (uint256)
              
              console.log(`- Token address (manual): ${tokenAddressHex}`);
              
              try {
                const amount = BigInt(amountHex);
                console.log(`- Amount (manual): ${amount.toString()}`);
                console.log(`- Amount (in ether format): ${formatEther(amount)}`);
              } catch (e) {
                console.log(`- Could not convert amount: ${amountHex}`);
              }
              
              try {
                const deadline = BigInt(deadlineHex);
                console.log(`- Deadline (manual): ${deadline.toString()}`);
                console.log(`- Deadline (as date): ${new Date(Number(deadline) * 1000).toISOString()}`);
              } catch (e) {
                console.log(`- Could not convert deadline: ${deadlineHex}`);
              }
            } else {
              console.log("Input data too short for manual extraction");
            }
          } catch (e2) {
            console.log(`Error in manual parameter extraction: ${e2.message}`);
          }
        }
      } catch (e) {
        console.log(`Error decoding input data: ${e.message}`);
        
        // Let's try manual extraction from the input data
        try {
          if (tx.input.length >= 10 + 64 * 3) { // Method sig + 3 params of 32 bytes each
            const tokenAddressHex = '0x' + tx.input.slice(10, 10 + 64).slice(24); // First param (address)
            const amountHex = '0x' + tx.input.slice(10 + 64, 10 + 64 * 2); // Second param (uint256)
            const deadlineHex = '0x' + tx.input.slice(10 + 64 * 2, 10 + 64 * 3); // Third param (uint256)
            
            console.log(`\nManually extracted parameters:`);
            console.log(`- Token address (manual): ${tokenAddressHex}`);
            
            try {
              const amount = BigInt(amountHex);
              console.log(`- Amount (manual): ${amount.toString()}`);
              console.log(`- Amount (in ether format): ${formatEther(amount)}`);
            } catch (e) {
              console.log(`- Could not convert amount: ${amountHex}`);
            }
            
            try {
              const deadline = BigInt(deadlineHex);
              console.log(`- Deadline (manual): ${deadline.toString()}`);
              console.log(`- Deadline (as date): ${new Date(Number(deadline) * 1000).toISOString()}`);
            } catch (e) {
              console.log(`- Could not convert deadline: ${deadlineHex}`);
            }
          } else {
            console.log("Input data too short for manual extraction");
          }
        } catch (e2) {
          console.log(`Error in manual parameter extraction: ${e2.message}`);
        }
      }
    } else if (methodSignature === '0x87f27655') { // buyTokenAMAP
      try {
        const inputData = tx.input;
        const decodedParams = decodeFunctionData({
          abi: BUY_TOKEN_AMAP_ABI,
          data: inputData
        });
        console.log("\nDecoded parameters:");
        console.log(`- Token address: ${decodedParams.token}`);
        console.log(`- Max amount: ${decodedParams.maxAmount.toString()}`);
        console.log(`- Deadline: ${new Date(Number(decodedParams.deadline) * 1000).toISOString()}`);
      } catch (e) {
        console.log(`Error decoding input data: ${e.message}`);
      }
    } else if (methodSignature === '0x7771fdb0') { // buyMemeToken
      try {
        const inputData = tx.input;
        const decodedParams = decodeFunctionData({
          abi: BUY_MEME_TOKEN_ABI,
          data: inputData
        });
        console.log("\nDecoded parameters:");
        console.log(`- Token address: ${decodedParams.token}`);
        console.log(`- Sender: ${decodedParams.sender}`);
        console.log(`- Recipient: ${decodedParams.recipient}`);
        console.log(`- Amount: ${decodedParams.amount.toString()}`);
        console.log(`- Deadline: ${new Date(Number(decodedParams.deadline) * 1000).toISOString()}`);
      } catch (e) {
        console.log(`Error decoding input data: ${e.message}`);
      }
    }
    
    // Get all logs from this transaction
    console.log(`\nTransaction contains ${receipt.logs.length} logs:`);
    
    // Group logs by contract address
    const logsByContract = {};
    receipt.logs.forEach(log => {
      const addr = log.address.toLowerCase();
      if (!logsByContract[addr]) {
        logsByContract[addr] = [];
      }
      logsByContract[addr].push(log);
    });
    
    // Analyze logs by contract
    for (const [address, logs] of Object.entries(logsByContract)) {
      let contractType = "Unknown contract";
      
      if (address === FOUR_MEME_ADDRESS.toLowerCase()) {
        contractType = "FOUR.MEME CONTRACT";
      } else if (address === tokenAddress.toLowerCase()) {
        contractType = "TOKEN CONTRACT";
      } else if (address === WBNB_ADDRESS.toLowerCase()) {
        contractType = "WBNB CONTRACT";
      }
      
      console.log(`\n${contractType} (${address}) - ${logs.length} logs:`);
      
      // Show each log
      logs.forEach((log, i) => {
        // Identify the event signature
        const eventSignature = log.topics[0];
        const eventName = FOUR_MEME_EVENTS[eventSignature] || "Unknown event";
        
        console.log(`  Log #${i+1}: ${eventName} (${eventSignature})`);
        
        // For token transfers, decode them
        if (eventSignature === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
          // This is a Transfer event
          try {
            const decodedEvent = decodeEventLog({
              abi: TRANSFER_ABI,
              data: log.data,
              topics: log.topics
            });
            
            // Make sure we have the expected properties
            if (decodedEvent && decodedEvent.args && decodedEvent.args.from && decodedEvent.args.to && decodedEvent.args.value) {
              const from = decodedEvent.args.from;
              const to = decodedEvent.args.to;
              const value = decodedEvent.args.value;
              
              console.log(`    Transfer: ${from} -> ${to}`);
              console.log(`    Amount: ${value.toString()}`);
              console.log(`    Amount (in ether format): ${formatEther(value)}`);
              
              // Save token transfer amount for later price calculation
              if (address.toLowerCase() === tokenAddress.toLowerCase()) {
                tokenAmount = value;
                console.log(`    ** This is the TOKEN AMOUNT for price calculation **`);
              }
              
              // Save BNB transfer amount for later price calculation
              if (address.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
                bnbAmount = value;
                console.log(`    ** This is the BNB AMOUNT for price calculation **`);
              }
            } else {
              console.log(`    Incomplete Transfer event data. Trying to extract manually...`);
              
              // Try to manually extract information from the topics and data
              if (log.topics.length >= 3 && log.data) {
                const from = '0x' + log.topics[1].slice(26); // last 20 bytes of topic 1
                const to = '0x' + log.topics[2].slice(26);   // last 20 bytes of topic 2
                
                console.log(`    Transfer (manually extracted): ${from} -> ${to}`);
                
                try {
                  // The value is in the data field for ERC20 transfers
                  const value = BigInt(log.data);
                  console.log(`    Amount: ${value.toString()}`);
                  console.log(`    Amount (in ether format): ${formatEther(value)}`);
                  
                  // Save token transfer amount for later price calculation
                  if (address.toLowerCase() === tokenAddress.toLowerCase()) {
                    tokenAmount = value;
                    console.log(`    ** This is the TOKEN AMOUNT for price calculation **`);
                  }
                  
                  // Save BNB transfer amount for later price calculation
                  if (address.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
                    bnbAmount = value;
                    console.log(`    ** This is the BNB AMOUNT for price calculation **`);
                  }
                } catch (e2) {
                  console.log(`    Error extracting value: ${e2.message}`);
                }
              }
            }
          } catch (e) {
            console.log(`    Error decoding Transfer event: ${e.message}`);
            
            // Try to manually extract information from the topics and data
            if (log.topics.length >= 3 && log.data) {
              const from = '0x' + log.topics[1].slice(26); // last 20 bytes of topic 1
              const to = '0x' + log.topics[2].slice(26);   // last 20 bytes of topic 2
              
              console.log(`    Transfer (manually extracted): ${from} -> ${to}`);
              
              try {
                // The value is in the data field for ERC20 transfers
                const value = BigInt(log.data);
                console.log(`    Amount: ${value.toString()}`);
                console.log(`    Amount (in ether format): ${formatEther(value)}`);
                
                // Save token transfer amount for later price calculation
                if (address.toLowerCase() === tokenAddress.toLowerCase()) {
                  tokenAmount = value;
                  console.log(`    ** This is the TOKEN AMOUNT for price calculation **`);
                }
                
                // Save BNB transfer amount for later price calculation
                if (address.toLowerCase() === WBNB_ADDRESS.toLowerCase()) {
                  bnbAmount = value;
                  console.log(`    ** This is the BNB AMOUNT for price calculation **`);
                }
              } catch (e2) {
                console.log(`    Error extracting value: ${e2.message}`);
              }
            }
          }
        } 
        // For Four.meme specific events, analyze in detail
        else if (address.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()) {
          // Break down the event data into chunks
          const data = log.data.slice(2); // Remove 0x
          console.log(`    Data length: ${data.length} characters (${data.length/2} bytes)`);
          
          // Analyze data in 32-byte chunks to find potential price info
          console.log(`    Data chunks:`);
          
          // Define which chunks to focus on for price information - we now use the same chunks for both types
          // For buys and sells we want to examine chunks 3-6 as they tend to contain price-related values
          const focusChunks = [3, 4, 5, 6, 2]; 
          
          for (let j = 0; j < data.length; j += 64) {
            const chunk = data.slice(j, j + 64);
            let valueDisplay = chunk;
            
            // Try to decode as number
            try {
              const value = BigInt('0x' + chunk);
              if (value > 0) {
                valueDisplay = `${chunk} (numeric: ${value.toString()})`;
                
                // Check if this is a focus chunk that might contain price info
                if (focusChunks.includes(j/64)) {
                  console.log(`      [${j/64}]: ${valueDisplay} <-- FOCUS CHUNK`);
                  
                  // For sell transactions - check if this could be BNB amount
                  if (transactionType === 'sell' && tokenAmount && !bnbAmount) {
                    const potentialPrice = Number(formatEther(value)) / Number(formatEther(tokenAmount));
                    if (potentialPrice > 0 && potentialPrice < 1) {
                      console.log(`        Potential price: ${potentialPrice} BNB/token`);
                      console.log(`        This looks like a valid BNB amount for the sale!`);
                      // Set as potential BNB amount if we don't have one yet
                      if (!bnbAmount) {
                        bnbAmount = value;
                      }
                    }
                  }
                  
                  // For buy transactions - check if this could be token or BNB amount
                  if (transactionType === 'buy') {
                    // If we have token amount but no BNB amount, check if this could be BNB amount
                    if (tokenAmount && !bnbAmount) {
                      const potentialPrice = Number(formatEther(value)) / Number(formatEther(tokenAmount));
                      if (potentialPrice > 0 && potentialPrice < 1) {
                        console.log(`        Potential price: ${potentialPrice} BNB/token`);
                        console.log(`        This looks like a valid BNB amount for the purchase!`);
                        if (!bnbAmount) {
                          bnbAmount = value;
                        }
                      }
                    }
                    // If we have BNB amount but no token amount
                    else if (bnbAmount && !tokenAmount) {
                      const potentialPrice = Number(formatEther(bnbAmount)) / Number(formatEther(value));
                      if (potentialPrice > 0 && potentialPrice < 1) {
                        console.log(`        Potential price: ${potentialPrice} BNB/token`);
                        console.log(`        This looks like a valid token amount for the purchase!`);
                        if (!tokenAmount) {
                          tokenAmount = value;
                        }
                      }
                    }
                  }
                } else {
                  console.log(`      [${j/64}]: ${valueDisplay}`);
                }
              } else {
                console.log(`      [${j/64}]: ${valueDisplay}`);
              }
            } catch (e) {
              // Not a valid number, check if it might be an address
              if (chunk.match(/^0{24}[0-9a-f]{40}$/i)) {
                const potentialAddress = '0x' + chunk.slice(24);
                valueDisplay = `${chunk} (address: ${potentialAddress})`;
              }
              console.log(`      [${j/64}]: ${valueDisplay}`);
            }
          }
        }
      });
    }
    
    // Final price calculation
    if (tokenAmount && bnbAmount) {
      const price = Number(formatEther(bnbAmount)) / Number(formatEther(tokenAmount));
      console.log(`\n** CALCULATED PRICE: ${price} BNB/token **`);
      console.log(`Token amount: ${formatEther(tokenAmount)} tokens`);
      console.log(`BNB amount: ${formatEther(bnbAmount)} BNB`);
    } else {
      console.log("\nCould not calculate exact price - missing either token or BNB amount");
      
      // If we only have token amount, look harder for BNB amount
      if (tokenAmount && !bnbAmount) {
        console.log("Looking deeper for BNB amount in Four.meme events...");
        
        // Get all Four.meme events
        const fourMemeEvents = receipt.logs.filter(log => 
          log.address.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
        );
        
        // For sells, try chunks 3-7 in first event for potential BNB value
        if (transactionType === 'sell' && fourMemeEvents.length > 0) {
          const firstEvent = fourMemeEvents[0];
          const data = firstEvent.data.slice(2);
          
          for (let chunkIndex = 3; chunkIndex <= 7; chunkIndex++) {
            if (data.length >= (chunkIndex+1) * 64) {
              const chunk = data.slice(chunkIndex * 64, (chunkIndex+1) * 64);
              try {
                const value = BigInt('0x' + chunk);
                if (value > 0) {
                  const potentialPrice = Number(formatEther(value)) / Number(formatEther(tokenAmount));
                  // Only consider reasonable prices (tokens are often very cheap)
                  if (potentialPrice > 0.000000001 && potentialPrice < 0.1) {
                    console.log(`\nFound potential BNB amount in chunk ${chunkIndex}: ${formatEther(value)} BNB`);
                    console.log(`This would give a price of: ${potentialPrice} BNB/token`);
                  }
                }
              } catch (e) {
                // Not a number
              }
            }
          }
        }
      }
    }
    
    // Summary
    console.log("\n===== TRANSACTION SUMMARY =====");
    console.log(`Transaction type: ${transactionType.toUpperCase()}`);
    console.log(`Method called: ${methodName} (${methodSignature})`);
    console.log(`Events emitted: ${receipt.logs.map(log => log.topics[0]).filter((v, i, a) => a.indexOf(v) === i).length} unique events`);
    
    if (tokenAmount) console.log(`Token amount: ${formatEther(tokenAmount)} tokens`);
    if (bnbAmount) console.log(`BNB amount: ${formatEther(bnbAmount)} BNB`);
    
    if (tokenAmount && bnbAmount) {
      const price = Number(formatEther(bnbAmount)) / Number(formatEther(tokenAmount));
      console.log(`Price: ${price} BNB/token`);
    }
    
    // Add trade direction
    if (receipt.logs.some(log => 
      log.address.toLowerCase() === tokenAddress.toLowerCase() && 
      log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    )) {
      // Find a token transfer
      const tokenTransfer = receipt.logs.find(log => 
        log.address.toLowerCase() === tokenAddress.toLowerCase() &&
        log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      );
      
      if (tokenTransfer) {
        try {
          const decoded = decodeEventLog({
            abi: TRANSFER_ABI,
            data: tokenTransfer.data,
            topics: tokenTransfer.topics
          });
          
          // Add null/undefined checks before using decoded values
          if (decoded && decoded.args && decoded.args.from && decoded.args.to) {
            const fromAddress = decoded.args.from.toLowerCase();
            const toAddress = decoded.args.to.toLowerCase();
            
            if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
              console.log("Trade direction: Four.meme contract SENT tokens (BUY)");
            } else if (toAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
              console.log("Trade direction: Four.meme contract RECEIVED tokens (SELL)");
            } else {
              console.log(`Trade direction: Transfer between ${fromAddress} and ${toAddress}`);
            }
          } else {
            console.log("Trade direction: Could not determine (decoded event has missing addresses)");
            // Use a custom replacer function to handle BigInt values
            const bigintSafeReplacer = (key, value) => {
              // Convert BigInt to string with 'n' suffix to indicate it was a BigInt
              if (typeof value === 'bigint') {
                return value.toString() + 'n';
              }
              return value;
            };
            try {
              console.log("Decoded event:", JSON.stringify(decoded, bigintSafeReplacer, 2));
            } catch (e) {
              console.log("Could not stringify decoded event:", e.message);
              console.log("Decoded event values:", 
                "from:", decoded?.args?.from?.toString(),
                "to:", decoded?.args?.to?.toString(),
                "value:", decoded?.args?.value?.toString());
            }
          }
        } catch (e) {
          console.log(`Error analyzing trade direction: ${e.message}`);
          
          // Try manual analysis of the topics for transfer direction
          if (tokenTransfer.topics.length >= 3) {
            try {
              // Topics[1] is the from address, Topics[2] is the to address in the Transfer event
              const from = '0x' + tokenTransfer.topics[1].slice(26).toLowerCase(); // last 20 bytes
              const to = '0x' + tokenTransfer.topics[2].slice(26).toLowerCase();   // last 20 bytes
              
              console.log(`Manually extracted transfer: ${from} -> ${to}`);
              
              if (from === FOUR_MEME_ADDRESS.toLowerCase()) {
                console.log("Trade direction: Four.meme contract SENT tokens (BUY)");
              } else if (to === FOUR_MEME_ADDRESS.toLowerCase()) {
                console.log("Trade direction: Four.meme contract RECEIVED tokens (SELL)");
              }
            } catch (e2) {
              console.log(`Could not manually extract transfer direction: ${e2.message}`);
            }
          }
        }
      }
    }
    
  } catch (error) {
    console.error("Error analyzing transaction:", error);
  }
}

// Example with the transaction you provided
// analyzePriceFromSpecificTransaction({
//   tokenAddress: "0xbb13eedd5fe3bfc4c0071ada89f0a5b486537749", // Replace with actual token address
//   txHash: "0xb76ad629f0a6ee448c71365845eb1c17bd3f47b4b6b642a5090f6b6af37f93b5", // Replace with actual transaction hash
//   transactionType: "sell" // "buy" or "sell"
// });

// Comment out other function calls and run our analysis
// runCompleteAnalysis();

// Comment out the specific transaction analysis
// analyzePriceFromSpecificTransaction({
//   tokenAddress: '0xbb13eedd5fe3bfc4c0071ada89f0a5b486537749',
//   txHash: '0x588b8dcfcdee02a41488fc0e3223734a768c0455d40d3ff389d92bf4abaf599c',
//   blockNumber: undefined,
//   transactionType: 'sell'
// });

// Analyze the token the user provided
// analyzeTokenEarlyActivity(
//   '0xbb629c94b6046d7cd3ad96d16ca3a4ad29c377e9', // Token address
//   47748104,                                      // Creation block
//   3                                              // Analyze 3 blocks after creation
// );

// Comment out the specific transaction analysis
// analyzePriceFromSpecificTransaction({
//   tokenAddress: '0xbb629c94b6046d7cd3ad96d16ca3a4ad29c377e9', // Token address
//   txHash: '0x32e0b93ba6bf4c821e308a80fea9617008866075fcec5c15ec8a5aa1a3a949b0', // Transaction hash
//   blockNumber: 47748105, // Block right after creation
//   transactionType: 'buy' // It's a buy transaction according to the user
// });

async function getImplementationAddress(proxyAddress) {
  console.log("Finding implementation for proxy:", proxyAddress);
  
  // This is the EIP-1967 storage slot for the implementation address
  const storageSlot = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
  
  // Get the value at this storage slot
  const implementationAddrBytes = await client.getStorageAt({
    address: proxyAddress,
    slot: storageSlot
  });
  
  // Convert to address format (last 20 bytes)
  const implementationAddr = "0x" + implementationAddrBytes.slice(-40);
  console.log("Implementation contract:", implementationAddr);
  
  return implementationAddr;
}

// Pricing methods search function has been removed to clean up console output

async function extractFunctionSignatures() {
  const IMPLEMENTATION_ADDRESS = '0x275d840c31ce742eab419d030f71ada93f4980bc';
  
  console.log("\n===== EXTRACTING ALL FUNCTION SIGNATURES =====\n");
  
  // Get the bytecode of the implementation
  const implementationCode = await client.getCode({
    address: IMPLEMENTATION_ADDRESS
  });
  
  console.log(`Implementation bytecode length: ${implementationCode.length} bytes`);
  
  // Remove 0x prefix if present
  const code = implementationCode.startsWith('0x') ? implementationCode.slice(2) : implementationCode;
  
  // Look for function selectors in the bytecode
  // Solidity typically uses PUSH4 opcode (63 in hex) followed by 4 bytes function selector
  const signatureMatches = code.match(/63[0-9a-f]{8}/gi) || [];
  
  const signatures = new Set();
  signatureMatches.forEach(match => {
    // Extract just the signature part (without the 63 opcode)
    const signature = '0x' + match.slice(2);
    signatures.add(signature);
  });
  
  // Look for other common patterns (DUP1 followed by PUSH4 then EQ)
  const dupPushMatches = code.match(/80635[0-9a-f]{7}14/gi) || [];
  dupPushMatches.forEach(match => {
    // Extract just the signature part (skip 80 and take the next 4 bytes)
    const signature = '0x' + match.slice(2, 10);
    signatures.add(signature);
  });
  
  console.log(`Found ${signatures.size} potential function signatures`);
  
  // Common known signatures to check against
  const knownSignatures = {
    // Core ERC20
    "0xa9059cbb": "transfer(address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x70a08231": "balanceOf(address)",
    "0x18160ddd": "totalSupply()",
    "0x313ce567": "decimals()",
    
    // Trading/Swapping
    "0xd0e30db0": "deposit()",
    "0x2e1a7d4d": "withdraw(uint256)",
    "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
    "0x18cbafe5": "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
    "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    
    // Common custom functions
    "0xa6417ed6": "sell()",
    "0x6c3a0416": "buy()",
    "0x4b0a3e7b": "sellTokenForETH(uint256)",
    "0x8c9f4df6": "buyTokenWithETH(uint256)",
    
    // Admin functions
    "0x8da5cb5b": "owner()",
    "0xf2fde38b": "transferOwnership(address)",
    "0x715018a6": "renounceOwnership()",
    
    // Pair/AMM functions
    "0x0902f1ac": "getReserves()",
    "0x022c0d9f": "swap(uint256,uint256,address,bytes)",
    "0x5b0d5984": "updatePair(address)",
    "0x5855a25a": "getPair(address,address)",
    
    // Fee functions
    "0x7b103999": "setFeePercent(uint256)",
    "0x3427a516": "getFeePercent()",
    "0x1a75ea0c": "setFeeRecipient(address)"
  };
  
  // Categorize found signatures
  const categorizedSignatures = {
    known: [],
    unknown: []
  };
  
  // Convert to array and sort for readability
  const signatureArray = Array.from(signatures).sort();
  
  signatureArray.forEach(sig => {
    if (knownSignatures[sig]) {
      categorizedSignatures.known.push({ 
        signature: sig, 
        name: knownSignatures[sig] 
      });
    } else {
      categorizedSignatures.unknown.push(sig);
    }
  });
  
  // Display the results
  console.log("\nKnown functions found in contract:");
  if (categorizedSignatures.known.length === 0) {
    console.log("  None of the common known functions were found");
  } else {
    categorizedSignatures.known.forEach(({ signature, name }) => {
      console.log(`- ${name} (${signature})`);
    });
  }
  
  console.log("\nUnknown function signatures:");
  categorizedSignatures.unknown.forEach(sig => {
    console.log(`- ${sig} (Check https://www.4byte.directory/signatures/?bytes4_signature=${sig})`);
  });
  
  return signatureArray;
}

// Run all the analysis functions
async function runCompleteAnalysis() {
  const signatures = await extractFunctionSignatures();
  await analyzeRecentTransactions(signatures);
  await analyzeContractStorage();
  console.log("\nAnalysis complete! This information should help identify how the contract handles pricing.");
}

async function analyzeRecentTransactions(functionSignatures) {
  const PROXY_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';
  
  console.log("\n===== ANALYZING RECENT TRANSACTIONS =====\n");
  
  // Get current block
  const currentBlock = await client.getBlockNumber();
  // Reduce block range from 10,000 to just 100 blocks to prevent timeout
  const fromBlock = currentBlock - BigInt(100); // Last ~30 minutes
  
  console.log(`Searching for transactions in blocks ${fromBlock} to ${currentBlock} (last 100 blocks)...`);
  
  // Get recent transactions to the contract
  const logs = await client.getLogs({
    address: PROXY_ADDRESS,
    fromBlock,
    toBlock: currentBlock
  });
  
  console.log(`Found ${logs.length} logs`);
  
  if (logs.length === 0) {
    console.log("No recent transactions found.");
    return;
  }
  
  // Group logs by transaction hash
  const txGroups = {};
  logs.forEach(log => {
    if (!txGroups[log.transactionHash]) {
      txGroups[log.transactionHash] = [];
    }
    txGroups[log.transactionHash].push(log);
  });
  
  console.log(`Found ${Object.keys(txGroups).length} unique transactions`);
  
  // Analyze transaction input data for the most recent transactions
  // Increase from 3 to 5 transactions since we're looking at fewer blocks
  const recentTxs = Object.keys(txGroups).slice(0, 5); 
  
  // Common known signatures to check against
  const knownMethods = {
    // Core ERC20
    "0xa9059cbb": "transfer(address,uint256)",
    "0x095ea7b3": "approve(address,uint256)",
    "0x23b872dd": "transferFrom(address,address,uint256)",
    "0x70a08231": "balanceOf(address)",
    "0x18160ddd": "totalSupply()",
    "0x313ce567": "decimals()",
    
    // Trading/Swapping
    "0xd0e30db0": "deposit()",
    "0x2e1a7d4d": "withdraw(uint256)",
    "0x7ff36ab5": "swapExactETHForTokens(uint256,address[],address,uint256)",
    "0x18cbafe5": "swapExactTokensForETH(uint256,uint256,address[],address,uint256)",
    "0x38ed1739": "swapExactTokensForTokens(uint256,uint256,address[],address,uint256)",
    
    // Common custom functions
    "0xa6417ed6": "sell()",
    "0x6c3a0416": "buy()",
    "0x4b0a3e7b": "sellTokenForETH(uint256)",
    "0x8c9f4df6": "buyTokenWithETH(uint256)",
    
    // Admin functions
    "0x8da5cb5b": "owner()",
    "0xf2fde38b": "transferOwnership(address)",
    "0x715018a6": "renounceOwnership()",
    
    // Pair/AMM functions
    "0x0902f1ac": "getReserves()",
    "0x022c0d9f": "swap(uint256,uint256,address,bytes)",
    "0x5b0d5984": "updatePair(address)",
    "0x5855a25a": "getPair(address,address)",
    
    // Fee functions
    "0x7b103999": "setFeePercent(uint256)",
    "0x3427a516": "getFeePercent()",
    "0x1a75ea0c": "setFeeRecipient(address)"
  };
  
  for (const txHash of recentTxs) {
    console.log(`\nAnalyzing transaction: ${txHash}`);
    
    try {
      // Get transaction data
      const tx = await client.getTransaction({ hash: txHash });
      
      // Show input data
      console.log(`Input data: ${tx.input.slice(0, 74)}...`); // Show first 10 bytes including method signature
      
      // Get method signature (first 4 bytes after 0x)
      const methodSignature = tx.input.slice(0, 10);
      console.log(`Method signature: ${methodSignature}`);
      
      // Look at topics in logs
      const logsForTx = txGroups[txHash];
      console.log(`Transaction has ${logsForTx.length} logs`);
      
      // Show topics for each log
      logsForTx.forEach((log, index) => {
        console.log(`\nLog #${index + 1}:`);
        console.log(`- Event signature: ${log.topics[0]}`);
        console.log(`- Contract: ${log.address}`);
        console.log(`- Data: ${log.data.slice(0, 66)}${log.data.length > 66 ? '...' : ''}`);
        
        // If this is a token transfer, try to decode it
        if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
          console.log('  This is an ERC20 Transfer event');
          
          if (log.topics.length >= 3) {
            const from = '0x' + log.topics[1].slice(26); // last 20 bytes 
            const to = '0x' + log.topics[2].slice(26);   // last 20 bytes
            console.log(`  From: ${from}`);
            console.log(`  To: ${to}`);
            
            if (log.data && log.data !== '0x') {
              // Try to convert data value to a readable number
              try {
                const value = BigInt(log.data);
                console.log(`  Value: ${value.toString()}`);
              } catch (e) {
                console.log(`  Value: ${log.data}`);
              }
            }
          }
        }
      });
      
      // Add specific check for method calls to functions we found in the bytecode
      console.log("\nChecking for known function calls:");
      const calledMethod = knownMethods[methodSignature] || "Unknown method";
      console.log(`Called method: ${calledMethod} (${methodSignature})`);
      
    } catch (error) {
      console.log(`Error analyzing transaction: ${error.message}`);
    }
  }
}

// Function to peek at storage slots to find potential values
async function analyzeContractStorage() {
  const PROXY_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';
  
  console.log("\n===== ANALYZING CONTRACT STORAGE =====\n");
  
  // Check some common storage slots for useful information
  const slotsToCheck = [
    { slot: '0x0', description: 'First storage slot (often contains owner or important flag)' },
    { slot: '0x1', description: 'Second storage slot (often contains config or key address)' },
    { slot: '0x2', description: 'Third storage slot' },
    { slot: '0x3', description: 'Fourth storage slot' },
    { slot: '0x4', description: 'Fifth storage slot' },
    { slot: '0x5', description: 'Sixth storage slot' },
    { slot: '0x6', description: 'Seventh storage slot' },
    { slot: '0x7', description: 'Eighth storage slot' },
    { slot: '0x8', description: 'Ninth storage slot' },
    { slot: '0x9', description: 'Tenth storage slot' }
  ];
  
  console.log('Checking common storage slots:');
  
  for (const { slot, description } of slotsToCheck) {
    try {
      const value = await client.getStorageAt({
        address: PROXY_ADDRESS,
        slot: slot
      });
      
      // Check if it could be an address (20 bytes)
      let interpretation = value;
      if (value !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
        const possibleAddress = '0x' + value.slice(-40);
        interpretation = `${value} (possible address: ${possibleAddress})`;
      }
      
      console.log(`- Slot ${slot}: ${interpretation} - ${description}`);
    } catch (error) {
      console.log(`- Slot ${slot}: Error - ${error.message}`);
    }
  }
}

async function checkFourMemeEvents(tokenAddress) {  
  console.log(`Analyzing Four.meme events for token: ${tokenAddress}`);
  
  // Get current block and look back 200 blocks
  const currentBlock = await client.getBlockNumber();
  const fromBlock = currentBlock - BigInt(200);
  
  // Get all Four.meme logs for this range
  const logs = await client.getLogs({
    address: FOUR_MEME_ADDRESS,
    fromBlock,
    toBlock: currentBlock
  });
  
  console.log(`Found ${logs.length} logs from Four.meme contract`);
  
  // Group by event signature
  const eventGroups = {};
  logs.forEach(log => {
    const sig = log.topics[0];
    if (!eventGroups[sig]) eventGroups[sig] = [];
    eventGroups[sig].push(log);
  });
  
  // Key event signatures we found from analysis
  const eventSigs = {
    potentialSell1: "0x7db52723a3b2cdd6164364b3b766e65e540d7be48ffa89582956d8eaebe62942",
    potentialSell2: "0x48063b1239b68b5d50123408787a6df1f644d9160f0e5f702fefddb9a855954d",
    potentialBuy1: "0x0a5575b3648bae2210cee56bf33254cc1ddfbc7bf637c0af2ac18b14fb1bae19",
    potentialBuy2: "0x741ffc4605df23259462547defeab4f6e755bdc5fbb6d0820727d6d3400c7e0d"
  };
  
  // Look for the events specifically for our token
  console.log("Looking for transactions involving our token...");
  const tokenHex = tokenAddress.slice(2).toLowerCase();
  
  // Check each event type for our token
  for (const [eventName, eventSig] of Object.entries(eventSigs)) {
    if (!eventGroups[eventSig]) continue;
    
    console.log(`\nChecking ${eventName} events (${eventGroups[eventSig].length} total):`);
    
    // Filter for our token
    const relevantLogs = eventGroups[eventSig].filter(log => 
      log.data.toLowerCase().includes(tokenHex)
    );
    
    console.log(`Found ${relevantLogs.length} events involving our token`);
    
    if (relevantLogs.length > 0) {
      // Analyze the most recent event
      const recentLog = relevantLogs[0];
      console.log(`\nAnalyzing log in transaction: ${recentLog.transactionHash}`);
      
      // Get the full transaction
      const receipt = await client.getTransactionReceipt({ 
        hash: recentLog.transactionHash 
      });
      
      // Find all logs from this transaction
      console.log("All logs in this transaction:");
      receipt.logs.forEach((log, i) => {
        console.log(`- Log #${i+1}: Contract ${log.address}, Topic ${log.topics[0]}`);
        console.log(`  Data: ${log.data.slice(0, 130)}...`);
      });
      
      // Try to extract price data from this transaction
      await analyzeTransactionForPricing(recentLog.transactionHash, tokenAddress);
    }
  }
}

async function analyzeTransactionForPricing(txHash, tokenAddress) {
  console.log(`\nDetailed analysis of transaction ${txHash} for pricing information:`);
  
  // Get transaction data
  const tx = await client.getTransaction({ hash: txHash });
  
  // Get method signature and decode input data if possible
  const methodSig = tx.input.slice(0, 10);
  console.log(`Method: ${methodSig}`);
  
  // Get receipt for logs
  const receipt = await client.getTransactionReceipt({ hash: txHash });
  
  // Look for token transfers to spot amount
  const transferLogs = receipt.logs.filter(log => 
    log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' &&
    log.address.toLowerCase() === tokenAddress.toLowerCase()
  );
  
  let tokenAmount = null;
  
  if (transferLogs.length > 0) {
    console.log(`Found ${transferLogs.length} token transfers`);
    
    // Get the token amount from the transfer
    try {
      const transferData = transferLogs[0].data;
      tokenAmount = BigInt(transferData);
      console.log(`Token amount: ${tokenAmount.toString()}`);
    } catch (e) {
      console.log(`Could not decode token amount: ${e.message}`);
    }
  }
  
  // Look for BNB transfers (WBNB contract)
  const bnbLogs = receipt.logs.filter(log => 
    log.address.toLowerCase() === '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'.toLowerCase() &&
    log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
  );
  
  let bnbAmount = null;
  
  if (bnbLogs.length > 0) {
    console.log(`Found ${bnbLogs.length} BNB transfers`);
    
    // Get the BNB amount
    try {
      const bnbData = bnbLogs[0].data;
      bnbAmount = BigInt(bnbData);
      console.log(`BNB amount: ${bnbAmount.toString()}`);
    } catch (e) {
      console.log(`Could not decode BNB amount: ${e.message}`);
    }
  }
  
  // Check Four.meme specific events for pricing data
  const fourMemeLogs = receipt.logs.filter(log => 
    log.address.toLowerCase() === '0x5c952063c7fc8610ffdb798152d69f0b9550762b'.toLowerCase()
  );
  
  if (fourMemeLogs.length > 0) {
    console.log(`\nFour.meme event data that might contain price info:`);
    
    fourMemeLogs.forEach((log, i) => {
      console.log(`\nEvent #${i+1} (${log.topics[0]}):`);
      
      // Parse the data into 32-byte chunks
      const data = log.data.slice(2); // Remove 0x
      for (let j = 0; j < data.length; j += 64) {
        const chunk = data.slice(j, j + 64);
        
        try {
          // Try to convert to number values
          const bigValue = BigInt('0x' + chunk);
          
          if (bigValue > 0) {
            console.log(`Chunk ${j/64}: ${bigValue.toString()}`);
            
            // If we have token amount, calculate potential price
            if (tokenAmount && tokenAmount > 0) {
              const potentialPrice = Number(bigValue) / Number(tokenAmount);
              if (potentialPrice > 0 && potentialPrice < 1) {
                console.log(`  Potential price: ${potentialPrice}`);
              }
            }
          }
        } catch (e) {
          // Not a valid number
        }
      }
    });
  }
}

async function testFourMemeMethods() {
  const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';
  
  console.log("Testing direct interaction with Four.meme methods...");
  
  // We can now try the specific method signatures we found
  const methods = [
    {
      name: "Method 0x1c25dd39 (likely buy)",
      signature: "0x1c25dd39",
      params: "00000000000000000000000000000000000000000005d648047c1f3b912d2e00" // From example tx
    },
    {
      name: "Method 0x7f79f6df",
      signature: "0x7f79f6df", 
      params: "000000000000000000000000a2e9cc8d2c42dfdb031ab6e229fa98c194875149" // From example tx
    }
  ];
  
  for (const method of methods) {
    try {
      // Create a call to each method
      const result = await client.call({
        to: FOUR_MEME_ADDRESS,
        data: `${method.signature}${method.params}`
      });
      
      console.log(`Result from ${method.name}: ${result}`);
    } catch (error) {
      console.log(`Error calling ${method.name}: ${error.message}`);
    }
  }
}

// New function to analyze token creation and early activity
async function analyzeTokenEarlyActivity(tokenAddress, creationBlockNumber, blocksToAnalyze = 3) {
  console.log(`\n=== ANALYZING EARLY ACTIVITY FOR TOKEN ${tokenAddress} ===`);
  console.log(`Starting from creation block: ${creationBlockNumber}`);
  tokenAddress = tokenAddress.toLowerCase(); // Normalize addresses for consistent comparison
  
  // Get token metadata using client.readContract
  try {
    console.log("Fetching token metadata...");
    const nameAbi = [{
      name: 'name',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'string' }],
    }];
    
    const symbolAbi = [{
      name: 'symbol',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'string' }],
    }];
    
    const decimalsAbi = [{
      name: 'decimals',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'uint8' }],
    }];
    
    const totalSupplyAbi = [{
      name: 'totalSupply',
      type: 'function',
      stateMutability: 'view',
      inputs: [],
      outputs: [{ type: 'uint256' }],
    }];

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: nameAbi,
        functionName: 'name',
      }),
      client.readContract({
        address: tokenAddress,
        abi: symbolAbi,
        functionName: 'symbol',
      }),
      client.readContract({
        address: tokenAddress,
        abi: decimalsAbi,
        functionName: 'decimals',
      }),
      client.readContract({
        address: tokenAddress,
        abi: totalSupplyAbi,
        functionName: 'totalSupply',
      })
    ]);

    console.log(`Token Name: ${name}`);
    console.log(`Token Symbol: ${symbol}`);
    console.log(`Token Decimals: ${decimals}`);
    console.log(`Total Supply: ${formatEther(totalSupply)} (${totalSupply.toString()})`);
  } catch (error) {
    console.log(`Error getting token metadata: ${error.message}`);
  }

  // Analyze creation block
  console.log(`\n--- Analyzing creation block ${creationBlockNumber} ---`);
  let creationTx = null;
  
  try {
    console.log("Fetching creation block data...");
    const block = await client.getBlock({ blockNumber: BigInt(creationBlockNumber) });
    console.log(`Block timestamp: ${new Date(Number(block.timestamp) * 1000).toISOString()}`);
    console.log(`Block transactions: ${block.transactions.length}`);

    // Find creation transaction
    console.log("Looking for token creation transaction...");
    for (const txHash of block.transactions) {
      console.log(`Checking transaction: ${txHash}`);
      const tx = await client.getTransaction({ hash: txHash });
      if (tx.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()) {
        console.log(`Found transaction to Four.meme contract: ${txHash}`);
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        
        // Check if any logs involve our token address
        const relevantLogs = receipt.logs.filter(log => 
          log.address.toLowerCase() === tokenAddress.toLowerCase() ||
          log.topics.some(topic => topic.includes(tokenAddress.substring(2).toLowerCase()))
        );
        
        if (relevantLogs.length > 0) {
          creationTx = { tx, receipt };
          console.log(`\nFound creation transaction: ${txHash}`);
          const methodId = tx.input.substring(0, 10);
          console.log(`Method: ${methodId} (${FOUR_MEME_METHODS[methodId] || 'Unknown'})`);
          console.log(`From: ${tx.from}`);
          console.log(`Gas Used: ${receipt.gasUsed}`);
          
          // Analyze logs
          console.log(`\nCreation transaction logs:`);
          for (const log of receipt.logs) {
            const contractAddress = log.address;
            const topicSignature = log.topics[0];
            
            // For token transfers
            if (topicSignature === TRANSFER_EVENT_SIGNATURE) {
              try {
                const decoded = decodeEventLog({
                  abi: ERC20_ABI,
                  data: log.data,
                  topics: log.topics,
                });
                
                console.log(`- Transfer from ${decoded.args.from} to ${decoded.args.to} amount: ${formatEther(decoded.args.value)}`);
              } catch (e) {
                console.log(`- [Error decoding transfer event: ${e.message}]`);
              }
            } 
            // Add more event decodings as needed
          }
          // We found the creation transaction, no need to check more
          break;
        }
      }
    }
    
    if (!creationTx) {
      console.log(`Couldn't find creation transaction in block ${creationBlockNumber}`);
    }
  } catch (error) {
    console.log(`Error analyzing creation block: ${error.message}`);
  }

  // Identify the creator's address from creation transaction
  let creatorAddress = null;
  if (creationTx) {
    creatorAddress = creationTx.tx.from.toLowerCase();
    console.log(`\nToken creator identified: ${creatorAddress}`);
  }

  // Analyze subsequent blocks for early activity
  console.log(`\n--- Analyzing ${blocksToAnalyze} blocks after creation ---`);
  const uniqueBuyers = new Set();
  const uniqueSellers = new Set();
  const largeTransactions = [];
  let totalBuyVolumeTokens = BigInt(0);
  let totalSellVolumeTokens = BigInt(0);
  let totalBuyVolumeBNB = BigInt(0);
  let transactionCount = 0;
  let blockActivityCount = 0;
  
  // Direct check for the transaction we know exists
  const knownBuyTx = '0x32e0b93ba6bf4c821e308a80fea9617008866075fcec5c15ec8a5aa1a3a949b0';
  let knownBuyFound = false;
  
  for (let i = 1; i <= blocksToAnalyze; i++) {
    const blockNumber = creationBlockNumber + i;
    console.log(`\nChecking block ${blockNumber} (block +${i})...`);
    
    try {
      const block = await client.getBlock({ blockNumber: BigInt(blockNumber) });
      console.log(`Block has ${block.transactions.length} transactions`);
      
      let blockTxCount = 0;
      
      // Check specifically for our known transaction first
      if (!knownBuyFound && block.transactions.includes(knownBuyTx)) {
        console.log(`FOUND KNOWN BUY TRANSACTION: ${knownBuyTx}`);
        knownBuyFound = true;
      }
      
      // Fetch all relevant logs for the token in this block in a single call
      const blockLogs = await client.getLogs({
        address: tokenAddress,
        fromBlock: BigInt(blockNumber),
        toBlock: BigInt(blockNumber),
        topics: [TRANSFER_EVENT_SIGNATURE]  // Only look for Transfer events
      });
      
      console.log(`Found ${blockLogs.length} token transfer logs in this block`);
      
      if (blockLogs.length === 0) {
        console.log(`No token activity in this block`);
        continue; // Skip to next block if no relevant logs
      }
      
      // Group logs by transaction hash
      const txHashToLogs = {};
      blockLogs.forEach(log => {
        if (!txHashToLogs[log.transactionHash]) {
          txHashToLogs[log.transactionHash] = [];
        }
        txHashToLogs[log.transactionHash].push(log);
      });
      
      const relevantTxHashes = Object.keys(txHashToLogs);
      console.log(`Found ${relevantTxHashes.length} transactions with token transfers`);
      blockActivityCount += relevantTxHashes.length > 0 ? 1 : 0;
      transactionCount += relevantTxHashes.length;
      
      // Fetch all transaction receipts in parallel
      console.log(`Fetching ${relevantTxHashes.length} transaction receipts in parallel...`);
      const receiptPromises = relevantTxHashes.map(txHash => 
        client.getTransactionReceipt({ hash: txHash })
      );
      
      const txPromises = relevantTxHashes.map(txHash => 
        client.getTransaction({ hash: txHash })
      );
      
      // Wait for all receipts and transactions to be fetched
      const [receipts, transactions] = await Promise.all([
        Promise.all(receiptPromises),
        Promise.all(txPromises)
      ]);
      
      blockTxCount = receipts.length;
      
      // Process each transaction with its receipt
      for (let j = 0; j < receipts.length; j++) {
        const receipt = receipts[j];
        const tx = transactions[j];
        const txHash = relevantTxHashes[j];
        
        console.log(`\nAnalyzing transaction: ${txHash}`);
        console.log(`Transaction status: ${receipt.status === 1 || receipt.status === "success" ? 'SUCCESS' : 'FAILED'}`);
        
        // Determine if buy or sell from transfers, not just method name
        let isBuy = false;
        let isSell = false;
        let transferAmount = BigInt(0);
        let transferBNB = tx.value || BigInt(0);
        
        // Get the token transfer logs from this transaction
        const tokenTransferLogs = receipt.logs.filter(log => 
          log.address.toLowerCase() === tokenAddress &&
          log.topics[0] === TRANSFER_EVENT_SIGNATURE
        );
        
        // Extract token transfers
        for (const log of tokenTransferLogs) {
          try {
            const decoded = decodeEventLog({
              abi: ERC20_ABI,
              data: log.data,
              topics: log.topics,
            });
            
            // Log transfer details
            const from = decoded.args.from.toLowerCase();
            const to = decoded.args.to.toLowerCase();
            const amount = decoded.args.value;
            
            console.log(`Transfer: ${from} -> ${to}, Amount: ${formatEther(amount)}`);
            
            // Transfers FROM four.meme contract are buys
            if (from === FOUR_MEME_ADDRESS.toLowerCase()) {
              isBuy = true;
              transferAmount = amount;
              uniqueBuyers.add(to);
              totalBuyVolumeTokens += amount;
              totalBuyVolumeBNB += transferBNB;
              console.log(`BUY detected - added to buy volume: ${formatEther(amount)} tokens for ${formatEther(transferBNB)} BNB`);
              
              // Track large buys (> 0.5 BNB or > 1% of token supply)
              if (transferBNB > parseEther('0.5')) {
                largeTransactions.push({
                  type: 'BUY',
                  block: blockNumber,
                  blockOffset: i,
                  hash: txHash,
                  tokens: formatEther(amount),
                  bnb: formatEther(transferBNB)
                });
              }
            } 
            // Transfers TO four.meme contract are sells
            else if (to === FOUR_MEME_ADDRESS.toLowerCase()) {
              isSell = true;
              transferAmount = amount;
              uniqueSellers.add(from);
              totalSellVolumeTokens += amount;
              console.log(`SELL detected - added to sell volume: ${formatEther(amount)} tokens`);
            }
          } catch (e) {
            console.log(`Error decoding token transfer: ${e.message}`);
          }
        }
        
        // Log the transaction type
        if (isBuy) {
          console.log(`BUY transaction - ${formatEther(transferAmount)} tokens for ${formatEther(transferBNB)} BNB`);
        } else if (isSell) {
          console.log(`SELL transaction - ${formatEther(transferAmount)} tokens`);
        } else {
          console.log(`TRANSFER transaction involving the token`);
        }
      }
      
      console.log(`Block ${blockNumber} summary: ${blockTxCount} transactions involving the token`);
    } catch (error) {
      console.log(`Error analyzing block ${blockNumber}: ${error.message}`);
    }
  }
  
  // Summary
  console.log(`\n=== SUMMARY OF EARLY ACTIVITY (First ${blocksToAnalyze} blocks) ===`);
  console.log(`Total transactions: ${transactionCount}`);
  console.log(`Blocks with activity: ${blockActivityCount} out of ${blocksToAnalyze}`);
  console.log(`Unique buyers: ${uniqueBuyers.size}`);
  console.log(`Unique sellers: ${uniqueSellers.size}`);
  console.log(`Buy/Sell ratio: ${uniqueBuyers.size}/${uniqueSellers.size} = ${uniqueBuyers.size / Math.max(1, uniqueSellers.size)}`);
  console.log(`Total buy volume (tokens): ${formatEther(totalBuyVolumeTokens)}`);
  console.log(`Total sell volume (tokens): ${formatEther(totalSellVolumeTokens)}`);
  console.log(`Total buy volume (BNB): ${formatEther(totalBuyVolumeBNB)}`);
  
  // Report large transactions
  if (largeTransactions.length > 0) {
    console.log(`\n=== LARGE TRANSACTIONS (First ${blocksToAnalyze} blocks) ===`);
    largeTransactions.forEach((tx, i) => {
      console.log(`${i+1}. [Block +${tx.blockOffset}] ${tx.type}: ${tx.tokens} tokens for ${tx.bnb} BNB (${tx.hash})`);
    });
  }
  
  // Known transaction check
  if (knownBuyFound) {
    console.log(`\n✓ Successfully detected the known buy transaction (${knownBuyTx})`);
  } else {
    console.log(`\n✗ Failed to detect the known buy transaction (${knownBuyTx}) - debug needed!`);
  }
  
  if (transactionCount > 0) {
    console.log(`\nConclusion: This token had ${transactionCount} transactions within ${blocksToAnalyze} blocks after creation.`);
    if (uniqueBuyers.size > 0) {
      const avgBuyBNB = Number(formatEther(totalBuyVolumeBNB)) / uniqueBuyers.size;
      console.log(`${uniqueBuyers.size} unique buyers spent an average of ${avgBuyBNB.toFixed(4)} BNB each`);
      
      if (uniqueBuyers.size > 3 && uniqueBuyers.size > uniqueSellers.size) {
        console.log(`With ${uniqueBuyers.size} unique buyers and ${formatEther(totalBuyVolumeBNB)} BNB volume, this shows STRONG initial interest.`);
      } else if (avgBuyBNB > 0.5) {
        console.log(`With an average buy of ${avgBuyBNB.toFixed(4)} BNB, this shows MEANINGFUL initial interest.`);
      } else {
        console.log(`With ${uniqueBuyers.size} unique buyers, this shows some initial interest.`);
      }
    } else {
      console.log(`No buyers detected in the early blocks - low initial interest.`);
    }
  } else {
    console.log(`\nConclusion: This token had NO transactions within ${blocksToAnalyze} blocks after creation.`);
  }
  
  console.log(`Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
}

// New high-performance token detection function
async function quickTokenAnalysis(tokenAddress, creationBlockNumber, blocksToAnalyze = 3) {
  console.log(`\n=== QUICK ANALYSIS FOR TOKEN ${tokenAddress} ===`);
  tokenAddress = tokenAddress.toLowerCase();
  
  try {
    // Get basic token info in parallel with other operations
    const tokenInfoPromise = getBasicTokenInfo(tokenAddress);
    
    // Fetch all relevant token transfer logs in a single call
    console.log(`Fetching all transfer events from blocks ${creationBlockNumber} to ${creationBlockNumber + blocksToAnalyze}...`);
    const allLogs = await client.getLogs({
      address: tokenAddress,
      fromBlock: BigInt(creationBlockNumber),
      toBlock: BigInt(creationBlockNumber + blocksToAnalyze),
      topics: [TRANSFER_EVENT_SIGNATURE] // Only Transfer events
    });
    
    console.log(`Found ${allLogs.length} token transfer logs across ${blocksToAnalyze + 1} blocks`);
    
    // Group logs by block number
    const logsByBlock = {};
    for (const log of allLogs) {
      const blockNum = Number(log.blockNumber);
      if (!logsByBlock[blockNum]) {
        logsByBlock[blockNum] = [];
      }
      logsByBlock[blockNum].push(log);
    }
    
    // Group logs by transaction hash
    const logsByTx = {};
    const blockActivity = {};
    
    for (const log of allLogs) {
      const blockNum = Number(log.blockNumber);
      const txHash = log.transactionHash;
      
      if (!logsByTx[txHash]) {
        logsByTx[txHash] = [];
        
        // Track block activity
        if (!blockActivity[blockNum]) {
          blockActivity[blockNum] = 0;
        }
        blockActivity[blockNum]++;
      }
      
      logsByTx[txHash].push(log);
    }
    
    // Identify potentially interesting transactions based on logs alone
    const interestingTxs = [];
    
    console.log("\nPre-analyzing transfer patterns...");
    for (const [txHash, logs] of Object.entries(logsByTx)) {
      // Look for transactions where tokens are transferred FROM the Four.meme contract (buys)
      const fromFourMeme = logs.some(log => {
        try {
          // Check if topic[1] (from address) is the Four.meme contract
          const from = '0x' + log.topics[1].slice(26).toLowerCase();
          return from === FOUR_MEME_ADDRESS.toLowerCase();
        } catch {
          return false;
        }
      });
      
      if (fromFourMeme) {
        const blockNum = Number(logs[0].blockNumber);
        const blockOffset = blockNum - creationBlockNumber;
        console.log(`Found potential buy in block +${blockOffset}: ${txHash}`);
        interestingTxs.push({
          txHash,
          blockNumber: blockNum,
          blockOffset,
          type: 'BUY'
        });
      }
    }
    
    // Only fetch full details for interesting transactions
    console.log(`\nFound ${interestingTxs.length} potentially interesting transactions, fetching details...`);
    
    // Batch fetch transaction details in parallel
    const receiptPromises = interestingTxs.map(tx => 
      client.getTransactionReceipt({ hash: tx.txHash })
    );
    
    const txDataPromises = interestingTxs.map(tx => 
      client.getTransaction({ hash: tx.txHash })
    );
    
    const [receipts, txData] = await Promise.all([
      Promise.all(receiptPromises),
      Promise.all(txDataPromises)
    ]);
    
    // Wait for token info to complete
    const tokenInfo = await tokenInfoPromise;
    
    // Process the transactions with full details
    const successfulBuys = [];
    let largestBuyBNB = BigInt(0);
    let largestBuyTx = null;
    let totalBuyVolumeBNB = BigInt(0);
    let totalBuyVolumeTokens = BigInt(0);
    const uniqueBuyers = new Set();
    
    for (let i = 0; i < interestingTxs.length; i++) {
      const txInfo = interestingTxs[i];
      const receipt = receipts[i];
      const tx = txData[i];
      
      // Skip failed transactions (though we may want to analyze them for some purposes)
      if (receipt.status !== 1 && receipt.status !== "success") {
        console.log(`Transaction ${txInfo.txHash} failed, skipping...`);
        continue;
      }
      
      // Analyze token transfers in this transaction
      const tokenTransfers = receipt.logs.filter(log => 
        log.address.toLowerCase() === tokenAddress &&
        log.topics[0] === TRANSFER_EVENT_SIGNATURE
      );
      
      for (const transfer of tokenTransfers) {
        try {
          const decoded = decodeEventLog({
            abi: ERC20_ABI,
            data: transfer.data,
            topics: transfer.topics,
          });
          
          const from = decoded.args.from.toLowerCase();
          const to = decoded.args.to.toLowerCase();
          const amount = decoded.args.value;
          
          // Transfers FROM Four.meme are buys
          if (from === FOUR_MEME_ADDRESS.toLowerCase()) {
            // Record buy details
            uniqueBuyers.add(to);
            totalBuyVolumeTokens += amount;
            totalBuyVolumeBNB += tx.value || BigInt(0);
            
            // Check if this is the largest buy so far
            if ((tx.value || BigInt(0)) > largestBuyBNB) {
              largestBuyBNB = tx.value || BigInt(0);
              largestBuyTx = {
                hash: txInfo.txHash,
                blockOffset: txInfo.blockOffset,
                bnbAmount: formatEther(tx.value || BigInt(0)),
                tokenAmount: formatEther(amount),
                buyer: to
              };
            }
            
            successfulBuys.push({
              hash: txInfo.txHash,
              blockOffset: txInfo.blockOffset,
              buyer: to,
              bnbAmount: formatEther(tx.value || BigInt(0)),
              tokenAmount: formatEther(amount)
            });
          }
        } catch (e) {
          console.log(`Error decoding transfer in tx ${txInfo.txHash}: ${e.message}`);
        }
      }
    }
    
    // Generate summary
    console.log("\n=== QUICK ANALYSIS SUMMARY ===");
    console.log(`Token Name: ${tokenInfo.name}`);
    console.log(`Token Symbol: ${tokenInfo.symbol}`);
    console.log(`Total Supply: ${formatEther(tokenInfo.totalSupply)}`);
    console.log(`\nEarly Trading Activity (${blocksToAnalyze} blocks after creation):`);
    console.log(`Blocks with activity: ${Object.keys(blockActivity).length - 1}`); // Subtract creation block
    console.log(`Unique buyers: ${uniqueBuyers.size}`);
    console.log(`Successful buys: ${successfulBuys.length}`);
    console.log(`Total buy volume (BNB): ${formatEther(totalBuyVolumeBNB)}`);
    console.log(`Total buy volume (tokens): ${formatEther(totalBuyVolumeTokens)}`);
    
    if (largestBuyTx) {
      console.log(`\nLargest early buy: ${largestBuyTx.bnbAmount} BNB for ${largestBuyTx.tokenAmount} tokens`);
      console.log(`  Block +${largestBuyTx.blockOffset}, Tx: ${largestBuyTx.hash}`);
      console.log(`  Buyer: ${largestBuyTx.buyer}`);
    }
    
    // Alert score calculation (simple heuristic)
    let alertScore = 0;
    // Points for activity in the first 3 blocks
    alertScore += Math.min(3, Object.keys(blockActivity).length) * 2;
    // Points for unique buyers
    alertScore += Math.min(5, uniqueBuyers.size) * 2;
    // Points for buy volume
    const bnbVolume = Number(formatEther(totalBuyVolumeBNB));
    if (bnbVolume > 5) alertScore += 10;
    else if (bnbVolume > 1) alertScore += 5;
    else if (bnbVolume > 0.5) alertScore += 3;
    // Points for large buys
    if (largestBuyTx && Number(largestBuyTx.bnbAmount) > 1) alertScore += 5;
    
    console.log(`\nToken Alert Score: ${alertScore}/20`);
    if (alertScore >= 15) {
      console.log("STRONG ALERT: High early activity detected!");
    } else if (alertScore >= 10) {
      console.log("MEDIUM ALERT: Promising early activity");
    } else if (alertScore >= 5) {
      console.log("LOW ALERT: Some early interest");
    } else {
      console.log("NO ALERT: Limited early activity");
    }
    
    return {
      tokenInfo,
      alertScore,
      buyCount: successfulBuys.length,
      uniqueBuyerCount: uniqueBuyers.size,
      totalBuyVolumeBNB: formatEther(totalBuyVolumeBNB),
      largestBuy: largestBuyTx
    };
    
  } catch (error) {
    console.error("Error in quickTokenAnalysis:", error);
    return { error: error.message };
  }
  
  console.log(`Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
}

// Helper function to get basic token info
async function getBasicTokenInfo(tokenAddress) {
  try {
    const nameAbi = [{ name: 'name', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }];
    const symbolAbi = [{ name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] }];
    const decimalsAbi = [{ name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] }];
    const totalSupplyAbi = [{ name: 'totalSupply', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }];

    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({ address: tokenAddress, abi: nameAbi, functionName: 'name' }),
      client.readContract({ address: tokenAddress, abi: symbolAbi, functionName: 'symbol' }),
      client.readContract({ address: tokenAddress, abi: decimalsAbi, functionName: 'decimals' }),
      client.readContract({ address: tokenAddress, abi: totalSupplyAbi, functionName: 'totalSupply' })
    ]);

    return { name, symbol, decimals, totalSupply };
  } catch (error) {
    console.log(`Error getting token info: ${error.message}`);
    return { name: "Unknown", symbol: "Unknown", decimals: 18, totalSupply: BigInt(0) };
  }
}

// Comment out any direct function calls that might be running
// quickTokenAnalysis(
//   '0xbb629c94b6046d7cd3ad96d16ca3a4ad29c377e9', // Token address
//   47748104,                                      // Creation block
//   3                                              // Analyze 3 blocks after creation
// );

// analyzeTokenEarlyActivity(
//   '0xbb629c94b6046d7cd3ad96d16ca3a4ad29c377e9', // Token address
//   47748104,                                      // Creation block
//   3                                              // Analyze 3 blocks after creation
// );

// superFastTokenAnalysis(
//   '0xbb629c94b6046d7cd3ad96d16ca3a4ad29c377e9', // Token address
//   47748104,                                      // Creation block
//   3                                              // Analyze 3 blocks after creation
// );

// New super-optimized token analysis function that minimizes transaction receipt fetching
async function superFastTokenAnalysis(tokenAddress, creationBlockNumber, blocksToAnalyze = 3) {
  console.log(`\n=== SUPER FAST ANALYSIS FOR TOKEN ${tokenAddress} ===`);
  tokenAddress = tokenAddress.toLowerCase();
  
  try {
    // Get basic token info in parallel with other operations
    const tokenInfoPromise = getBasicTokenInfo(tokenAddress);
    
    // Fetch all relevant token transfer logs in a single call
    console.log(`Fetching all transfer events from blocks ${creationBlockNumber} to ${creationBlockNumber + blocksToAnalyze}...`);
    const allLogs = await client.getLogs({
      address: tokenAddress,
      fromBlock: BigInt(creationBlockNumber),
      toBlock: BigInt(creationBlockNumber + blocksToAnalyze),
      topics: [TRANSFER_EVENT_SIGNATURE] // Only Transfer events
    });
    
    console.log(`Found ${allLogs.length} token transfer logs across ${blocksToAnalyze + 1} blocks`);
    
    // Group logs by block number for activity tracking
    const blockActivity = {};
    
    // First-pass analysis: Identify transfers FROM Four.meme contract (buys)
    const potentialBuyTxs = new Set();
    
    console.log("\nIdentifying potential buys based on transfer logs...");
    for (const log of allLogs) {
      const blockNum = Number(log.blockNumber);
      const txHash = log.transactionHash;
      
      // Track block activity
      if (!blockActivity[blockNum]) {
        blockActivity[blockNum] = new Set();
      }
      blockActivity[blockNum].add(txHash);
      
      try {
        // Only analyze transfers FROM the Four.meme contract (indicating buys)
        if (log.topics.length >= 2) {
          const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
          if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
            potentialBuyTxs.add(txHash);
            const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
            console.log(`Found potential buy in block ${blockNum}: ${txHash.slice(0, 10)}... (to: ${toAddress.slice(0, 10)}...)`);
          }
        }
      } catch (e) {
        // Skip this log if we can't decode it properly
      }
    }
    
    // Convert Set to Array for easier processing
    const interestingTxs = Array.from(potentialBuyTxs);
    console.log(`\nIdentified ${interestingTxs.length} potential buy transactions to analyze in detail`);
    
    // If we have no interesting transactions, we can return early with basic info
    if (interestingTxs.length === 0) {
      const tokenInfo = await tokenInfoPromise;
      return {
        tokenInfo,
        alertScore: 0,
        buyCount: 0,
        uniqueBuyerCount: 0,
        totalBuyVolumeBNB: '0',
        largestBuy: null,
        message: "No buy transactions detected in the early blocks"
      };
    }
    
    // Only now fetch transaction data for the interesting transactions
    console.log("Fetching transaction data for interesting transactions...");
    const txDataPromises = interestingTxs.map(txHash => 
      client.getTransaction({ hash: txHash })
    );
    
    const txData = await Promise.all(txDataPromises);
    
    // Build transaction hash to data mapping
    const txHashToData = {};
    txData.forEach((tx, i) => {
      txHashToData[interestingTxs[i]] = tx;
    });
    
    // Process transaction data to extract buy information
    const uniqueBuyers = new Set();
    let totalBuyVolumeBNB = BigInt(0);
    let totalBuyVolumeTokens = BigInt(0);
    let largestBuyBNB = BigInt(0);
    let largestBuyTx = null;
    const successfulBuys = [];
    
    // Second-pass analysis on the log data, now with transaction context
    for (const log of allLogs) {
      const txHash = log.transactionHash;
      
      // Only process logs from transactions we're interested in
      if (!potentialBuyTxs.has(txHash)) continue;
      
      // Get transaction data
      const tx = txHashToData[txHash];
      if (!tx) continue; // Skip if we couldn't fetch the transaction for some reason
      
      // Analyze token transfers 
      try {
        if (log.topics.length >= 3 && log.topics[0] === TRANSFER_EVENT_SIGNATURE) {
          const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
          const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
          
          // Only process transfers FROM Four.meme (buys)
          if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
            // Decode the token amount
            const amount = BigInt(log.data);
            const blockNum = Number(log.blockNumber);
            const blockOffset = blockNum - creationBlockNumber;
            
            // Record buyer and volumes
            uniqueBuyers.add(toAddress);
            totalBuyVolumeTokens += amount;
            totalBuyVolumeBNB += tx.value || BigInt(0);
            
            // Check if this is the largest buy so far
            if ((tx.value || BigInt(0)) > largestBuyBNB) {
              largestBuyBNB = tx.value || BigInt(0);
              largestBuyTx = {
                hash: txHash,
                blockOffset,
                bnbAmount: formatEther(tx.value || BigInt(0)),
                tokenAmount: formatEther(amount),
                buyer: toAddress
              };
            }
            
            successfulBuys.push({
              hash: txHash,
              blockOffset,
              buyer: toAddress,
              bnbAmount: formatEther(tx.value || BigInt(0)),
              tokenAmount: formatEther(amount)
            });
          }
        }
      } catch (e) {
        console.log(`Error analyzing log in tx ${txHash}: ${e.message}`);
      }
    }
    
    // Wait for token info to complete
    const tokenInfo = await tokenInfoPromise;
    
    // Generate summary
    console.log("\n=== SUPER FAST ANALYSIS SUMMARY ===");
    console.log(`Token Name: ${tokenInfo.name}`);
    console.log(`Token Symbol: ${tokenInfo.symbol}`);
    console.log(`Total Supply: ${formatEther(tokenInfo.totalSupply)}`);
    console.log(`\nEarly Trading Activity (${blocksToAnalyze} blocks after creation):`);
    console.log(`Blocks with activity: ${Object.keys(blockActivity).length}`);
    console.log(`Unique buyers: ${uniqueBuyers.size}`);
    console.log(`Successful buys: ${successfulBuys.length}`);
    console.log(`Total buy volume (BNB): ${formatEther(totalBuyVolumeBNB)}`);
    console.log(`Total buy volume (tokens): ${formatEther(totalBuyVolumeTokens)}`);
    
    if (largestBuyTx) {
      console.log(`\nLargest early buy: ${largestBuyTx.bnbAmount} BNB for ${largestBuyTx.tokenAmount} tokens`);
      console.log(`  Block +${largestBuyTx.blockOffset}, Tx: ${largestBuyTx.hash}`);
      console.log(`  Buyer: ${largestBuyTx.buyer}`);
    }
    
    // Alert score calculation (simple heuristic)
    let alertScore = 0;
    // Points for activity in the first 3 blocks
    alertScore += Math.min(3, Object.keys(blockActivity).length) * 2;
    // Points for unique buyers
    alertScore += Math.min(5, uniqueBuyers.size) * 2;
    // Points for buy volume
    const bnbVolume = Number(formatEther(totalBuyVolumeBNB));
    if (bnbVolume > 5) alertScore += 10;
    else if (bnbVolume > 1) alertScore += 5;
    else if (bnbVolume > 0.5) alertScore += 3;
    // Points for large buys
    if (largestBuyTx && Number(largestBuyTx.bnbAmount) > 1) alertScore += 5;
    
    console.log(`\nToken Alert Score: ${alertScore}/20`);
    if (alertScore >= 15) {
      console.log("STRONG ALERT: High early activity detected!");
    } else if (alertScore >= 10) {
      console.log("MEDIUM ALERT: Promising early activity");
    } else if (alertScore >= 5) {
      console.log("LOW ALERT: Some early interest");
    } else {
      console.log("NO ALERT: Limited early activity");
    }
    
    return {
      tokenInfo,
      alertScore,
      buyCount: successfulBuys.length,
      uniqueBuyerCount: uniqueBuyers.size,
      totalBuyVolumeBNB: formatEther(totalBuyVolumeBNB),
      largestBuy: largestBuyTx
    };
    
  } catch (error) {
    console.error("Error in superFastTokenAnalysis:", error);
    return { error: error.message };
  }
  
  console.log(`Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
}

// Ultra-lightweight token analysis that uses ONLY logs, no transaction data or receipts
async function ultraFastTokenAnalysis(tokenAddress, creationBlockNumber, blocksToAnalyze = 3) {
  console.log(`\n=== ULTRA FAST ANALYSIS FOR TOKEN ${tokenAddress} ===`);
  console.log(`⚠️ NOTE: This is using logs-only mode - no BNB amounts available`);
  tokenAddress = tokenAddress.toLowerCase();
  
  const startTime = Date.now();
  
  try {
    // Get basic token info in parallel with logs
    const tokenInfoPromise = getBasicTokenInfo(tokenAddress);
    
    // Fetch all token transfer logs in a single call
    console.log(`Fetching all transfer events from blocks ${creationBlockNumber} to ${creationBlockNumber + blocksToAnalyze}...`);
    const allLogs = await client.getLogs({
      address: tokenAddress,
      fromBlock: BigInt(creationBlockNumber),
      toBlock: BigInt(creationBlockNumber + blocksToAnalyze),
      topics: [TRANSFER_EVENT_SIGNATURE] // Only Transfer events
    });
    
    console.log(`Found ${allLogs.length} token transfer logs across ${blocksToAnalyze + 1} blocks`);
    
    // Group logs by block number for activity tracking
    const blockActivity = {};
    
    // Track transactions by hash without fetching them
    const uniqueTxHashes = new Set();
    
    // Track buyers (accounts receiving from Four.meme)
    const uniqueBuyers = new Set();
    const buyTxs = [];
    
    // Track transfers and volumes
    let totalTokensMoved = BigInt(0);
    let totalTokensBought = BigInt(0);
    
    // First-pass analysis: Process all logs directly
    console.log("\nProcessing transfer logs without fetching transactions...");
    for (const log of allLogs) {
      const blockNum = Number(log.blockNumber);
      const txHash = log.transactionHash;
      uniqueTxHashes.add(txHash);
      
      // Track block activity
      if (!blockActivity[blockNum]) {
        blockActivity[blockNum] = new Set();
      }
      blockActivity[blockNum].add(txHash);
      
      // Decode log topics to extract from/to addresses
      if (log.topics.length >= 3) {
        const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
        const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
        
        // Add proper error handling for BigInt conversion
        let tokenAmount;
        try {
          // Make sure log.data isn't empty or just "0x"
          if (log.data && log.data !== "0x") {
            tokenAmount = BigInt(log.data);
          } else {
            tokenAmount = BigInt(0);
          }
        } catch (e) {
          console.log(`Error converting log data to BigInt: ${e.message}, data: ${log.data}`);
          tokenAmount = BigInt(0);
        }
        
        // Only include token transfers in the total if they're not massive outliers
        // This helps avoid scientific notation issues with extremely large numbers
        if (tokenAmount < BigInt(1) * BigInt(10) ** BigInt(30)) {
          totalTokensMoved += tokenAmount;
        }
        
        // Check if this is a buy (transfer FROM Four.meme)
        if (fromAddress === FOUR_MEME_ADDRESS.toLowerCase()) {
          uniqueBuyers.add(toAddress);
          totalTokensBought += tokenAmount;
          const blockOffset = blockNum - creationBlockNumber;
          
          buyTxs.push({
            hash: txHash,
            blockOffset,
            buyerAddress: toAddress,
            tokenAmount,
            tokenAmountFormatted: formatEther(tokenAmount),
            timestamp: log.blockTime // If available
          });
          
          console.log(`Found buy: ${formatEther(tokenAmount)} tokens sent to ${toAddress.slice(0, 10)}... in block +${blockOffset}`);
        }
      }
    }
    
    // Sort buy transactions by token amount (fix comparison to sort largest first)
    buyTxs.sort((a, b) => b.tokenAmount > a.tokenAmount ? 1 : (b.tokenAmount < a.tokenAmount ? -1 : 0));
    
    // Wait for token info to complete
    const tokenInfo = await tokenInfoPromise;
    
    // Calculate time taken
    const timeTaken = (Date.now() - startTime) / 1000;
    
    // Generate summary
    console.log("\n=== ULTRA FAST ANALYSIS SUMMARY (LOGS ONLY) ===");
    console.log(`Token Name: ${tokenInfo.name}`);
    console.log(`Token Symbol: ${tokenInfo.symbol}`);
    console.log(`Total Supply: ${formatEther(tokenInfo.totalSupply)}`);
    console.log(`Time taken: ${timeTaken.toFixed(2)} seconds`);
    
    console.log(`\nEarly Trading Activity (${blocksToAnalyze} blocks after creation):`);
    console.log(`Blocks with activity: ${Object.keys(blockActivity).length}`);
    console.log(`Total transactions: ${uniqueTxHashes.size}`);
    console.log(`Unique buyers: ${uniqueBuyers.size}`);
    console.log(`Buy transactions: ${buyTxs.length}`);
    console.log(`Total token volume: ${formatEther(totalTokensMoved)}`);
    console.log(`Total buy volume (tokens): ${formatEther(totalTokensBought)}`);
    console.log(`Average buy size (tokens): ${formatEther(totalTokensBought / BigInt(Math.max(1, buyTxs.length)))}`);
    
    // Show largest buys (by token amount)
    if (buyTxs.length > 0) {
      console.log(`\n🔍 Top 3 largest buys by token amount:`);
      buyTxs.slice(0, 3).forEach((tx, i) => {
        console.log(`${i+1}. ${tx.tokenAmountFormatted} tokens by ${tx.buyerAddress.slice(0, 10)}... in block +${tx.blockOffset}`);
        console.log(`   TX: ${tx.hash}`);
      });
    }
    
    // Alert score calculation (simple heuristic)
    let alertScore = 0;
    // Points for activity in the first 3 blocks
    alertScore += Math.min(3, Object.keys(blockActivity).length) * 2;
    // Points for unique buyers
    alertScore += Math.min(5, uniqueBuyers.size) * 2;
    // Points for transaction count
    alertScore += Math.min(10, uniqueTxHashes.size);
    // Points for token volume as % of supply (we don't have BNB amounts)
    const volumePercentage = Number(formatEther(totalTokensBought)) / Number(formatEther(tokenInfo.totalSupply)) * 100;
    if (volumePercentage > 10) alertScore += 5;
    else if (volumePercentage > 5) alertScore += 3;
    else if (volumePercentage > 1) alertScore += 2;
    
    // Display alert score
    console.log(`\nToken Alert Score: ${alertScore}/25`);
    if (alertScore >= 18) {
      console.log("🚨 STRONG ALERT: High early activity detected!");
    } else if (alertScore >= 12) {
      console.log("⚠️ MEDIUM ALERT: Promising early activity");
    } else if (alertScore >= 6) {
      console.log("ℹ️ LOW ALERT: Some early interest");
    } else {
      console.log("😴 NO ALERT: Limited early activity");
    }
    
    console.log(`\n⚠️ NOTE: This analysis doesn't include BNB amounts since transaction data wasn't fetched.`);
    
    return {
      tokenInfo,
      alertScore,
      buyCount: buyTxs.length,
      uniqueBuyerCount: uniqueBuyers.size,
      totalBuyVolumeTokens: formatEther(totalTokensBought),
      largestBuy: buyTxs.length > 0 ? buyTxs[0] : null,
      performanceStats: {
        timeTaken,
        networkCalls: 2 // Just logs and token info
      }
    };
    
  } catch (error) {
    console.error("Error in ultraFastTokenAnalysis:", error);
    return { error: error.message };
  }
  
  console.log(`Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
}

// Add the turboFastTokenAnalysis function before the command-line processing code
/**
 * Turbo-fast token analysis that fetches full blocks with transactions
 * - Uses client.getBlock with includeTransactions:true to avoid receipt fetching
 * - Combines benefits of speed and complete transaction data
 */
async function turboFastTokenAnalysis(tokenAddress, creationBlockNumber, blocksToAnalyze = 3) {
  const startTime = Date.now();
  console.log(`\n=== TURBO FAST ANALYSIS FOR TOKEN ${tokenAddress} ===`);
  console.log("⚠️ Using block+transaction approach - most efficient method");
  
  try {
    // Standardize addresses
    tokenAddress = tokenAddress.toLowerCase();
    // Correct Four.meme address (using the one the other functions use)
    const FOUR_MEME_ADDRESS = "0x2bc07124d8dac638e290f8eccae7d4b92ea0c4aa".toLowerCase();
    
    // Track trading data
    let uniqueBuyers = new Set();
    let uniqueTxHashes = new Set();
    let blockActivity = {};
    let buyTxs = [];
    let totalBnbVolume = 0;
    let totalTokenVolume = BigInt(0);
    let totalTokensBought = BigInt(0);
    
    // Fetch token info in parallel while getting blocks
    const tokenInfoPromise = getBasicTokenInfo(tokenAddress);
    
    console.log(`Fetching ${blocksToAnalyze + 1} blocks with full transaction data...`);
    
    // Fetch blocks with transaction data in parallel
    const blockPromises = [];
    for (let i = 0; i <= blocksToAnalyze; i++) {
      // Ensure both creationBlockNumber and i are BigInt
      const blockNum = BigInt(creationBlockNumber) + BigInt(i);
      blockPromises.push(client.getBlock({
        blockNumber: blockNum,
        includeTransactions: true
      }));
    }
    
    // Wait for all blocks to be fetched
    const blocks = await Promise.all(blockPromises);
    console.log(`Retrieved ${blocks.length} blocks with transaction data`);
    
    // Create a map of transaction hash -> full transaction
    const txMap = {};
    blocks.forEach(block => {
      if (block.transactions) {
        block.transactions.forEach(tx => {
          txMap[tx.hash] = tx;
        });
      }
    });
    
    console.log(`Mapped ${Object.keys(txMap).length} transactions from blocks`);
    
    // Fetch all transfer logs in one call
    console.log(`Fetching transfer logs from blocks ${creationBlockNumber} to ${BigInt(creationBlockNumber) + BigInt(blocksToAnalyze)}...`);
    const transferLogs = await client.getLogs({
      address: tokenAddress,
      fromBlock: BigInt(creationBlockNumber),
      toBlock: BigInt(creationBlockNumber) + BigInt(blocksToAnalyze),
      topics: [
        // Transfer event signature
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
      ]
    });
    
    console.log(`Found ${transferLogs.length} token transfer logs across ${blocks.length} blocks`);
    
    // Process logs to identify token transfers and buys
    console.log("\nAnalyzing token transfers and matching with transaction data...");
    for (const log of transferLogs) {
      const blockNum = Number(log.blockNumber);
      const txHash = log.transactionHash;
      uniqueTxHashes.add(txHash);
      
      // Track block activity
      if (!blockActivity[blockNum]) {
        blockActivity[blockNum] = new Set();
      }
      blockActivity[blockNum].add(txHash);
      
      // Decode log topics to extract from/to addresses
      if (log.topics.length >= 3) {
        const fromAddress = '0x' + log.topics[1].slice(26).toLowerCase();
        const toAddress = '0x' + log.topics[2].slice(26).toLowerCase();
        
        // Add proper error handling for BigInt conversion
        let tokenAmount;
        try {
          if (log.data && log.data !== "0x") {
            tokenAmount = BigInt(log.data);
          } else {
            tokenAmount = BigInt(0);
          }
        } catch (e) {
          console.log(`Error converting log data to BigInt: ${e.message}, data: ${log.data}`);
          tokenAmount = BigInt(0);
        }
        
        // Only include token transfers in the total if they're not massive outliers
        if (tokenAmount < BigInt(1) * BigInt(10) ** BigInt(30)) {
          totalTokenVolume += tokenAmount;
        }
        
        // Get the associated transaction from our map
        const tx = txMap[txHash];
        
        // Check if this is a buy (transfer FROM Four.meme or TO a buyer)
        if (fromAddress === FOUR_MEME_ADDRESS || 
           (toAddress !== FOUR_MEME_ADDRESS && fromAddress !== '0x0000000000000000000000000000000000000000'.toLowerCase())) {
          // If it's from Four.meme, it's definitely a buy
          if (fromAddress === FOUR_MEME_ADDRESS) {
            // Filter out unrealistically large token amounts (likely errors or uint256 max value)
            if (tokenAmount < BigInt(1) * BigInt(10) ** BigInt(30)) {
              uniqueBuyers.add(toAddress);
              totalTokensBought += tokenAmount;
              const blockOffset = blockNum - Number(creationBlockNumber);
              
              // If we have the transaction data, extract the BNB amount
              let bnbAmount = 0;
              if (tx) {
                bnbAmount = Number(formatEther(tx.value));
                totalBnbVolume += bnbAmount;
              }
              
              buyTxs.push({
                hash: txHash,
                blockOffset,
                buyerAddress: toAddress,
                tokenAmount,
                tokenAmountFormatted: formatEther(tokenAmount),
                bnbAmount,
                timestamp: blocks[blockOffset]?.timestamp // From block data
              });
              
              console.log(`Found buy (from Four.meme): ${formatEther(tokenAmount)} tokens for ${bnbAmount} BNB by ${toAddress.slice(0, 10)}... in block +${blockOffset}`);
            } else {
              console.log(`Skipping unrealistically large transfer: ${formatEther(tokenAmount)} tokens - likely an error or uint256 max value`);
            }
          }
          // If it's a transfer to someone other than Four.meme and not from the zero address, it might be a buy
          else if (blockNum > Number(creationBlockNumber) && 
                   toAddress !== FOUR_MEME_ADDRESS && 
                   fromAddress !== '0x0000000000000000000000000000000000000000'.toLowerCase()) {
            // Filter out unrealistically large token amounts (likely errors or uint256 max value)
            if (tokenAmount < BigInt(1) * BigInt(10) ** BigInt(30)) {
              uniqueBuyers.add(toAddress);
              totalTokensBought += tokenAmount;
              const blockOffset = blockNum - Number(creationBlockNumber);
              
              // If we have the transaction data, extract the BNB amount
              let bnbAmount = 0;
              if (tx) {
                bnbAmount = Number(formatEther(tx.value));
                totalBnbVolume += bnbAmount;
              }
              
              buyTxs.push({
                hash: txHash,
                blockOffset,
                buyerAddress: toAddress,
                tokenAmount,
                tokenAmountFormatted: formatEther(tokenAmount),
                bnbAmount,
                timestamp: blocks[blockOffset]?.timestamp // From block data
              });
              
              console.log(`Found likely buy: ${formatEther(tokenAmount)} tokens for ${bnbAmount} BNB by ${toAddress.slice(0, 10)}... in block +${blockOffset}`);
            } else {
              console.log(`Skipping unrealistically large transfer: ${formatEther(tokenAmount)} tokens - likely an error or uint256 max value`);
            }
          }
        }
      }
    }
    
    // Sort buy transactions by token amount
    buyTxs.sort((a, b) => b.tokenAmount > a.tokenAmount ? 1 : (b.tokenAmount < a.tokenAmount ? -1 : 0));
    
    // Wait for token info to complete
    const tokenInfo = await tokenInfoPromise;
    
    // Calculate metrics for alerting
    const blocksWithActivity = Object.keys(blockActivity).length;
    const totalTxs = uniqueTxHashes.size;
    const uniqueBuyerCount = uniqueBuyers.size;
    const formattedTotalTokensBought = formatEther(totalTokensBought);
    
    // Calculate alert score (out of 25)
    let alertScore = 0;
    alertScore += Math.min(5, uniqueBuyerCount); // Up to 5 points for unique buyers
    alertScore += Math.min(5, blocksWithActivity * 2); // Up to 5 points for block activity
    alertScore += totalBnbVolume > 10 ? 5 : Math.floor(totalBnbVolume / 2); // Up to 5 points for BNB volume
    alertScore += buyTxs.length >= 5 ? 5 : buyTxs.length; // Up to 5 points for buy tx count
    alertScore += totalTxs > 10 ? 5 : Math.floor(totalTxs / 2); // Up to 5 points for total tx count
    
    // Build summary string
    let summaryString = `\n=== TURBO FAST ANALYSIS SUMMARY ===\n`;
    summaryString += `Token Name: ${tokenInfo.name}\n`;
    summaryString += `Token Symbol: ${tokenInfo.symbol}\n`;
    summaryString += `Total Supply: ${Number(formatEther(tokenInfo.totalSupply)).toLocaleString('en-US', { maximumFractionDigits: 0 })}\n`;
    summaryString += `Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds\n\n`;
    
    summaryString += `Early Trading Activity (${blocksToAnalyze} blocks after creation):\n`;
    summaryString += `Blocks with activity: ${blocksWithActivity}\n`;
    summaryString += `Total transactions: ${totalTxs}\n`;
    summaryString += `Unique buyers: ${uniqueBuyerCount}\n`;
    summaryString += `Buy transactions: ${buyTxs.length}\n`;
    summaryString += `Total token volume: ${formatEther(totalTokenVolume)}\n`;
    summaryString += `Total buy volume (tokens): ${formattedTotalTokensBought}\n`;
    summaryString += `Total buy volume (BNB): ${totalBnbVolume.toFixed(2)} BNB\n`;
    
    if (buyTxs.length > 0) {
      summaryString += `Average buy size (tokens): ${(Number(formattedTotalTokensBought) / buyTxs.length).toLocaleString('en-US', { maximumFractionDigits: 6 })}\n`;
      summaryString += `Average buy size (BNB): ${(totalBnbVolume / buyTxs.length).toFixed(4)} BNB\n\n`;
      
      // Show top 3 buys by token amount
      summaryString += `🔍 Top 3 largest buys by token amount:\n`;
      for (let i = 0; i < Math.min(3, buyTxs.length); i++) {
        const buy = buyTxs[i];
        summaryString += `${i+1}. ${buy.tokenAmountFormatted} tokens for ${buy.bnbAmount} BNB by ${buy.buyerAddress.slice(0, 10)}... in block +${buy.blockOffset}\n`;
        summaryString += `   TX: ${buy.hash}\n`;
      }
    }
    
    // Alert score summary
    summaryString += `\nToken Alert Score: ${alertScore}/25\n`;
    if (alertScore >= 20) {
      summaryString += `🔥 STRONG ALERT: High early activity detected!\n`;
    } else if (alertScore >= 15) {
      summaryString += `⚠️ MEDIUM ALERT: Moderate early activity detected.\n`;
    } else if (alertScore >= 10) {
      summaryString += `ℹ️ LOW ALERT: Some early activity detected.\n`;
    } else {
      summaryString += `✅ NO ALERT: Minimal early activity detected.\n`;
    }
    
    console.log(summaryString);
    
    console.log(`Time taken: ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
    
    // Return analysis results
    return {
      tokenInfo,
      uniqueBuyers: Array.from(uniqueBuyers),
      buyTxs,
      totalBnbVolume,
      totalTokenVolume: formatEther(totalTokenVolume),
      totalTokensBought: formattedTotalTokensBought,
      alertScore,
      blocksWithActivity,
      totalTxs,
      timeElapsed: Date.now() - startTime
    };
  } catch (error) {
    console.error("Error in turboFastTokenAnalysis:", error);
    return { error: error.message };
  }
}

// Update command line processing to include all options
const args = process.argv.slice(2);
const runMode = args[0] || 'superfast'; // Default to superfast if no arg provided

// Token data for analysis
const tokenAddress = '0xbb629c94b6046d7cd3ad96d16ca3a4ad29c377e9';
const creationBlock = 47748104;
const blocksToAnalyze = 3;

// Parse for transaction analysis
if (runMode === '--analyze-tx' || runMode === 'analyze-tx') {
  const txHash = args[1];
  if (!txHash) {
    console.error("Please provide a transaction hash to analyze");
    process.exit(1);
  }
  console.log(`Analyzing transaction ${txHash} for token creation details`);
  analyzeTokenCreationTx(txHash);
}
// Parse for token detection
else if (runMode === '--detect' || runMode === 'detect') {
  const blockNumber = args[1] ? parseInt(args[1]) : creationBlock;
  console.log(`Running token creation detection for block ${blockNumber}`);
  detectTokenCreation(blockNumber);
} else {
  // Regular token analysis modes
  console.log(`Running analysis in ${runMode} mode for token ${tokenAddress}`);
  
  // Run the appropriate analysis based on command-line argument
  if (runMode === '--legacy' || runMode === 'legacy') {
    console.log("Running legacy detailed analysis...");
    analyzeTokenEarlyActivity(
      tokenAddress,
      creationBlock,
      blocksToAnalyze
    );
  } else if (runMode === '--quick' || runMode === 'quick') {
    console.log("Running quick analysis...");
    quickTokenAnalysis(
      tokenAddress,
      creationBlock,
      blocksToAnalyze
    );
  } else if (runMode === '--ultra' || runMode === 'ultra') {
    console.log("Running ultra-fast logs-only analysis...");
    ultraFastTokenAnalysis(
      tokenAddress,
      creationBlock,
      blocksToAnalyze
    );
  } else if (runMode === '--turbo' || runMode === 'turbo') {
    console.log("Running turbo-fast block+transaction analysis...");
    turboFastTokenAnalysis(
      tokenAddress,
      creationBlock,
      blocksToAnalyze
    );
  } else {
    // Default is superfast
    console.log("Running super-fast optimized analysis...");
    superFastTokenAnalysis(
      tokenAddress,
      creationBlock,
      blocksToAnalyze
    );
  }
}

/**
 * Enhanced token creation detection based on Four.meme patterns
 */
async function detectTokenCreation(blockNumber) {
  console.log(`\n=== ANALYZING BLOCK ${blockNumber} FOR FOUR.MEME TOKEN CREATION ===`);
  const startTime = Date.now();
  
  try {
    // Constants - Using the proper Four.meme address as defined at the top of the file
    const FOUR_MEME_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b".toLowerCase();
    const ROUTER_ADDRESS = "0x5c952063c7fc8610ffdb798152d69f0b9550762b".toLowerCase(); // Same as Four.meme address in this case
    
    // Fetch the block with full transaction data
    console.log(`Fetching block ${blockNumber} with full transaction data...`);
    const block = await client.getBlock({
      blockNumber: BigInt(blockNumber),
      includeTransactions: true
    });
    
    console.log(`Block ${blockNumber} contains ${block.transactions.length} transactions`);
    
    // Track potential token creations
    const potentialTokenCreations = [];
    
    // Find transactions involving the Four.meme platform
    console.log("\nLooking for transactions involving Four.meme platform...");
    const fourMemeTransactions = block.transactions.filter(tx => {
      // Direct interactions with Four.meme contract (to OR from)
      if (tx.to && tx.to.toLowerCase() === FOUR_MEME_ADDRESS) {
        return true;
      }
      if (tx.from && tx.from.toLowerCase() === FOUR_MEME_ADDRESS) {
        return true;
      }
      return false;
    });
    
    console.log(`Found ${fourMemeTransactions.length} transactions directly involving the Four.meme platform`);
    
    // Get all transaction hashes involving Four.meme for later reference
    const fourMemeTxHashes = new Set(fourMemeTransactions.map(tx => tx.hash));
    
    // Look for ALL Transfer events in this block 
    console.log("\nFetching Transfer events in this block...");
    const transferLogs = await client.getLogs({
      fromBlock: BigInt(blockNumber),
      toBlock: BigInt(blockNumber),
      topics: [
        // Transfer event signature
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
      ]
    });
    
    console.log(`Found ${transferLogs.length} Transfer events`);
    
    // Group logs by contract address
    console.log("\nGrouping events by contract...");
    const contractEvents = {};
    
    // Track tokens with direct Four.meme involvement
    const fourMemeInvolvedTokens = new Set();
    
    // Process Transfer events
    for (const log of transferLogs) {
      const address = log.address.toLowerCase();
      if (!contractEvents[address]) {
        contractEvents[address] = {
          transfers: [],
          buys: [],
          sells: [],
          mints: [],
          burns: [],
          txHashes: new Set(),
          fourMemeInvolved: false,
          fourMemeReason: []
        };
      }
      
      // Add transfer
      contractEvents[address].transfers.push(log);
      
      // Track transaction hash
      contractEvents[address].txHashes.add(log.transactionHash);
      
      // Check if this transfer is in a Four.meme transaction
      if (fourMemeTxHashes.has(log.transactionHash)) {
        contractEvents[address].fourMemeInvolved = true;
        contractEvents[address].fourMemeReason.push('Four.meme transaction');
        fourMemeInvolvedTokens.add(address);
      }
      
      // Identify transfer type if this is a Transfer event
      if (log.topics && log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' && log.topics.length >= 3) {
        const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
        const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
        
        // Check if Four.meme is directly involved in the transfer
        if (fromAddr === FOUR_MEME_ADDRESS || toAddr === FOUR_MEME_ADDRESS) {
          contractEvents[address].fourMemeInvolved = true;
          contractEvents[address].fourMemeReason.push('Transfer to/from Four.meme');
          fourMemeInvolvedTokens.add(address);
        }
        
        // Mint (from zero address)
        if (fromAddr === '0x0000000000000000000000000000000000000000') {
          contractEvents[address].mints.push(log);
        }
        // Burn (to zero address)
        else if (toAddr === '0x0000000000000000000000000000000000000000') {
          contractEvents[address].burns.push(log);
        }
        // Buy (to/from router)
        else if (fromAddr === ROUTER_ADDRESS) {
          contractEvents[address].buys.push(log);
        }
        // Sell (to/from router)
        else if (toAddr === ROUTER_ADDRESS) {
          contractEvents[address].sells.push(log);
        }
      }
    }
    
    console.log(`\nFound ${fourMemeInvolvedTokens.size} tokens with direct Four.meme involvement`);
    
    // Add a list of well-known token addresses to exclude
    const EXCLUDE_TOKENS = [
      '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
      '0x55d398326f99059ff775485246999027b3197955', // USDT
      '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
      '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH
      '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
      '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
      '0x7083609fce4d1d8dc0c979aab8c869ea2c873402'  // DOT
    ];
    
    // Analyze each contract for Four.meme token patterns
    console.log("\nAnalyzing contracts for Four.meme token patterns...");
    
    // Filter contracts - prioritize those with direct Four.meme involvement
    const analyzedContracts = Object.keys(contractEvents)
      .filter(address => {
        // Exclude well-known tokens
        if (EXCLUDE_TOKENS.includes(address.toLowerCase())) return false;
        
        const events = contractEvents[address];
        
        // Include if Four.meme is directly involved
        if (events.fourMemeInvolved) return true;
        
        // For tokens without direct involvement, only include those with interesting activity
        // that might be worth investigating
        if ((events.buys.length > 0 || events.sells.length > 0) && 
            (events.mints.length > 0 || events.transfers.length >= 3)) {
          return true;
        }
        
        return false;
      });
    
    console.log(`Found ${analyzedContracts.length} contracts to analyze (after filtering)`);
    
    for (const address of analyzedContracts) {
      const events = contractEvents[address];
      console.log(`\nAnalyzing contract ${address} with ${events.transfers.length} transfers (${events.buys.length} buys, ${events.sells.length} sells, ${events.mints.length} mints)`);
      
      if (events.fourMemeInvolved) {
        console.log(`✅ FOUR.MEME CONFIRMED: Direct involvement detected (${events.fourMemeReason.join(', ')})`);
      }
      
      // Check if it looks like a Four.meme token
      let isFourMemePattern = events.fourMemeInvolved; // Default to true if direct involvement
      let fourMemeScore = events.fourMemeInvolved ? 10 : 0; // Start with high score if direct involvement
      let reasons = events.fourMemeInvolved ? events.fourMemeReason : [];
      
      // 1. Check for transfers involving the router (buys/sells)
      if (events.buys.length > 0 || events.sells.length > 0) {
        console.log(`Found ${events.buys.length + events.sells.length} trades involving the router (${events.buys.length} buys, ${events.sells.length} sells)`);
        fourMemeScore += (events.buys.length + events.sells.length) * 2;
        reasons.push(`${events.buys.length + events.sells.length} router trades`);
      }
      
      // 2. Check for mints from zero address (token creation)
      if (events.mints.length > 0) {
        console.log(`Found ${events.mints.length} mint events (token creation)`);
        fourMemeScore += events.mints.length;
        reasons.push(`${events.mints.length} mint events`);
        
        // Mint in same block as router interaction is very strong signal
        if (events.buys.length > 0 || events.sells.length > 0) {
          fourMemeScore += 5;
          reasons.push("Mint + router trades in same block");
        }
      }
      
      // 3. Check if transactions match Four.meme transaction pattern
      const matchingFourMemeTxs = Array.from(events.txHashes).filter(txHash => 
        fourMemeTxHashes.has(txHash)
      );
      
      if (matchingFourMemeTxs.length > 0) {
        console.log(`Found ${matchingFourMemeTxs.length} transactions matching Four.meme pattern`);
        fourMemeScore += matchingFourMemeTxs.length * 3;
        reasons.push(`${matchingFourMemeTxs.length} Four.meme transactions`);
      }
      
      // Determine if this is likely a Four.meme token based on score
      isFourMemePattern = isFourMemePattern || fourMemeScore >= 3;
      
      // If it matches our pattern, verify it's an ERC20 token
      if (isFourMemePattern) {
        try {
          console.log(`Potential Four.meme token detected - checking ERC20 compatibility...`);
          const tokenInfo = await getBasicTokenInfo(address);
          
          console.log(`✅ Confirmed ERC20 token: ${tokenInfo.name} (${tokenInfo.symbol})`);
          console.log(`Decimals: ${tokenInfo.decimals}`);
          console.log(`Total Supply: ${formatEther(tokenInfo.totalSupply)}`);
          
          // Check if any of the transactions had value sent to the Four.meme address
          let creatorAddress = null;
          let creationTx = null;
          
          for (const txHash of events.txHashes) {
            const tx = block.transactions.find(t => t.hash === txHash);
            if (tx && tx.to && tx.to.toLowerCase() === FOUR_MEME_ADDRESS && tx.value > 0) {
              creatorAddress = tx.from;
              creationTx = tx.hash;
              console.log(`Found likely creation tx: ${tx.hash} from ${tx.from} with ${formatEther(tx.value)} ETH`);
              break;
            }
          }
          
          // Add to token creations
          potentialTokenCreations.push({
            tokenAddress: address,
            tokenName: tokenInfo.name,
            tokenSymbol: tokenInfo.symbol,
            totalSupply: tokenInfo.totalSupply,
            decimals: tokenInfo.decimals,
            creatorAddress,
            creationTx,
            fourMemeInvolved: events.fourMemeInvolved,
            fourMemeReasons: events.fourMemeReason.join(', '),
            mintEvents: events.mints.length,
            buyTrades: events.buys.length,
            sellTrades: events.sells.length,
            totalTxs: events.txHashes.size,
            fourMemeScore,
            reasons: reasons.join(", "),
            confidence: events.fourMemeInvolved ? 'Very High' : 
                      (fourMemeScore >= 5 ? 'High' : 
                      (fourMemeScore >= 3 ? 'Medium' : 'Low'))
          });
        } catch (error) {
          console.log(`Not an ERC20 token: ${error.message}`);
        }
      }
    }
    
    // Print summary of detected token creations
    console.log("\n=== DETECTED FOUR.MEME TOKENS ===");
    if (potentialTokenCreations.length === 0) {
      console.log("No Four.meme token creations detected in this block");
    }
    
    // Sort by Four.meme involvement first, then by score
    potentialTokenCreations.sort((a, b) => {
      if (a.fourMemeInvolved && !b.fourMemeInvolved) return -1;
      if (!a.fourMemeInvolved && b.fourMemeInvolved) return 1;
      return b.fourMemeScore - a.fourMemeScore;
    });
    
    for (let i = 0; i < potentialTokenCreations.length; i++) {
      const token = potentialTokenCreations[i];
      console.log(`\n${i+1}. Token: ${token.tokenAddress}`);
      console.log(`   Name: ${token.tokenName}`);
      console.log(`   Symbol: ${token.tokenSymbol}`);
      console.log(`   Total Supply: ${formatEther(token.totalSupply)}`);
      console.log(`   Creator: ${token.creatorAddress || 'Unknown'}`);
      console.log(`   Creation Tx: ${token.creationTx || 'Unknown'}`);
      if (token.fourMemeInvolved) {
        console.log(`   ✅ FOUR.MEME CONFIRMED TOKEN (${token.fourMemeReasons})`);
      }
      console.log(`   Trading Activity: ${token.buyTrades} buys, ${token.sellTrades} sells`);
      console.log(`   Mint Events: ${token.mintEvents}`);
      console.log(`   Total Transactions: ${token.totalTxs}`);
      console.log(`   Four.meme Score: ${token.fourMemeScore} (${token.reasons})`);
      console.log(`   Confidence: ${token.confidence}`);
    }
    
    console.log(`\nAnalysis completed in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
    return potentialTokenCreations;
    
  } catch (error) {
    console.error("Error in token creation detection:", error);
    return { error: error.message };
  }
}

/**
 * Analyzes a specific transaction to understand token creation mechanics
 */
async function analyzeTokenCreationTx(txHash) {
  console.log(`\n=== ANALYZING TRANSACTION ${txHash} FOR TOKEN CREATION DETAILS ===`);
  const startTime = Date.now();
  
  try {
    // Fetch the transaction
    console.log(`Fetching transaction data...`);
    const tx = await client.getTransaction({ hash: txHash });
    console.log(`\nTransaction basic details:`);
    console.log(`From: ${tx.from}`);
    console.log(`To: ${tx.to || 'Contract Creation'}`);
    console.log(`Value: ${formatEther(tx.value)} ETH`);
    console.log(`Block: ${tx.blockNumber}`);
    console.log(`Gas Used: ${tx.gas}`);
    
    // Fetch the receipt for logs and created contracts
    console.log(`\nFetching transaction receipt for events...`);
    const receipt = await client.getTransactionReceipt({ hash: txHash });
    console.log(`Gas Used in Receipt: ${receipt.gasUsed}`);
    console.log(`Status: ${receipt.status ? 'Success' : 'Failed'}`);
    
    // If contract was created
    if (receipt.contractAddress) {
      console.log(`\n🔍 Contract created at: ${receipt.contractAddress}`);
      
      // Check if it's a token
      try {
        const tokenInfo = await getBasicTokenInfo(receipt.contractAddress);
        console.log(`✅ Confirmed ERC20 token: ${tokenInfo.name} (${tokenInfo.symbol})`);
        console.log(`Decimals: ${tokenInfo.decimals}`);
        console.log(`Total Supply: ${formatEther(tokenInfo.totalSupply)}`);
        
        // Remove owner check section
      } catch (e) {
        console.log(`❌ Not an ERC20 token: ${e.message}`);
      }
    } else {
      console.log(`\nNo contract was directly created in this transaction`);
    }
    
    // Analyze logs from the receipt
    console.log(`\nAnalyzing transaction logs...`);
    console.log(`Found ${receipt.logs.length} logs in the transaction`);
    
    // Track tokens involved
    const tokensInvolved = new Set();
    
    // Group logs by event signature
    const eventTypes = {};
    
    for (let i = 0; i < receipt.logs.length; i++) {
      const log = receipt.logs[i];
      const contractAddress = log.address;
      tokensInvolved.add(contractAddress);
      
      // Check if this is a transfer event
      if (log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        const eventType = 'Transfer';
        if (!eventTypes[eventType]) eventTypes[eventType] = 0;
        eventTypes[eventType]++;
        
        // Decode the transfer
        const fromAddr = '0x' + log.topics[1].slice(26).toLowerCase();
        const toAddr = '0x' + log.topics[2].slice(26).toLowerCase();
        
        let value;
        try {
          value = log.data && log.data !== '0x' ? formatEther(BigInt(log.data)) : '0';
        } catch (e) {
          value = 'Error decoding: ' + log.data;
        }
        
        console.log(`\nLog #${i} - Token Transfer:`);
        console.log(`Contract: ${contractAddress}`);
        console.log(`From: ${fromAddr}`);
        console.log(`To: ${toAddr}`);
        console.log(`Value: ${value}`);
        
        // Check if this is a mint (from zero address)
        if (fromAddr === '0x0000000000000000000000000000000000000000') {
          console.log(`🔍 This is a token MINT (from zero address)`);
          
          // Check if it's a token
          try {
            const tokenInfo = await getBasicTokenInfo(contractAddress);
            console.log(`Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
          } catch (e) {
            console.log(`Could not get token info: ${e.message}`);
          }
        }
      }
      // Otherwise just show the topic and data
      else {
        const eventType = 'Unknown (' + log.topics[0].slice(0, 10) + '...)';
        if (!eventTypes[eventType]) eventTypes[eventType] = 0;
        eventTypes[eventType]++;
        
        console.log(`\nLog #${i} - Other Event:`);
        console.log(`Contract: ${contractAddress}`);
        console.log(`Topic 0: ${log.topics[0]}`);
        console.log(`Data: ${log.data.length > 66 ? log.data.slice(0, 66) + '...' : log.data}`);
      }
    }
    
    // Summary of event types
    console.log(`\nEvent Summary:`);
    for (const [eventType, count] of Object.entries(eventTypes)) {
      console.log(`- ${eventType}: ${count}`);
    }
    
    // For each token contract involved, check if it's actually a token
    console.log(`\nToken Contracts Involved (${tokensInvolved.size}):`);
    for (const tokenAddr of tokensInvolved) {
      console.log(`\nChecking ${tokenAddr} for ERC20 compatibility...`);
      
      try {
        const tokenInfo = await getBasicTokenInfo(tokenAddr);
        console.log(`✅ ERC20 Token: ${tokenInfo.name} (${tokenInfo.symbol})`);
        console.log(`Decimals: ${tokenInfo.decimals}`);
        console.log(`Total Supply: ${formatEther(tokenInfo.totalSupply)}`);
        
        // Remove owner check section
      } catch (e) {
        console.log(`❌ Not an ERC20 token: ${e.message}`);
      }
    }
    
    console.log(`\nAnalysis completed in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);
  } catch (error) {
    console.error(`Error analyzing transaction: ${error.message}`);
  }
}