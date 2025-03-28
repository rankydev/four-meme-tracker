/**
 * Debug logging utility that only logs when DEBUG is enabled
 * @param {string} message - Message to log
 * @param {boolean} [force=false] - Whether to log even if DEBUG is disabled
 */
export function debugLog(message, force = false) {
  if (process.env.DEBUG || force) {
    console.log(`[DEBUG] ${message}`);
  }
}

/**
 * Error logging utility that always logs errors
 * @param {string} message - Error message to log
 * @param {Error} [error] - Optional error object to log
 */
export function errorLog(message, error) {
  console.error(`[ERROR] ${message}`);
  if (error) {
    console.error(error);
  }
} 