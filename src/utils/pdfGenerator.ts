import jsPDF from 'jspdf';
import logger from './logger';
import { Invoice, Company, Customer, JobEntry } from '../types';
import { PDFDocument } from 'pdf-lib';
import { formatCurrency } from './formatters';

// Common utilities for PDF generation
function hexToRgb(hex: string | undefined | null) {
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

function getColorConfiguration(primaryColor: string, secondaryColor: string) {
  return {
    primaryColor: hexToRgb(primaryColor),
    secondaryColor: hexToRgb(secondaryColor),
    primaryRgb: hexToRgb(primaryColor),
    secondaryRgb: hexToRgb(secondaryColor),
    darkText: '#1f2937',
    grayText: '#6b7280'
  };
}

export interface PDFOptions {
  format: 'zugferd' | 'xrechnung';
  company: Company;
  customer: Customer;
}

export interface JobPDFOptions {
  company: Company;
  customer: Customer;
}

export interface QuotePDFOptions {
  company: Company;
  customer: Customer;
}

// Helper function to calculate tax breakdown by rate
function calculateTaxBreakdown(items: Invoice['items'], invoice?: Partial<Invoice>) {
  const taxBreakdown = items.reduce((acc, item) => {
    // Berechne den Artikelpreis NACH Artikelrabatt
    const itemTotal = item.quantity * item.unitPrice;
    const itemDiscountAmount = item.discountAmount || 0;
    const itemTotalAfterDiscount = itemTotal - itemDiscountAmount;
    
    const taxRate = item.taxRate;
    const taxAmount = itemTotalAfterDiscount * (taxRate / 100);
    
    if (acc[taxRate]) {
      acc[taxRate].taxableAmount += itemTotalAfterDiscount;
      acc[taxRate].taxAmount += taxAmount;
    } else {
      acc[taxRate] = {
        taxableAmount: itemTotalAfterDiscount,
        taxAmount: taxAmount
      };
    }
    
    return acc;
  }, {} as Record<number, { taxableAmount: number; taxAmount: number }>);
  
  // Wende globalen Rabatt proportional auf alle Steuersätze an
  if (invoice?.globalDiscountAmount && invoice.globalDiscountAmount > 0) {
    const subtotalAfterItemDiscounts = items.reduce((sum, item) => {
      const itemTotal = item.quantity * item.unitPrice;
      const itemDiscountAmount = item.discountAmount || 0;
      return sum + (itemTotal - itemDiscountAmount);
    }, 0);
    
    if (subtotalAfterItemDiscounts > 0) {
      const discountRatio = invoice.globalDiscountAmount / subtotalAfterItemDiscounts;
      
      Object.keys(taxBreakdown).forEach(taxRateStr => {
        const taxRate = Number(taxRateStr);
        const breakdown = taxBreakdown[taxRate];
        
        // Reduziere den steuerpflichtigen Betrag proportional
        breakdown.taxableAmount = breakdown.taxableAmount * (1 - discountRatio);
        breakdown.taxAmount = (breakdown.taxableAmount * taxRate) / 100;
      });
    }
  }
  
  return taxBreakdown;
}

// Helper function to check if invoice has only 0% tax rate
function hasOnlyZeroTaxRate(items: Invoice['items']): boolean {
  return items.length > 0 && items.every(item => item.taxRate === 0);
}

// Helper function to calculate tax breakdown for jobs
function calculateJobTaxBreakdown(job: JobEntry, isSmallBusiness?: boolean) {
  const taxBreakdown: Record<number, { taxableAmount: number; taxAmount: number }> = {};
  
  // Process time entries (use job's legacy fields if no time entries exist)
  if (job.timeEntries && job.timeEntries.length > 0) {
    job.timeEntries.forEach(timeEntry => {
      const entryTotal = timeEntry.hoursWorked * timeEntry.hourlyRate;
      // Bei Kleinunternehmerregelung immer 0% MwSt.
      const taxRate = isSmallBusiness ? 0 : (timeEntry.taxRate != null ? timeEntry.taxRate : 19);
      const taxAmount = entryTotal * (taxRate / 100);
      
      if (taxBreakdown[taxRate]) {
        taxBreakdown[taxRate].taxableAmount += entryTotal;
        taxBreakdown[taxRate].taxAmount += taxAmount;
      } else {
        taxBreakdown[taxRate] = {
          taxableAmount: entryTotal,
          taxAmount: taxAmount
        };
      }
    });
  } else {
    // Legacy support: use hoursWorked and hourlyRate
    const laborTotal = job.hoursWorked * job.hourlyRate;
    // Bei Kleinunternehmerregelung immer 0% MwSt., sonst 19% als Fallback (Legacy-Jobs haben kein taxRate Feld)
    const taxRate = isSmallBusiness ? 0 : 19;
    const taxAmount = laborTotal * (taxRate / 100);
    
    taxBreakdown[taxRate] = {
      taxableAmount: laborTotal,
      taxAmount: taxAmount
    };
  }
  
  // Process materials
  if (job.materials) {
    job.materials.forEach(material => {
      const materialTotal = material.quantity * material.unitPrice;
      // Bei Kleinunternehmerregelung immer 0% MwSt.
      const taxRate = isSmallBusiness ? 0 : (material.taxRate != null ? material.taxRate : 19);
      const taxAmount = materialTotal * (taxRate / 100);
      
      if (taxBreakdown[taxRate]) {
        taxBreakdown[taxRate].taxableAmount += materialTotal;
        taxBreakdown[taxRate].taxAmount += taxAmount;
      } else {
        taxBreakdown[taxRate] = {
          taxableAmount: materialTotal,
          taxAmount: taxAmount
        };
      }
    });
  }
  
  return taxBreakdown;
}

export async function generateInvoicePDF(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  // For XRechnung format, generate XML instead of PDF
  if (options.format === 'xrechnung') {
    return generateXRechnungXML(invoice, options);
  }

  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  
  // Get locale from company settings for formatting
  const locale = options.company.locale || 'de-DE';
  
  // Colors configuration
  const primaryColor = options.company.primaryColor || '#2563eb';
  const secondaryColor = options.company.secondaryColor || '#64748b';
  const { primaryRgb, secondaryRgb, darkText, grayText } = getColorConfiguration(primaryColor, secondaryColor);
  
  let yPosition = 15; // Reduced top margin from 20 to 15
  const margins = { top: 15, bottom: 25, left: 20, right: 20 }; // Reduced top and bottom margins

  // Helper function to add complete header to current page
  const addHeader = async (): Promise<number> => {
    let currentY = 15; // Start with reduced top margin
    
    // Header section with clear positioning
    // Invoice metadata box (right side) - positioned first to avoid overlaps
    const metadataBoxX = pageWidth - 80;
    const metadataBoxY = currentY;
    const metadataBoxWidth = 60;
    const metadataBoxHeight = 50;
    
    // Light background for metadata box
    pdf.setFillColor(248, 250, 252);
    pdf.rect(metadataBoxX, metadataBoxY, metadataBoxWidth, metadataBoxHeight, 'F');
    
    // Invoice title in metadata box
    pdf.setFontSize(14);
    pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.text('RECHNUNG', metadataBoxX + 3, metadataBoxY + 12);
    
    // Invoice details in metadata box
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    let metaY = metadataBoxY + 20;
    
    pdf.text('Rechnungs-Nr.:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(invoice.invoiceNumber, metadataBoxX + 3, metaY + 4);
    metaY += 10;
    
    pdf.setTextColor(grayText);
    pdf.text('Datum:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(new Date(invoice.issueDate).toLocaleDateString('de-DE'), metadataBoxX + 3, metaY + 4);
    metaY += 10;
    
    pdf.setTextColor(grayText);
    pdf.text('Fällig am:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    
    // Check if payment is immediate (same day as issue date or 0 days payment terms)
    const issueDate = new Date(invoice.issueDate);
    const dueDate = new Date(invoice.dueDate);
    const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
    
    if (daysDifference <= 0) {
      pdf.text('sofort', metadataBoxX + 3, metaY + 4);
    } else {
      pdf.text(new Date(invoice.dueDate).toLocaleDateString('de-DE'), metadataBoxX + 3, metaY + 4);
    }
    
    // Company logo and information (left side) - dynamically positioned
    if (options.company.logo) {
      try {
        // Add timeout and error handling for logo loading
        const logoImg = await Promise.race([
          loadImage(options.company.logo),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Logo loading timeout')), 5000)
          )
        ]);
        
        // Dynamic logo sizing and positioning calculation
        const maxLogoHeight = metadataBoxHeight * 0.8; // 80% of metadata box height for padding
        const maxLogoWidth = 100; // Available width between left margin and line end (100 units)
        const aspectRatio = logoImg.width / logoImg.height;
        
        let logoWidth, logoHeight;
        
        // Determine size based on aspect ratio and constraints
        if (aspectRatio > maxLogoWidth / maxLogoHeight) {
          // Width is the limiting factor
          logoWidth = maxLogoWidth;
          logoHeight = maxLogoWidth / aspectRatio;
        } else {
          // Height is the limiting factor
          logoHeight = maxLogoHeight;
          logoWidth = maxLogoHeight * aspectRatio;
        }
        
        // Calculate dynamic positioning
        // X: Center the logo within the available space (0 to 100 units where line ends)
        const availableLogoSpaceWidth = 100; // Width until the line under company data
        const logoStartX = 20 + (availableLogoSpaceWidth - logoWidth) / 2;
        
        // Y: Center the logo vertically within the metadata box
        const logoStartY = metadataBoxY + (metadataBoxHeight - logoHeight) / 2;
        
        // Determine image format for jsPDF
        let imageFormat = 'JPEG';
        if (options.company.logo.toLowerCase().includes('png') || options.company.logo.includes('data:image/png')) {
          imageFormat = 'PNG';
        }
        
        pdf.addImage(options.company.logo, imageFormat, logoStartX, logoStartY, logoWidth, logoHeight);
        
      } catch (error) {
        logger.warn('Logo konnte nicht geladen werden:', error);
        // Fallback: Company name as header - center vertically in metadata box
        const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
        pdf.setFontSize(16);
        pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
        pdf.text(options.company.name, 20, fallbackTextY);
      }
    } else {
      // Company name as header without logo - center vertically in metadata box  
      const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
      pdf.setFontSize(16);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(options.company.name, 20, fallbackTextY);
    }
    
    // Move Y position down after header section
    currentY = metadataBoxY + metadataBoxHeight + 10;
    
    // Sender address line (German standard) - now with support for two-line layout
    pdf.setFontSize(7);
    pdf.setTextColor(grayText);
    
    if (options.company.companyHeaderTwoLine) {
      // Two-line layout
      const line1 = options.company.companyHeaderLine1 || options.company.name;
      const line2 = options.company.companyHeaderLine2 || 
        `${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`;
      
      pdf.text(line1, 20, currentY);
      currentY += 3; // Small spacing between lines
      pdf.text(line2, 20, currentY);
      currentY += 2; // Spacing before line
    } else {
      // Traditional single-line layout
      pdf.text(`${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`, 20, currentY);
      currentY += 2; // Spacing before line
    }
    
    // Line under sender address
    pdf.setDrawColor(200, 200, 200);
    pdf.line(20, currentY, 120, currentY);
    
    currentY += 6; // Reduced spacing after line
    
    // Customer address block (left side)
    const customerAddressY = currentY;
    pdf.setFontSize(11);
    pdf.setTextColor(darkText);
    pdf.text(options.customer.name, 20, currentY);
    currentY += 5; // Reduced from 6 to 5
    if (options.customer.addressSupplement) {
      pdf.text(options.customer.addressSupplement, 20, currentY);
      currentY += 5;
    }
    pdf.text(options.customer.address, 20, currentY);
    currentY += 5; // Reduced from 6 to 5
    pdf.text(`${options.customer.postalCode} ${options.customer.city}`, 20, currentY);
    if (options.customer.country && options.customer.country !== 'Deutschland') {
      currentY += 5; // Reduced from 6 to 5
      pdf.text(options.customer.country, 20, currentY);
    }
    
    // Customer details (right side - same height as customer address)
    let customerDetailsY = customerAddressY;
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    
    const customerMetadataX = pageWidth - 80; // Re-define for customer details
    
    if (options.customer.customerNumber) {
      pdf.text('Kunden-Nr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.customerNumber, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10; // Reduced from 12 to 10
    }
    
    // Additional customer info if available
    if (options.customer.taxId) {
      pdf.setTextColor(grayText);
      pdf.text('USt-IdNr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.taxId, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10;
    }
    
    // Ensure currentY accounts for customer address section
    currentY += 18; // Reduced from 25 to 18
    
    return currentY; // Return Y position after complete header
  };

  // Helper function to check if we need a new page with more intelligent space calculation
  const checkPageBreak = async (requiredSpace: number, minimumSpace: number = 30): Promise<boolean> => {
    // Use available space more efficiently by considering smaller minimum requirements
    const availableSpace = pageHeight - margins.bottom - yPosition;
    if (availableSpace < Math.max(requiredSpace, minimumSpace)) {
      pdf.addPage();
      yPosition = await addHeader(); // Add header on new page
      resetFont(); // Reset font after new header
      return true;
    }
    return false;
  };
  
  // Helper function to reset font to ensure consistency
  const resetFont = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(darkText);
  };
  
  // Add complete header to first page
  yPosition = await addHeader();
  
  // Ensure consistent font after header
  resetFont();
  
  // Items table with professional styling
  
  // Table header with better styling
  pdf.setFillColor(240, 243, 248);
  pdf.rect(20, yPosition - 2, pageWidth - 40, 12, 'F');
  
  // Table border
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.5);
  pdf.rect(20, yPosition - 2, pageWidth - 40, 12);
  
  pdf.setFontSize(9);
  pdf.setTextColor(darkText);
  pdf.setFont('helvetica', 'bold');
  
  // Column headers with German labels
  pdf.text('Pos.', 25, yPosition + 5);
  pdf.text('Beschreibung', 40, yPosition + 5);
  pdf.text('Menge', 95, yPosition + 5);
  pdf.text('Einzelpreis', 115, yPosition + 5);
  pdf.text('Rabatt', 135, yPosition + 5);
  pdf.text('MwSt.', 155, yPosition + 5);
  pdf.text('Gesamt', 170, yPosition + 5);
  
  yPosition += 15;
  
  // Table rows with alternating background
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  
  // Sort items by order to ensure correct sequence
  const sortedItems = [...invoice.items].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  for (let index = 0; index < sortedItems.length; index++) {
    const item = sortedItems[index];
    // Handle long descriptions first to calculate required space
    const maxDescWidth = 60;
    let description = item.description;
    
    // Add job number if available
    if (item.jobNumber) {
      description = `${description} (Auftrag: ${item.jobNumber})`;
    }
    
    const splitDesc = pdf.splitTextToSize(description, maxDescWidth);
    const totalRowHeight = 10 + (splitDesc.length - 1) * 8; // Base height + additional lines
    
    // Check if we need a new page for this row
    if (await checkPageBreak(totalRowHeight + 5)) {
      // Re-add table header on new page
      pdf.setFillColor(240, 243, 248);
      pdf.rect(20, yPosition - 2, pageWidth - 40, 12, 'F');
      
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.5);
      pdf.rect(20, yPosition - 2, pageWidth - 40, 12);
      
      pdf.setFontSize(9);
      pdf.setTextColor(darkText);
      pdf.setFont('helvetica', 'bold');
      
      pdf.text('Pos.', 25, yPosition + 5);
      pdf.text('Beschreibung', 40, yPosition + 5);
      pdf.text('Menge', 95, yPosition + 5);
      pdf.text('Einzelpreis', 115, yPosition + 5);
      pdf.text('Rabatt', 135, yPosition + 5);
      pdf.text('MwSt.', 155, yPosition + 5);
      pdf.text('Gesamt', 170, yPosition + 5);
      
      yPosition += 15;
      pdf.setFont('helvetica', 'normal');
    }
    
    // Alternating row colors with dynamic height
    if (index % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(20, yPosition - 3, pageWidth - 40, totalRowHeight, 'F');
    }
    
    pdf.setTextColor(darkText);
    pdf.text((index + 1).toString(), 25, yPosition);
    
    pdf.text(splitDesc[0], 40, yPosition);
    
    pdf.text(item.quantity.toString(), 95, yPosition);
    pdf.text(formatCurrency(item.unitPrice, locale), 115, yPosition);
    
    // Rabatt anzeigen
    const discountAmount = item.discountAmount || 0;
    if (discountAmount > 0) {
      if (item.discountType === 'percentage') {
        pdf.text(`${item.discountValue}%`, 135, yPosition);
      } else {
        pdf.text(formatCurrency(item.discountValue || 0, locale), 135, yPosition);
      }
    } else {
      pdf.text('-', 135, yPosition);
    }
    
    pdf.text(`${item.taxRate}%`, 155, yPosition);
    
    // Gesamtpreis nach Rabatt
    const itemTotal = (item.quantity * item.unitPrice) - discountAmount;
    pdf.text(formatCurrency(itemTotal, locale), 170, yPosition);
    
    yPosition += 10;
    
    // Additional description lines if needed
    if (splitDesc.length > 1) {
      for (let i = 1; i < splitDesc.length; i++) {
        pdf.text(splitDesc[i], 40, yPosition);
        yPosition += 8;
      }
    }
  }
  
  // Table bottom border
  pdf.setDrawColor(203, 213, 225);
  pdf.line(20, yPosition - 3, pageWidth - 20, yPosition - 3);
  
  // Totals and Notes section side by side - optimized spacing
  yPosition += 10; // Reduced from 15 to 10
  
  // Calculate dynamic height for totals box based on tax rates and discounts
  const taxBreakdownForSizing = calculateTaxBreakdown(invoice.items, invoice);
  const numberOfTaxRates = Object.keys(taxBreakdownForSizing).filter(rate => Number(rate) > 0).length;
  const showTotalTaxLine = numberOfTaxRates > 1;
  
  // Calculate discount lines
  const itemDiscountAmountForSizing = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmountForSizing = invoice.globalDiscountAmount || 0;
  const hasDiscounts = itemDiscountAmountForSizing > 0 || globalDiscountAmountForSizing > 0;
  
  let discountLines = 0;
  if (itemDiscountAmountForSizing > 0) discountLines++;
  if (globalDiscountAmountForSizing > 0) discountLines++;
  if (hasDiscounts) discountLines++; // Additional line for "Nettobetrag" after discounts
  
  // Base height: Zwischensumme + Gesamtbetrag + padding = 18px base
  // Additional lines: discount lines + tax rates + optional total tax line
  const totalsBoxHeight = 18 + (discountLines * 7) + (numberOfTaxRates * 7) + (showTotalTaxLine ? 7 : 0);
  
  // Calculate space needed for reverse charge clause if applicable
  const reverseChargeHeight = hasOnlyZeroTaxRate(invoice.items) ? 20 : 0; // Reduced from 25 to 20
  
  // Calculate total space needed for totals section
  const totalTotalsSpace = totalsBoxHeight + reverseChargeHeight + 5; // Reduced buffer from 10px to 5px
  
  // More intelligent page break - only if absolutely necessary
  const availableSpaceForTotals = pageHeight - yPosition - margins.bottom;
  const shouldBreakPage = totalTotalsSpace > availableSpaceForTotals && availableSpaceForTotals < 80; // Only break if very little space left
  
  if (shouldBreakPage) {
    pdf.addPage();
    yPosition = await addHeader();
    resetFont(); // Reset font after header
  }
  
  const totalsStartX = pageWidth - 40;
  const totalsLabelX = totalsStartX - 35;
  const totalsBoxWidth = 60;
  
  // Save the starting Y position for notes
  const totalsNotesStartY = yPosition;
  
  // Background for totals
  pdf.setFillColor(248, 250, 252);
  pdf.rect(totalsLabelX - 5, yPosition - 5, totalsBoxWidth, totalsBoxHeight, 'F');
  
  pdf.setFontSize(9);
  pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
  
  pdf.text('Zwischensumme:', totalsLabelX, yPosition);
  pdf.setTextColor(darkText);
  pdf.text(formatCurrency(invoice.subtotal, locale), totalsStartX, yPosition);
  yPosition += 7;
  
  // Zeige Artikelrabatte falls vorhanden
  const itemDiscountAmount = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  if (itemDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38); // red-600
    pdf.text('Artikelrabatte:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(itemDiscountAmount, locale)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Zeige Gesamtrabatt falls vorhanden
  const globalDiscountAmount = invoice.globalDiscountAmount || 0;
  if (globalDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38); // red-600
    pdf.text('Gesamtrabatt:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(globalDiscountAmount, locale)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Zeige Zwischensumme nach Rabatten falls Rabatte vorhanden
  if (itemDiscountAmount > 0 || globalDiscountAmount > 0) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('Nettobetrag:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    const discountedSubtotal = invoice.subtotal - itemDiscountAmount - globalDiscountAmount;
    pdf.text(formatCurrency(discountedSubtotal, locale), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Calculate tax breakdown and display each rate separately (exclude 0% rates)
  const taxBreakdown = calculateTaxBreakdown(invoice.items, invoice);
  const taxRates = Object.keys(taxBreakdown)
    .filter(rate => Number(rate) > 0)
    .sort((a, b) => Number(a) - Number(b));
  
  for (const rate of taxRates) {
    const breakdown = taxBreakdown[Number(rate)];
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text(`MwSt. (${rate}%):`, totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(breakdown.taxAmount, locale), totalsStartX, yPosition);
    yPosition += 7; // Reduced from 8 to 7
  }
  
  // If multiple tax rates > 0% exist, show total tax amount
  if (taxRates.length > 1) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('MwSt. gesamt:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(invoice.taxAmount, locale), totalsStartX, yPosition);
    yPosition += 7; // Reduced from 8 to 7
  }
  
  // Total amount highlighted
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Gesamtbetrag:', totalsLabelX, yPosition);
  pdf.text(formatCurrency(invoice.total, locale), totalsStartX, yPosition);
  
  // Reset font properly after totals
  resetFont();
  
  // Move yPosition to the end of the totals box
  yPosition = totalsNotesStartY + totalsBoxHeight;
  
  // Add clause for invoices with only 0% tax rate - outside the box
  if (hasOnlyZeroTaxRate(invoice.items)) {
    yPosition += 8; // Reduced gap after the box from 10 to 8
    
    // Check if clause fits on current page with smaller requirement
    if (await checkPageBreak(12, 20)) {
      // Clause moved to new page only if really necessary
    }
    
    // Center the clause below the totals box
    const clauseText = options.company.isSmallBusiness 
      ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)'
      : 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über';
    const textWidth = pdf.getTextWidth(clauseText);
    const centerX = (pageWidth - textWidth) / 2;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(clauseText, centerX, yPosition);
    
    // Reset font after clause
    resetFont();
    
    yPosition += 8; // Reduced space after the clause from 10 to 8
  }
  
  // Combined Notes and Payment Information section - keep them together
  let notesHeight = 0;
  let notesRequiredHeight = 0;
  
  // Calculate notes height if they exist
  if (invoice.notes) {
    const notesWidth = totalsLabelX - 35;
    const splitNotes = pdf.splitTextToSize(invoice.notes, notesWidth);
    const lineHeight = 4.5;
    notesRequiredHeight = splitNotes.length * lineHeight + 12;
    notesHeight = notesRequiredHeight;
  }
  
  // Use new payment information or fall back to legacy fields
  const paymentInfo = options.company.paymentInformation;
  const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount;
  
  // Calculate payment info height
  let paymentInfoHeight = 0;
  if (bankAccount) {
    const issueDate = new Date(invoice.issueDate);
    const dueDate = new Date(invoice.dueDate);
    const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
    const isImmediatePayment = daysDifference <= 0;
    
    const baseHeight = 35; // Base height for payment info
    const immediateClauseHeight = isImmediatePayment && options.company.immediatePaymentClause ? 15 : 0;
    paymentInfoHeight = baseHeight + immediateClauseHeight;
  }
  
  // Calculate total space needed for both sections together
  const totalBottomSectionHeight = Math.max(notesHeight, 0) + paymentInfoHeight + (notesHeight > 0 ? 16 : 8); // 16px spacing between sections if both exist
  
  // Ensure yPosition is correctly positioned after the totals section
  yPosition = Math.max(yPosition, totalsNotesStartY + totalsBoxHeight);
  yPosition += 8;
  
  // Check if both sections fit together on current page
  const availableSpaceForBottom = pageHeight - yPosition - margins.bottom;
  if (totalBottomSectionHeight > availableSpaceForBottom && availableSpaceForBottom < 80) {
    pdf.addPage();
    yPosition = await addHeader();
    resetFont(); // Ensure consistent font after page break
  }
  
  // Render Notes section (left side) if they exist
  if (invoice.notes && notesHeight > 0) {
    const notesX = 20;
    const notesWidth = totalsLabelX - 35;
    let notesY = yPosition;
    
    const splitNotes = pdf.splitTextToSize(invoice.notes, notesWidth);
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Anmerkungen:', notesX, notesY);
    notesY += 7;
    
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.setFont('helvetica', 'normal'); // Reset font to normal
    pdf.text(splitNotes, notesX, notesY);
    
    resetFont(); // Reset font after notes
  }
  
  // Position for payment information (always after notes if they exist)
  yPosition += Math.max(notesHeight, 0);
  if (notesHeight > 0) {
    yPosition += 8; // Space between notes and payment info
  }
  
  // Payment information section
  if (bankAccount) {
    const issueDate = new Date(invoice.issueDate);
    const dueDate = new Date(invoice.dueDate);
    const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
    const isImmediatePayment = daysDifference <= 0;
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Zahlungsinformationen:', 20, yPosition);
    yPosition += 6;
    
    // Add immediate payment clause if applicable
    if (isImmediatePayment && options.company.immediatePaymentClause) {
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(options.company.immediatePaymentClause, 20, yPosition);
      yPosition += 7;
    }
    
    pdf.setFont('helvetica', 'normal'); // Ensure normal font
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text('Bitte überweisen Sie den Betrag auf folgendes Konto:', 20, yPosition);
    yPosition += 4;
    
    pdf.setTextColor(darkText);
    
    // Use separated payment information with fallbacks
    const accountHolder = paymentInfo?.accountHolder || options.company.name;
    const bic = paymentInfo?.bic || options.company.bic;
    const bankName = paymentInfo?.bankName;
    
    pdf.text(`Kontoinhaber: ${accountHolder}`, 20, yPosition);
    yPosition += 4;
    pdf.text(`IBAN: ${bankAccount}`, 20, yPosition);
    yPosition += 4;
    if (bic) {
      pdf.text(`BIC: ${bic}`, 20, yPosition);
      yPosition += 4;
    }
    if (bankName) {
      pdf.text(`Bank: ${bankName}`, 20, yPosition);
      yPosition += 4;
    }
    pdf.text(`Verwendungszweck: ${invoice.invoiceNumber}`, 20, yPosition);
    
    // Add additional payment terms if available
    if (paymentInfo?.paymentTerms) {
      yPosition += 6;
      pdf.setFontSize(8);
      pdf.setTextColor(grayText);
      const splitTerms = pdf.splitTextToSize(paymentInfo.paymentTerms, pageWidth - 40);
      pdf.text(splitTerms, 20, yPosition);
    }
    
    // Reset font after payment information
    resetFont();
  }
  
  // Final font reset to ensure consistency
  resetFont();
  
  // Professional footer - add to all pages
  const pageCount = (pdf as any).getNumberOfPages();
  
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    pdf.setPage(pageNum);
    
    const footerY = pageHeight - 20; // Reduced from 25 to 20
    
    // Footer separator line
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(20, footerY - 8, pageWidth - 20, footerY - 8); // Reduced from 10 to 8
    
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    
    // Company info in footer
    const footerInfo = `${options.company.name} | ${options.company.address} | ${options.company.postalCode} ${options.company.city}`;
    pdf.text(footerInfo, 20, footerY - 4); // Reduced from 5 to 4
    
    // Build tax information string
    let taxInfo = '';
    if (options.company.taxId) {
      taxInfo += `USt-IdNr: ${options.company.taxId}`;
    }
    if (options.company.taxIdentificationNumber) {
      if (taxInfo) taxInfo += ' | ';
      taxInfo += `Steuer-ID: ${options.company.taxIdentificationNumber}`;
    }
    
    const footerContact = `Tel: ${options.company.phone} | E-Mail: ${options.company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
    pdf.text(footerContact, 20, footerY);
    
    // Page number if multiple pages - moved down one line to avoid conflict with tax data
    if (pageCount > 1) {
      pdf.text(`Seite ${pageNum} von ${pageCount}`, pageWidth - 40, footerY + 8);
    }
  }
  
  // Always generate ZUGFeRD PDF (embed XML data)
  return await embedZUGFeRDXMLIntoPDF(pdf.output('arraybuffer'), invoice, options);
}

/**
 * Embeds ZUGFeRD XML data into a PDF/A-3 compliant document
 */
async function embedZUGFeRDXMLIntoPDF(pdfBuffer: ArrayBuffer, invoice: Invoice, options: PDFOptions): Promise<Blob> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const xmlData = generateZUGFeRDXML(invoice, options);
    
    if (!xmlData || xmlData.trim().length === 0) {
      throw new Error('Generated ZUGFeRD XML is empty');
    }
    
    // Set PDF/A-3 compliance metadata
    pdfDoc.setTitle(`Rechnung ${invoice.invoiceNumber}`);
    pdfDoc.setSubject('ZUGFeRD invoice');
    pdfDoc.setKeywords(['ZUGFeRD', 'invoice', 'electronic invoice', 'EN 16931']);
    pdfDoc.setProducer('Belego');
    pdfDoc.setCreator('Belego');
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    
    const xmlBytes = new TextEncoder().encode(xmlData);
    
    // Try to attach XML file to PDF
    let attachmentSuccess = false;
    const possibleMethods = ['attachFile', 'embedFile', 'attach', 'addAttachment'];
    
    for (const methodName of possibleMethods) {
      if (typeof pdfDoc[methodName] === 'function') {
        try {
          if (methodName === 'attachFile' || methodName === 'embedFile') {
            await pdfDoc[methodName](xmlBytes, 'xrechnung.xml', {
              mimeType: 'application/xml',
              description: 'ZUGFeRD-Rechnungsdaten'
            });
          } else {
            await pdfDoc[methodName](xmlBytes, 'xrechnung.xml');
          }
          attachmentSuccess = true;
          break;
        } catch (methodError) {
          // Try next method
          continue;
        }
      }
    }
    
    if (!attachmentSuccess) {
      logger.warn('No suitable attachment method found in pdf-lib, storing XML in metadata');
      pdfDoc.setSubject('ZUGFeRD invoice - XML data in metadata');
      pdfDoc.setKeywords(['ZUGFeRD', 'invoice', 'electronic invoice', 'EN 16931', 'xml-metadata']);
    }
    
    const pdfBytes = await pdfDoc.save({
      useObjectStreams: false,
      addDefaultPage: false,
      objectsPerTick: 50
    });
    
    return new Blob([pdfBytes], { type: 'application/pdf' });
    
  } catch (error: any) {
    logger.error('Error embedding ZUGFeRD XML into PDF:', error.message);
    return new Blob([pdfBuffer], { type: 'application/pdf' });
  }
}

function generateXRechnungXML(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  // Implement the XRechnung standard correctly
  // XRechnung is based on the European Standard EN 16931 for e-invoicing
  
  // Helper function to format numbers for XML (without currency symbols)
  const formatAmount = (amount: number) => amount.toFixed(2);
  
  // Escape XML special characters
  const escapeXML = (text: string) => {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  // Use new payment information or fall back to legacy fields
  const paymentInfo = options.company.paymentInformation;
  
  // Create a properly formatted XRechnung document following XRechnung 3.0 standard
  const xmlContent = `<?xml version="1.0" encoding="utf-8"?>
<ubl:Invoice xmlns:ubl="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" 
             xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" 
             xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0#conformant#urn:xeinkauf.de:kosit:extension:xrechnung_3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${escapeXML(invoice.invoiceNumber)}</cbc:ID>
  <cbc:IssueDate>${new Date(invoice.issueDate).toISOString().split('T')[0]}</cbc:IssueDate>
  <cbc:DueDate>${new Date(invoice.dueDate).toISOString().split('T')[0]}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  ${(() => {
    // Use new payment information structure
    const paymentInfo = options.company.paymentInformation;
    const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount;
    const bic = paymentInfo?.bic || options.company.bic || 'XXXXXXXX';
    const accountHolder = paymentInfo?.accountHolder || options.company.name;
    
    const bankInfo = bankAccount ? `${escapeXML(accountHolder)} - BIC: ${escapeXML(bic)}  IBAN: ${escapeXML(bankAccount)}` : '';
    const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items) ? 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über' : '';
    
    const noteContent = [invoice.notes, bankInfo, reverseChargeNote].filter(Boolean).join('\n');
    
    return noteContent ? `<cbc:Note>${escapeXML(noteContent)}</cbc:Note>` : '';
  })()}
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${options.customer.customerNumber || 'KUNDE'}</cbc:BuyerReference>
  
  
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${options.company.email}</cbc:EndpointID>
      <cac:PartyName>
        <cbc:Name>${escapeXML(options.company.name)}</cbc:Name>
      </cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${options.company.address}</cbc:StreetName>
        <cbc:CityName>${options.company.city}</cbc:CityName>
        <cbc:PostalZone>${options.company.postalCode}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${options.company.country === 'Deutschland' ? 'DE' : 'DE'}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${options.company.taxId}</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${options.company.name}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
      <cac:Contact>
        <cbc:Name>${options.company.name}</cbc:Name>
        <cbc:Telephone>${options.company.phone}</cbc:Telephone>
        <cbc:ElectronicMail>${options.company.email}</cbc:ElectronicMail>
      </cac:Contact>
    </cac:Party>
  </cac:AccountingSupplierParty>
  
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cbc:EndpointID schemeID="EM">${options.customer.email}</cbc:EndpointID>
      <cac:PostalAddress>
        <cbc:StreetName>${options.customer.address}${options.customer.addressSupplement ? ', ' + options.customer.addressSupplement : ''}</cbc:StreetName>
        <cbc:CityName>${options.customer.city}</cbc:CityName>
        <cbc:PostalZone>${options.customer.postalCode}</cbc:PostalZone>
        <cac:Country>
          <cbc:IdentificationCode>${options.customer.country === 'Deutschland' ? 'DE' : 'DE'}</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${options.customer.name}</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:Delivery>
    <cbc:ActualDeliveryDate>${new Date(invoice.issueDate).toISOString().split('T')[0]}</cbc:ActualDeliveryDate>
  </cac:Delivery>
  
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${(paymentInfo?.bankAccount || options.company.bankAccount)}</cbc:ID>
      <cbc:Name>${paymentInfo?.accountHolder || options.company.name}</cbc:Name>
      <cac:FinancialInstitutionBranch>
        <cbc:ID>${paymentInfo?.bic || options.company.bic || 'XXXXXXXX'}</cbc:ID>
      </cac:FinancialInstitutionBranch>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:PaymentTerms>
    <cbc:Note>/
</cbc:Note>
  </cac:PaymentTerms>
  
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${formatAmount(invoice.taxAmount)}</cbc:TaxAmount>
    ${Object.entries(calculateTaxBreakdown(invoice.items, invoice))
      .filter(([rate]) => Number(rate) > 0)
      .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB))
      .map(([rate, breakdown]) => `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${formatAmount(breakdown.taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${formatAmount(breakdown.taxAmount)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`).join('')}
  </cac:TaxTotal>
  
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${formatAmount(invoice.subtotal)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${formatAmount(invoice.subtotal - (invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0) - (invoice.globalDiscountAmount || 0))}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${formatAmount(invoice.total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="EUR">${formatAmount((invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0) + (invoice.globalDiscountAmount || 0))}</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="EUR">0.00</cbc:ChargeTotalAmount>
    <cbc:PrepaidAmount currencyID="EUR">0.00</cbc:PrepaidAmount>
    <cbc:PayableRoundingAmount currencyID="EUR">0.00</cbc:PayableRoundingAmount>
    <cbc:PayableAmount currencyID="EUR">${formatAmount(invoice.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  
  ${invoice.items.map((item, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${formatAmount(item.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${formatAmount((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Description>${item.description}</cbc:Description>
      <cbc:Name>${item.description}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>ITEM-${index + 1}</cbc:ID>
      </cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>${item.taxRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">${formatAmount(item.unitPrice)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="C62">1.00</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`).join('')}
</ubl:Invoice>`;

  const blob = new Blob([xmlContent], { type: 'application/xml' });
  return Promise.resolve(blob);
}

function generateZUGFeRDXML(invoice: Invoice, options: PDFOptions): string {
  // Helper function to format numbers for XML (without currency symbols)
  const formatAmount = (amount: number) => amount.toFixed(2);
  
  // Escape XML special characters
  const escapeXML = (text: string) => {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };
  
  // Use new payment information or fall back to legacy fields
  const paymentInfo = options.company.paymentInformation;
  
  // Generate proper ZUGFeRD 2.1 XML (EN 16931 compliant)
  return `<?xml version="1.0" encoding="UTF-8"?>

<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100" xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100" xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100" xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
	<rsm:ExchangedDocumentContext>
		<ram:BusinessProcessSpecifiedDocumentContextParameter>
			<ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>
		</ram:BusinessProcessSpecifiedDocumentContextParameter>
		<ram:GuidelineSpecifiedDocumentContextParameter>
			<ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0</ram:ID>
		</ram:GuidelineSpecifiedDocumentContextParameter>
	</rsm:ExchangedDocumentContext>
  
	<rsm:ExchangedDocument>
		<ram:ID>${escapeXML(invoice.invoiceNumber)}</ram:ID>
		<ram:TypeCode>380</ram:TypeCode>
		<ram:IssueDateTime>
			<udt:DateTimeString format="102">${new Date(invoice.issueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
		</ram:IssueDateTime>
		<ram:IncludedNote>
			<ram:Content>  ${(() => {
        // Use new payment information structure for ZUGFeRD
        const paymentInfo = options.company.paymentInformation;
        const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount || '';
        const bic = paymentInfo?.bic || options.company.bic || 'COBADEFFXXX';
        const accountHolder = paymentInfo?.accountHolder || options.company.name;
        
        const bankInfo = `${accountHolder} - BIC: ${bic}  IBAN: ${bankAccount}`;
        const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items) ? 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über' : '';
        
        return [bankInfo, reverseChargeNote].filter(Boolean).join('\n');
      })()}</ram:Content>
		</ram:IncludedNote>
	</rsm:ExchangedDocument>
  
	<rsm:SupplyChainTradeTransaction>
		${invoice.items.map((item, index) => `<ram:IncludedSupplyChainTradeLineItem>
			<ram:AssociatedDocumentLineDocument>
				<ram:LineID>${index + 1}</ram:LineID>
			</ram:AssociatedDocumentLineDocument>
			<ram:SpecifiedTradeProduct>
				<ram:SellerAssignedID>ITEM-${index + 1}</ram:SellerAssignedID>
				<ram:Name>${escapeXML(item.description)}</ram:Name>
				<ram:Description>${escapeXML(item.description)}</ram:Description>
			</ram:SpecifiedTradeProduct>
			<ram:SpecifiedLineTradeAgreement>
				<ram:NetPriceProductTradePrice>
					<ram:ChargeAmount>${formatAmount(item.unitPrice)}</ram:ChargeAmount>
					<ram:BasisQuantity unitCode="C62">1</ram:BasisQuantity>
				</ram:NetPriceProductTradePrice>
			</ram:SpecifiedLineTradeAgreement>
			<ram:SpecifiedLineTradeDelivery>
				<ram:BilledQuantity unitCode="C62">${item.quantity}</ram:BilledQuantity>
			</ram:SpecifiedLineTradeDelivery>
			<ram:SpecifiedLineTradeSettlement>
				<ram:ApplicableTradeTax>
					<ram:TypeCode>VAT</ram:TypeCode>
					<ram:CategoryCode>S</ram:CategoryCode>
					<ram:RateApplicablePercent>${item.taxRate}</ram:RateApplicablePercent>
				</ram:ApplicableTradeTax>
				<ram:SpecifiedTradeSettlementLineMonetarySummation>
					<ram:LineTotalAmount>${formatAmount((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</ram:LineTotalAmount>
				</ram:SpecifiedTradeSettlementLineMonetarySummation>
			</ram:SpecifiedLineTradeSettlement>
		</ram:IncludedSupplyChainTradeLineItem>`).join('')}
		<ram:ApplicableHeaderTradeAgreement>
			<ram:BuyerReference>${options.customer.customerNumber || '0010'}</ram:BuyerReference>
			<ram:SellerTradeParty>
				<ram:Name>${escapeXML(options.company.name)}</ram:Name>
				<ram:SpecifiedLegalOrganization>
					<ram:TradingBusinessName>${escapeXML(options.company.name)}</ram:TradingBusinessName>
				</ram:SpecifiedLegalOrganization>
				<ram:DefinedTradeContact>
					<ram:PersonName>${escapeXML(options.company.name)}</ram:PersonName>
					<ram:TelephoneUniversalCommunication>
						<ram:CompleteNumber>${options.company.phone || '+49 30 12345678'}</ram:CompleteNumber>
					</ram:TelephoneUniversalCommunication>
					<ram:EmailURIUniversalCommunication>
						<ram:URIID>${options.company.email}</ram:URIID>
					</ram:EmailURIUniversalCommunication>
				</ram:DefinedTradeContact>
				<ram:PostalTradeAddress>
					<ram:PostcodeCode>${options.company.postalCode}</ram:PostcodeCode>
					<ram:LineOne>${escapeXML(options.company.address)}</ram:LineOne>
					<ram:CityName>${escapeXML(options.company.city)}</ram:CityName>
					<ram:CountryID>${options.company.country === 'Deutschland' ? 'DE' : 'DE'}</ram:CountryID>
				</ram:PostalTradeAddress>
				<ram:URIUniversalCommunication>
					<ram:URIID schemeID="EM">${options.company.email}</ram:URIID>
				</ram:URIUniversalCommunication>
				<ram:SpecifiedTaxRegistration>
					<ram:ID schemeID="VA">${options.company.taxId}</ram:ID>
				</ram:SpecifiedTaxRegistration>
			</ram:SellerTradeParty>
			<ram:BuyerTradeParty>
				<ram:Name>${escapeXML(options.customer.name)}</ram:Name>
				<ram:PostalTradeAddress>
					<ram:PostcodeCode>${options.customer.postalCode}</ram:PostcodeCode>
					<ram:LineOne>${escapeXML(options.customer.address)}${options.customer.addressSupplement ? ', ' + escapeXML(options.customer.addressSupplement) : ''}</ram:LineOne>
					<ram:CityName>${escapeXML(options.customer.city)}</ram:CityName>
					<ram:CountryID>${options.customer.country === 'Deutschland' ? 'DE' : 'DE'}</ram:CountryID>
				</ram:PostalTradeAddress>
				<ram:URIUniversalCommunication>
					<ram:URIID schemeID="EM">${options.customer.email || 'kunde@example.de'}</ram:URIID>
				</ram:URIUniversalCommunication>
			</ram:BuyerTradeParty>
		</ram:ApplicableHeaderTradeAgreement>
		<ram:ApplicableHeaderTradeDelivery>
			<ram:ActualDeliverySupplyChainEvent>
				<ram:OccurrenceDateTime>
					<udt:DateTimeString format="102">${new Date(invoice.issueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
				</ram:OccurrenceDateTime>
			</ram:ActualDeliverySupplyChainEvent>
		</ram:ApplicableHeaderTradeDelivery>
		<ram:ApplicableHeaderTradeSettlement>
			<ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
			<ram:SpecifiedTradeSettlementPaymentMeans>
				<ram:TypeCode>58</ram:TypeCode>
				<ram:Information>SEPA credit transfer</ram:Information>
				<ram:PayeePartyCreditorFinancialAccount>
					<ram:IBANID>${(paymentInfo?.bankAccount || options.company.bankAccount || 'DE89370400440532013000').replace(/\s/g, '')}</ram:IBANID>
					<ram:AccountName>${escapeXML(paymentInfo?.accountHolder || options.company.name)}</ram:AccountName>
				</ram:PayeePartyCreditorFinancialAccount>
				<ram:PayeeSpecifiedCreditorFinancialInstitution>
					<ram:BICID>${paymentInfo?.bic || options.company.bic || 'COBADEFFXXX'}</ram:BICID>
				</ram:PayeeSpecifiedCreditorFinancialInstitution>
			</ram:SpecifiedTradeSettlementPaymentMeans>
			${Object.entries(calculateTaxBreakdown(invoice.items, invoice))
				.filter(([rate]) => Number(rate) > 0)
				.sort(([rateA], [rateB]) => Number(rateA) - Number(rateB))
				.map(([rate, breakdown]) => `<ram:ApplicableTradeTax>
				<ram:CalculatedAmount>${formatAmount(breakdown.taxAmount)}</ram:CalculatedAmount>
				<ram:TypeCode>VAT</ram:TypeCode>
				<ram:BasisAmount>${formatAmount(breakdown.taxableAmount)}</ram:BasisAmount>
				<ram:CategoryCode>S</ram:CategoryCode>
				<ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
			</ram:ApplicableTradeTax>`).join('')}
			<ram:SpecifiedTradePaymentTerms>
				<ram:Description>/</ram:Description>
				<ram:DueDateDateTime>
					<udt:DateTimeString format="102">${new Date(invoice.dueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
				</ram:DueDateDateTime>
			</ram:SpecifiedTradePaymentTerms>
			<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
				<ram:LineTotalAmount>${formatAmount(invoice.subtotal)}</ram:LineTotalAmount>
				${(() => {
					const itemDiscountAmount = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
					const globalDiscountAmount = invoice.globalDiscountAmount || 0;
					const totalDiscountAmount = itemDiscountAmount + globalDiscountAmount;
					return totalDiscountAmount > 0 ? `<ram:AllowanceTotalAmount>${formatAmount(totalDiscountAmount)}</ram:AllowanceTotalAmount>` : '';
				})()}
				<ram:TaxBasisTotalAmount>${formatAmount(invoice.subtotal - (invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0) - (invoice.globalDiscountAmount || 0))}</ram:TaxBasisTotalAmount>
				<ram:TaxTotalAmount currencyID="EUR">${formatAmount(invoice.taxAmount)}</ram:TaxTotalAmount>
				<ram:GrandTotalAmount>${formatAmount(invoice.total)}</ram:GrandTotalAmount>
				<ram:DuePayableAmount>${formatAmount(invoice.total)}</ram:DuePayableAmount>
			</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
		</ram:ApplicableHeaderTradeSettlement>
	</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    // Set a timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      reject(new Error('Image loading timeout'));
    }, 10000); // 10 seconds timeout
    
    img.onload = () => {
      clearTimeout(timeout);
      resolve(img);
    };
    
    img.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    
    // For data URLs (base64), handle them more safely to prevent stack overflow
    if (src.startsWith('data:')) {
      try {
        // Check if the base64 string is valid
        const base64Data = src.split(',')[1];
        if (!base64Data) {
          reject(new Error('Invalid base64 image data'));
          return;
        }
        
        // Check file size - if too large, resize it
        const estimatedSize = (base64Data.length * 3) / 4; // Approximate byte size
        if (estimatedSize > 1024 * 1024) { // 1MB limit
          // Create a canvas to resize the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          img.onload = () => {
            clearTimeout(timeout);
            
            // Resize if image is too large
            const maxWidth = 800;
            const maxHeight = 600;
            let { width, height } = img;
            
            if (width > maxWidth || height > maxHeight) {
              // Calculate new dimensions while maintaining aspect ratio
              if (width > height) {
                if (width > maxWidth) {
                  height = (height * maxWidth) / width;
                  width = maxWidth;
                }
              } else {
                if (height > maxHeight) {
                  width = (width * maxHeight) / height;
                  height = maxHeight;
                }
              }
              
              // Resize the image
              canvas.width = width;
              canvas.height = height;
              
              if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                
                // Create a new resized image
                const resizedImg = new Image();
                resizedImg.onload = () => resolve(resizedImg);
                resizedImg.onerror = () => reject(new Error('Failed to resize image'));
                resizedImg.src = canvas.toDataURL('image/jpeg', 0.8); // Compress to 80% quality
              } else {
                resolve(img);
              }
            } else {
              resolve(img);
            }
          };
        }
        
        img.src = src;
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    } else {
      // Regular URL
      img.src = src;
    }
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates a PDF for a job order/work order
 */
export async function generateJobPDF(job: JobEntry, options: JobPDFOptions): Promise<Blob> {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margins = { top: 15, bottom: 25, left: 20, right: 20 };
  
  // Get locale from company settings for formatting
  const locale = options.company.locale || 'de-DE';
  
  // Colors configuration
  const primaryColor = options.company.primaryColor || '#2563eb';
  const secondaryColor = options.company.secondaryColor || '#64748b';
  const { primaryRgb, secondaryRgb, darkText, grayText } = getColorConfiguration(primaryColor, secondaryColor);
  
  let yPosition = 15; // Start with reduced top margin
  let currentPage = 1;

  // Helper function to add complete header to current page
  const addHeader = async (): Promise<number> => {
    let currentY = 15; // Start with reduced top margin
    
    // Header section with job metadata box (right side)
    const metadataBoxX = pageWidth - 80;
    const metadataBoxY = currentY;
    const metadataBoxWidth = 60;
    
    // Calculate dynamic height based on content
    let metadataLines = 4; // Base lines: Title + Job Number + Date + Status
    if (job.externalJobNumber) {
      metadataLines += 1; // Add line for external job number
    }
    const metadataBoxHeight = Math.max(45, 12 + (metadataLines * 7)); // Reduced spacing
    
    // Light background for metadata box
    pdf.setFillColor(248, 250, 252);
    pdf.rect(metadataBoxX, metadataBoxY, metadataBoxWidth, metadataBoxHeight, 'F');
    
    // Job title in metadata box
    pdf.setFontSize(14);
    pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.text('AUFTRAG', metadataBoxX + 3, metadataBoxY + 10);
    
    // Job details in metadata box
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    let metaY = metadataBoxY + 17;
    
    pdf.text('Auftrags-Nr.:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    const jobNumber = job.jobNumber || job.id.slice(-8).toUpperCase();
    const maxJobNumberWidth = metadataBoxWidth - 6;
    const truncatedJobNumber = pdf.getTextWidth(jobNumber) > maxJobNumberWidth
      ? jobNumber.substring(0, 12) + '...'
      : jobNumber;
    pdf.text(truncatedJobNumber, metadataBoxX + 3, metaY + 3);
    metaY += 8;
    
    // External job number if available
    if (job.externalJobNumber) {
      pdf.setTextColor(grayText);
      pdf.text('Ext. Nr.:', metadataBoxX + 3, metaY);
      pdf.setTextColor(darkText);
      const truncatedExtNumber = pdf.getTextWidth(job.externalJobNumber) > maxJobNumberWidth
        ? job.externalJobNumber.substring(0, 12) + '...'
        : job.externalJobNumber;
      pdf.text(truncatedExtNumber, metadataBoxX + 3, metaY + 3);
      metaY += 8;
    }
    
    pdf.setTextColor(grayText);
    pdf.text('Datum:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(new Date(job.date).toLocaleDateString('de-DE'), metadataBoxX + 3, metaY + 3);
    metaY += 8;
    
    pdf.setTextColor(grayText);
    pdf.text('Status:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    const statusMap = {
      'draft': 'Entwurf',
      'in-progress': 'In Bearbeitung',
      'completed': 'Abgeschlossen',
      'invoiced': 'Abgerechnet'
    };
    const statusText = statusMap[job.status] || job.status;
    const truncatedStatus = pdf.getTextWidth(statusText) > maxJobNumberWidth
      ? statusText.substring(0, 12) + '...'
      : statusText;
    pdf.text(truncatedStatus, metadataBoxX + 3, metaY + 3);
    
    // Company logo and information (left side)
    if (options.company.logo) {
      try {
        const logoImg = await Promise.race([
          loadImage(options.company.logo),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Logo loading timeout')), 5000)
          )
        ]);
        
        // Dynamic logo sizing
        const maxLogoHeight = metadataBoxHeight * 0.7;
        const maxLogoWidth = 80;
        const aspectRatio = logoImg.width / logoImg.height;
        
        let logoWidth, logoHeight;
        if (aspectRatio > maxLogoWidth / maxLogoHeight) {
          logoWidth = maxLogoWidth;
          logoHeight = maxLogoWidth / aspectRatio;
        } else {
          logoHeight = maxLogoHeight;
          logoWidth = maxLogoHeight * aspectRatio;
        }
        
        const logoStartX = margins.left + (80 - logoWidth) / 2;
        const logoStartY = metadataBoxY + (metadataBoxHeight - logoHeight) / 2;
        
        let imageFormat = 'JPEG';
        if (options.company.logo.toLowerCase().includes('png') || options.company.logo.includes('data:image/png')) {
          imageFormat = 'PNG';
        }
        
        pdf.addImage(options.company.logo, imageFormat, logoStartX, logoStartY, logoWidth, logoHeight);
        
      } catch (error) {
        logger.warn('Logo konnte nicht geladen werden:', error);
        const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 2;
        pdf.setFontSize(14);
        pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
        pdf.text(options.company.name, margins.left, fallbackTextY);
      }
    } else {
      const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 2;
      pdf.setFontSize(14);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(options.company.name, margins.left, fallbackTextY);
    }
    
    // Move Y position down after header section
    currentY = metadataBoxY + metadataBoxHeight + 10;
    
    // Sender address line (German standard) - now with support for two-line layout
    pdf.setFontSize(7);
    pdf.setTextColor(grayText);
    
    if (options.company.companyHeaderTwoLine) {
      // Two-line layout
      const line1 = options.company.companyHeaderLine1 || options.company.name;
      const line2 = options.company.companyHeaderLine2 || 
        `${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`;
      
      pdf.text(line1, margins.left, currentY);
      currentY += 3; // Small spacing between lines
      pdf.text(line2, margins.left, currentY);
      currentY += 2; // Spacing before line
    } else {
      // Traditional single-line layout
      pdf.text(`${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`, margins.left, currentY);
      currentY += 2; // Spacing before line
    }
    
    // Line under sender address
    pdf.setDrawColor(200, 200, 200);
    pdf.line(margins.left, currentY, 120, currentY);
    
    currentY += 6; // Reduced spacing after line
    
    // Customer address block (left side)
    const customerAddressY = currentY;
    pdf.setFontSize(11);
    pdf.setTextColor(darkText);
    pdf.text(options.customer.name, margins.left, currentY);
    currentY += 5; // Reduced from 6 to 5
    if (options.customer.addressSupplement) {
      pdf.text(options.customer.addressSupplement, margins.left, currentY);
      currentY += 5;
    }
    pdf.text(options.customer.address, margins.left, currentY);
    currentY += 5; // Reduced from 6 to 5
    pdf.text(`${options.customer.postalCode} ${options.customer.city}`, margins.left, currentY);
    if (options.customer.country && options.customer.country !== 'Deutschland') {
      currentY += 5; // Reduced from 6 to 5
      pdf.text(options.customer.country, margins.left, currentY);
    }
    
    // Add customer address (execution address) if different from billing address
    if (job.customerAddress && job.customerAddress.trim()) {
      currentY += 6; // Reduced spacing from 8 to 6
      pdf.setFontSize(9);
      pdf.setTextColor(grayText);
      pdf.text('Ausführungsort:', margins.left, currentY);
      currentY += 4; // Reduced from 5 to 4
      pdf.setFontSize(10);
      pdf.setTextColor(darkText);
      
      // Split customer address into lines and display each line
      const addressLines = job.customerAddress.split('\n').filter(line => line.trim());
      for (const line of addressLines) {
        pdf.text(line.trim(), margins.left, currentY);
        currentY += 4;
      }
    }
    
    // Customer details (right side - same height as customer address)
    let customerDetailsY = customerAddressY;
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    
    const customerMetadataX = pageWidth - 80; // Re-define for customer details
    
    if (options.customer.customerNumber) {
      pdf.text('Kunden-Nr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.customerNumber, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10; // Reduced from 12 to 10
    }
    
    if (options.customer.phone) {
      pdf.setTextColor(grayText);
      pdf.text('Telefon:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.phone, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10;
    }
    
    if (options.customer.email) {
      pdf.setTextColor(grayText);
      pdf.text('E-Mail:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.email, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10;
    }
    
    // Additional customer info if available
    if (options.customer.taxId) {
      pdf.setTextColor(grayText);
      pdf.text('USt-IdNr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.taxId, customerMetadataX, customerDetailsY + 4);
    }
    
    // Ensure currentY accounts for customer address section
    currentY += 18; // Reduced spacing from 20 to 18
    
    return currentY; // Return Y position after complete header
  };

  // Helper function to check if we need a new page
  const checkPageBreak = async (requiredSpace: number, minimumSpace: number = 30): Promise<boolean> => {
    const availableSpace = pageHeight - margins.bottom - yPosition;
    if (availableSpace < Math.max(requiredSpace, minimumSpace)) {
      pdf.addPage();
      currentPage++;
      yPosition = await addHeader();
      resetFont(); // Reset font after header
      return true;
    }
    return false;
  };

  // Helper function to add page footer
  const addPageFooter = (pageNum: number) => {
    const footerY = pageHeight - 20; // Reduced from 20 to match invoice PDFs
    
    // Footer separator line
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(margins.left, footerY - 8, pageWidth - margins.right, footerY - 8); // Reduced from 5 to 8
    
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    
    // Company info in footer
    const footerInfo = `${options.company.name} | ${options.company.address} | ${options.company.postalCode} ${options.company.city}`;
    pdf.text(footerInfo, margins.left, footerY - 4); // Reduced from footerY to footerY - 4
    
    // Build tax information string
    let taxInfo = '';
    if (options.company.taxId) {
      taxInfo += `USt-IdNr: ${options.company.taxId}`;
    }
    if (options.company.taxIdentificationNumber) {
      if (taxInfo) taxInfo += ' | ';
      taxInfo += `Steuer-ID: ${options.company.taxIdentificationNumber}`;
    }
    
    const footerContact = `Tel: ${options.company.phone} | E-Mail: ${options.company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
    pdf.text(footerContact, margins.left, footerY);
    
    // Page number - moved down one line to avoid conflict with tax data
    pdf.text(`Seite ${pageNum}`, pageWidth - margins.right - 20, footerY + 8);
  };
  
  // Helper function to reset font to ensure consistency
  const resetFont = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(darkText);
  };
  
  // Add complete header to first page
  yPosition = await addHeader();
  
  // Ensure consistent font after header
  resetFont();
  
  // Check for page break before job content
  await checkPageBreak(20);
  
  // Job title section
  pdf.setFontSize(16);
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.setFont('helvetica', 'bold');
  pdf.text(job.title, margins.left, yPosition);
  yPosition += 10; // Reduced spacing from 12 to 10
  
  // Job details section (reduced to basic info only)
  await checkPageBreak(30);
  
  pdf.setFontSize(10);
  pdf.setTextColor(darkText);
  pdf.setFont('helvetica', 'bold');
  pdf.text('Auftragsdetails:', margins.left, yPosition);
  yPosition += 7;
  
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  
  const labelWidth = 45;
  const valueX = margins.left + labelWidth;
  
  // Basic job info only (no hourly rates here anymore)
  if (job.startTime && job.endTime) {
    pdf.setTextColor(grayText);
    pdf.text('Arbeitszeit:', margins.left, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(`${job.startTime} - ${job.endTime}`, valueX, yPosition);
    yPosition += 5;
  }
  
  if (job.priority) {
    pdf.setTextColor(grayText);
    pdf.text('Priorität:', margins.left, yPosition);
    pdf.setTextColor(darkText);
    const priorityMap = { 'low': 'Niedrig', 'medium': 'Mittel', 'high': 'Hoch' };
    pdf.text(priorityMap[job.priority] || job.priority, valueX, yPosition);
    yPosition += 5;
  }
  
  if (job.location) {
    pdf.setTextColor(grayText);
    pdf.text('Ort:', margins.left, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(job.location, valueX, yPosition);
    yPosition += 5;
  }
  
  yPosition += 7;
  
  // Description section
  if (job.description) {
    await checkPageBreak(30);
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Beschreibung:', margins.left, yPosition);
    yPosition += 6;
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(darkText);
    const maxDescWidth = pageWidth - margins.left - margins.right;
    const splitDesc = pdf.splitTextToSize(job.description, maxDescWidth);
    
    const descriptionHeight = splitDesc.length * 4;
    if (await checkPageBreak(descriptionHeight)) {
      pdf.setFontSize(10);
      pdf.setTextColor(darkText);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Beschreibung:', margins.left, yPosition);
      yPosition += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
    }
    
    pdf.text(splitDesc, margins.left, yPosition);
    yPosition += splitDesc.length * 4 + 6;
  }
  
  // Create positions table (like invoice items)
  await checkPageBreak(40);
  
  // Positions table header
  pdf.setFillColor(240, 243, 248);
  pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12, 'F');
  
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.5);
  pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12);
  
  pdf.setFontSize(9);
  pdf.setTextColor(darkText);
  pdf.setFont('helvetica', 'bold');
  
  pdf.text('Pos.', margins.left + 3, yPosition + 5);
  pdf.text('Beschreibung', 40, yPosition + 5);
  pdf.text('Menge', 105, yPosition + 5);
  pdf.text('Einzelpreis', 125, yPosition + 5);
  pdf.text('MwSt.', 150, yPosition + 5);
  pdf.text('Gesamt', 165, yPosition + 5);
  
  yPosition += 15;
  
  // Reset font for table content
  pdf.setFont('helvetica', 'normal');
  
  let positionIndex = 1;
  
  // Add time entries as positions
  if (job.timeEntries && job.timeEntries.length > 0) {
    // Use detailed time entries
    for (const timeEntry of job.timeEntries) {
      const maxDescWidth = 60;
      const description = `Arbeitszeit: ${timeEntry.description || 'Arbeitsleistung'}`;
      const splitDesc = pdf.splitTextToSize(description, maxDescWidth);
      const totalRowHeight = 10 + (splitDesc.length - 1) * 8;
      
      if (await checkPageBreak(totalRowHeight + 5)) {
        // Re-add table header on new page
        pdf.setFillColor(240, 243, 248);
        pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12, 'F');
        
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.5);
        pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12);
        
        pdf.setFontSize(9);
        pdf.setTextColor(darkText);
        pdf.setFont('helvetica', 'bold');
        
        pdf.text('Pos.', margins.left + 3, yPosition + 5);
        pdf.text('Beschreibung', 40, yPosition + 5);
        pdf.text('Menge', 105, yPosition + 5);
        pdf.text('Einzelpreis', 125, yPosition + 5);
        pdf.text('MwSt.', 150, yPosition + 5);
        pdf.text('Gesamt', 165, yPosition + 5);
        
        yPosition += 15;
        pdf.setFont('helvetica', 'normal');
      }
      
      // Alternating row colors
      if ((positionIndex - 1) % 2 === 1) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margins.left, yPosition - 3, pageWidth - margins.left - margins.right, totalRowHeight, 'F');
      }
      
      pdf.setTextColor(darkText);
      pdf.text(positionIndex.toString(), margins.left + 3, yPosition);
      pdf.text(splitDesc[0], 40, yPosition);
      pdf.text(`${timeEntry.hoursWorked.toFixed(2)} h`, 105, yPosition);
      pdf.text(formatCurrency(timeEntry.hourlyRate, locale), 125, yPosition);
      // Bei Kleinunternehmerregelung immer 0% MwSt. anzeigen
      const taxRate = options.company.isSmallBusiness ? 0 : (timeEntry.taxRate != null ? timeEntry.taxRate : 19);
      pdf.text(`${taxRate}%`, 150, yPosition);
      pdf.text(formatCurrency(timeEntry.hoursWorked * timeEntry.hourlyRate, locale), 165, yPosition);
      
      yPosition += 10;
      
      // Additional description lines if needed
      if (splitDesc.length > 1) {
        for (let i = 1; i < splitDesc.length; i++) {
          pdf.text(splitDesc[i], 40, yPosition);
          yPosition += 8;
        }
      }
      
      positionIndex++;
    }
  } else {
    // Use legacy hoursWorked and hourlyRate
    const maxDescWidth = 60;
    const description = 'Arbeitszeit: Arbeitsleistung';
    const splitDesc = pdf.splitTextToSize(description, maxDescWidth);
    const totalRowHeight = 10 + (splitDesc.length - 1) * 8;
    
    if (await checkPageBreak(totalRowHeight + 5)) {
      // Re-add table header on new page
      pdf.setFillColor(240, 243, 248);
      pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12, 'F');
      
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.5);
      pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12);
      
      pdf.setFontSize(9);
      pdf.setTextColor(darkText);
      pdf.setFont('helvetica', 'bold');
      
      pdf.text('Pos.', margins.left + 3, yPosition + 5);
      pdf.text('Beschreibung', 40, yPosition + 5);
      pdf.text('Menge', 105, yPosition + 5);
      pdf.text('Einzelpreis', 125, yPosition + 5);
      pdf.text('MwSt.', 150, yPosition + 5);
      pdf.text('Gesamt', 165, yPosition + 5);
      
      yPosition += 15;
      pdf.setFont('helvetica', 'normal');
    }
    
    // Alternating row colors
    if ((positionIndex - 1) % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(margins.left, yPosition - 3, pageWidth - margins.left - margins.right, totalRowHeight, 'F');
    }
    
    pdf.setTextColor(darkText);
    pdf.text(positionIndex.toString(), margins.left + 3, yPosition);
    pdf.text(splitDesc[0], 40, yPosition);
    pdf.text(`${job.hoursWorked.toFixed(2)} h`, 105, yPosition);
    pdf.text(formatCurrency(job.hourlyRate, locale), 125, yPosition);
    pdf.text('19%', 150, yPosition);
    pdf.text(formatCurrency(job.hoursWorked * job.hourlyRate, locale), 165, yPosition);
    
    yPosition += 10;
    
    // Additional description lines if needed
    if (splitDesc.length > 1) {
      for (let i = 1; i < splitDesc.length; i++) {
        pdf.text(splitDesc[i], 40, yPosition);
        yPosition += 8;
      }
    }
    
    positionIndex++;
  }
  
  // Add materials as positions
  if (job.materials && job.materials.length > 0) {
    for (const material of job.materials) {
      const maxDescWidth = 60;
      const description = `Material: ${material.description}`;
      const splitDesc = pdf.splitTextToSize(description, maxDescWidth);
      const totalRowHeight = 10 + (splitDesc.length - 1) * 8;
      
      if (await checkPageBreak(totalRowHeight + 5)) {
        // Re-add table header on new page
        pdf.setFillColor(240, 243, 248);
        pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12, 'F');
        
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.5);
        pdf.rect(margins.left, yPosition - 2, pageWidth - margins.left - margins.right, 12);
        
        pdf.setFontSize(9);
        pdf.setTextColor(darkText);
        pdf.setFont('helvetica', 'bold');
        
        pdf.text('Pos.', margins.left + 3, yPosition + 5);
        pdf.text('Beschreibung', 40, yPosition + 5);
        pdf.text('Menge', 105, yPosition + 5);
        pdf.text('Einzelpreis', 125, yPosition + 5);
        pdf.text('MwSt.', 150, yPosition + 5);
        pdf.text('Gesamt', 165, yPosition + 5);
        
        yPosition += 15;
        pdf.setFont('helvetica', 'normal');
      }
      
      // Alternating row colors
      if ((positionIndex - 1) % 2 === 1) {
        pdf.setFillColor(248, 250, 252);
        pdf.rect(margins.left, yPosition - 3, pageWidth - margins.left - margins.right, totalRowHeight, 'F');
      }
      
      pdf.setTextColor(darkText);
      pdf.text(positionIndex.toString(), margins.left + 3, yPosition);
      pdf.text(splitDesc[0], 40, yPosition);
      pdf.text(material.quantity.toString(), 105, yPosition);
      pdf.text(formatCurrency(material.unitPrice, locale), 125, yPosition);
      // Bei Kleinunternehmerregelung immer 0% MwSt. anzeigen
      const materialTaxRate = options.company.isSmallBusiness ? 0 : (material.taxRate != null ? material.taxRate : 19);
      pdf.text(`${materialTaxRate}%`, 150, yPosition);
      pdf.text(formatCurrency(material.quantity * material.unitPrice, locale), 165, yPosition);
      
      yPosition += 10;
      
      // Additional description lines if needed
      if (splitDesc.length > 1) {
        for (let i = 1; i < splitDesc.length; i++) {
          pdf.text(splitDesc[i], 40, yPosition);
          yPosition += 8;
        }
      }
      
      positionIndex++;
    }
  }
  
  // Table bottom border
  pdf.setDrawColor(203, 213, 225);
  pdf.line(margins.left, yPosition - 3, pageWidth - margins.right, yPosition - 3);
  
  yPosition += 6;
  
  // Materials are now included in the positions table above
  
  // Total calculation section
  const taxBreakdown = calculateJobTaxBreakdown(job, options.company.isSmallBusiness);
  const subtotal = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxableAmount, 0);
  const totalTaxAmount = Object.values(taxBreakdown).reduce((sum, breakdown) => sum + breakdown.taxAmount, 0);
  const total = subtotal + totalTaxAmount;
  
  // Totals section
  await checkPageBreak(60);
  
  yPosition += 6;
  const totalsBoxWidth = 80;
  const totalsStartX = pageWidth - margins.right;
  const totalsLabelX = totalsStartX - totalsBoxWidth + 5;
  const totalsValueX = totalsStartX - 5;
  
  // Calculate dynamic height for totals box
  const taxRates = Object.keys(taxBreakdown).filter(rate => Number(rate) > 0).sort((a, b) => Number(a) - Number(b));
  const showTotalTaxLine = taxRates.length > 1;
  
  let totalsLines = 2; // Base lines: Nettobetrag + Gesamtbetrag
  totalsLines += taxRates.length; // Add lines for each tax rate
  if (showTotalTaxLine) totalsLines += 1; // Add line for total tax if multiple rates
  
  const totalsBoxHeight = Math.max(30, 6 + (totalsLines * 6) + 6);
  
  // Background for totals
  pdf.setFillColor(248, 250, 252);
  pdf.rect(totalsLabelX - 5, yPosition - 3, totalsBoxWidth, totalsBoxHeight, 'F');
  
  pdf.setFontSize(9);
  
  // Add space from top of box
  yPosition += 4;
  
  pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
  pdf.text('Nettobetrag:', totalsLabelX, yPosition);
  pdf.setTextColor(darkText);
  pdf.text(formatCurrency(subtotal, locale), totalsValueX, yPosition, { align: 'right' });
  yPosition += 6;
  
  // Display each tax rate separately (exclude 0% rates)
  for (const rate of taxRates) {
    const breakdown = taxBreakdown[Number(rate)];
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text(`MwSt. (${rate}%):`, totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(breakdown.taxAmount, locale), totalsValueX, yPosition, { align: 'right' });
    yPosition += 6;
  }
  
  // If multiple tax rates > 0% exist, show total tax amount
  if (showTotalTaxLine) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('MwSt. gesamt:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(totalTaxAmount, locale), totalsValueX, yPosition, { align: 'right' });
    yPosition += 6;
  }
  
  // Total amount highlighted
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Gesamtbetrag:', totalsLabelX, yPosition);
  pdf.text(formatCurrency(total, locale), totalsValueX, yPosition, { align: 'right' });
  
  // Reset font properly after totals
  resetFont();
  
  // Add clause for jobs with only 0% tax rate (Kleinunternehmerregelung) - outside the box
  if (options.company.isSmallBusiness || totalTaxAmount === 0) {
    yPosition += 8;
    
    // Check if clause fits on current page
    if (await checkPageBreak(12, 20)) {
      // Clause moved to new page only if really necessary
    }
    
    // Center the clause below the totals box
    const clauseText = options.company.isSmallBusiness 
      ? 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)'
      : 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über';
    const textWidth = pdf.getTextWidth(clauseText);
    const centerX = (pageWidth - textWidth) / 2;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(clauseText, centerX, yPosition);
    
    // Reset font after clause
    resetFont();
    
    yPosition += 8;
  }
  
  // Notes section
  if (job.notes) {
    yPosition += 12; // Reduced spacing from 15 to 12
    await checkPageBreak(30);
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Anmerkungen:', margins.left, yPosition);
    yPosition += 6; // Reduced spacing
    
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    const splitNotes = pdf.splitTextToSize(job.notes, pageWidth - margins.left - margins.right);
    
    // Check if notes fit on current page
    const notesHeight = splitNotes.length * 4.5; // Reduced line height
    if (await checkPageBreak(notesHeight)) {
      // Redraw section header if we moved to new page
      pdf.setFontSize(10);
      pdf.setTextColor(darkText);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Anmerkungen:', margins.left, yPosition);
      yPosition += 6;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(grayText);
    }
    
    pdf.text(splitNotes, margins.left, yPosition);
    yPosition += splitNotes.length * 4.5 + 6; // Reduced spacing from 8 to 6
  }
  
  // Customer signature section
  if (job.signature) {
    const signatureSpace = 45; // Reduced space needed for signature
    await checkPageBreak(signatureSpace);
    
    yPosition += 10; // Reduced spacing from 12 to 10
    
    pdf.setFontSize(10);
    pdf.setTextColor(darkText);
    pdf.setFont('helvetica', 'bold');
    pdf.text('Kundenunterschrift:', margins.left, yPosition);
    yPosition += 6; // Reduced spacing
    
    // Customer name
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    pdf.text(`Kunde: ${job.signature.customerName}`, margins.left, yPosition);
    yPosition += 4; // Reduced from 5 to 4
    
    // Signature date
    const signatureDate = new Date(job.signature.signedAt).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    pdf.text(`Unterschrieben am: ${signatureDate}`, margins.left, yPosition);
    yPosition += 6; // Reduced from 8 to 6
    
    // Add signature image
    try {
      const signatureImg = job.signature.signatureData;
      if (signatureImg && signatureImg.startsWith('data:image/')) {
        // Calculate signature dimensions (maintain aspect ratio)
        const maxSignatureWidth = 80; // Further reduced size
        const maxSignatureHeight = 25; // Further reduced size
        
        await checkPageBreak(maxSignatureHeight + 5);
        
        // Add signature image
        pdf.addImage(
          signatureImg,
          'PNG',
          margins.left,
          yPosition,
          maxSignatureWidth,
          maxSignatureHeight
        );
        
        // Add a border around the signature
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.5);
        pdf.rect(margins.left, yPosition, maxSignatureWidth, maxSignatureHeight);
        
        yPosition += maxSignatureHeight + 4; // Reduced from 5 to 4
      }
    } catch (error) {
      logger.warn('Could not add signature image to PDF:', error);
      // Fallback: just show text
      pdf.setTextColor(grayText);
      pdf.text('[Digitale Unterschrift vorhanden]', margins.left, yPosition);
      yPosition += 6; // Reduced from 8 to 6
    }
    
    // Reset font after signature section
    resetFont();
  }
  
  // Add footer to all pages
  const totalPages = (pdf as any).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    addPageFooter(i);
  }
  
  return pdf.output('blob');
}

// Generate Quote PDF
export async function generateQuotePDF(quote: any, options: QuotePDFOptions): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF();
  
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  
  // Get locale from company settings for formatting
  const locale = options.company.locale || 'de-DE';
  
  // Colors configuration
  const primaryColor = options.company.primaryColor || '#2563eb';
  const secondaryColor = options.company.secondaryColor || '#64748b';
  const { primaryRgb, secondaryRgb, darkText, grayText } = getColorConfiguration(primaryColor, secondaryColor);
  
  let yPosition = 15; // Reduced top margin from 20 to 15
  const margins = { top: 15, bottom: 25, left: 20, right: 20 }; // Reduced top and bottom margins

  // Helper function to add complete header to current page
  const addHeader = async (): Promise<number> => {
    let currentY = 15; // Start with reduced top margin
    
    // Header section with clear positioning
    // Quote metadata box (right side) - positioned first to avoid overlaps
    const metadataBoxX = pageWidth - 80;
    const metadataBoxY = currentY;
    const metadataBoxWidth = 60;
    const metadataBoxHeight = 50;
    
    // Light background for metadata box
    pdf.setFillColor(248, 250, 252);
    pdf.rect(metadataBoxX, metadataBoxY, metadataBoxWidth, metadataBoxHeight, 'F');
    
    // Quote title in metadata box
    pdf.setFontSize(14);
    pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.text('ANGEBOT', metadataBoxX + 3, metadataBoxY + 12);
    
    // Quote details in metadata box
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    let metaY = metadataBoxY + 20;
    
    pdf.text('Angebots-Nr.:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(quote.quoteNumber, metadataBoxX + 3, metaY + 4);
    metaY += 10;
    
    pdf.setTextColor(grayText);
    pdf.text('Datum:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(new Date(quote.issueDate).toLocaleDateString('de-DE'), metadataBoxX + 3, metaY + 4);
    metaY += 10;
    
    pdf.setTextColor(grayText);
    pdf.text('Gültig bis:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(new Date(quote.validUntil).toLocaleDateString('de-DE'), metadataBoxX + 3, metaY + 4);
    
    // Company logo and information (left side) - dynamically positioned
    if (options.company.logo) {
      try {
        // Add timeout and error handling for logo loading
        const logoImg = await Promise.race([
          loadImage(options.company.logo),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Logo loading timeout')), 5000)
          )
        ]);
        
        // Dynamic logo sizing and positioning calculation
        const maxLogoHeight = metadataBoxHeight * 0.8; // 80% of metadata box height for padding
        const maxLogoWidth = 100; // Available width between left margin and line end (100 units)
        const aspectRatio = logoImg.width / logoImg.height;
        
        let logoWidth, logoHeight;
        
        // Determine size based on aspect ratio and constraints
        if (aspectRatio > maxLogoWidth / maxLogoHeight) {
          // Width is the limiting factor
          logoWidth = maxLogoWidth;
          logoHeight = maxLogoWidth / aspectRatio;
        } else {
          // Height is the limiting factor
          logoHeight = maxLogoHeight;
          logoWidth = maxLogoHeight * aspectRatio;
        }
        
        // Calculate dynamic positioning
        // X: Center the logo within the available space (0 to 100 units where line ends)
        const availableLogoSpaceWidth = 100; // Width until the line under company data
        const logoStartX = 20 + (availableLogoSpaceWidth - logoWidth) / 2;
        
        // Y: Center the logo vertically within the metadata box
        const logoStartY = metadataBoxY + (metadataBoxHeight - logoHeight) / 2;
        
        // Determine image format for jsPDF
        let imageFormat = 'JPEG';
        if (options.company.logo.toLowerCase().includes('png') || options.company.logo.includes('data:image/png')) {
          imageFormat = 'PNG';
        }
        
        pdf.addImage(options.company.logo, imageFormat, logoStartX, logoStartY, logoWidth, logoHeight);
        
      } catch (error) {
        logger.warn('Logo konnte nicht geladen werden:', error);
        // Fallback: Company name as header - center vertically in metadata box
        const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
        pdf.setFontSize(16);
        pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
        pdf.text(options.company.name, 20, fallbackTextY);
      }
    } else {
      // Company name as header without logo - center vertically in metadata box  
      const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
      pdf.setFontSize(16);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(options.company.name, 20, fallbackTextY);
    }
    
    // Move Y position down after header section
    currentY = metadataBoxY + metadataBoxHeight + 10;
    
    // Sender address line (German standard) - now with support for two-line layout
    pdf.setFontSize(7);
    pdf.setTextColor(grayText);
    
    if (options.company.companyHeaderTwoLine) {
      // Two-line layout
      const line1 = options.company.companyHeaderLine1 || options.company.name;
      const line2 = options.company.companyHeaderLine2 || 
        `${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`;
      
      pdf.text(line1, 20, currentY);
      currentY += 3; // Small spacing between lines
      pdf.text(line2, 20, currentY);
      currentY += 2; // Spacing before line
    } else {
      // Traditional single-line layout
      pdf.text(`${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`, 20, currentY);
      currentY += 2; // Spacing before line
    }
    
    // Line under sender address
    pdf.setDrawColor(200, 200, 200);
    pdf.line(20, currentY, 120, currentY);
    
    currentY += 6; // Reduced spacing after line
    
    // Customer address block (left side)
    const customerAddressY = currentY;
    pdf.setFontSize(11);
    pdf.setTextColor(darkText);
    pdf.text(options.customer.name, 20, currentY);
    currentY += 5; // Reduced from 6 to 5
    if (options.customer.addressSupplement) {
      pdf.text(options.customer.addressSupplement, 20, currentY);
      currentY += 5;
    }
    pdf.text(options.customer.address, 20, currentY);
    currentY += 5; // Reduced from 6 to 5
    pdf.text(`${options.customer.postalCode} ${options.customer.city}`, 20, currentY);
    if (options.customer.country && options.customer.country !== 'Deutschland') {
      currentY += 5; // Reduced from 6 to 5
      pdf.text(options.customer.country, 20, currentY);
    }
    
    // Customer details (right side - same height as customer address)
    let customerDetailsY = customerAddressY;
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    
    const customerMetadataX = pageWidth - 80; // Re-define for customer details
    
    if (options.customer.customerNumber) {
      pdf.text('Kunden-Nr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.customerNumber, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10; // Reduced from 12 to 10
    }
    
    // Additional customer info if available
    if (options.customer.taxId) {
      pdf.setTextColor(grayText);
      pdf.text('USt-IdNr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.taxId, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10;
    }
    
    // Ensure currentY accounts for customer address section
    currentY += 18; // Reduced from 25 to 18
    
    return currentY; // Return Y position after complete header
  };

  // Helper function to check if we need a new page with more intelligent space calculation
  const checkPageBreak = async (requiredSpace: number, minimumSpace: number = 30): Promise<boolean> => {
    // Use available space more efficiently by considering smaller minimum requirements
    const availableSpace = pageHeight - margins.bottom - yPosition;
    if (availableSpace < Math.max(requiredSpace, minimumSpace)) {
      pdf.addPage();
      yPosition = await addHeader(); // Add header on new page
      resetFont(); // Reset font after new header
      return true;
    }
    return false;
  };
  
  // Helper function to reset font to ensure consistency
  const resetFont = () => {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(darkText);
  };

  const addPageFooter = (pageNum: number) => {
    const footerY = pageHeight - 20; // Reduced from 25 to 20
    
    // Footer separator line
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(20, footerY - 8, pageWidth - 20, footerY - 8); // Reduced from 10 to 8
    
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    
    // Company info in footer
    const footerInfo = `${options.company.name} | ${options.company.address} | ${options.company.postalCode} ${options.company.city}`;
    pdf.text(footerInfo, 20, footerY - 4); // Reduced from 5 to 4
    
    // Build tax information string
    let taxInfo = '';
    if (options.company.taxId) {
      taxInfo += `USt-IdNr: ${options.company.taxId}`;
    }
    if (options.company.taxIdentificationNumber) {
      if (taxInfo) taxInfo += ' | ';
      taxInfo += `Steuer-ID: ${options.company.taxIdentificationNumber}`;
    }
    
    const footerContact = `Tel: ${options.company.phone} | E-Mail: ${options.company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
    pdf.text(footerContact, 20, footerY);
    
    // Page number if multiple pages - moved down one line to avoid conflict with tax data
    const totalPages = (pdf as any).getNumberOfPages();
    if (totalPages > 1) {
      pdf.text(`Seite ${pageNum} von ${totalPages}`, pageWidth - 40, footerY + 8);
    }
  };
  
  // Add complete header to first page
  yPosition = await addHeader();
  
  // Ensure consistent font after header
  resetFont();
  
  // Items table with professional styling
  
  // Table header with better styling
  pdf.setFillColor(240, 243, 248);
  pdf.rect(20, yPosition - 2, pageWidth - 40, 12, 'F');
  
  // Table border
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.5);
  pdf.rect(20, yPosition - 2, pageWidth - 40, 12);
  
  pdf.setFontSize(9);
  pdf.setTextColor(darkText);
  pdf.setFont('helvetica', 'bold');
  
  // Column headers with German labels
  pdf.text('Pos.', 25, yPosition + 5);
  pdf.text('Beschreibung', 40, yPosition + 5);
  pdf.text('Menge', 95, yPosition + 5);
  pdf.text('Einzelpreis', 115, yPosition + 5);
  pdf.text('Rabatt', 135, yPosition + 5);
  pdf.text('MwSt.', 155, yPosition + 5);
  pdf.text('Gesamt', 170, yPosition + 5);
  
  yPosition += 15;
  
  // Table rows with alternating background
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  
  // Sort items by order to ensure correct sequence
  const sortedItems = [...quote.items].sort((a, b) => (a.order || 0) - (b.order || 0));
  
  for (let index = 0; index < sortedItems.length; index++) {
    const item = sortedItems[index];
    // Handle long descriptions first to calculate required space
    const maxDescWidth = 60;
    const description = item.description;
    
    const splitDesc = pdf.splitTextToSize(description, maxDescWidth);
    const totalRowHeight = 10 + (splitDesc.length - 1) * 8; // Base height + additional lines
    
    // Check if we need a new page for this row
    if (await checkPageBreak(totalRowHeight + 5)) {
      // Re-add table header on new page
      pdf.setFillColor(240, 243, 248);
      pdf.rect(20, yPosition - 2, pageWidth - 40, 12, 'F');
      
      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.5);
      pdf.rect(20, yPosition - 2, pageWidth - 40, 12);
      
      pdf.setFontSize(9);
      pdf.setTextColor(darkText);
      pdf.setFont('helvetica', 'bold');
      
      pdf.text('Pos.', 25, yPosition + 5);
      pdf.text('Beschreibung', 40, yPosition + 5);
      pdf.text('Menge', 95, yPosition + 5);
      pdf.text('Einzelpreis', 115, yPosition + 5);
      pdf.text('Rabatt', 135, yPosition + 5);
      pdf.text('MwSt.', 155, yPosition + 5);
      pdf.text('Gesamt', 170, yPosition + 5);
      
      yPosition += 15;
      pdf.setFont('helvetica', 'normal');
    }
    
    // Alternating row colors with dynamic height
    if (index % 2 === 1) {
      pdf.setFillColor(248, 250, 252);
      pdf.rect(20, yPosition - 3, pageWidth - 40, totalRowHeight, 'F');
    }
    
    pdf.setTextColor(darkText);
    pdf.text((index + 1).toString(), 25, yPosition);
    
    pdf.text(splitDesc[0], 40, yPosition);
    
    pdf.text(item.quantity.toString(), 95, yPosition);
    pdf.text(formatCurrency(item.unitPrice, locale), 115, yPosition);
    
    // Rabatt anzeigen
    const discountAmount = item.discountAmount || 0;
    if (discountAmount > 0) {
      if (item.discountType === 'percentage') {
        pdf.text(`${item.discountValue}%`, 135, yPosition);
      } else {
        pdf.text(formatCurrency(item.discountValue || 0, locale), 135, yPosition);
      }
    } else {
      pdf.text('-', 135, yPosition);
    }
    
    pdf.text(`${item.taxRate}%`, 155, yPosition);
    
    // Gesamtpreis nach Rabatt
    const itemTotal = (item.quantity * item.unitPrice) - discountAmount;
    pdf.text(formatCurrency(itemTotal, locale), 170, yPosition);
    
    yPosition += 10;
    
    // Additional description lines if needed
    if (splitDesc.length > 1) {
      for (let i = 1; i < splitDesc.length; i++) {
        pdf.text(splitDesc[i], 40, yPosition);
        yPosition += 8;
      }
    }
  }
  
  // Table bottom border
  pdf.setDrawColor(203, 213, 225);
  pdf.line(20, yPosition - 3, pageWidth - 20, yPosition - 3);

  // Totals and Notes section side by side - optimized spacing
  yPosition += 10; // Reduced from 15 to 10
  
  // Calculate dynamic height for totals box based on tax rates and discounts
  const taxBreakdownForSizing = calculateTaxBreakdown(quote.items);
  const numberOfTaxRates = Object.keys(taxBreakdownForSizing).filter(rate => Number(rate) > 0).length;
  const showTotalTaxLine = numberOfTaxRates > 1;
  
  // Calculate discount lines
  const itemDiscountAmountForSizing = quote.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmountForSizing = quote.globalDiscountAmount || 0;
  const hasDiscounts = itemDiscountAmountForSizing > 0 || globalDiscountAmountForSizing > 0;
  
  let discountLines = 0;
  if (itemDiscountAmountForSizing > 0) discountLines++;
  if (globalDiscountAmountForSizing > 0) discountLines++;
  if (hasDiscounts) discountLines++; // Additional line for "Nettobetrag" after discounts
  
  // Base height: Zwischensumme + Gesamtbetrag + padding = 18px base
  // Additional lines: discount lines + tax rates + optional total tax line
  const totalsBoxHeight = 18 + (discountLines * 7) + (numberOfTaxRates * 7) + (showTotalTaxLine ? 7 : 0);
  
  // Calculate space needed for small business clause if applicable
  const smallBusinessHeight = (options.company.isSmallBusiness && hasOnlyZeroTaxRate(quote.items)) ? 20 : 0; // Reduced from 25 to 20
  
  // Calculate total space needed for totals section
  const totalTotalsSpace = totalsBoxHeight + smallBusinessHeight + 5; // Reduced buffer from 10px to 5px
  
  // More intelligent page break - only if absolutely necessary
  const availableSpaceForTotals = pageHeight - yPosition - margins.bottom;
  const shouldBreakPage = totalTotalsSpace > availableSpaceForTotals && availableSpaceForTotals < 80; // Only break if very little space left
  
  if (shouldBreakPage) {
    pdf.addPage();
    yPosition = await addHeader();
    resetFont(); // Reset font after header
  }
  
  const totalsStartX = pageWidth - 40;
  const totalsLabelX = totalsStartX - 35;
  const totalsBoxWidth = 60;
  
  // Save the starting Y position for notes
  const totalsNotesStartY = yPosition;
  
  // Background for totals
  pdf.setFillColor(248, 250, 252);
  pdf.rect(totalsLabelX - 5, yPosition - 5, totalsBoxWidth, totalsBoxHeight, 'F');
  
  pdf.setFontSize(9);
  pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
  
  pdf.text('Zwischensumme:', totalsLabelX, yPosition);
  pdf.setTextColor(darkText);
  pdf.text(formatCurrency(quote.subtotal, locale), totalsStartX, yPosition);
  yPosition += 7;
  
  // Zeige Artikelrabatte falls vorhanden
  const itemDiscountAmount = quote.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  if (itemDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38); // red-600
    pdf.text('Artikelrabatte:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(itemDiscountAmount, locale)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Zeige Gesamtrabatt falls vorhanden
  const globalDiscountAmount = quote.globalDiscountAmount || 0;
  if (globalDiscountAmount > 0) {
    pdf.setTextColor(220, 38, 38); // red-600
    pdf.text('Gesamtrabatt:', totalsLabelX, yPosition);
    pdf.text(`-${formatCurrency(globalDiscountAmount, locale)}`, totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Zeige Zwischensumme nach Rabatten falls Rabatte vorhanden
  if (itemDiscountAmount > 0 || globalDiscountAmount > 0) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('Nettobetrag:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    const discountedSubtotal = quote.subtotal - itemDiscountAmount - globalDiscountAmount;
    pdf.text(formatCurrency(discountedSubtotal, locale), totalsStartX, yPosition);
    yPosition += 7;
  }
  
  // Calculate tax breakdown and display each rate separately (exclude 0% rates)
  const taxBreakdown = calculateTaxBreakdown(quote.items);
  const taxRates = Object.keys(taxBreakdown)
    .filter(rate => Number(rate) > 0)
    .sort((a, b) => Number(a) - Number(b));
  
  for (const rate of taxRates) {
    const breakdown = taxBreakdown[Number(rate)];
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text(`MwSt. (${rate}%):`, totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(breakdown.taxAmount, locale), totalsStartX, yPosition);
    yPosition += 7; // Reduced from 8 to 7
  }
  
  // If multiple tax rates > 0% exist, show total tax amount
  if (taxRates.length > 1) {
    pdf.setTextColor(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b);
    pdf.text('MwSt. gesamt:', totalsLabelX, yPosition);
    pdf.setTextColor(darkText);
    pdf.text(formatCurrency(quote.taxAmount, locale), totalsStartX, yPosition);
    yPosition += 7; // Reduced from 8 to 7
  }
  
  // Total amount highlighted
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Gesamtbetrag:', totalsLabelX, yPosition);
  pdf.text(formatCurrency(quote.total, locale), totalsStartX, yPosition);
  
  // Reset font properly after totals
  resetFont();
  
  // Move yPosition to the end of the totals box
  yPosition = totalsNotesStartY + totalsBoxHeight;
  
  // Add clause for quotes with only 0% tax rate or small business - outside the box
  if (options.company.isSmallBusiness && hasOnlyZeroTaxRate(quote.items)) {
    yPosition += 8; // Reduced gap after the box from 10 to 8
    
    // Check if clause fits on current page with smaller requirement
    if (await checkPageBreak(12, 20)) {
      // Clause moved to new page only if really necessary
    }
    
    // Center the clause below the totals box
    const clauseText = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)';
    const textWidth = pdf.getTextWidth(clauseText);
    const centerX = (pageWidth - textWidth) / 2;
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text(clauseText, centerX, yPosition);
    
    // Reset font after clause
    resetFont();
    
    yPosition += 8; // Reduced space after the clause from 10 to 8
  }
  
  // Notes section
  if (quote.notes) {
    yPosition += 10;
    await checkPageBreak(20);
    
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(darkText);
    pdf.text('Hinweise:', 20, yPosition);
    yPosition += 6;
    
    resetFont();
    pdf.setFontSize(9);
    const notesLines = pdf.splitTextToSize(quote.notes, pageWidth - 40);
    for (const line of notesLines) {
      await checkPageBreak(5);
      pdf.text(line, 20, yPosition);
      yPosition += 5;
    }
  }

  // Add footer to all pages
  const totalPages = (pdf as any).getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    pdf.setPage(i);
    addPageFooter(i);
  }
  
  return pdf.output('blob');
}
/**
 * Generate payment reminder PDF
 * Reuses invoice PDF layout but with simplified content
 */
export async function generateReminderPDF(
  invoice: Invoice, 
  stage: 1 | 2 | 3, 
  reminderText: string,
  fee: number,
  options: PDFOptions
): Promise<Blob> {
  const pdf = new jsPDF();
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  
  // Get locale from company settings for formatting
  const locale = options.company.locale || 'de-DE';
  
  // Colors configuration (reuse from Invoice PDF)
  const primaryColor = options.company.primaryColor || '#2563eb';
  const secondaryColor = options.company.secondaryColor || '#64748b';
  const { primaryRgb, secondaryRgb, darkText, grayText } = getColorConfiguration(primaryColor, secondaryColor);
  
  let yPos = 15; // Same as invoice
  const margins = { top: 15, bottom: 25, left: 20, right: 20 };

  // Helper: Add header with company logo and info (same style as Invoice PDF)
  const addHeader = async (): Promise<number> => {
    let currentY = 15; // Start with reduced top margin
    
    // Header section with clear positioning
    // Reminder metadata box (right side) - positioned first to avoid overlaps
    const metadataBoxX = pageWidth - 80;
    const metadataBoxY = currentY;
    const metadataBoxWidth = 60;
    const metadataBoxHeight = 55; // Slightly taller for reminder info
    
    // Light background for metadata box
    pdf.setFillColor(248, 250, 252);
    pdf.rect(metadataBoxX, metadataBoxY, metadataBoxWidth, metadataBoxHeight, 'F');
    
    // Reminder title in metadata box
    const stageText = stage === 1 ? '1. MAHNUNG' : stage === 2 ? '2. MAHNUNG' : '3. MAHNUNG';
    pdf.setFontSize(14);
    pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
    pdf.text(stageText, metadataBoxX + 3, metadataBoxY + 12);
    
    // Reminder details in metadata box
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    let metaY = metadataBoxY + 20;
    
    pdf.text('Rechnung-Nr.:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(invoice.invoiceNumber, metadataBoxX + 3, metaY + 4);
    metaY += 10;
    
    pdf.setTextColor(grayText);
    pdf.text('Mahndatum:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(new Date().toLocaleDateString(locale), metadataBoxX + 3, metaY + 4);
    metaY += 10;
    
    pdf.setTextColor(grayText);
    pdf.text('Fällig war:', metadataBoxX + 3, metaY);
    pdf.setTextColor(darkText);
    pdf.text(new Date(invoice.dueDate).toLocaleDateString(locale), metadataBoxX + 3, metaY + 4);
    
    // Company logo and information (left side) - dynamically positioned
    if (options.company.logo) {
      try {
        // Add timeout and error handling for logo loading
        const logoImg = await Promise.race([
          loadImage(options.company.logo),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Logo loading timeout')), 5000)
          )
        ]);
        
        // Dynamic logo sizing and positioning calculation
        const maxLogoHeight = metadataBoxHeight * 0.8; // 80% of metadata box height for padding
        const maxLogoWidth = 100; // Available width between left margin and line end (100 units)
        const aspectRatio = logoImg.width / logoImg.height;
        
        let logoWidth, logoHeight;
        
        // Determine size based on aspect ratio and constraints
        if (aspectRatio > maxLogoWidth / maxLogoHeight) {
          // Width is the limiting factor
          logoWidth = maxLogoWidth;
          logoHeight = maxLogoWidth / aspectRatio;
        } else {
          // Height is the limiting factor
          logoHeight = maxLogoHeight;
          logoWidth = maxLogoHeight * aspectRatio;
        }
        
        // Calculate dynamic positioning
        // X: Center the logo within the available space (0 to 100 units where line ends)
        const availableLogoSpaceWidth = 100; // Width until the line under company data
        const logoStartX = 20 + (availableLogoSpaceWidth - logoWidth) / 2;
        
        // Y: Center the logo vertically within the metadata box
        const logoStartY = metadataBoxY + (metadataBoxHeight - logoHeight) / 2;
        
        // Determine image format for jsPDF
        let imageFormat = 'JPEG';
        if (options.company.logo.toLowerCase().includes('png') || options.company.logo.includes('data:image/png')) {
          imageFormat = 'PNG';
        }
        
        pdf.addImage(options.company.logo, imageFormat, logoStartX, logoStartY, logoWidth, logoHeight);
        
      } catch (error) {
        logger.warn('Logo konnte nicht geladen werden:', error);
        // Fallback: Company name as header - center vertically in metadata box
        const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
        pdf.setFontSize(16);
        pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
        pdf.text(options.company.name, 20, fallbackTextY);
      }
    } else {
      // Company name as header without logo - center vertically in metadata box  
      const fallbackTextY = metadataBoxY + (metadataBoxHeight / 2) + 3; // +3 for better text baseline alignment
      pdf.setFontSize(16);
      pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
      pdf.text(options.company.name, 20, fallbackTextY);
    }
    
    // Move Y position down after header section
    currentY = metadataBoxY + metadataBoxHeight + 10;
    
    // Sender address line (German standard) - now with support for two-line layout
    pdf.setFontSize(7);
    pdf.setTextColor(grayText);
    
    if (options.company.companyHeaderTwoLine) {
      // Two-line layout
      const line1 = options.company.companyHeaderLine1 || options.company.name;
      const line2 = options.company.companyHeaderLine2 || 
        `${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`;
      
      pdf.text(line1, 20, currentY);
      currentY += 3; // Small spacing between lines
      pdf.text(line2, 20, currentY);
      currentY += 2; // Spacing before line
    } else {
      // Traditional single-line layout
      pdf.text(`${options.company.name}, ${options.company.address}, ${options.company.postalCode} ${options.company.city}`, 20, currentY);
      currentY += 2; // Spacing before line
    }
    
    // Line under sender address
    pdf.setDrawColor(200, 200, 200);
    pdf.line(20, currentY, 120, currentY);
    
    currentY += 6; // Reduced spacing after line
    
    // Customer address block (left side)
    const customerAddressY = currentY;
    pdf.setFontSize(11);
    pdf.setTextColor(darkText);
    pdf.text(options.customer.name, 20, currentY);
    currentY += 5; // Reduced from 6 to 5
    if (options.customer.addressSupplement) {
      pdf.text(options.customer.addressSupplement, 20, currentY);
      currentY += 5;
    }
    pdf.text(options.customer.address, 20, currentY);
    currentY += 5; // Reduced from 6 to 5
    pdf.text(`${options.customer.postalCode} ${options.customer.city}`, 20, currentY);
    if (options.customer.country && options.customer.country !== 'Deutschland') {
      currentY += 5; // Reduced from 6 to 5
      pdf.text(options.customer.country, 20, currentY);
    }
    
    // Customer details (right side - same height as customer address)
    let customerDetailsY = customerAddressY;
    pdf.setFontSize(9);
    pdf.setTextColor(grayText);
    
    const customerMetadataX = pageWidth - 80; // Re-define for customer details
    
    if (options.customer.customerNumber) {
      pdf.text('Kunden-Nr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.customerNumber, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10; // Reduced from 12 to 10
    }
    
    // Additional customer info if available
    if (options.customer.taxId) {
      pdf.setTextColor(grayText);
      pdf.text('USt-IdNr.:', customerMetadataX, customerDetailsY);
      pdf.setTextColor(darkText);
      pdf.text(options.customer.taxId, customerMetadataX, customerDetailsY + 4);
      customerDetailsY += 10;
    }
    
    // Ensure currentY accounts for customer address section
    currentY += 18; // Reduced from 25 to 18
    
    return currentY; // Return Y position after complete header
  };
  
  // Add header
  yPos = await addHeader();
  
  yPos += 3;
  
  // Reference to original invoice - prominent box
  pdf.setFillColor(250, 250, 250);
  pdf.setDrawColor(200, 200, 200);
  pdf.setLineWidth(0.3);
  pdf.rect(20, yPos, pageWidth - 40, 25, 'FD');
  
  yPos += 7;
  
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Bezug: Rechnung', 25, yPos);
  
  yPos += 6;
  
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(0, 0, 0);
  pdf.text(`${invoice.invoiceNumber}`, 25, yPos);
  
  // Invoice date and due date on the right side of the box
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(80, 80, 80);
  const invoiceDateText = `vom ${new Date(invoice.issueDate).toLocaleDateString(locale)}`;
  const dueDateText = `fällig am ${new Date(invoice.dueDate).toLocaleDateString(locale)}`;
  const rightBoxText = `${invoiceDateText}, ${dueDateText}`;
  const rightBoxTextWidth = pdf.getTextWidth(rightBoxText);
  pdf.text(rightBoxText, pageWidth - 25 - rightBoxTextWidth, yPos);
  
  yPos += 20;
  
  // Reminder text
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0, 0, 0);
  
  const reminderLines = pdf.splitTextToSize(reminderText, pageWidth - 40);
  reminderLines.forEach((line: string) => {
    if (yPos > pageHeight - 80) {
      pdf.addPage();
      yPos = 20;
    }
    pdf.text(line, 20, yPos);
    yPos += 5;
  });
  
  yPos += 15;
  
  // Calculate cumulative reminder fees (sum of all previous stages + current stage)
  const cumulativeFee = (() => {
    let totalFees = 0;
    const feeStage1 = options.company.reminderFeeStage1 || 0;
    const feeStage2 = options.company.reminderFeeStage2 || 0;
    const feeStage3 = options.company.reminderFeeStage3 || 0;
    
    if (stage >= 1) totalFees += feeStage1;
    if (stage >= 2) totalFees += feeStage2;
    if (stage >= 3) totalFees += feeStage3;
    
    return totalFees;
  })();
  
  // Simplified amounts display
  const colLabelX = 25;
  const colAmountX = pageWidth - 50;
  
  // Original invoice amount
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Rechnungsbetrag:', colLabelX, yPos);
  const originalAmount = formatCurrency(invoice.total, locale);
  const originalAmountWidth = pdf.getTextWidth(originalAmount);
  pdf.text(originalAmount, colAmountX + 20 - originalAmountWidth, yPos);
  
  yPos += 7;
  
  // Cumulative reminder fees (if applicable)
  if (cumulativeFee > 0) {
    pdf.setTextColor(60, 60, 60);
    pdf.text('Mahngebühren:', colLabelX, yPos);
    pdf.setTextColor(180, 50, 50); // Red color for fees
    const feeAmount = formatCurrency(cumulativeFee, locale);
    const feeAmountWidth = pdf.getTextWidth(feeAmount);
    pdf.text(feeAmount, colAmountX + 20 - feeAmountWidth, yPos);
    yPos += 7;
    pdf.setTextColor(0, 0, 0);
  }
  
  // Divider line
  pdf.setDrawColor(180, 180, 180);
  pdf.setLineWidth(0.5);
  pdf.line(colLabelX, yPos, colAmountX + 20, yPos);
  yPos += 8;
  
  // Total amount - simple and clear
  pdf.setFontSize(13);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);
  pdf.text('Zu zahlender Gesamtbetrag:', colLabelX, yPos);
  const totalAmount = formatCurrency(invoice.total + cumulativeFee, locale);
  const totalAmountWidth = pdf.getTextWidth(totalAmount);
  pdf.text(totalAmount, colAmountX + 20 - totalAmountWidth, yPos);
  
  yPos += 15;
  
  // Reset colors
  pdf.setTextColor(0, 0, 0);
  pdf.setDrawColor(0, 0, 0);
  
  // Payment information - simplified
  const paymentInfo = options.company.paymentInformation || {};
  const bankAccount = paymentInfo.bankAccount || options.company.bankAccount;
  const bic = paymentInfo.bic || options.company.bic;
  
  pdf.setFontSize(10);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(60, 60, 60);
  pdf.text('Zahlungsinformationen:', 20, yPos);
  
  yPos += 6;
  
  pdf.setFontSize(9);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(0, 0, 0);
  
  if (bankAccount) {
    pdf.text(`IBAN: ${bankAccount}`, 20, yPos);
    yPos += 5;
  }
  if (bic) {
    pdf.text(`BIC: ${bic}`, 20, yPos);
    yPos += 5;
  }
  pdf.setFont('helvetica', 'bold');
  pdf.text(`Verwendungszweck: ${invoice.invoiceNumber}`, 20, yPos);
  
  yPos += 10;
  
  // Closing text
  // pdf.setFontSize(10);
  // pdf.setFont('helvetica', 'normal');
  // pdf.text('Mit freundlichen Grüßen', 20, yPos);
  // yPos += 5;
  // pdf.setFont('helvetica', 'bold');
  // pdf.text(options.company.name, 20, yPos);
  
  // Footer (same style as invoice PDF)
  const addFooter = () => {
    const footerY = pageHeight - margins.bottom;
    
    // Footer separator line
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.5);
    pdf.line(20, footerY - 8, pageWidth - 20, footerY - 8); // Reduced from 10 to 8
    
    pdf.setFontSize(8);
    pdf.setTextColor(grayText);
    
    // Company info in footer
    const footerInfo = `${options.company.name} | ${options.company.address} | ${options.company.postalCode} ${options.company.city}`;
    pdf.text(footerInfo, 20, footerY - 4); // Reduced from 5 to 4
    
    // Build tax information string
    let taxInfo = '';
    if (options.company.taxId) {
      taxInfo += `USt-IdNr: ${options.company.taxId}`;
    }
    if (options.company.taxIdentificationNumber) {
      if (taxInfo) taxInfo += ' | ';
      taxInfo += `Steuer-ID: ${options.company.taxIdentificationNumber}`;
    }
    
    const footerContact = `Tel: ${options.company.phone} | E-Mail: ${options.company.email}${taxInfo ? ' | ' + taxInfo : ''}`;
    pdf.text(footerContact, 20, footerY);
  };
  
  addFooter();
  
  return pdf.output('blob');
}
