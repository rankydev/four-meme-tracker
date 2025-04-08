process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp as client } from './src/clients/client.js';
import { formatEther, parseAbi } from 'viem';

// The transaction hash to analyze
const TX_HASH = '0xd4fc258e25215610d8fe8c3c40189e32ba782e095b9dad988ff716f93043232a';

// Four.meme receiving address (verify this address)
const FOUR_MEME_ADDRESS = '0x757eba15a64468e6535532fcF093Cef90e226F85';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// ERC20 Standard ABI fragments we need
const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
]);

// Transfer event signature
const TRANSFER_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function analyzeTokenCreation() {
  console.log(`Analyzing transaction: ${TX_HASH}`);
  
  try {
    // Fetch transaction receipt which contains logs
    const receipt = await client.getTransactionReceipt({ hash: TX_HASH });
    
    // Fetch transaction details
    const tx = await client.getTransaction({ hash: TX_HASH });
    
    console.log(`\nTransaction info:`);
    console.log(`Block: ${receipt.blockNumber}`);
    console.log(`Status: ${receipt.status ? 'Success' : 'Failed'}`);
    console.log(`From: ${receipt.from}`);
    console.log(`To: ${receipt.to}`);
    console.log(`Gas used: ${receipt.gasUsed}`);
    
    // Log all contracts interacted with
    const uniqueContracts = new Set();
    receipt.logs.forEach(log => uniqueContracts.add(log.address.toLowerCase()));
    
    console.log(`\nContracts interacted with in this transaction:`);
    [...uniqueContracts].forEach(contract => console.log(`- ${contract}`));
    
    // Find all mint events (transfers from zero address)
    const mintEvents = receipt.logs.filter(log => 
      log.topics[0] === TRANSFER_SIGNATURE && 
      log.topics[1] === `0x000000000000000000000000${ZERO_ADDRESS.slice(2)}`
    );
    
    console.log(`\nFound ${mintEvents.length} mint events (transfers from zero address):`);
    
    // Track potential tokens created in this transaction
    const potentialTokens = [];
    
    // Analyze each mint event
    for (let i = 0; i < mintEvents.length; i++) {
      const event = mintEvents[i];
      const recipient = '0x' + event.topics[2].slice(26).toLowerCase();
      const contractAddress = event.address.toLowerCase();
      
      console.log(`\nMint Event #${i+1}:`);
      console.log(`- Token contract: ${contractAddress}`);
      console.log(`- Recipient: ${recipient}`);
      console.log(`- Amount: ${event.data}`);
      console.log(`- Log index: ${event.logIndex}`);
      
      // Pattern 1: Token minted directly to Four.meme
      if (recipient === FOUR_MEME_ADDRESS.toLowerCase()) {
        console.log(`✅ PATTERN MATCH: Direct mint to Four.meme`);
        potentialTokens.push({
          address: contractAddress,
          pattern: "Direct mint to Four.meme",
          score: 10
        });
      } 
      
      // Pattern 2: Token contract created in this transaction (check contractCreated)
      if (receipt.contractCreated && receipt.contractCreated.toLowerCase() === contractAddress) {
        console.log(`✅ PATTERN MATCH: Token contract created in this transaction`);
        potentialTokens.push({
          address: contractAddress,
          pattern: "Contract created in tx",
          score: 8
        });
      }
      
      // Pattern 3: Look for subsequent transfer to Four.meme
      const transfersToFourMeme = receipt.logs.filter(log => 
        log.address.toLowerCase() === contractAddress &&
        log.topics[0] === TRANSFER_SIGNATURE &&
        log.topics[2] === `0x000000000000000000000000${FOUR_MEME_ADDRESS.slice(2).toLowerCase()}`
      );
      
      if (transfersToFourMeme.length > 0) {
        console.log(`✅ PATTERN MATCH: Transfer to Four.meme after mint`);
        potentialTokens.push({
          address: contractAddress,
          pattern: "Transfer to Four.meme",
          score: 9
        });
        
        // Log the transfers to Four.meme
        transfersToFourMeme.forEach(transfer => {
          const sender = '0x' + transfer.topics[1].slice(26).toLowerCase();
          console.log(`  - Transfer to Four.meme from: ${sender}, amount: ${transfer.data}`);
        });
      }
      
      // Check for transfers from Four.meme (distribution)
      const transfersFromFourMeme = receipt.logs.filter(log => 
        log.address.toLowerCase() === contractAddress &&
        log.topics[0] === TRANSFER_SIGNATURE &&
        log.topics[1] === `0x000000000000000000000000${FOUR_MEME_ADDRESS.slice(2).toLowerCase()}`
      );
      
      if (transfersFromFourMeme.length > 0) {
        console.log(`- Found ${transfersFromFourMeme.length} transfers FROM Four.meme (distribution):`);
        transfersFromFourMeme.forEach(transfer => {
          const recipient = '0x' + transfer.topics[2].slice(26).toLowerCase();
          console.log(`  - To: ${recipient}, amount: ${transfer.data}`);
        });
      }
    }
    
    // If we found potential tokens, get more info about them
    let uniqueTokens = [];
    if (potentialTokens.length > 0) {
      console.log(`\n==== POTENTIAL TOKENS CREATED ====`);
      
      // De-duplicate tokens and sort by score
      uniqueTokens = [];
      potentialTokens.forEach(token => {
        const existing = uniqueTokens.find(t => t.address === token.address);
        if (existing) {
          existing.score += token.score;
          existing.patterns = (existing.patterns || [existing.pattern]).concat([token.pattern]);
          delete existing.pattern;
        } else {
          uniqueTokens.push({...token});
        }
      });
      
      uniqueTokens.sort((a, b) => b.score - a.score);
      
      // Get more info about each token
      for (const token of uniqueTokens) {
        console.log(`\nToken: ${token.address}`);
        console.log(`Match patterns: ${token.patterns ? token.patterns.join(', ') : token.pattern}`);
        console.log(`Match score: ${token.score}/10`);
        
        try {
          // Create contract instance for reading
          const name = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'name'
          });
          
          const symbol = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'symbol'
          });
          
          const decimals = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'decimals'
          });
          
          const totalSupply = await client.readContract({
            address: token.address,
            abi: ERC20_ABI,
            functionName: 'totalSupply'
          });
          
          console.log(`Token Name: ${name}`);
          console.log(`Token Symbol: ${symbol}`);
          console.log(`Decimals: ${decimals}`);
          console.log(`Total Supply: ${formatEther(totalSupply)} (raw: ${totalSupply})`);
        } catch (error) {
          console.error(`Error fetching token information: ${error.message}`);
        }
      }
    }
    
    // Check for alternative patterns - contract creation without mint events
    if (receipt.contractCreated) {
      console.log(`\nContract created in this transaction: ${receipt.contractCreated}`);
      
      // Look for any events from this contract
      const contractEvents = receipt.logs.filter(log => 
        log.address.toLowerCase() === receipt.contractCreated.toLowerCase()
      );
      
      if (contractEvents.length > 0) {
        console.log(`Found ${contractEvents.length} events from the created contract`);
        
        // Check if this might be a token by looking for common event signatures
        const transferEvents = contractEvents.filter(log => 
          log.topics[0] === TRANSFER_SIGNATURE
        );
        
        if (transferEvents.length > 0) {
          console.log(`✅ PATTERN MATCH: Contract created appears to be a token (has Transfer events)`);
          
          // This might be a token with a different creation pattern
          // Try to fetch token info
          try {
            const tokenAddress = receipt.contractCreated;
            
            const name = await client.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'name'
            });
            
            const symbol = await client.readContract({
              address: tokenAddress,
              abi: ERC20_ABI,
              functionName: 'symbol'
            });
            
            console.log(`\nAlternative token creation pattern detected!`);
            console.log(`Token: ${tokenAddress}`);
            console.log(`Token Name: ${name}`);
            console.log(`Token Symbol: ${symbol}`);
          } catch (error) {
            console.error(`Error fetching alternative token information: ${error.message}`);
          }
        }
      }
    }
    
    // Final summary
    console.log(`\n==== CONCLUSION ====`);
    if (potentialTokens.length > 0) {
      console.log(`Transaction ${TX_HASH} appears to involve token creation.`);
      console.log(`Most likely token address: ${uniqueTokens[0].address}`);
    } else if (receipt.contractCreated) {
      console.log(`Transaction ${TX_HASH} created a contract, but no clear token creation pattern was detected.`);
      console.log(`Contract address: ${receipt.contractCreated}`);
    } else {
      console.log(`Transaction ${TX_HASH} does NOT appear to involve token creation.`);
    }
    
  } catch (error) {
    console.error(`Error analyzing transaction: ${error.message}`);
  }
}

// Run the analysis
analyzeTokenCreation(); 