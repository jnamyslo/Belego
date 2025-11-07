/**
 * Image helper utilities for PDF generation
 */

/**
 * Load an image from a URL or data URL
 * @param src - Image source (URL or data URL)
 * @returns Promise that resolves with the loaded image
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    
    // Handle data URLs and regular URLs
    if (src.startsWith('data:')) {
      img.src = src;
    } else if (src.startsWith('blob:')) {
      img.src = src;
    } else {
      // Regular URL
      img.src = src;
    }
  });
}


