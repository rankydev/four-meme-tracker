import { clientHttp } from './clients/client.js';
import { parseAbi, toHex } from 'viem';

/**
 * ERC20 token interface for name and symbol
 */
const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)'
]);

// Flag to enable or disable debug logging
const DEBUG = false;

/**
 * Debug logger that only logs if DEBUG is true
 */
function debugLog(message) {
  if (DEBUG) {
    console.log(`[DEBUG] ${message}`);
  }
}

/**
 * Fetch token data primarily using multicall with individual calls as fallbacks
 */
export async function getTokenData(tokenAddress) {
  debugLog(`Fetching token data for ${tokenAddress}`);
  
  let name = null;
  let symbol = null;
  let success = false;
  let errors = [];
  
  // First approach: Try multicall (more efficient)
  try {
    debugLog(`Using multicall for ${tokenAddress}`);
    const [nameResult, symbolResult] = await clientHttp.multicall({
      contracts: [
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'name',
        },
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'symbol',
        }
      ],
      allowFailure: true,
    });

    // Process multicall results
    if (nameResult.status === 'success') {
      name = nameResult.result;
      debugLog(`Multicall got name: ${name}`);
      success = true;
    } else {
      debugLog(`Multicall name failed: ${nameResult.error?.message || 'unknown error'}`);
      errors.push({ field: 'name', error: nameResult.error?.message || 'unknown error', method: 'multicall' });
    }
    
    if (symbolResult.status === 'success') {
      symbol = symbolResult.result;
      debugLog(`Multicall got symbol: ${symbol}`);
      success = true;
    } else {
      debugLog(`Multicall symbol failed: ${symbolResult.error?.message || 'unknown error'}`);
      errors.push({ field: 'symbol', error: symbolResult.error?.message || 'unknown error', method: 'multicall' });
    }
  } catch (multicallError) {
    debugLog(`Multicall error: ${multicallError.message}`);
    errors.push({ field: 'multicall', error: multicallError.message });
  }
  
  // Second approach: Try individual calls for any missing fields
  // Try to get name if still missing
  if (name === null) {
    try {
      debugLog(`Getting name for ${tokenAddress} with individual call`);
      name = await clientHttp.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'name'
      });
      debugLog(`Individual call got name: ${name}`);
      success = true;
    } catch (nameError) {
      debugLog(`Individual name error: ${nameError.message}`);
      errors.push({ field: 'name', error: nameError.message, method: 'individual' });
    }
  }
  
  // Try to get symbol if still missing
  if (symbol === null) {
    try {
      debugLog(`Getting symbol for ${tokenAddress} with individual call`);
      symbol = await clientHttp.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'symbol'
      });
      debugLog(`Individual call got symbol: ${symbol}`);
      success = true;
    } catch (symbolError) {
      debugLog(`Individual symbol error: ${symbolError.message}`);
      errors.push({ field: 'symbol', error: symbolError.message, method: 'individual' });
    }
  }

  return {
    address: tokenAddress,
    name,
    symbol,
    success,
    errors: errors.length > 0 ? errors : undefined
  };
}

/**
 * Helper function to check if an address is likely to be a token
 * based on whether it implements the ERC20 interface
 */
export async function isLikelyToken(tokenAddress) {
  try {
    const tokenData = await getTokenData(tokenAddress);
    return tokenData.success;
  } catch (error) {
    return false;
  }
}
