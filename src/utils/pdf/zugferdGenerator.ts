/**
 * ZUGFeRD XML generator
 * Generates ZUGFeRD 2.1 compliant XML based on EN 16931 standard
 */

import { PDFDocument, AFRelationship } from 'pdf-lib';
import { Invoice } from '../../types';
import { PDFOptions } from '../pdfGenerator';
import logger from '../logger';
import { escapeXML, formatAmountForXML, roundToCents, getCountryCode } from './xmlUtils';
import { calculateTaxBreakdown, hasOnlyZeroTaxRate, getTaxCategoryCode, getTaxExemptionReason } from './taxCalculations';

/**
 * Generate ZUGFeRD XML string
 * @param invoice - Invoice data
 * @param options - PDF options with company and customer data
 * @returns ZUGFeRD XML string
 */
export function generateZUGFeRDXML(invoice: Invoice, options: PDFOptions): string {
  // Use new payment information or fall back to legacy fields
  const paymentInfo = options.company.paymentInformation;

  // Tax breakdown (sorted by rate), shared between header total and per-rate tax groups.
  const taxBreakdownEntries = Object.entries(calculateTaxBreakdown(invoice.items, invoice))
    .sort(([rateA], [rateB]) => Number(rateA) - Number(rateB));
  // BR-CO-14: header tax = sum of the already-rounded per-category amounts.
  const headerTaxAmount = taxBreakdownEntries.reduce((sum, [, breakdown]) => sum + roundToCents(breakdown.taxAmount), 0);

  const itemDiscountTotal = invoice.items?.reduce((sum, item) => sum + (item.discountAmount || 0), 0) || 0;
  const globalDiscountAmount = invoice.globalDiscountAmount || 0;

  // BR-CO-10: header line total = sum of line net amounts (item discounts already subtracted per line).
  const headerLineExtensionAmount = roundToCents(invoice.subtotal - itemDiscountTotal);

  // Global (document-level) discount modelled as one allowance per tax rate, split
  // proportionally (see xrechnungGenerator for the derivation), so BR-CO-11/13 hold.
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
        const bankAccount = paymentInfo?.bankAccount || options.company.bankAccount || '';
        const bic = paymentInfo?.bic || options.company.bic || 'COBADEFFXXX';
        const accountHolder = paymentInfo?.accountHolder || options.company.name;
        
        const bankInfo = `${accountHolder} - BIC: ${bic}  IBAN: ${bankAccount}`;
        const reverseChargeNote = hasOnlyZeroTaxRate(invoice.items)
          ? getTaxExemptionReason(getTaxCategoryCode(0, options.company.isSmallBusiness))
          : '';

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
					<ram:ChargeAmount>${formatAmountForXML(item.unitPrice)}</ram:ChargeAmount>
					<ram:BasisQuantity unitCode="C62">1</ram:BasisQuantity>
				</ram:NetPriceProductTradePrice>
			</ram:SpecifiedLineTradeAgreement>
			<ram:SpecifiedLineTradeDelivery>
				<ram:BilledQuantity unitCode="C62">${item.quantity}</ram:BilledQuantity>
			</ram:SpecifiedLineTradeDelivery>
			<ram:SpecifiedLineTradeSettlement>
				<ram:ApplicableTradeTax>
					<ram:TypeCode>VAT</ram:TypeCode>
					<ram:CategoryCode>${getTaxCategoryCode(item.taxRate, options.company.isSmallBusiness)}</ram:CategoryCode>
					<ram:RateApplicablePercent>${item.taxRate}</ram:RateApplicablePercent>
				</ram:ApplicableTradeTax>${(item.discountAmount || 0) > 0 ? `
				<ram:SpecifiedTradeAllowanceCharge>
					<ram:ChargeIndicator>
						<udt:Indicator>false</udt:Indicator>
					</ram:ChargeIndicator>
					<ram:ActualAmount>${formatAmountForXML(item.discountAmount || 0)}</ram:ActualAmount>
					<ram:Reason>Rabatt</ram:Reason>
				</ram:SpecifiedTradeAllowanceCharge>` : ''}
				<ram:SpecifiedTradeSettlementLineMonetarySummation>
					<ram:LineTotalAmount>${formatAmountForXML((item.quantity * item.unitPrice) - (item.discountAmount || 0))}</ram:LineTotalAmount>
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
					<ram:CountryID>${getCountryCode(options.company.country)}</ram:CountryID>
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
					<ram:CountryID>${getCountryCode(options.customer.country)}</ram:CountryID>
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
			${taxBreakdownEntries
				.map(([rate, breakdown]) => {
					const categoryCode = getTaxCategoryCode(Number(rate), options.company.isSmallBusiness);
					const exemptionReason = getTaxExemptionReason(categoryCode);
					return `<ram:ApplicableTradeTax>
				<ram:CalculatedAmount>${formatAmountForXML(roundToCents(breakdown.taxAmount))}</ram:CalculatedAmount>
				<ram:TypeCode>VAT</ram:TypeCode>${exemptionReason ? `
				<ram:ExemptionReason>${escapeXML(exemptionReason)}</ram:ExemptionReason>` : ''}
				<ram:BasisAmount>${formatAmountForXML(breakdown.taxableAmount)}</ram:BasisAmount>
				<ram:CategoryCode>${categoryCode}</ram:CategoryCode>
				<ram:RateApplicablePercent>${rate}</ram:RateApplicablePercent>
			</ram:ApplicableTradeTax>`;
				}).join('')}${documentAllowances.map(allowance => `
			<ram:SpecifiedTradeAllowanceCharge>
				<ram:ChargeIndicator>
					<udt:Indicator>false</udt:Indicator>
				</ram:ChargeIndicator>
				<ram:ActualAmount>${formatAmountForXML(allowance.amount)}</ram:ActualAmount>
				<ram:Reason>Rabatt</ram:Reason>
				<ram:CategoryTradeTax>
					<ram:TypeCode>VAT</ram:TypeCode>
					<ram:CategoryCode>${allowance.categoryCode}</ram:CategoryCode>
					<ram:RateApplicablePercent>${allowance.rate}</ram:RateApplicablePercent>
				</ram:CategoryTradeTax>
			</ram:SpecifiedTradeAllowanceCharge>`).join('')}
			<ram:SpecifiedTradePaymentTerms>
				<ram:Description>/</ram:Description>
				<ram:DueDateDateTime>
					<udt:DateTimeString format="102">${new Date(invoice.dueDate).toISOString().split('T')[0].replace(/-/g, '')}</udt:DateTimeString>
				</ram:DueDateDateTime>
			</ram:SpecifiedTradePaymentTerms>
			<ram:SpecifiedTradeSettlementHeaderMonetarySummation>
				<ram:LineTotalAmount>${formatAmountForXML(headerLineExtensionAmount)}</ram:LineTotalAmount>
				${allowanceTotalAmount > 0 ? `<ram:AllowanceTotalAmount>${formatAmountForXML(allowanceTotalAmount)}</ram:AllowanceTotalAmount>` : ''}
				<ram:TaxBasisTotalAmount>${formatAmountForXML(taxExclusiveAmount)}</ram:TaxBasisTotalAmount>
				<ram:TaxTotalAmount currencyID="EUR">${formatAmountForXML(headerTaxAmount)}</ram:TaxTotalAmount>
				<ram:GrandTotalAmount>${formatAmountForXML(invoice.total)}</ram:GrandTotalAmount>
				<ram:DuePayableAmount>${formatAmountForXML(invoice.total)}</ram:DuePayableAmount>
			</ram:SpecifiedTradeSettlementHeaderMonetarySummation>
		</ram:ApplicableHeaderTradeSettlement>
	</rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

/**
 * Embed ZUGFeRD XML data into a PDF/A-3 compliant document
 * @param pdfBuffer - Original PDF as ArrayBuffer
 * @param invoice - Invoice data
 * @param options - PDF options
 * @returns Promise with Blob containing PDF with embedded XML
 */
export async function embedZUGFeRDXMLIntoPDF(pdfBuffer: ArrayBuffer, invoice: Invoice, options: PDFOptions): Promise<Blob> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer);
    const xmlData = generateZUGFeRDXML(invoice, options);
    
    if (!xmlData || xmlData.trim().length === 0) {
      throw new Error('Generated ZUGFeRD XML is empty');
    }
    
    const xmlBytes = new TextEncoder().encode(xmlData);
    
    pdfDoc.setTitle(`Rechnung ${invoice.invoiceNumber}`);
    pdfDoc.setSubject(`ZUGFeRD invoice ${invoice.invoiceNumber}`);
    pdfDoc.setKeywords(['ZUGFeRD', 'invoice', 'electronic invoice', 'EN 16931']);
    pdfDoc.setProducer('Belego');
    pdfDoc.setCreator('Belego');
    pdfDoc.setCreationDate(new Date());
    pdfDoc.setModificationDate(new Date());
    
    await pdfDoc.attach(xmlBytes, 'ZUGFeRD-invoice.xml', {
      mimeType: 'application/xml',
      description: 'ZUGFeRD invoice data',
      creationDate: new Date(),
      modificationDate: new Date(),
      afRelationship: AFRelationship.Alternative,
    });
    
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


