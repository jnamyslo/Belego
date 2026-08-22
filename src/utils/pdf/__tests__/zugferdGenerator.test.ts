import { describe, it, expect } from 'vitest';
import { generateZUGFeRDXML } from '../zugferdGenerator';
import { testInvoice, testItem, testOptions, tag, tags } from './fixtures';

/**
 * ZUGFeRD 2.1 (UN/CEFACT CII), gleiche EN-16931-Regeln wie XRechnung, andere
 * Element-Namen. Getestet werden dieselben vier bisher ungeprüften Fälle.
 */

const num = (s: string | null) => Number(s);
const lineItems = (xml: string) => tags(xml, 'ram:IncludedSupplyChainTradeLineItem');

/** Nur die Kopf-Steuergruppen (Positionen haben ebenfalls ApplicableTradeTax). */
const headerTradeTaxes = (xml: string) => {
  const settlement = tags(xml, 'ram:ApplicableHeaderTradeSettlement')[0] || '';
  return tags(settlement, 'ram:ApplicableTradeTax');
};

describe('generateZUGFeRDXML', () => {
  describe('Standardfall (19%)', () => {
    it('erzeugt gültigen CII-Rahmen mit Typcode 380', () => {
      const inv = testInvoice([testItem({ quantity: 2, unitPrice: 100 })], { taxAmount: 38, total: 238 });
      const xml = generateZUGFeRDXML(inv, testOptions());

      expect(xml).toContain('<rsm:CrossIndustryInvoice');
      // Die Rechnungsnummer steht in ExchangedDocument — das erste ram:ID im
      // Dokument ist die Peppol-BusinessProcess-ID, nicht die Rechnungsnummer.
      const exchanged = tags(xml, 'rsm:ExchangedDocument')[0];
      expect(tag(exchanged, 'ram:ID')).toBe('RE-2026-001');
      expect(tag(exchanged, 'ram:TypeCode')).toBe('380');
    });

    it('meldet eine Kopf-Steuergruppe mit Kategorie S', () => {
      const inv = testInvoice([testItem({ quantity: 2, unitPrice: 100 })], { taxAmount: 38, total: 238 });
      const xml = generateZUGFeRDXML(inv, testOptions());
      const header = headerTradeTaxes(xml);

      expect(header).toHaveLength(1);
      expect(tag(header[0], 'ram:CategoryCode')).toBe('S');
      expect(tag(header[0], 'ram:RateApplicablePercent')).toBe('19');
      expect(num(tag(header[0], 'ram:BasisAmount'))).toBeCloseTo(200, 2);
      expect(num(tag(header[0], 'ram:CalculatedAmount'))).toBeCloseTo(38, 2);
    });
  });

  describe('Fall 1 — Kleinunternehmer §19 UStG', () => {
    it('meldet Kategorie E mit 0% und Ausnahmegrund', () => {
      const inv = testInvoice([testItem({ taxRate: 0, total: 100 })], { taxAmount: 0, total: 100 });
      const xml = generateZUGFeRDXML(inv, testOptions({ isSmallBusiness: true }));
      const header = headerTradeTaxes(xml);

      expect(tag(header[0], 'ram:CategoryCode')).toBe('E');
      expect(tag(header[0], 'ram:RateApplicablePercent')).toBe('0');
      expect(tag(header[0], 'ram:ExemptionReason')).toContain('§ 19 UStG');
    });

    // Gleicher Regressionstest wie bei XRechnung: Position und Kopf müssen
    // denselben Satz melden, auch wenn die Position noch 19% gespeichert hat.
    it('normalisiert veraltete 19%-Positionen auf E/0', () => {
      const inv = testInvoice([testItem({ taxRate: 19, total: 100 })], { taxAmount: 0, total: 100 });
      const xml = generateZUGFeRDXML(inv, testOptions({ isSmallBusiness: true }));

      const lineTax = tags(lineItems(xml)[0], 'ram:ApplicableTradeTax')[0];
      expect(tag(lineTax, 'ram:CategoryCode')).toBe('E');
      expect(tag(lineTax, 'ram:RateApplicablePercent')).toBe('0');
      expect(xml).not.toContain('<ram:RateApplicablePercent>19</ram:RateApplicablePercent>');
    });
  });

  describe('Fall 2 — Reverse Charge §13b UStG', () => {
    it('meldet Kategorie AE mit 0% und Hinweis auf §13b', () => {
      const inv = testInvoice([testItem({ unitPrice: 500, taxRate: 0, total: 500 })], { taxAmount: 0, total: 500 });
      const xml = generateZUGFeRDXML(inv, testOptions({ isSmallBusiness: false }));
      const header = headerTradeTaxes(xml);

      expect(tag(header[0], 'ram:CategoryCode')).toBe('AE');
      expect(tag(header[0], 'ram:RateApplicablePercent')).toBe('0');
      expect(tag(header[0], 'ram:ExemptionReason')).toContain('§ 13b UStG');
      expect(tag(xml, 'ram:Content')).toContain('13b');
    });
  });

  describe('Fall 3 — mehrere Steuersätze mit Gesamtrabatt', () => {
    const multiRate = () =>
      testInvoice(
        [
          testItem({ id: 'a', unitPrice: 100, taxRate: 19, total: 100 }),
          testItem({ id: 'b', unitPrice: 100, taxRate: 7, total: 100, order: 2 }),
        ],
        {
          globalDiscountType: 'percentage',
          globalDiscountValue: 10,
          globalDiscountAmount: 20,
          taxAmount: 23.4,
          total: 203.4,
        }
      );

    it('meldet je Steuersatz eine Kopfgruppe, aufsteigend', () => {
      const xml = generateZUGFeRDXML(multiRate(), testOptions());
      const header = headerTradeTaxes(xml);

      expect(header).toHaveLength(2);
      expect(tag(header[0], 'ram:RateApplicablePercent')).toBe('7');
      expect(tag(header[1], 'ram:RateApplicablePercent')).toBe('19');
    });

    it('erfüllt BR-CO-13/14 in der MonetarySummation', () => {
      const xml = generateZUGFeRDXML(multiRate(), testOptions());
      const summation = tags(xml, 'ram:SpecifiedTradeSettlementHeaderMonetarySummation')[0];

      expect(num(tag(summation, 'ram:LineTotalAmount'))).toBeCloseTo(200, 2);
      expect(num(tag(summation, 'ram:AllowanceTotalAmount'))).toBeCloseTo(20, 2);
      expect(num(tag(summation, 'ram:TaxBasisTotalAmount'))).toBeCloseTo(180, 2);
      expect(num(tag(summation, 'ram:TaxTotalAmount'))).toBeCloseTo(23.4, 2);

      const perCategory = headerTradeTaxes(xml)
        .reduce((s, t) => s + num(tag(t, 'ram:CalculatedAmount')), 0);
      expect(num(tag(summation, 'ram:TaxTotalAmount'))).toBeCloseTo(perCategory, 2);
    });
  });

  describe('Fall 4 — Positionsrabatte (BR-CO-10)', () => {
    it('LineTotalAmount (Kopf) == Summe der Positions-Nettobeträge', () => {
      const inv = testInvoice(
        [
          testItem({
            id: 'a', unitPrice: 100, taxRate: 19,
            discountType: 'percentage', discountValue: 10, discountAmount: 10, total: 90,
          }),
          testItem({ id: 'b', unitPrice: 50, taxRate: 19, total: 50, order: 2 }),
        ],
        { taxAmount: 26.6, total: 166.6 }
      );
      const xml = generateZUGFeRDXML(inv, testOptions());

      const summation = tags(xml, 'ram:SpecifiedTradeSettlementHeaderMonetarySummation')[0];
      const lineSum = lineItems(xml).reduce(
        (s, l) => s + num(tag(l, 'ram:LineTotalAmount')), 0
      );

      expect(num(tag(summation, 'ram:LineTotalAmount'))).toBeCloseTo(140, 2);
      expect(lineSum).toBeCloseTo(140, 2);
    });

    it('bildet den Positionsrabatt als SpecifiedTradeAllowanceCharge ab', () => {
      const inv = testInvoice(
        [testItem({ unitPrice: 100, discountAmount: 10, total: 90 })],
        { taxAmount: 17.1, total: 107.1 }
      );
      const xml = generateZUGFeRDXML(inv, testOptions());
      const allowance = tags(lineItems(xml)[0], 'ram:SpecifiedTradeAllowanceCharge')[0];

      expect(allowance).toBeDefined();
      expect(num(tag(allowance, 'ram:ActualAmount'))).toBeCloseTo(10, 2);
      expect(tag(allowance, 'ram:Reason')).toBe('Rabatt');
    });
  });

  describe('Stammdaten', () => {
    it('mappt Ländernamen auf ISO-Codes', () => {
      const inv = testInvoice([testItem()], { taxAmount: 19, total: 119 });
      const xml = generateZUGFeRDXML(inv, testOptions({ country: 'Frankreich' }, { country: 'Italien' }));
      const codes = tags(xml, 'ram:CountryID');

      expect(codes).toContain('FR');
      expect(codes).toContain('IT');
    });

    it('escaped Sonderzeichen im Firmennamen', () => {
      const inv = testInvoice([testItem()], { taxAmount: 19, total: 119 });
      const xml = generateZUGFeRDXML(inv, testOptions({ name: 'Meier & Söhne' }));

      expect(xml).toContain('Meier &amp; Söhne');
    });
  });
});
