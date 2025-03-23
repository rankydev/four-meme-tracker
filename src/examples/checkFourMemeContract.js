import { clientHttp } from '../clients/client.js';

// Four.meme contract address on BSC
const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';

/**
 * Check if the four.meme contract address is valid and get recent transactions
 */
async function checkContract() {
  try {
    console.log('Verifying four.meme contract address...');
    console.log('Contract address:', FOUR_MEME_ADDRESS);
    
    // Get contract code to verify it's a contract
    console.log('Checking if address is a valid contract...');
    const code = await clientHttp.getBytecode({
      address: FOUR_MEME_ADDRESS,
    });
    
    if (!code || code === '0x') {
      console.error('⚠️ ERROR: Address is not a contract or does not exist!');
      console.error('Please verify the contract address is correct.');
      return;
    }
    
    console.log('✅ Address is a valid contract');
    
    // Get contract balance
    console.log('Checking contract BNB balance...');
    const balance = await clientHttp.getBalance({
      address: FOUR_MEME_ADDRESS,
    });
    console.log(`Contract balance: ${balance} wei`);
    
    // Get recent transactions
    console.log('\nFetching recent block...');
    const blockNumber = await clientHttp.getBlockNumber();
    console.log(`Current block number: ${blockNumber}`);
    
    console.log('\nChecking recent transactions to/from this contract...');
    const recentBlock = await clientHttp.getBlock({
      blockNumber: blockNumber - BigInt(1),
      includeTransactions: true,
    });
    
    const contractTxs = recentBlock.transactions.filter(tx => 
      tx.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() || 
      tx.from.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
    );
    
    console.log(`Found ${contractTxs.length} transactions for this contract in block ${blockNumber - BigInt(1)}`);
    
    if (contractTxs.length > 0) {
      console.log('\nMost recent transactions:');
      contractTxs.slice(0, 3).forEach((tx, i) => {
        console.log(`${i + 1}. TX Hash: ${tx.hash}`);
        console.log(`   From: ${tx.from}`);
        console.log(`   To: ${tx.to}`);
        console.log(`   Value: ${tx.value}`);
        console.log('---');
      });
    } else {
      console.log('No transactions found in the most recent block.');
      console.log('Checking a few more blocks...');
      
      let foundAnyTx = false;
      
      // Check a few more blocks for transactions
      for (let i = 2; i <= 5; i++) {
        const olderBlock = await clientHttp.getBlock({
          blockNumber: blockNumber - BigInt(i),
          includeTransactions: true,
        });
        
        const olderTxs = olderBlock.transactions.filter(tx => 
          tx.to?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() || 
          tx.from.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
        );
        
        if (olderTxs.length > 0) {
          console.log(`Found ${olderTxs.length} transactions in block ${blockNumber - BigInt(i)}`);
          console.log(`TX Hash example: ${olderTxs[0].hash}`);
          foundAnyTx = true;
          break;
        }
      }
      
      if (!foundAnyTx) {
        console.log('No transactions found in the last 5 blocks.');
        console.log('The contract might be inactive or you might need to check a larger block range.');
      }
    }
    
    console.log('\nSuggested next steps:');
    console.log('1. If the contract is valid, try monitoring for a longer period');
    console.log('2. Check if four.meme is still active (visit their website/social media)');
    console.log('3. Try looking at BSCScan for recent token creation transactions');
    console.log('4. Consider using different event filters if the current one isn\'t detecting tokens');
    
  } catch (error) {
    console.error('Error verifying contract:', error);
    console.error('Error details:', error.message);
  }
}

checkContract(); 