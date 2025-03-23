import { clientHttp } from './clients/client.js';
import { parseAbi, toHex } from 'viem';

/**
 * ERC20 token interface for name, symbol, and decimals
 */
const erc20Abi = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
]);

/**
 * Fetch token data primarily using multicall with individual calls as fallbacks
 */
export async function getTokenData(tokenAddress) {
  console.log(`[DEBUG] Fetching token data for ${tokenAddress}`);
  
  let name = null;
  let symbol = null;
  let decimals = null;
  let success = false;
  let errors = [];
  
  // First approach: Try multicall (more efficient)
  try {
    console.log(`[DEBUG] Using multicall for ${tokenAddress}`);
    const [nameResult, symbolResult, decimalsResult] = await clientHttp.multicall({
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
        },
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }
      ],
      allowFailure: true,
    });

    // Process multicall results
    if (nameResult.status === 'success') {
      name = nameResult.result;
      console.log(`[DEBUG] Multicall got name: ${name}`);
      success = true;
    } else {
      console.error(`[DEBUG] Multicall name failed: ${nameResult.error?.message || 'unknown error'}`);
      errors.push({ field: 'name', error: nameResult.error?.message || 'unknown error', method: 'multicall' });
    }
    
    if (symbolResult.status === 'success') {
      symbol = symbolResult.result;
      console.log(`[DEBUG] Multicall got symbol: ${symbol}`);
      success = true;
    } else {
      console.error(`[DEBUG] Multicall symbol failed: ${symbolResult.error?.message || 'unknown error'}`);
      errors.push({ field: 'symbol', error: symbolResult.error?.message || 'unknown error', method: 'multicall' });
    }
    
    if (decimalsResult.status === 'success') {
      decimals = decimalsResult.result;
      console.log(`[DEBUG] Multicall got decimals: ${decimals}`);
    } else {
      console.error(`[DEBUG] Multicall decimals failed: ${decimalsResult.error?.message || 'unknown error'}`);
      errors.push({ field: 'decimals', error: decimalsResult.error?.message || 'unknown error', method: 'multicall' });
      // Default to 18 as most common
      decimals = 18;
    }
  } catch (multicallError) {
    console.error(`[DEBUG] Multicall error: ${multicallError.message}`);
    errors.push({ field: 'multicall', error: multicallError.message });
  }
  
  // Second approach: Try individual calls for any missing fields
  // Try to get name if still missing
  if (name === null) {
    try {
      console.log(`[DEBUG] Getting name for ${tokenAddress} with individual call`);
      name = await clientHttp.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'name'
      });
      console.log(`[DEBUG] Individual call got name: ${name}`);
      success = true;
    } catch (nameError) {
      console.error(`[DEBUG] Individual name error: ${nameError.message}`);
      errors.push({ field: 'name', error: nameError.message, method: 'individual' });
    }
  }
  
  // Try to get symbol if still missing
  if (symbol === null) {
    try {
      console.log(`[DEBUG] Getting symbol for ${tokenAddress} with individual call`);
      symbol = await clientHttp.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'symbol'
      });
      console.log(`[DEBUG] Individual call got symbol: ${symbol}`);
      success = true;
    } catch (symbolError) {
      console.error(`[DEBUG] Individual symbol error: ${symbolError.message}`);
      errors.push({ field: 'symbol', error: symbolError.message, method: 'individual' });
    }
  }
  
  // Try to get decimals if still missing
  if (decimals === null) {
    try {
      console.log(`[DEBUG] Getting decimals for ${tokenAddress} with individual call`);
      decimals = await clientHttp.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'decimals'
      });
      console.log(`[DEBUG] Individual call got decimals: ${decimals}`);
    } catch (decimalsError) {
      console.error(`[DEBUG] Individual decimals error: ${decimalsError.message}`);
      errors.push({ field: 'decimals', error: decimalsError.message, method: 'individual' });
      // Default to 18 as most common
      decimals = 18;
    }
  }

  return {
    address: tokenAddress,
    name,
    symbol,
    decimals: decimals !== null ? Number(decimals) : 18,
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
