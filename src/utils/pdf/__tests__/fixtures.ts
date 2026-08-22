import { Invoice, InvoiceItem, Company, Customer } from '../../../types';
import { PDFOptions } from '../../pdfGenerator';

/**
 * Minimal-Fixtures für die eRechnung-Tests. Absichtlich klein gehalten:
 * getestet wird die Steuer-/Rabattlogik im XML, nicht die Stammdaten.
 */

export const testCompany = (overrides: Partial<Company> = {}): Company => ({
  name: 'Musterbetrieb GmbH',
  address: 'Musterstraße 1',
  city: 'Berlin',
  postalCode: '10115',
  country: 'Deutschland',
  phone: '030 123456',
  email: 'rechnung@musterbetrieb.de',
  taxId: 'DE123456789',
  ...overrides,
});

export const testCustomer = (overrides: Partial<Customer> = {}): Customer => ({
  id: 'cust-1',
  customerNumber: '0001',
  name: 'Kunde AG',
  email: 'buchhaltung@kunde.de',
  address: 'Kundenweg 2',
  city: 'Hamburg',
  postalCode: '20095',
  country: 'Deutschland',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

export const testItem = (overrides: Partial<InvoiceItem> = {}): InvoiceItem => ({
  id: 'item-1',
  description: 'Leistung',
  quantity: 1,
  unitPrice: 100,
  taxRate: 19,
  total: 100,
  order: 1,
  ...overrides,
});

/**
 * Baut eine Rechnung inkl. der gespeicherten Summenfelder. Die Generatoren
 * lesen invoice.subtotal / invoice.total direkt aus dem Datensatz, daher müssen
 * diese Felder zu den Positionen passen — genau wie beim echten Speichern.
 */
export const testInvoice = (
  items: InvoiceItem[],
  overrides: Partial<Invoice> = {}
): Invoice => {
  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const itemDiscounts = items.reduce((s, i) => s + (i.discountAmount || 0), 0);
  return {
    id: 'inv-1',
    invoiceNumber: 'RE-2026-001',
    customerId: 'cust-1',
    customerName: 'Kunde AG',
    issueDate: new Date('2026-03-01'),
    dueDate: new Date('2026-03-31'),
    items,
    subtotal,
    taxAmount: 0,
    total: subtotal - itemDiscounts,
    status: 'draft',
    createdAt: new Date('2026-03-01'),
    ...overrides,
  } as Invoice;
};

export const testOptions = (
  company: Partial<Company> = {},
  customer: Partial<Customer> = {}
): PDFOptions => ({
  format: 'xrechnung',
  company: testCompany(company),
  customer: testCustomer(customer),
});

/**
 * Baut das Muster für ein Element mit exaktem Namen.
 * Wichtig: nach dem Namen muss '>' oder Whitespace folgen — sonst würde z.B.
 * <rsm:ExchangedDocument> auch auf <rsm:ExchangedDocumentContext> passen und
 * einen viel zu großen Block einfangen.
 */
const elementPattern = (name: string) =>
  `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`;

/** Liest den Inhalt eines Tags (erstes Vorkommen). */
export const tag = (xml: string, name: string): string | null => {
  const m = xml.match(new RegExp(elementPattern(name)));
  return m ? m[1].trim() : null;
};

/** Liest alle Vorkommen eines Tags. */
export const tags = (xml: string, name: string): string[] => {
  const out: string[] = [];
  const re = new RegExp(elementPattern(name), 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
};

/** Schneidet alle TaxSubtotal-Blöcke heraus. */
export const taxSubtotals = (xml: string): string[] =>
  tags(xml, 'cac:TaxSubtotal');

/** Schneidet alle InvoiceLine-Blöcke heraus. */
export const invoiceLines = (xml: string): string[] =>
  tags(xml, 'cac:InvoiceLine');
