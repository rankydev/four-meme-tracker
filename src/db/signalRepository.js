// src/db/signalRepository.js
import { Signal } from '../models/Signal.js';

export async function saveSignal(tokenInfo, analysis) {
  try {
    const signal = new Signal({
      tokenAddress: tokenInfo.tokenAddress,
      name: tokenInfo.name,
      symbol: tokenInfo.symbol,
      creator: tokenInfo.creator,
      totalSupply: tokenInfo.totalSupply,
      creationBlock: tokenInfo.blockNumber,
      creationTxHash: tokenInfo.transactionHash,
      detectedAt: tokenInfo.detectedAt || new Date(),
      qualifiedAt: new Date(),
      metrics: {
        tradeCount: analysis.metrics.tradeCount,
        blocksWithActivity: analysis.metrics.blocksWithActivity,
        uniqueTraders: analysis.metrics.uniqueTraders,
        buyCount: tokenInfo.buyCount || 0,
        sellCount: tokenInfo.sellCount || 0,
        totalBuyVolume: tokenInfo.totalBuyVolume || "0",
        totalSellVolume: tokenInfo.totalSellVolume || "0"
      },
      trades: tokenInfo.trades || []
    });

    await signal.save();
    console.log(`Saved signal for token ${tokenInfo.tokenAddress}`);
    return signal;
  } catch (error) {
    console.error(`Error saving signal for token ${tokenInfo.tokenAddress}: ${error.message}`);
    throw error;
  }
}

export async function getSignal(tokenAddress) {
  try {
    return await Signal.findOne({ tokenAddress: tokenAddress.toLowerCase() });
  } catch (error) {
    console.error(`Error retrieving signal for token ${tokenAddress}: ${error.message}`);
    throw error;
  }
}

export async function getAllSignals() {
  try {
    return await Signal.find({}).sort({ qualifiedAt: -1 });
  } catch (error) {
    console.error('Error retrieving signals: ' + error.message);
    throw error;
  }
}