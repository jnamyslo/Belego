import { apiService } from '../services/api';
import type { Invoice, Quote, JobEntry } from '../types';

// Listen-Endpoints liefern Anhänge ohne `content` (spart Bandbreite).
// Der Inhalt kommt erst beim Einzelabruf (GET /:id).

type WithContent = { id: string; content: string };

const hasMissingContent = (attachments?: { content?: string }[]): boolean =>
  !!attachments?.some(a => !a.content);

/** Füllt fehlenden `content` in `current` aus `full` (Match per id); Rest bleibt unverändert. */
export function mergeAttachmentContent<T extends WithContent>(current: T[], full: T[]): T[] {
  const byId = new Map(full.map(a => [a.id, a.content]));
  return current.map(a => (a.content ? a : { ...a, content: byId.get(a.id) ?? '' }));
}

export const invoiceNeedsContent = (invoice: Invoice): boolean => hasMissingContent(invoice.attachments);
export const quoteNeedsContent = (quote: Quote): boolean => hasMissingContent(quote.attachments);
export const jobNeedsContent = (job: JobEntry): boolean => hasMissingContent(job.attachments);

/** Liefert die Rechnung inkl. Anhang-Inhalten (lädt nach, falls nötig). */
export async function withInvoiceContent(invoice: Invoice): Promise<Invoice> {
  return invoiceNeedsContent(invoice) ? apiService.getInvoice(invoice.id) : invoice;
}

export async function withQuoteContent(quote: Quote): Promise<Quote> {
  return quoteNeedsContent(quote) ? apiService.getQuote(quote.id) : quote;
}

export async function withJobContent(job: JobEntry): Promise<JobEntry> {
  return jobNeedsContent(job) ? apiService.getJobEntry(job.id) : job;
}
