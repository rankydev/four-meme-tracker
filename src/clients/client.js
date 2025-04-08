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

const wsConfig = {
  ...config,
  keepAlive: { interval: 1_000 },
  reconnect: {
    attempts: 10,
    delay: 1_000,
    retryCount: 20,
  },
}

const clientHttp = createPublicClient({
  ...config,
  transport: http(
    `${process.env.ALCHEMY_PROVIDER_URL_BSC}${process.env.ALCHEMY_API_KEY}`
  ),
});

const clientWebsocket = createPublicClient({
  ...wsConfig,
  transport: webSocket(
    `${process.env.ALCHEMY_PROVIDER_WS_URL_BSC}${process.env.ALCHEMY_API_KEY}`
  ),
});

export { clientHttp, clientWebsocket };
