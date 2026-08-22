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
 * Round a monetary amount to 2 decimals (cents).
 * Used so header totals can be derived from the sum of already-rounded parts
 * (avoids round-then-sum vs sum-then-round drift, BR-CO-14).
 * @param amount - Amount to round
 * @returns Amount rounded to 2 decimals
 */
export function roundToCents(amount: number): number {
  return Number(amount.toFixed(2));
}

/**
 * Map a country name to its ISO 3166-1 alpha-2 code.
 * Covers the countries the app commonly supports; defaults to 'DE'.
 * Already-valid 2-letter codes are passed through (upper-cased).
 * @param country - Country name (German or English) or ISO code
 * @returns ISO 3166-1 alpha-2 code
 */
export function getCountryCode(country?: string): string {
  if (!country) return 'DE';
  const key = country.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  const map: Record<string, string> = {
    'deutschland': 'DE',
    'germany': 'DE',
    'österreich': 'AT',
    'oesterreich': 'AT',
    'austria': 'AT',
    'schweiz': 'CH',
    'switzerland': 'CH',
    'frankreich': 'FR',
    'france': 'FR',
    'italien': 'IT',
    'italy': 'IT',
    'niederlande': 'NL',
    'netherlands': 'NL',
    'belgien': 'BE',
    'belgium': 'BE',
    'luxemburg': 'LU',
    'luxembourg': 'LU',
    'polen': 'PL',
    'poland': 'PL',
    'spanien': 'ES',
    'spain': 'ES',
    'dänemark': 'DK',
    'daenemark': 'DK',
    'denmark': 'DK',
    'tschechien': 'CZ',
    'czech republic': 'CZ',
  };
  return map[key] || 'DE';
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


