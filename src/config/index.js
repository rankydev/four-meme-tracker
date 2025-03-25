/**
 * Configuration settings for the Four.meme tracker application
 */

// Contract addresses
export const FOUR_MEME_ADDRESS = '0x5c952063c7fc8610FFDB798152D69F0B9550762b';
export const WBNB_ADDRESS = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Event signatures
export const TRANSFER_EVENT_SIGNATURE = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const OWNERSHIP_TRANSFER_SIGNATURE = '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0';

// Well-known token addresses to exclude from analysis
export const EXCLUDE_TOKENS = [
  '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c', // WBNB
  '0x55d398326f99059ff775485246999027b3197955', // USDT
  '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', // USDC
  '0x2170ed0880ac9a755fd29b2688956bd959f933f8', // ETH
  '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c', // BTCB
  '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3', // DAI
  '0x7083609fce4d1d8dc0c979aab8c869ea2c873402'  // DOT
];

// Block watcher settings
export const BLOCK_CHECK_INTERVAL = 3000; // milliseconds

// Performance settings
export const MAX_PARALLEL_REQUESTS = 5;

// Token standards
export const STANDARD_TOTAL_SUPPLY = '1000000000000000000000000000'; // 1 billion with 18 decimals

// Analysis thresholds
export const MIN_FOUR_MEME_SCORE = 3; // Minimum score to consider a token related to Four.meme 