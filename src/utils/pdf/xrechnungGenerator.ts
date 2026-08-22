/**
 * XRechnung XML generator
 * Generates XRechnung 3.0 compliant XML based on EN 16931 standard
 */

import { Invoice } from '../../types';
import { PDFOptions } from '../pdfGenerator';
import { escapeXML, formatAmountForXML, roundToCents, getCountryCode } from './xmlUtils';
import { calculateTaxBreakdown, hasOnlyZeroTaxRate, getTaxCategoryCode, getTaxExemptionReason } from './taxCalculations';

/**
 * Generate XRechnung XML as a Blob
 * @param invoice - Invoice data
 * @param options - PDF options with company and customer data
 * @returns Promise with XML Blob
 */
export function generateXRechnungXML(invoice: Invoice, options: PDFOptions): Promise<Blob> {
  // Use new payment information or fall back to legacy fields
  const paymentInfo = options.company.paymentInformation;

  // Tax breakdown (sorted by rate) shared between the header total and the subtotals.
  const taxBreakdownEntries = Object.entries(calculateTaxBreakdown(invoice.items, invoice))
    .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB));
  // BR-CO-14: derive the header tax amount from the sum of the already-rounded per-category amounts.
  const headerTaxAmount = taxBreakdownEntries.reduce((sum, [, breakdown]) => sum + roundToCents(breakdown.taxAmount), 0);

  const itemDiscountTotal = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmount = invoice.globalDiscountAmount || 0;

  // BR-CO-10: header line total must equal the sum of the line net amounts
  // (each line net already has its item discount subtracted).
  const headerLineExtensionAmount = roundToCents(invoice.subtotal - itemDiscountTotal);

  // Model the global (document-level) discount as one AllowanceCharge per tax
  // rate, split proportionally so BR-CO-11/BR-CO-13 hold on multi-rate invoices.
  // The breakdown's taxableAmount is already post-global; reconstruct each rate's
  // share as taxable * ratio/(1-ratio) so the shares sum back to the global discount.
  const subtotalAfterItemDiscounts = invoice.subtotal - itemDiscountTotal;
  const globalRatio = globalDiscountAmount > 0 && subtotalAfterItemDiscounts > 0
    ? globalDiscountAmount / subtotalAfterItemDiscounts
    : 0;
  const documentAllowances = globalDiscountAmount > 0
    ? taxBreakdownEntries.map(([rate, breakdown]) => ({
        rate,
        categoryCode: getTaxCategoryCode(Number(rate), options.company.isSmallBusiness),
        amount: roundToCents(globalRatio > 0 ? breakdown.taxableAmount * (globalRatio / (1 - globalRatio)) : 0),
      }))
    : [];
  const allowanceTotalAmount = roundToCents(documentAllowances.reduce((sum, a) => sum + a.amount, 0));
  const taxExclusiveAmount = roundToCents(headerLineExtensionAmount - allowanceTotalAmount);

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
    const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount;
    const bic = paymentInfo?.bic || options.company.bic || 'XXXXXXXX';
    const accountHolder = paymentInfo?.accountHolder || options.company.name;
    
    const bankInfo = bankAccount ? `${escapeXML(accountHolder)} - BIC: ${escapeXML(bic)}  IBAN: ${escapeXML(bankAccount)}` : '';
    const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items)
      ? getTaxExemptionReason(getTaxCategoryCode(0, options.company.isSmallBusiness))
      : '';

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
          <cbc:IdentificationCode>${getCountryCode(options.company.country)}</cbc:IdentificationCode>
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
          <cbc:IdentificationCode>${getCountryCode(options.customer.country)}</cbc:IdentificationCode>
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
  ${documentAllowances.map(allowance => `
  <cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="EUR">${formatAmountForXML(allowance.amount)}</cbc:Amount>
    <cac:TaxCategory>
      <cbc:ID>${allowance.categoryCode}</cbc:ID>
      <cbc:Percent>${allowance.rate}</cbc:Percent>
      <cac:TaxScheme>
        <cbc:ID>VAT</cbc:ID>
      </cac:TaxScheme>
    </cac:TaxCategory>
  </cac:AllowanceCharge>`).join('')}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${formatAmountForXML(headerTaxAmount)}</cbc:TaxAmount>
    ${taxBreakdownEntries
      .map(([rate, breakdown]) => {
        const categoryCode = getTaxCategoryCode(Number(rate), options.company.isSmallBusiness);
        const exemptionReason = getTaxExemptionReason(categoryCode);
        return `
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${formatAmountForXML(breakdown.taxableAmount)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${formatAmountForXML(roundToCents(breakdown.taxAmount))}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${categoryCode}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>${exemptionReason ? `
        <cbc:TaxExemptionReason>${escapeXML(exemptionReason)}</cbc:TaxExemptionReason>` : ''}
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>`;
      }).join('')}
  </cac:TaxTotal>

  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${formatAmountForXML(headerLineExtensionAmount)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${formatAmountForXML(taxExclusiveAmount)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${formatAmountForXML(invoice.total)}</cbc:TaxInclusiveAmount>
    <cbc:AllowanceTotalAmount currencyID="EUR">${formatAmountForXML(allowanceTotalAmount)}</cbc:AllowanceTotalAmount>
    <cbc:ChargeTotalAmount currencyID="EUR">0.00</cbc:ChargeTotalAmount>
    <cbc:PrepaidAmount currencyID="EUR">0.00</cbc:PrepaidAmount>
    <cbc:PayableRoundingAmount currencyID="EUR">0.00</cbc:PayableRoundingAmount>
    <cbc:PayableAmount currencyID="EUR">${formatAmountForXML(invoice.total)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  
  ${invoice.items.map((item, index) => `
  <cac:InvoiceLine>
    <cbc:ID>${index + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${formatAmountForXML(item.quantity)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">${formatAmountForXML((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</cbc:LineExtensionAmount>${(item.discountAmount || 0) > 0 ? `
    <cac:AllowanceCharge>
      <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
      <cbc:AllowanceChargeReason>Rabatt</cbc:AllowanceChargeReason>
      <cbc:Amount currencyID="EUR">${formatAmountForXML(item.discountAmount || 0)}</cbc:Amount>
    </cac:AllowanceCharge>` : ''}
    <cac:Item>
      <cbc:Description>${item.description}</cbc:Description>
      <cbc:Name>${item.description}</cbc:Name>
      <cac:SellersItemIdentification>
        <cbc:ID>ITEM-${index + 1}</cbc:ID>
      </cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${getTaxCategoryCode(item.taxRate, options.company.isSmallBusiness)}</cbc:ID>
        <cbc:Percent>${item.taxRate}</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="EUR">${formatAmountForXML(item.unitPrice)}</cbc:PriceAmount>
      <cbc:BaseQuantity unitCode="C62">1.00</cbc:BaseQuantity>
    </cac:Price>
  </cac:InvoiceLine>`).join('')}
</ubl:Invoice>`;

  const blob = new Blob([xmlContent], { type: 'application/xml' });
  return Promise.resolve(blob);
}


