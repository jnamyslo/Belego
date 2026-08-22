import { describe, it, expect } from 'vitest';
import { generateXRechnungXML } from '../xrechnungGenerator';
import {
  testInvoice,
  testItem,
  testOptions,
  tag,
  tags,
  taxSubtotals,
  invoiceLines,
} from './fixtures';

/**
 * XRechnung 3.0 / EN 16931.
 *
 * Abgedeckt sind gezielt die vier Fälle, die docs/CODE_REVIEW.md als
 * "nie gegen den Validator geprüft" markiert:
 *   1. Kleinunternehmer (0%, Kategorie E, §19 UStG)
 *   2. Reverse Charge (0%, Kategorie AE, §13b UStG)
 *   3. Mehrere Steuersätze + Gesamtrabatt
 *   4. Positionsrabatte (BR-CO-10)
 *
 * Die Regeln, auf die sich die Assertions beziehen:
 *   BR-CO-10  Summe der Positions-Nettobeträge == LineExtensionAmount (Kopf)
 *   BR-CO-13  TaxExclusiveAmount == LineExtensionAmount − AllowanceTotalAmount
 *   BR-CO-14  TaxAmount (Kopf) == Summe der TaxAmount je Kategorie
 *   BR-CO-15  TaxInclusiveAmount == TaxExclusiveAmount + TaxAmount
 *   BR-CO-18  mindestens eine TaxSubtotal-Gruppe
 *   BR-S-05   Kategorie S erfordert Percent > 0
 *   BR-E-05/10 Kategorie E erfordert Percent 0 + Ausnahmegrund
 *   BR-AE-05  Kategorie AE erfordert Percent 0
 */

const xml = async (invoice: Parameters<typeof generateXRechnungXML>[0], options: Parameters<typeof generateXRechnungXML>[1]) =>
  (await generateXRechnungXML(invoice, options)).text();

const num = (s: string | null) => Number(s);

describe('generateXRechnungXML', () => {
  describe('Standardfall (19%, keine Rabatte)', () => {
    it('erzeugt genau eine Steuergruppe mit Kategorie S', async () => {
      const inv = testInvoice([testItem({ quantity: 2, unitPrice: 100, taxRate: 19 })], {
        taxAmount: 38,
        total: 238,
      });
      const out = await xml(inv, testOptions());
      const subtotals = taxSubtotals(out);

      expect(subtotals).toHaveLength(1);
      expect(tag(subtotals[0], 'cbc:ID')).toBe('S');
      expect(tag(subtotals[0], 'cbc:Percent')).toBe('19');
      expect(tag(subtotals[0], 'cbc:TaxableAmount')).toBe('200.00');
      expect(tag(subtotals[0], 'cbc:TaxAmount')).toBe('38.00');
      expect(tag(subtotals[0], 'cbc:TaxExemptionReason')).toBeNull();
    });

    it('erfüllt BR-CO-10/13/14/15 im Kopf', async () => {
      const inv = testInvoice([testItem({ quantity: 2, unitPrice: 100, taxRate: 19 })], {
        taxAmount: 38,
        total: 238,
      });
      const out = await xml(inv, testOptions());

      const line = num(tag(out, 'cbc:LineExtensionAmount'));
      const allowance = num(tag(out, 'cbc:AllowanceTotalAmount'));
      const exclusive = num(tag(out, 'cbc:TaxExclusiveAmount'));
      const inclusive = num(tag(out, 'cbc:TaxInclusiveAmount'));
      const headerTax = num(tag(tags(out, 'cac:TaxTotal')[0], 'cbc:TaxAmount'));

      expect(line).toBe(200);
      expect(allowance).toBe(0);
      // BR-CO-13
      expect(exclusive).toBeCloseTo(line - allowance, 2);
      // BR-CO-14
      expect(headerTax).toBeCloseTo(38, 2);
      // BR-CO-15
      expect(inclusive).toBeCloseTo(exclusive + headerTax, 2);
    });
  });

  describe('Fall 1 — Kleinunternehmer §19 UStG', () => {
    const smallBusinessInvoice = () =>
      testInvoice([testItem({ quantity: 1, unitPrice: 100, taxRate: 0, total: 100 })], {
        taxAmount: 0,
        total: 100,
      });

    it('emittiert eine 0%-Gruppe (BR-CO-18) statt sie herauszufiltern', async () => {
      const out = await xml(smallBusinessInvoice(), testOptions({ isSmallBusiness: true }));
      const subtotals = taxSubtotals(out);

      expect(subtotals).toHaveLength(1);
      expect(tag(subtotals[0], 'cbc:TaxableAmount')).toBe('100.00');
      expect(tag(subtotals[0], 'cbc:TaxAmount')).toBe('0.00');
    });

    it('verwendet Kategorie E mit Percent 0 und Ausnahmegrund (BR-E-05/BR-E-10)', async () => {
      const out = await xml(smallBusinessInvoice(), testOptions({ isSmallBusiness: true }));
      const sub = taxSubtotals(out)[0];

      expect(tag(sub, 'cbc:ID')).toBe('E');
      expect(tag(sub, 'cbc:Percent')).toBe('0');
      expect(tag(sub, 'cbc:TaxExemptionReason')).toContain('§ 19 UStG');
    });

    it('setzt auch auf Positionsebene Kategorie E mit Percent 0', async () => {
      const out = await xml(smallBusinessInvoice(), testOptions({ isSmallBusiness: true }));
      const line = invoiceLines(out)[0];
      const category = tags(line, 'cac:ClassifiedTaxCategory')[0];

      expect(tag(category, 'cbc:ID')).toBe('E');
      expect(tag(category, 'cbc:Percent')).toBe('0');
    });

    // Regressionstest: Position und Kopf müssen denselben Steuersatz melden.
    // Vorher meldete die Position S/19% während der Kopf nur eine E/0%-Gruppe
    // führte — der Validator lehnt das ab (BR-S-05, Position verweist auf eine
    // Kategorie ohne zugehörige TaxSubtotal-Gruppe). Auslöser: Rechnungen, die
    // vor dem Umschalten auf Kleinunternehmer angelegt wurden und noch 19%
    // gespeichert haben, sowie wiederhergestellte Backups.
    it('normalisiert auch veraltete 19%-Positionen auf E/0 (Kopf und Position konsistent)', async () => {
      const staleInvoice = testInvoice(
        [testItem({ quantity: 1, unitPrice: 100, taxRate: 19, total: 100 })],
        { taxAmount: 0, total: 100 }
      );
      const out = await xml(staleInvoice, testOptions({ isSmallBusiness: true }));

      const headerSub = taxSubtotals(out);
      const lineCategory = tags(invoiceLines(out)[0], 'cac:ClassifiedTaxCategory')[0];

      expect(headerSub).toHaveLength(1);
      expect(tag(headerSub[0], 'cbc:ID')).toBe('E');
      expect(tag(headerSub[0], 'cbc:Percent')).toBe('0');

      expect(tag(lineCategory, 'cbc:ID')).toBe('E');
      expect(tag(lineCategory, 'cbc:Percent')).toBe('0');

      // Kein Verweis auf eine S-Kategorie ohne passende Kopfgruppe.
      expect(out).not.toContain('<cbc:Percent>19</cbc:Percent>');
    });
  });

  describe('Fall 2 — Reverse Charge §13b UStG', () => {
    const reverseChargeInvoice = () =>
      testInvoice([testItem({ quantity: 1, unitPrice: 500, taxRate: 0, total: 500 })], {
        taxAmount: 0,
        total: 500,
      });

    it('verwendet Kategorie AE mit Percent 0 (BR-AE-05)', async () => {
      const out = await xml(reverseChargeInvoice(), testOptions({ isSmallBusiness: false }));
      const sub = taxSubtotals(out)[0];

      expect(tag(sub, 'cbc:ID')).toBe('AE');
      expect(tag(sub, 'cbc:Percent')).toBe('0');
      expect(tag(sub, 'cbc:TaxExemptionReason')).toContain('§ 13b UStG');
    });

    it('nennt den Übergang der Steuerschuld im Note-Feld', async () => {
      const out = await xml(reverseChargeInvoice(), testOptions({ isSmallBusiness: false }));
      expect(tag(out, 'cbc:Note')).toContain('13b');
    });
  });

  describe('Fall 3 — mehrere Steuersätze mit Gesamtrabatt', () => {
    const multiRateDiscounted = () =>
      testInvoice(
        [
          testItem({ id: 'a', quantity: 1, unitPrice: 100, taxRate: 19, total: 100 }),
          testItem({ id: 'b', quantity: 1, unitPrice: 100, taxRate: 7, total: 100, order: 2 }),
        ],
        {
          globalDiscountType: 'percentage',
          globalDiscountValue: 10,
          globalDiscountAmount: 20,
          taxAmount: 23.4,
          total: 203.4,
        }
      );

    it('erzeugt je Steuersatz eine Gruppe, aufsteigend sortiert', async () => {
      const out = await xml(multiRateDiscounted(), testOptions());
      const subtotals = taxSubtotals(out);

      expect(subtotals).toHaveLength(2);
      expect(tag(subtotals[0], 'cbc:Percent')).toBe('7');
      expect(tag(subtotals[1], 'cbc:Percent')).toBe('19');
    });

    it('verteilt den Gesamtrabatt als AllowanceCharge je Steuersatz', async () => {
      const out = await xml(multiRateDiscounted(), testOptions());
      const allowances = tags(out, 'cac:AllowanceCharge');

      // Dokumentebene: eine Allowance pro Steuersatz (keine Positionsrabatte hier).
      expect(allowances).toHaveLength(2);
      const sum = allowances.reduce((s, a) => s + num(tag(a, 'cbc:Amount')), 0);
      expect(sum).toBeCloseTo(20, 2);
      // Jede Allowance trägt Kategorie + Satz (BR-CO-11 / BR-CO-13).
      for (const a of allowances) {
        expect(tag(a, 'cbc:ChargeIndicator')).toBe('false');
        expect(['7', '19']).toContain(tag(a, 'cbc:Percent'));
      }
    });

    it('erfüllt BR-CO-13 und BR-CO-14 trotz Rabattverteilung', async () => {
      const out = await xml(multiRateDiscounted(), testOptions());

      const line = num(tag(out, 'cbc:LineExtensionAmount'));
      const allowanceTotal = num(tag(out, 'cbc:AllowanceTotalAmount'));
      const exclusive = num(tag(out, 'cbc:TaxExclusiveAmount'));
      const headerTax = num(tag(tags(out, 'cac:TaxTotal')[0], 'cbc:TaxAmount'));
      const perCategory = taxSubtotals(out)
        .reduce((s, sub) => s + num(tag(sub, 'cbc:TaxAmount')), 0);

      expect(line).toBe(200);
      expect(allowanceTotal).toBeCloseTo(20, 2);
      expect(exclusive).toBeCloseTo(180, 2);
      // BR-CO-14: Kopfsteuer == Summe der Kategoriesteuern
      expect(headerTax).toBeCloseTo(perCategory, 2);
      // 90 × 19% + 90 × 7% = 17,10 + 6,30
      expect(headerTax).toBeCloseTo(23.4, 2);
    });
  });

  describe('Fall 4 — Positionsrabatte (BR-CO-10)', () => {
    const itemDiscounted = () =>
      testInvoice(
        [
          testItem({
            id: 'a',
            quantity: 1,
            unitPrice: 100,
            taxRate: 19,
            discountType: 'percentage',
            discountValue: 10,
            discountAmount: 10,
            total: 90,
          }),
          testItem({ id: 'b', quantity: 1, unitPrice: 50, taxRate: 19, total: 50, order: 2 }),
        ],
        { taxAmount: 26.6, total: 166.6 }
      );

    it('Kopf-LineExtensionAmount == Summe der Positions-Nettobeträge', async () => {
      const out = await xml(itemDiscounted(), testOptions());

      const headerLine = num(tag(out, 'cbc:LineExtensionAmount'));
      const lineSum = invoiceLines(out)
        .reduce((s, l) => s + num(tag(l, 'cbc:LineExtensionAmount')), 0);

      // 90 + 50 — der Positionsrabatt ist bereits abgezogen.
      expect(headerLine).toBe(140);
      expect(lineSum).toBeCloseTo(headerLine, 2);
    });

    it('bildet den Positionsrabatt als AllowanceCharge auf der Position ab', async () => {
      const out = await xml(itemDiscounted(), testOptions());
      const lines = invoiceLines(out);

      const first = tags(lines[0], 'cac:AllowanceCharge');
      expect(first).toHaveLength(1);
      expect(tag(first[0], 'cbc:Amount')).toBe('10.00');
      // Position ohne Rabatt bekommt keine AllowanceCharge.
      expect(tags(lines[1], 'cac:AllowanceCharge')).toHaveLength(0);
    });

    it('zählt Positionsrabatte NICHT in AllowanceTotalAmount (nur Dokumentrabatt)', async () => {
      const out = await xml(itemDiscounted(), testOptions());
      // Ohne Gesamtrabatt muss der Dokument-Rabatt 0 sein, sonst wäre der
      // Positionsrabatt doppelt erfasst (BR-CO-10 und BR-CO-13 gleichzeitig).
      expect(num(tag(out, 'cbc:AllowanceTotalAmount'))).toBe(0);
      expect(num(tag(out, 'cbc:TaxExclusiveAmount'))).toBeCloseTo(140, 2);
    });
  });

  describe('Stammdaten und Escaping', () => {
    it('mappt Ländernamen auf ISO-Codes', async () => {
      const inv = testInvoice([testItem()], { taxAmount: 19, total: 119 });
      const out = await xml(inv, testOptions({ country: 'Österreich' }, { country: 'Schweiz' }));
      const codes = tags(out, 'cbc:IdentificationCode');

      expect(codes).toContain('AT');
      expect(codes).toContain('CH');
    });

    it('escaped XML-Sonderzeichen in Freitextfeldern', async () => {
      const inv = testInvoice([testItem()], {
        notes: 'Meier & Söhne <Abteilung "Bau">',
        taxAmount: 19,
        total: 119,
      });
      const out = await xml(inv, testOptions());

      expect(out).toContain('&amp;');
      expect(out).not.toMatch(/<Abteilung/);
      expect(tag(out, 'cbc:Note')).toContain('&quot;Bau&quot;');
    });

    it('nutzt die Rechnungsnummer als cbc:ID und Typcode 380', async () => {
      const inv = testInvoice([testItem()], { invoiceNumber: 'RE-2026-042', taxAmount: 19, total: 119 });
      const out = await xml(inv, testOptions());

      expect(tag(out, 'cbc:ID')).toBe('RE-2026-042');
      expect(tag(out, 'cbc:InvoiceTypeCode')).toBe('380');
    });
  });
});
