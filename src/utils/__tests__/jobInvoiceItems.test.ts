import { describe, it, expect } from 'vitest';
import { buildInvoiceItemsFromJobs, buildInvoiceFromJobs } from '../jobInvoiceItems';
import { JobEntry } from '../../types';

/**
 * Auftrag → Rechnung.
 *
 * Frühere Fehler, die hier abgesichert werden:
 *  - Positionsrabatte von Zeiteinträgen/Materialien wurden nicht übernommen;
 *    `item.total` trug den rabattierten Wert, `subtotal` war Σ(Menge × Preis)
 *    OHNE Rabatt und die Steuer wurde auf dem vollen Betrag berechnet.
 *  - Die Summen liefen über eine eigene Implementierung statt über das Modul,
 *    das Editoren, PDF und eRechnung verwenden.
 *
 * Materialien liegen als JSONB am Auftrag und transportieren beliebige Felder —
 * Rabattangaben können also per Restore oder API in den Bestand gelangen, auch
 * ohne Eingabemaske.
 */

const job = (o: Partial<JobEntry> = {}): JobEntry => ({
  id: 'job-1',
  jobNumber: 'A-001',
  customerId: 'cust-1',
  customerName: 'Kunde AG',
  title: 'Auftrag A',
  description: 'Arbeiten',
  date: new Date('2026-03-01'),
  hoursWorked: 0,
  hourlyRate: 0,
  status: 'completed',
  materials: [],
  timeEntries: [],
  createdAt: new Date('2026-03-01'),
  updatedAt: new Date('2026-03-01'),
  ...o,
} as JobEntry);

const timeEntry = (o: Record<string, unknown> = {}) => ({
  id: 't1',
  description: 'Montage',
  hoursWorked: 2,
  hourlyRate: 60,
  taxRate: 19,
  total: 120,
  ...o,
});

const material = (o: Record<string, unknown> = {}) => ({
  id: 'm1',
  description: 'Kabel',
  quantity: 10,
  unitPrice: 5,
  taxRate: 19,
  total: 50,
  ...o,
});

const round = (n: number) => Math.round(n * 100) / 100;

describe('buildInvoiceItemsFromJobs', () => {
  it('erzeugt je Zeiteintrag und Material eine Position, Zeiten zuerst', () => {
    const items = buildInvoiceItemsFromJobs([
      job({ timeEntries: [timeEntry()] as never, materials: [material()] as never }),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('time-entry-t1');
    expect(items[1].id).toBe('material-m1');
    expect(items[0].order).toBe(1);
    expect(items[1].order).toBe(2);
    expect(items[0].description).toBe('Auftrag A - Montage');
  });

  it('nutzt die Legacy-Stunden nur, wenn keine Zeiteinträge vorhanden sind', () => {
    const withEntries = buildInvoiceItemsFromJobs([
      job({ hoursWorked: 5, hourlyRate: 50, timeEntries: [timeEntry()] as never }),
    ]);
    expect(withEntries).toHaveLength(1);
    expect(withEntries[0].id).toBe('time-entry-t1');

    const legacy = buildInvoiceItemsFromJobs([job({ hoursWorked: 5, hourlyRate: 50 })]);
    expect(legacy).toHaveLength(1);
    expect(legacy[0].id).toBe('job-job-1');
    expect(legacy[0].quantity).toBe(5);
    expect(legacy[0].unitPrice).toBe(50);
  });

  it('übernimmt Rabattangaben von Zeiteinträgen und Materialien', () => {
    const items = buildInvoiceItemsFromJobs([
      job({
        timeEntries: [timeEntry({ discountType: 'percentage', discountValue: 10 })] as never,
        materials: [material({ discountType: 'fixed', discountValue: 8 })] as never,
      }),
    ]);

    expect(items[0].discountType).toBe('percentage');
    expect(items[0].discountValue).toBe(10);
    expect(items[0].discountAmount).toBe(12); // 10% von 120
    expect(items[0].total).toBe(108);

    expect(items[1].discountType).toBe('fixed');
    expect(items[1].discountAmount).toBe(8);
    expect(items[1].total).toBe(42);
  });

  it('hält item.total konsistent zu Menge × Preis − Rabatt', () => {
    const items = buildInvoiceItemsFromJobs([
      job({ materials: [material({ discountType: 'percentage', discountValue: 20 })] as never }),
    ]);

    for (const i of items) {
      expect(i.total).toBe(i.quantity * i.unitPrice - (i.discountAmount || 0));
    }
  });

  it('normalisiert bei Kleinunternehmerregelung alle Sätze auf 0', () => {
    const items = buildInvoiceItemsFromJobs(
      [job({ timeEntries: [timeEntry({ taxRate: 19 })] as never, materials: [material({ taxRate: 7 })] as never })],
      true
    );

    expect(items.map(i => i.taxRate)).toEqual([0, 0]);
  });

  it('fällt ohne gespeicherten Steuersatz auf 19% zurück', () => {
    const items = buildInvoiceItemsFromJobs([
      job({ materials: [material({ taxRate: undefined })] as never }),
    ]);
    expect(items[0].taxRate).toBe(19);
  });

  it('nummeriert Positionen über mehrere Aufträge fortlaufend', () => {
    const items = buildInvoiceItemsFromJobs([
      job({ id: 'j1', materials: [material({ id: 'm1' })] as never }),
      job({ id: 'j2', title: 'Auftrag B', materials: [material({ id: 'm2' })] as never }),
    ]);

    expect(items.map(i => i.order)).toEqual([1, 2]);
    expect(items[1].description).toBe('Auftrag B - Kabel');
  });
});

describe('buildInvoiceFromJobs — Summen', () => {
  it('rechnet ohne Rabatte wie bisher (kein Regressionsrisiko für Bestandsfälle)', () => {
    const { subtotal, taxAmount, total } = buildInvoiceFromJobs([
      job({ timeEntries: [timeEntry()] as never, materials: [material()] as never }),
    ]);

    expect(subtotal).toBe(170);
    expect(round(taxAmount)).toBe(32.3);
    expect(round(total)).toBe(202.3);
  });

  // Kernregression: die Steuer muss auf dem rabattierten Betrag beruhen.
  it('berechnet Steuer und Summe auf dem rabattierten Betrag', () => {
    const { subtotal, taxAmount, total } = buildInvoiceFromJobs([
      job({ materials: [material({ discountType: 'percentage', discountValue: 20 })] as never }),
    ]);

    expect(subtotal).toBe(50);           // brutto, vor Rabatt
    expect(round(taxAmount)).toBe(7.6);  // 19% auf 40, nicht auf 50
    expect(round(total)).toBe(47.6);     // nicht 59.50
  });

  it('bleibt bei Kleinunternehmerregelung steuerfrei, auch mit Rabatt', () => {
    const { taxAmount, total } = buildInvoiceFromJobs(
      [job({ materials: [material({ discountType: 'percentage', discountValue: 20 })] as never })],
      true
    );

    expect(taxAmount).toBe(0);
    expect(total).toBe(40);
  });

  it('summiert gemischte Steuersätze und Rabatte über mehrere Aufträge', () => {
    const { subtotal, taxAmount } = buildInvoiceFromJobs([
      job({ id: 'j1', materials: [material({ id: 'm1', taxRate: 19 })] as never }),
      job({
        id: 'j2',
        materials: [material({ id: 'm2', taxRate: 7, discountType: 'fixed', discountValue: 10 })] as never,
      }),
    ]);

    expect(subtotal).toBe(100);
    // 50 × 19% + 40 × 7% = 9,50 + 2,80
    expect(round(taxAmount)).toBe(12.3);
  });

  it('liefert leere Summen ohne Aufträge', () => {
    const { items, subtotal, taxAmount, total } = buildInvoiceFromJobs([]);
    expect(items).toEqual([]);
    expect(subtotal).toBe(0);
    expect(taxAmount).toBe(0);
    expect(total).toBe(0);
  });
});
