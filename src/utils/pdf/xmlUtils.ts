/**
 * Common XML utilities
 */

/**
 * Format a number as currency string for XML
 * @param amount - Amount to format
 * @returns Formatted amount string
 */
export function formatAmountForXML(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Escape XML special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
export function escapeXML(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


