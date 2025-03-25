import { parseAbi } from 'viem';
import { clientHttp as client } from '../clients/client.js';

// Basic token ABI for getting information
const tokenABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)'
]);

// Cache token info to avoid duplicate requests
const tokenInfoCache = new Map();

/**
 * Gets basic token information like name, symbol, decimals, and total supply
 * Implements caching to avoid repeated requests for the same token
 * 
 * @param {string} tokenAddress - The token contract address
 * @returns {Object} Token information
 */
export async function getBasicTokenInfo(tokenAddress) {
  // Normalize address
  const normalizedAddress = tokenAddress.toLowerCase();
  
  // Check cache first
  if (tokenInfoCache.has(normalizedAddress)) {
    return tokenInfoCache.get(normalizedAddress);
  }
  
  try {
    // Use Promise.all for parallel requests
    const [name, symbol, decimals, totalSupply] = await Promise.all([
      client.readContract({
        address: tokenAddress,
        abi: tokenABI,
        functionName: 'name'
      }),
      client.readContract({
        address: tokenAddress,
        abi: tokenABI,
        functionName: 'symbol'
      }),
      client.readContract({
        address: tokenAddress,
        abi: tokenABI,
        functionName: 'decimals'
      }),
      client.readContract({
        address: tokenAddress,
        abi: tokenABI,
        functionName: 'totalSupply'
      })
    ]);

    const tokenInfo = { 
      address: normalizedAddress,
      name, 
      symbol, 
      decimals, 
      totalSupply,
      fetchedAt: Date.now()
    };
    
    // Cache the result
    tokenInfoCache.set(normalizedAddress, tokenInfo);

    return tokenInfo;
  } catch (error) {
    throw new Error(`Error getting token info: ${error.message}`);
  }
}

/**
 * Clears the token info cache entirely or for a specific address
 * 
 * @param {string} [tokenAddress] - Optional specific token address to clear from cache
 */
export function clearTokenInfoCache(tokenAddress = null) {
  if (tokenAddress) {
    tokenInfoCache.delete(tokenAddress.toLowerCase());
  } else {
    tokenInfoCache.clear();
  }
}

/**
 * Gets token info for multiple tokens in parallel with batching
 * 
 * @param {Array<string>} tokenAddresses - Array of token addresses
 * @param {number} batchSize - Number of tokens to process in parallel
 * @returns {Object} Map of token addresses to token info
 */
export async function getMultipleTokenInfo(tokenAddresses, batchSize = 5) {
  const results = {};
  const uniqueAddresses = [...new Set(tokenAddresses.map(addr => addr.toLowerCase()))];
  
  // Process in batches to avoid too many concurrent requests
  for (let i = 0; i < uniqueAddresses.length; i += batchSize) {
    const batch = uniqueAddresses.slice(i, i + batchSize);
    const promises = batch.map(address => 
      getBasicTokenInfo(address)
        .then(info => { results[address] = info; })
        .catch(err => { results[address] = { error: err.message }; })
    );
    
    await Promise.all(promises);
  }
  
  return results;
} 