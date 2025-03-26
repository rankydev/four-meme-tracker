/**
 * Utility functions for the Four.meme Token Tracker application
 */

import fs from 'fs';
import path from 'path';

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
 * Format a BigInt value with proper decimal places
 * @param {BigInt|string} value - Value to format
 * @param {number} decimals - Number of decimal places
 * @returns {string} - Formatted value
 */
export function formatValue(value, decimals = 18) {
  if (value === null || value === undefined) return '0';
  
  const valueStr = value.toString();
  
  // Handle zero separately
  if (valueStr === '0') return '0';
  
  // Ensure the value has at least decimals + 1 digits (for the case where value < 10^decimals)
  const paddedValue = valueStr.padStart(decimals + 1, '0');
  
  // Find the decimal point position
  const decimalPos = paddedValue.length - decimals;
  
  // Insert the decimal point
  const withDecimal = 
    paddedValue.slice(0, decimalPos) + 
    '.' + 
    paddedValue.slice(decimalPos);
  
  // Remove trailing zeros after decimal
  const trimmedDecimal = withDecimal.replace(/\.?0+$/, '');
  
  // If there are more than 6 decimal places, limit to 6
  const parts = trimmedDecimal.split('.');
  if (parts.length === 2 && parts[1].length > 6) {
    return `${parts[0]}.${parts[1].slice(0, 6)}`;
  }
  
  return trimmedDecimal;
} 