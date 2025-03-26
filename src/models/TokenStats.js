import mongoose from 'mongoose';

// Schema for trade information
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

// Schema for token information
const TokenStatsSchema = new mongoose.Schema({
  tokenAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true
  },
  name: String,
  symbol: String,
  totalSupply: {
    type: String,
    required: true
  },
  currentSupply: {
    type: String,
    required: true
  },
  creator: {
    type: String,
    required: true
  },
  mintRecipient: String,
  transactionHash: String,
  blockNumber: String,
  value: String,
  detectedAt: {
    type: Date,
    default: Date.now
  },
  dataErrors: [Object],
  devHolding: {
    amount: String,
    percentage: String,
    formattedAmount: String,
    error: String
  },
  mintLog: {
    from: String,
    to: String,
    value: String,
    logIndex: Number
  },
  fourMemeTransfer: {
    from: String,
    to: String,
    value: String,
    logIndex: Number
  },
  // Trade statistics
  trades: [TradeSchema],
  buyCount: {
    type: Number,
    default: 0
  },
  sellCount: {
    type: Number,
    default: 0
  },
  uniqueBuyersCount: {
    type: Number,
    default: 0
  },
  uniqueSellersCount: {
    type: Number,
    default: 0
  },
  uniqueBuyers: [String],
  uniqueSellers: [String],
  totalBuyVolume: {
    type: String,
    default: "0"
  },
  totalSellVolume: {
    type: String,
    default: "0"
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  }
});

// Create the model
const TokenStats = mongoose.model('TokenStats', TokenStatsSchema);

export default TokenStats; 