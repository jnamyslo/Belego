/**
 * UUID generator that works across all browsers including older Safari versions
 */

// Polyfill for crypto.randomUUID() that works on all platforms
import logger from './logger';

export function generateUUID(): string {
  // Check if crypto.randomUUID is available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    try {
      return crypto.randomUUID();
    } catch (error) {
      logger.warn('crypto.randomUUID failed, falling back to manual generation:', error);
    }
  }
  
  // Fallback for browsers that don't support crypto.randomUUID (like older Safari)
  return generateUUIDFallback();
}

function generateUUIDFallback(): string {
  // Use crypto.getRandomValues if available, otherwise use Math.random
  const getRandomValues = () => {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const array = new Uint8Array(16);
      crypto.getRandomValues(array);
      return array;
    } else {
      // Fallback to Math.random for very old browsers
      const array = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    }
  };

  const randomBytes = getRandomValues();
  
  // Set version (4) and variant bits according to RFC 4122
  randomBytes[6] = (randomBytes[6] & 0x0f) | 0x40; // Version 4
  randomBytes[8] = (randomBytes[8] & 0x3f) | 0x80; // Variant 10

  // Convert to hex string with proper formatting
  const hex = Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  // Format as UUID: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  return [
    hex.substring(0, 8),
    hex.substring(8, 12),
    hex.substring(12, 16),
    hex.substring(16, 20),
    hex.substring(20, 32)
  ].join('-');
}
