/**
 * Tax calculation utilities for PDF generation
 */

import { Invoice, JobEntry } from '../../types';

export interface TaxBreakdown {
  [taxRate: number]: {
    taxableAmount: number;
    taxAmount: number;
  };
}

/**
 * Calculate tax breakdown by rate for invoice items
 * @param items - Invoice items
 * @param invoice - Optional invoice object for global discount
 * @returns Tax breakdown by rate
 */
export function calculateTaxBreakdown(items: Invoice['items'], invoice?: Partial<Invoice>): TaxBreakdown {
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
  }, {} as TaxBreakdown);
  
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

/**
 * Calculate tax breakdown for job entries
 * @param job - Job entry
 * @param isSmallBusiness - Whether small business rules apply
 * @returns Tax breakdown by rate
 */
export function calculateJobTaxBreakdown(job: JobEntry, isSmallBusiness?: boolean): TaxBreakdown {
  const taxBreakdown: TaxBreakdown = {};
  
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

/**
 * Check if any discounts exist in invoice items
 * @param items - Invoice items
 * @returns Whether discounts exist
 */
export function checkHasDiscounts(items: Invoice['items']): boolean {
  return items.some(item => 
    (item.discountAmount && item.discountAmount > 0) || 
    (item.discountValue && item.discountValue > 0)
  );
}

/**
 * Check if invoice has only 0% tax rate
 * @param items - Invoice items
 * @returns Whether only 0% tax rate is used
 */
export function hasOnlyZeroTaxRate(items: Invoice['items']): boolean {
  return items.length > 0 && items.every(item => item.taxRate === 0);
}


