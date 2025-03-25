/**
 * Utility functions for the Four.meme Token Tracker application
 */

/**
 * Custom JSON serializer that handles BigInt values
 * @param {Object} data - The data to stringify
 * @param {number} indent - Number of spaces to use for indentation (default: 2)
 * @returns {string} - The JSON string
 */
export function safeStringify(data, indent = 2) {
  return JSON.stringify(data, (key, value) => {
    // Convert BigInt to string
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, indent);
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
 * Format a value with appropriate decimal places
 * @param {string|number|BigInt} value - The value to format
 * @param {number} decimals - The number of decimals to use
 * @returns {string} - The formatted value
 */
export function formatValue(value, decimals = 18) {
  if (!value) return '0';
  
  // Convert to string if it's a BigInt
  const valueStr = typeof value === 'bigint' ? value.toString() : String(value);
  
  // If the value doesn't have enough digits, pad with zeros
  if (valueStr.length <= decimals) {
    return `0.${valueStr.padStart(decimals, '0')}`;
  }
  
  // Insert decimal point at the right position
  const integerPart = valueStr.slice(0, valueStr.length - decimals);
  const decimalPart = valueStr.slice(valueStr.length - decimals);
  
  return `${integerPart}.${decimalPart}`;
} 