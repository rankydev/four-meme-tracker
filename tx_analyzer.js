process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp } from './src/clients/client.js';
import fs from 'fs';

// Helper function to safely serialize BigInt values
function replaceBigInt(key, value) {
  // Convert BigInt to string
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
}

// Function to fetch and analyze a transaction
async function analyzeTx(txHash) {
  console.log(`Analyzing transaction: ${txHash}`);
  
  try {
    // Fetch transaction receipt
    console.log('Fetching transaction receipt...');
    const receipt = await clientHttp.getTransactionReceipt({ hash: txHash });
    
    // Fetch transaction details
    console.log('Fetching transaction details...');
    const txDetails = await clientHttp.getTransaction({ hash: txHash });
    
    // Combine both for a complete picture
    const txData = {
      receipt,
      details: txDetails,
      analysis: {
        blockNumber: receipt.blockNumber,
        status: receipt.status === 'success' ? 'Success' : 'Failed',
        gasUsed: receipt.gasUsed.toString(),
        from: receipt.from,
        to: receipt.to,
        contractAddress: receipt.contractAddress,
        logCount: receipt.logs.length,
        timestamp: new Date().toISOString() // When we analyzed it
      }
    };
    
    // Save to a file - using replaceBigInt to handle BigInt values
    const filename = `./logs/tx_analysis_${txHash}.json`;
    fs.writeFileSync(filename, JSON.stringify(txData, replaceBigInt, 2));
    console.log(`Transaction data saved to ${filename}`);
    
    // Print a quick summary
    console.log('\nTransaction Summary:');
    console.log(`Status: ${txData.analysis.status}`);
    console.log(`From: ${txData.analysis.from}`);
    console.log(`To: ${txData.analysis.to}`);
    console.log(`Block: ${txData.analysis.blockNumber}`);
    console.log(`Logs: ${txData.analysis.logCount}`);
    
    return txData;
  } catch (error) {
    console.error('Error analyzing transaction:', error);
    throw error;
  }
}

// Run the analysis with your transaction hash
const txHash = '0x41786981a8ac027a966f8e7e60d2e2a197ddb0fa170d60494ff560964881159b'; // Replace with your sell transaction hash
analyzeTx(txHash)
  .then(data => {
    console.log('Analysis complete!');
    
    // Look for Transfer events which are common in token sales
    const transferEvents = data.receipt.logs.filter(log => 
      log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' // Transfer event topic
    );
    
    if (transferEvents.length > 0) {
      console.log(`\nFound ${transferEvents.length} Transfer events in this transaction`);
    }
    
    // Look for Swap events from DEX pools
    const swapEvents = data.receipt.logs.filter(log => 
      log.topics[0] === '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822' // Swap event topic
    );
    
    if (swapEvents.length > 0) {
      console.log(`Found ${swapEvents.length} Swap events (common in DEX transactions)`);
    }
  })
  .catch(console.error); 