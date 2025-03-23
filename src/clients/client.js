import 'dotenv/config';
import { createPublicClient, http, webSocket } from 'viem';
import { mainnet } from 'viem/chains';
import { bsc } from 'viem/chains';

const config = {
  chain: bsc,
  batch: {
    multicall: true,
  },
};

const clientHttp = createPublicClient({
  ...config,
  transport: http(
    `${process.env.ALCHEMY_PROVIDER_URL_BSC}${process.env.ALCHEMY_API_KEY}`
  ),
});

const clientWebsocket = createPublicClient({
  ...config,
  transport: webSocket(
    `${process.env.ALCHEMY_PROVIDER_WS_URL_BSC}${process.env.ALCHEMY_API_KEY}`
  ),
});

export { clientHttp, clientWebsocket };
