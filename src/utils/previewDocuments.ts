import type { PreviewDocument } from '../components/DocumentPreview';
import type { Invoice, Quote, JobEntry } from '../types';

// Helper function to create preview documents from invoice attachments
export function createInvoiceAttachmentPreviewDocuments(
  invoice: Invoice
): PreviewDocument[] {
  const documents: PreviewDocument[] = [];

  // Add only the ZUGFeRD PDF (the version that would be sent via email)
  documents.push({
    id: `invoice-pdf-${invoice.id}`,
    name: `Rechnung_${invoice.invoiceNumber}.pdf`,
    type: 'invoice-pdf',
    invoice,
    pdfFormat: 'zugferd'
  });

  // Add attachments
  if (invoice.attachments) {
    invoice.attachments.forEach(attachment => {
      documents.push({
        id: attachment.id,
        name: attachment.name,
        type: 'attachment',
        content: attachment.content,
        contentType: attachment.contentType,
        size: attachment.size
      });
    });
  }

  return documents;
}

// Helper function to create preview documents from quote attachments
export function createQuoteAttachmentPreviewDocuments(
  quote: Quote
): PreviewDocument[] {
  const documents: PreviewDocument[] = [];

  // Add the quote PDF itself
  documents.push({
    id: `quote-pdf-${quote.id}`,
    name: `Angebot_${quote.quoteNumber}.pdf`,
    type: 'quote-pdf',
    quote
  });

  // Add attachments
  if (quote.attachments) {
    quote.attachments.forEach(attachment => {
      documents.push({
        id: attachment.id,
        name: attachment.name,
        type: 'attachment',
        content: attachment.content,
        contentType: attachment.contentType,
        size: attachment.size
      });
    });
  }

  return documents;
}

// Helper function to create preview documents from job attachments
export function createJobAttachmentPreviewDocuments(
  job: JobEntry
): PreviewDocument[] {
  const documents: PreviewDocument[] = [];

  // Add the job PDF itself
  documents.push({
    id: `job-pdf-${job.id}`,
    name: `Auftrag_${job.jobNumber || job.id.slice(-8).toUpperCase()}.pdf`,
    type: 'job-pdf',
    job
  });

  // Add attachments
  if (job.attachments) {
    job.attachments.forEach(attachment => {
      documents.push({
        id: attachment.id,
        name: attachment.name,
        type: 'attachment',
        content: attachment.content,
        contentType: attachment.contentType,
        size: attachment.size
      });
    });
  }

  return documents;
}
