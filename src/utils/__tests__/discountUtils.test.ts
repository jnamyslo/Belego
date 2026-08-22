import { describe, it, expect } from 'vitest';
import { calculateInvoiceWithDiscounts, InvoiceLineItemInput } from '../discountUtils';

/**
 * Diese Funktion ist die einzige Quelle für Rechnungs-/Angebotssummen:
 * InvoiceEditor, QuoteEditor, PDF-Erzeugung (jsPDF), ZUGFeRD- und
 * XRechnung-Generator rechnen alle darüber. Fehler hier schlagen direkt auf
 * Rechnungsbeträge und die eRechnung durch.
 */

const item = (o: Partial<InvoiceLineItemInput> = {}): InvoiceLineItemInput => ({
  quantity: 1,
  unitPrice: 100,
  taxRate: 19,
  ...o,
});

const round = (n: number) => Math.round(n * 100) / 100;

describe('calculateInvoiceWithDiscounts', () => {
  describe('Grundfall ohne Rabatte', () => {
    it('summiert Positionen und rechnet 19% MwSt.', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ quantity: 2, unitPrice: 100 }),
        item({ quantity: 1, unitPrice: 50 }),
      ]);

      expect(r.subtotal).toBe(250);
      expect(r.itemDiscountAmount).toBe(0);
      expect(r.globalDiscountAmount).toBe(0);
      expect(r.discountedSubtotal).toBe(250);
      expect(round(r.taxAmount)).toBe(47.5);
      expect(round(r.total)).toBe(297.5);
      expect(r.hasOnlyZeroTax).toBe(false);
    });

    it('liefert leere Summen für eine Rechnung ohne Positionen', () => {
      const r = calculateInvoiceWithDiscounts([]);

      expect(r.subtotal).toBe(0);
      expect(r.taxAmount).toBe(0);
      expect(r.total).toBe(0);
      expect(r.taxBreakdown).toEqual({});
      // Ohne Positionen ist "nur 0%" nicht sinnvoll ableitbar.
      expect(r.hasOnlyZeroTax).toBe(false);
    });
  });

  describe('Kleinunternehmerregelung (§19 UStG)', () => {
    // Regressionstest: Diese Normalisierung fehlte früher im QuoteEditor,
    // wodurch Angebote eines Kleinunternehmers MwSt. auswiesen.
    it('erzwingt 0% MwSt., auch wenn Positionen 19% gespeichert haben', () => {
      const items = [item({ taxRate: 19 }), item({ taxRate: 7 })];

      const r = calculateInvoiceWithDiscounts(items, {}, true);

      expect(r.subtotal).toBe(200);
      expect(r.taxAmount).toBe(0);
      expect(r.total).toBe(200);
      expect(r.hasOnlyZeroTax).toBe(true);
      expect(Object.keys(r.taxBreakdown)).toEqual(['0']);
    });

    it('verändert die übergebenen Positionen nicht', () => {
      const items = [item({ taxRate: 19 })];
      calculateInvoiceWithDiscounts(items, {}, true);
      expect(items[0].taxRate).toBe(19);
    });

    it('rechnet ohne Kleinunternehmerregelung normal weiter', () => {
      const r = calculateInvoiceWithDiscounts([item({ taxRate: 19 })], {}, false);
      expect(round(r.taxAmount)).toBe(19);
    });
  });

  describe('Steueraufschlüsselung nach Satz', () => {
    it('gruppiert mehrere Steuersätze getrennt', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ unitPrice: 100, taxRate: 19 }),
        item({ unitPrice: 100, taxRate: 7 }),
      ]);

      expect(round(r.taxBreakdown[19].taxableAmount)).toBe(100);
      expect(round(r.taxBreakdown[19].taxAmount)).toBe(19);
      expect(round(r.taxBreakdown[7].taxableAmount)).toBe(100);
      expect(round(r.taxBreakdown[7].taxAmount)).toBe(7);
      expect(round(r.taxAmount)).toBe(26);
    });

    it('fasst Positionen mit gleichem Satz zusammen', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ unitPrice: 100, taxRate: 19 }),
        item({ unitPrice: 200, taxRate: 19 }),
      ]);

      expect(Object.keys(r.taxBreakdown)).toEqual(['19']);
      expect(round(r.taxBreakdown[19].taxableAmount)).toBe(300);
    });

    it('behält eine 0%-Gruppe (BR-CO-18: Aufschlüsselung darf nicht fehlen)', () => {
      const r = calculateInvoiceWithDiscounts([item({ taxRate: 0 })]);
      expect(r.taxBreakdown[0]).toBeDefined();
      expect(r.taxBreakdown[0].taxableAmount).toBe(100);
      expect(r.taxBreakdown[0].taxAmount).toBe(0);
    });
  });

  describe('Positionsrabatte', () => {
    it('zieht einen Prozentrabatt von der Bemessungsgrundlage ab', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ unitPrice: 100, discountType: 'percentage', discountValue: 10 }),
      ]);

      // subtotal bleibt brutto (vor Rabatt) — darauf verlassen sich PDF und XML.
      expect(r.subtotal).toBe(100);
      expect(r.itemDiscountAmount).toBe(10);
      expect(r.discountedSubtotal).toBe(90);
      expect(round(r.taxAmount)).toBe(17.1);
      expect(round(r.total)).toBe(107.1);
    });

    it('zieht einen Festbetragsrabatt ab', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ unitPrice: 100, discountType: 'fixed', discountValue: 25 }),
      ]);

      expect(r.itemDiscountAmount).toBe(25);
      expect(r.discountedSubtotal).toBe(75);
    });

    it('deckelt einen Festbetragsrabatt auf den Positionswert', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ unitPrice: 100, discountType: 'fixed', discountValue: 500 }),
      ]);

      expect(r.itemDiscountAmount).toBe(100);
      expect(r.discountedSubtotal).toBe(0);
      expect(r.taxAmount).toBe(0);
    });

    it('deckelt einen Prozentrabatt auf 100%', () => {
      const r = calculateInvoiceWithDiscounts([
        item({ unitPrice: 100, discountType: 'percentage', discountValue: 150 }),
      ]);

      expect(r.itemDiscountAmount).toBe(100);
      expect(r.discountedSubtotal).toBe(0);
    });
  });

  describe('Gesamtrabatt', () => {
    it('wendet einen Prozentrabatt an und reduziert die Steuer proportional', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ quantity: 2, unitPrice: 100, taxRate: 19 })],
        { type: 'percentage', value: 10 }
      );

      expect(r.subtotal).toBe(200);
      expect(r.globalDiscountAmount).toBe(20);
      expect(r.discountedSubtotal).toBe(180);
      expect(round(r.taxAmount)).toBe(34.2);
      expect(round(r.total)).toBe(214.2);
    });

    it('verteilt den Gesamtrabatt proportional über mehrere Steuersätze', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ unitPrice: 100, taxRate: 19 }), item({ unitPrice: 100, taxRate: 7 })],
        { type: 'percentage', value: 50 }
      );

      expect(r.globalDiscountAmount).toBe(100);
      expect(round(r.taxBreakdown[19].taxableAmount)).toBe(50);
      expect(round(r.taxBreakdown[7].taxableAmount)).toBe(50);
      expect(round(r.taxAmount)).toBe(round(9.5 + 3.5));
    });

    it('kombiniert Positions- und Gesamtrabatt', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ unitPrice: 100, discountType: 'percentage', discountValue: 10 })],
        { type: 'percentage', value: 10 }
      );

      expect(r.subtotal).toBe(100);
      expect(r.itemDiscountAmount).toBe(10);
      // Gesamtrabatt greift auf der bereits positionsrabattierten Summe (90).
      expect(r.globalDiscountAmount).toBe(9);
      expect(r.totalDiscountAmount).toBe(19);
      expect(round(r.discountedSubtotal)).toBe(81);
    });

    // Regressionstest gegen den falschen Nenner: der Gesamtrabatt-Anteil muss
    // auf der Summe NACH Positionsrabatten basieren, nicht auf der Bruttosumme.
    // Ohne Positionsrabatt sind beide identisch — der Fehler wäre unsichtbar.
    it('bezieht den proportionalen Anteil auf die Summe nach Positionsrabatten', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ unitPrice: 100, taxRate: 19, discountType: 'percentage', discountValue: 10 })],
        { type: 'percentage', value: 10 }
      );

      // 100 brutto − 10 Positionsrabatt = 90; davon 10% = 9 Gesamtrabatt → 81 netto.
      expect(r.discountedSubtotal).toBe(81);
      // Bemessungsgrundlage muss auf 81 fallen (90 × (1 − 9/90)), nicht auf 81,9 (90 × (1 − 9/100)).
      expect(round(r.taxBreakdown[19].taxableAmount)).toBe(81);
      expect(round(r.taxAmount)).toBe(15.39);
      expect(round(r.total)).toBe(96.39);
    });

    it('deckelt einen Gesamt-Festbetrag auf die Zwischensumme', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ unitPrice: 100 })],
        { type: 'fixed', value: 9999 }
      );

      expect(r.globalDiscountAmount).toBe(100);
      expect(r.discountedSubtotal).toBe(0);
      expect(r.total).toBe(0);
    });

    it('kommt mit Gesamtrabatt auf einer Nullsumme klar (keine Division durch 0)', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ unitPrice: 0 })],
        { type: 'percentage', value: 10 }
      );

      expect(Number.isNaN(r.taxAmount)).toBe(false);
      expect(Number.isNaN(r.total)).toBe(false);
      expect(r.total).toBe(0);
    });
  });

  describe('Kleinunternehmer kombiniert mit Rabatten', () => {
    it('bleibt bei 0% MwSt., auch mit Positions- und Gesamtrabatt', () => {
      const r = calculateInvoiceWithDiscounts(
        [item({ unitPrice: 100, taxRate: 19, discountType: 'percentage', discountValue: 10 })],
        { type: 'percentage', value: 10 },
        true
      );

      expect(r.taxAmount).toBe(0);
      expect(round(r.total)).toBe(81);
      expect(r.hasOnlyZeroTax).toBe(true);
    });
  });
});
