/**
 * Utility functions for handling blob and base64 conversions
 */

/**
 * Safely converts a Blob to base64 string without causing stack overflow
 * This method processes the data in chunks to avoid "Maximum call stack size exceeded" errors
 * that can occur with large files when using the spread operator approach.
 * 
 * @param blob - The Blob to convert
 * @returns Promise<string> - The base64 encoded string
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Convert to base64 safely without causing stack overflow
  let binaryString = '';
  const chunkSize = 8192; // Process in chunks to avoid stack overflow
  
  for (let i = 0; i < uint8Array.length; i += chunkSize) {
    const chunk = uint8Array.slice(i, i + chunkSize);
    binaryString += String.fromCharCode.apply(null, Array.from(chunk));
  }
  
  return btoa(binaryString);
}

/**
 * Converts a base64 string back into a Blob.
 * Counterpart to blobToBase64 — used for turning stored attachment content
 * (base64 in the database) back into a downloadable file.
 *
 * @param base64 - The base64 encoded content (without data URL prefix)
 * @param contentType - MIME type for the resulting Blob
 * @returns Blob
 */
export function base64ToBlob(base64: string, contentType = 'application/octet-stream'): Blob {
  const byteCharacters = atob(base64);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  return new Blob([new Uint8Array(byteNumbers)], { type: contentType });
}

/**
 * Alternative method using FileReader (can be slower but more memory efficient)
 *
 * @param blob - The Blob to convert
 * @returns Promise<string> - The base64 encoded string
 */
export function blobToBase64Alternative(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
