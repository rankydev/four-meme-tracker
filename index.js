process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { clientHttp as client, clientWebsocket } from './src/clients/client.js';
import { parseAbiItem, parseAbi } from 'viem';

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

async function createFilter() {
    try {
      globalFilter = await client.createEventFilter();
      console.log('Created persistent event filter');
    } catch (error) {
      console.error(`Failed to create event filter: ${error.message}`);
      process.exit(1);
    }
  }

async function processBlock(blockNumber) {
    
    const block = await client.getBlock({ blockNumber });

    console.log(block);
}