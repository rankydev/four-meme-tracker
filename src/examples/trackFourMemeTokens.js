import { trackNewTokenCreations, getRecentTokenCreations } from '../tracking/fourMemeTracker.js';

/**
 * Simple example showing how to track new token creations on four.meme
 */
async function main() {
  try {
    // First, get some recent token creations to see what's already been created
    console.log('Fetching recent token creations...');
    
    // Use a smaller block range for faster testing (1000 blocks instead of 5000)
    const blockRange = 1000;
    console.log(`Searching the last ${blockRange} blocks for token creations...`);
    
    const recentTokens = await getRecentTokenCreations(blockRange);
    
    console.log(`Found ${recentTokens.length} recent token creations:`);
    recentTokens.slice(0, 5).forEach((token, index) => {
      console.log(`${index + 1}. Token at ${token.tokenAddress} (TX: ${token.transactionHash})`);
    });
    
    if (recentTokens.length > 5) {
      console.log(`...and ${recentTokens.length - 5} more`);
    }
    
    if (recentTokens.length === 0) {
      console.log('\nNo tokens found in recent blocks. This could be because:');
      console.log('1. No new tokens were created on four.meme in this block range');
      console.log('2. The four.meme contract address might be incorrect');
      console.log('3. There might be an issue with the RPC connection');
      console.log('\nTrying real-time tracking anyway...');
    }
    
    // Now start tracking new token creations in real-time
    console.log('\nStarting real-time tracking of new four.meme token creations...');
    console.log('Contract address being monitored:', '0x5c952063c7fc8610ffdb798152d69f0b9550762b');
    
    const unwatch = await trackNewTokenCreations((tokenInfo) => {
      // This callback will be called whenever a new token is created
      console.log('\n🚨 New token created:');
      console.log('- Address:', tokenInfo.tokenAddress);
      console.log('- Transaction:', tokenInfo.transactionHash);
      console.log('- Block:', tokenInfo.blockNumber.toString());
      console.log('- Time detected:', tokenInfo.timestamp);
      
      // You could add additional logic here, such as:
      // - Fetch token metadata (name, symbol)
      // - Store the token in a database
      // - Send a notification
      // - Automatically perform actions with the token
    });
    
    console.log('Watching for new tokens... (Press Ctrl+C to stop)');
    console.log('Note: You may not see any activity immediately if no new tokens are being created.');
    console.log('The script is still running and will detect new tokens as they are created.');
    
    // Keep the process running
    process.on('SIGINT', () => {
      console.log('Stopping token tracking...');
      unwatch();
      process.exit(0);
    });
    
  } catch (error) {
    console.error('Error in main process:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

main(); 