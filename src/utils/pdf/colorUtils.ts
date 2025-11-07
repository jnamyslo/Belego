/**
 * Color utilities for PDF generation
 */

export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface ColorConfiguration {
  primaryColor: RgbColor;
  secondaryColor: RgbColor;
  primaryRgb: RgbColor;
  secondaryRgb: RgbColor;
  darkText: string;
  grayText: string;
}

/**
 * Converts hex color to RGB values
 * @param hex - Hex color string (with or without #)
 * @returns RGB color object
 */
export function hexToRgb(hex: string | undefined | null): RgbColor {
  // Handle null, undefined, or empty string
  if (!hex || typeof hex !== 'string') {
    return { r: 37, g: 99, b: 235 }; // fallback to primary blue
  }
  
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 37, g: 99, b: 235 }; // fallback to primary blue
}

/**
 * Gets complete color configuration for PDF generation
 * @param primaryColor - Primary hex color
 * @param secondaryColor - Secondary hex color
 * @returns Color configuration object
 */
export function getColorConfiguration(primaryColor: string, secondaryColor: string): ColorConfiguration {
  return {
    primaryColor: hexToRgb(primaryColor),
    secondaryColor: hexToRgb(secondaryColor),
    primaryRgb: hexToRgb(primaryColor),
    secondaryRgb: hexToRgb(secondaryColor),
    darkText: '#1f2937',
    grayText: '#6b7280'
  };
}


