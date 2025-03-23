import { clientHttp } from './src/clients/client.js';

// Transaction hash for a known token creation on four.meme
const TX_HASH = '0x76ec03b5ae846320af9059da5732655b41bb34f0c60b8ce6aeb3a26f01f78004';

/**
 * Inspect a specific transaction to understand token creation on four.meme
 */
async function inspectTokenCreationTx() {
  try {
    console.log('Inspecting token creation transaction:', TX_HASH);
    
    // Get transaction receipt (which includes logs)
    const receipt = await clientHttp.getTransactionReceipt({
      hash: TX_HASH,
    });
    
    console.log(`Transaction Status: ${receipt.status ? 'Success' : 'Failed'}`);
    console.log(`Block Number: ${receipt.blockNumber}`);
    console.log(`From: ${receipt.from}`);
    console.log(`To: ${receipt.to}`);
    
    // Get full transaction details
    const tx = await clientHttp.getTransaction({
      hash: TX_HASH,
    });
    
    console.log(`Transaction Value: ${tx.value}`);
    
    // Analyze logs (events)
    console.log(`\nNumber of logs/events: ${receipt.logs.length}`);
    
    // Map to store token addresses by detection method
    const tokensByMethod = {};
    
    // Event signature hashes (topic[0])
    const transferSignature = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer
    const tokenSaleSignature = '0x90aec98c89b5bca872cabbd3a0ec4c5cf518ddc74bd95d2be9aa11cd1c7a504e'; // TokenSale
    const liquidityAddedSignature = '0x34359808d7cae5190a0210f503740b3c972007d472ece519909e81c2bfd799e6'; // LiquidityAdded
    
    // Focus on key events only
    for (const log of receipt.logs) {
      if (log.topics[0] === transferSignature && log.topics.length >= 3) {
        // Convert hex topic to address format
        const from = '0x' + log.topics[1].slice(26);
        const to = '0x' + log.topics[2].slice(26);
        
        // Check if this is a token creation transfer (from null address)
        if (from === '0x0000000000000000000000000000000000000000') {
          if (!tokensByMethod['Transfer']) tokensByMethod['Transfer'] = [];
          tokensByMethod['Transfer'].push({
            token: log.address,
            from,
            to
          });
        }
      } 
      else if (log.topics[0] === tokenSaleSignature && log.topics.length >= 2) {
        const token = '0x' + log.topics[1].slice(26);
        if (!tokensByMethod['TokenSale']) tokensByMethod['TokenSale'] = [];
        tokensByMethod['TokenSale'].push({
          token
        });
      } 
      else if (log.topics[0] === liquidityAddedSignature && log.topics.length >= 2) {
        const token = '0x' + log.topics[1].slice(26);
        if (!tokensByMethod['LiquidityAdded']) tokensByMethod['LiquidityAdded'] = [];
        tokensByMethod['LiquidityAdded'].push({
          token
        });
      }
    }
    
    // Print detected tokens by method
    console.log('\n=== Detected Tokens By Event Type ===');
    for (const [method, tokens] of Object.entries(tokensByMethod)) {
      console.log(`\n${method} Events (${tokens.length}):`);
      tokens.forEach((t, i) => {
        console.log(`  ${i + 1}. Token: ${t.token}`);
        if (t.from) console.log(`     From: ${t.from}`);
        if (t.to) console.log(`     To: ${t.to}`);
      });
    }
    
    // List all unique addresses involved in the transaction
    const addresses = new Set();
    receipt.logs.forEach(log => {
      addresses.add(log.address.toLowerCase());
      
      // Also add addresses from topics if they look like addresses
      log.topics.forEach(topic => {
        if (topic.length === 66) { // Potential address in topic
          const potential = '0x' + topic.slice(26).toLowerCase();
          if (potential !== '0x0000000000000000000000000000000000000000') {
            addresses.add(potential);
          }
        }
      });
    });
    
    console.log('\n=== All Contract Addresses Involved ===');
    [...addresses].forEach((addr, i) => {
      console.log(`  ${i + 1}. ${addr}`);
    });
    
    console.log('\n=== Summary ===');
    console.log('Based on this transaction analysis, we should focus on:');
    console.log('1. Transfer events from null address');
    if (tokensByMethod['TokenSale']) console.log('2. TokenSale events');
    if (tokensByMethod['LiquidityAdded']) console.log('3. LiquidityAdded events');
    
  } catch (error) {
    console.error('Error inspecting transaction:', error);
    console.error('Error details:', error.message);
  }
}

// Run the analysis
inspectTokenCreationTx(); 