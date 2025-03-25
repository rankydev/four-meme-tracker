process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = 0;

import { parseAbi } from 'viem';
import { clientHttp as client } from './src/clients/client.js';

async function main() {
    // const logs = await client.getLogs({
    //     fromBlock: 47747265n,
    //     toBlock: 47747265n,
    //     includeTransactions: true,
    //     events: parseAbi([
    //         'event buy(address,uint256,uint256)'
    //     ])
    // })

    const receipt = await client.getTransactionReceipt({
        hash: '0x41786981a8ac027a966f8e7e60d2e2a197ddb0fa170d60494ff560964881159b'
    })

    console.log(receipt);
}

main();
