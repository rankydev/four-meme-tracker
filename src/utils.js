/**
 * Utility functions for the Four.meme Token Tracker application
 */

import fs from 'fs';
import path from 'path';
import { FOUR_MEME_ADDRESS, STANDARD_TOTAL_SUPPLY } from './config/index.js';
import { debugLog } from './utils/logging.js';

/**
 * Safe JSON stringify that handles BigInt values
 * @param {any} value - Value to stringify
 * @returns {string} - JSON string
 */
export function safeStringify(value) {
  return JSON.stringify(value, (_, v) => 
    typeof v === 'bigint' ? v.toString() : v
  );
}

/**
 * Format an address for display (shortens it for readability)
 * @param {string} address - The Ethereum address to format
 * @returns {string} - The formatted address (e.g., 0x1234...5678)
 */
export function formatAddress(address) {
  if (!address || address.length < 10) return address;
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
}

/**
 * Calculate dev holding based on the transfer from Four.meme back to the creator
 * @param {Object} params - Parameters object
 * @param {Array} params.txLogs - All transaction logs
 * @param {string} params.tokenAddress - The token contract address
 * @param {string} params.creatorAddress - The creator's address
 * @param {Function} params.logFunction - Function to use for logging
 * @returns {Object} - Object containing dev holding amount and percentage
 */
export function calculateDevHolding({
  txLogs,
  tokenAddress,
  creatorAddress,
  logFunction = console.log
}) {
  try {
    // Find the transfer from four.meme back to the creator
    const devTransfer = txLogs.find(log => 
      log.address.toLowerCase() === tokenAddress.toLowerCase() &&
      log.args.from?.toLowerCase() === FOUR_MEME_ADDRESS.toLowerCase() &&
      log.args.to?.toLowerCase() === creatorAddress.toLowerCase()
    );
    
    if (!devTransfer || !devTransfer.args.value) {
      debugLog(`No dev transfer found from ${FOUR_MEME_ADDRESS} to ${creatorAddress}`);
      return {
        amount: '0',
        percentage: '0',
        formattedAmount: '0'
      };
    }
    
    const amount = devTransfer.args.value.toString();
    // Calculate percentage (dev holding / total supply * 100)
    const devHoldingPercent = (Number(amount) / Number(STANDARD_TOTAL_SUPPLY)) * 100;
    
    return {
      amount,
      percentage: devHoldingPercent.toFixed(2),
      formattedAmount: formatValue(amount, 18) // Fixed 18 decimals for all tokens
    };
  } catch (error) {
    debugLog(`Error calculating dev holding: ${error.message}`);
    return {
      amount: '0',
      percentage: '0',
      formattedAmount: '0',
      error: error.message
    };
  }
}

/**
 * Format a numeric value with the specified number of decimals
 * @param {string|number|bigint} value - The value to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted value as a string
 */
export function formatValue(value, decimals = 18) {
  try {
    const bigValue = BigInt(value);
    const divisor = BigInt(10) ** BigInt(decimals);
    const integerPart = bigValue / divisor;
    const fractionalPart = bigValue % divisor;
    
    // Pad the fractional part with leading zeros if needed
    const paddedFractional = fractionalPart.toString().padStart(decimals, '0');
    
    // Trim trailing zeros from fractional part
    const trimmedFractional = paddedFractional.replace(/0+$/, '');
    
    // Only include decimal point if there's a fractional part
    return trimmedFractional ? `${integerPart}.${trimmedFractional}` : integerPart.toString();
  } catch (error) {
    console.error(`Error formatting value: ${error.message}`);
    return value.toString();
  }
} 