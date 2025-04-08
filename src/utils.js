/**
 * Utility functions for the Four.meme Token Tracker application
 */

import fs from 'fs';
import path from 'path';
import { FOUR_MEME_ADDRESS, STANDARD_TOTAL_SUPPLY } from './config/index.js';
// import { errorLog } from './utils/logging.js';
import { formatUnits } from 'viem';
import { parseAbi as viemParseAbi } from 'viem';

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
 * Format a numeric value with the appropriate number of decimals
 * 
 * @param {string|number|BigInt} value - The value to format
 * @param {number} decimals - Number of decimals to format with
 * @returns {string} - Formatted value as a string
 */
export function formatValue(value, decimals = 18) {
  if (!value) return '0';
  
  try {
    // Convert to string if not already
    const valueStr = value.toString();
    
    // Handle 0 case
    if (valueStr === '0') return '0';
    
    // Format using viem utility
    return formatUnits(BigInt(valueStr), decimals);
  } catch (error) {
    // errorLog(`Error formatting value ${value} with ${decimals} decimals: ${error.message}`);
    return '0';
  }
}

/**
 * Calculate the percentage of dev holdings
 * @param {string|BigInt} devHoldings - Developer holdings
 * @param {string|BigInt} totalSupply - Total supply
 * @returns {number} - Percentage of dev holdings
 */
export function calculateDevPercentage(devHoldings, totalSupply) {
  try {
    const devBigInt = BigInt(devHoldings.toString());
    const supplyBigInt = BigInt(totalSupply.toString());
    
    if (supplyBigInt === BigInt(0)) return 0;
    
    // Calculate percentage with precision
    const percentage = Number((devBigInt * BigInt(10000)) / supplyBigInt) / 100;
    return percentage;
  } catch (error) {
    // errorLog(`Error calculating dev percentage: ${error.message}`);
    return 0;
  }
}

/**
 * Calculate dev holdings for a token based on transaction logs
 * @param {Object} params - Parameters
 * @param {Array} params.txLogs - Transaction logs
 * @param {string} params.tokenAddress - Token address
 * @param {string} params.creatorAddress - Creator address
 * @param {Function} params.logFunction - Function for logging
 * @returns {string} - Dev holdings as a string
 */
export function calculateDevHolding({ txLogs, tokenAddress, creatorAddress, logFunction = null }) {
  if (!creatorAddress) return "0";
  
  try {
    // Find all transfers to/from creator in the logs
    let devHolding = BigInt(0);
    const lowerTokenAddress = tokenAddress.toLowerCase();
    const lowerCreatorAddress = creatorAddress.toLowerCase();
    
    // Find transfer events in the logs
    for (const log of txLogs) {
      if (log.address.toLowerCase() !== lowerTokenAddress) continue;
      
      // Check topics for Transfer event
      if (!log.topics || log.topics.length < 3 || 
          log.topics[0] !== '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef') {
        continue;
      }
      
      const fromAddress = `0x${log.topics[1].slice(26)}`.toLowerCase();
      const toAddress = `0x${log.topics[2].slice(26)}`.toLowerCase();
      const amount = BigInt(log.data);
      
      // Skip zero transfers
      if (amount === BigInt(0)) continue;
      
      // Receiving tokens (including mint)
      if (toAddress === lowerCreatorAddress) {
        devHolding += amount;
        // logFunction(`Creator received ${amount.toString()} tokens from ${fromAddress}`);
      }
      // Sending tokens
      else if (fromAddress === lowerCreatorAddress) {
        devHolding -= amount;
        // logFunction(`Creator sent ${amount.toString()} tokens to ${toAddress}`);
      }
    }
    
    return devHolding.toString();
  } catch (error) {
    // errorLog(`Error calculating dev holding: ${error.message}`);
    return "0";
  }
}

/**
 * Wait for a specified time
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>} - Promise that resolves after the wait
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Create a debounced function
 * @param {Function} func - Function to debounce
 * @param {number} wait - Milliseconds to wait
 * @returns {Function} - Debounced function
 */
export function debounce(func, wait) {
  let timeout;
  
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Get a short version of an address
 * @param {string} address - Full address
 * @returns {string} - Shortened address
 */
export function shortenAddress(address) {
  if (!address) return '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Parse ABI strings into viem format
 * 
 * @param {string|Array} abi - ABI as string or array of strings
 * @returns {Array} - Parsed ABI
 */
export function parseAbi(abi) {
  try {
    // If already in array format, assume it's ready for viem's parseAbi
    if (Array.isArray(abi)) {
      return abi;
    }
    
    // Let viem handle the parsing
    return viemParseAbi(abi);
  } catch (error) {
    // errorLog(`Error parsing ABI: ${error.message}`);
    return [];
  }
} 