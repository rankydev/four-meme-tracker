process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp } from './src/clients/client.js';
import fs from 'fs';

// Four.meme contract address on BSC (kept for reference)
const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610ffdb798152d69f0b9550762b';

/**
 * Fetches all logs from the latest block
 * and saves them to a JSON file for analysis
 */
async function fetchLatestLogs() {
  try {
    console.log('Fetching latest block number...');
    const latestBlock = await clientHttp.getBlockNumber();
    console.log(`Latest block: ${latestBlock}`);
    
    // Get all logs from the latest block (no address filter)
    console.log(`Fetching ALL logs from block ${latestBlock}...`);
    
    // Get all logs without address filtering
    const logs = await clientHttp.getLogs({
      fromBlock: latestBlock,
      toBlock: latestBlock
    });
    
    console.log(`Found ${logs.length} logs in block ${latestBlock}`);
    
    if (logs.length === 0) {
      console.log('No logs found in the latest block. Trying previous block...');
      
      // Try the previous block
      const previousBlock = latestBlock - BigInt(1);
      console.log(`Trying block ${previousBlock}...`);
      
      const moreLogs = await clientHttp.getLogs({
        fromBlock: previousBlock,
        toBlock: previousBlock
      });
      
      if (moreLogs.length > 0) {
        console.log(`Found ${moreLogs.length} logs in previous block ${previousBlock}`);
        saveLogsToFile(moreLogs, 'block_logs_previous.json');
        analyzeLogTopics(moreLogs);
        await fetchTransactionDetails(moreLogs);
      } else {
        console.log('No logs found in previous block either.');
      }
      return;
    }
    
    // Save logs to file
    saveLogsToFile(logs, 'block_logs_latest.json');
    
    // Analyze log topics to identify event types
    analyzeLogTopics(logs);
    
    // Fetch transaction details for a sample of logs
    await fetchTransactionDetails(logs);
    
  } catch (error) {
    console.error('Error fetching logs:', error);
  }
}

/**
 * Save logs to a JSON file
 */
function saveLogsToFile(logs, filename) {
  // Create a logs directory if it doesn't exist
  const logsDir = './logs';
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
  }
  
  const logsData = {
    fetchedAt: new Date().toISOString(),
    count: logs.length,
    logs: logs.map(log => ({
      ...log,
      // Convert BigInt values to strings for JSON serialization
      blockNumber: log.blockNumber.toString(),
      logIndex: log.logIndex,
      transactionIndex: log.transactionIndex
    }))
  };
  
  fs.writeFileSync(`${logsDir}/${filename}`, JSON.stringify(logsData, null, 2));
  console.log(`Saved logs to ${logsDir}/${filename}`);
}

/**
 * Analyze log topics to identify event types
 */
function analyzeLogTopics(logs) {
  // Group logs by contract address
  const addressGroups = {};
  
  logs.forEach(log => {
    const address = log.address.toLowerCase();
    if (!addressGroups[address]) {
      addressGroups[address] = [];
    }
    addressGroups[address].push(log);
  });
  
  console.log('\nContracts with events:');
  for (const [address, logsForAddress] of Object.entries(addressGroups)) {
    console.log(`\nContract: ${address} (${logsForAddress.length} logs)`);
    
    // Group by topic signature within this contract
    const topicGroups = {};
    logsForAddress.forEach(log => {
      const topicSignature = log.topics[0];
      if (!topicGroups[topicSignature]) {
        topicGroups[topicSignature] = [];
      }
      topicGroups[topicSignature].push(log);
    });
    
    console.log('Event signatures:');
    for (const [signature, logsWithSignature] of Object.entries(topicGroups)) {
      console.log(`- Signature: ${signature} (${logsWithSignature.length} logs)`);
      
      // Get a sample data length to understand event structure
      if (logsWithSignature.length > 0) {
        const sampleLog = logsWithSignature[0];
        console.log(`  Data length: ${sampleLog.data.length} bytes`);
        console.log(`  Topics count: ${sampleLog.topics.length}`);
      }
    }
  }
}

/**
 * Fetch transaction details for a sample of logs
 */
async function fetchTransactionDetails(logs) {
  if (logs.length === 0) return;
  
  // For a large number of logs, limit the number we process
  const MAX_TRANSACTIONS_TO_ANALYZE = 3;
  
  console.log('\nFetching transaction details for sample logs...');
  
  // Sort logs by block number (descending) then by log index (descending)
  const sortedLogs = [...logs].sort((a, b) => 
    Number(b.blockNumber) - Number(a.blockNumber) || 
    Number(b.logIndex) - Number(a.logIndex)
  );
  
  // Get a few sample logs from different transactions
  const sampleTransactions = new Set();
  sortedLogs.forEach(log => {
    if (sampleTransactions.size < MAX_TRANSACTIONS_TO_ANALYZE) {
      sampleTransactions.add(log.transactionHash);
    }
  });
  
  console.log(`Selected ${sampleTransactions.size} transactions for detailed analysis`);
  
  for (const txHash of sampleTransactions) {
    try {
      console.log(`\nAnalyzing transaction: ${txHash}`);
      
      // Get transaction receipt
      const receipt = await clientHttp.getTransactionReceipt({ hash: txHash });
      
      // Check for ERC20 Transfer events
      const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // ERC20 Transfer event topic
      const transferLogs = receipt.logs.filter(log => 
        log.topics[0] === transferTopic
      );
      
      console.log(`Found ${transferLogs.length} token transfer logs in transaction`);
      
      // Get transaction data
      const txData = await clientHttp.getTransaction({ hash: txHash });
      
      // Save transaction details to a separate file
      const txDetails = {
        transaction: {
          ...txData,
          value: txData.value.toString(),
          gasPrice: txData.gasPrice.toString(),
          gas: txData.gas.toString(),
        },
        receipt: {
          ...receipt,
          blockNumber: receipt.blockNumber.toString(),
          cumulativeGasUsed: receipt.cumulativeGasUsed.toString(),
          gasUsed: receipt.gasUsed.toString(),
          logs: receipt.logs.map(log => ({
            ...log,
            blockNumber: log.blockNumber.toString(),
            logIndex: log.logIndex,
            transactionIndex: log.transactionIndex
          }))
        }
      };
      
      // Save to file
      const logsDir = './logs';
      const filename = `transaction_${txHash}.json`;
      fs.writeFileSync(`${logsDir}/${filename}`, JSON.stringify(txDetails, null, 2));
      console.log(`Saved transaction details to ${logsDir}/${filename}`);
      
      // For Four.meme contract, provide more detail
      const fourMemeLogs = receipt.logs.filter(log => 
        log.address.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase()
      );
      
      if (fourMemeLogs.length > 0) {
        console.log(`\nFound ${fourMemeLogs.length} logs involving Four.meme contract`);
        console.log('These could be useful for analyzing token pricing mechanisms');
      }
      
    } catch (error) {
      console.error(`Error fetching transaction details for ${txHash}:`, error);
    }
  }
}

// Run the script
fetchLatestLogs().catch(console.error); 