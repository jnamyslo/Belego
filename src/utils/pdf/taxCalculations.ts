/**
 * Tax calculation utilities for PDF generation
 */

import { Invoice, JobEntry } from '../../types';
import { TaxBreakdown } from '../discountUtils';

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

/**
 * Derive the EN 16931 VAT category code from the tax rate and business context.
 * - S  = standard rated (rate > 0)
 * - E  = exempt / Kleinunternehmer § 19 UStG (rate 0, small business)
 * - AE = reverse charge § 13b UStG (rate 0, not small business)
 * @param rate - Tax rate (percent)
 * @param isSmallBusiness - Whether the Kleinunternehmerregelung applies
 * @returns Category code
 */
export function getTaxCategoryCode(rate: number, isSmallBusiness?: boolean): string {
  if (rate > 0) return 'S';
  return isSmallBusiness ? 'E' : 'AE';
}

/**
 * Human-readable VAT exemption reason (BT-121 / ram:ExemptionReason) for a
 * given category code. Returns an empty string for categories that need none.
 * @param categoryCode - EN 16931 VAT category code
 * @returns Exemption reason text (German) or empty string
 */
export function getTaxExemptionReason(categoryCode: string): string {
  switch (categoryCode) {
    case 'E':
      return 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet (Kleinunternehmerregelung)';
    case 'AE':
      return 'Gemäß § 13b UStG geht die Steuerschuld auf den Leistungsempfänger über';
    default:
      return '';
  }
}


