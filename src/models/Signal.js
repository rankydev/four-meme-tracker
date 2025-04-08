// src/db/models/Signal.js
import mongoose from 'mongoose';

const TradeSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['buy', 'sell'],
    required: true
  },
  amount: {
    type: String,
    required: true
  },
  formattedAmount: {
    type: String,
    required: true
  },
  buyer: String,
  seller: String,
  txHash: {
    type: String,
    required: true
  },
  blockNumber: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const SignalSchema = new mongoose.Schema({
  tokenAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  name: String,
  symbol: String,
  creator: String,
  totalSupply: String,
  creationBlock: String,
  creationTxHash: String,
  detectedAt: Date,
  qualifiedAt: Date,
  metrics: {
    tradeCount: Number,
    blocksWithActivity: Number,
    uniqueTraders: Number,
    buyCount: Number,
    sellCount: Number,
    totalBuyVolume: String,
    totalSellVolume: String
  },
  trades: [TradeSchema],
});

export const Signal = mongoose.model('Signal', SignalSchema);