import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';
import { findAllQuotes, findQuoteById } from '../queries/quoteQueries.js';
import { createQuote, updateQuote, deleteQuote, convertQuoteToInvoice } from '../services/quoteService.js';

const router = express.Router();

// Get all quotes
router.get('/', async (req, res) => {
  try {
    const quotes = await findAllQuotes();
    res.json(quotes);
  } catch (error) {
    logger.error('Failed to fetch quotes', { error: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// Get quote by ID
router.get('/:id', async (req, res) => {
  try {
    const quote = await findQuoteById(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (error) {
    logger.error('Failed to fetch quote', { error: error.message, quoteId: req.params.id });
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// Create new quote
router.post('/', async (req, res) => {
  try {
    const {
      customerId,
      items = [],
      notes = '',
      attachments = [],
      issueDate,
      validUntil,
      status = 'draft',
      globalDiscountType,
      globalDiscountValue,
      globalDiscountAmount,
    } = req.body;
    const quote = await createQuote({ customerId, items, notes, attachments, issueDate, validUntil, status, globalDiscountType, globalDiscountValue, globalDiscountAmount });
    res.status(201).json(quote);
  } catch (error) {
    logger.error('Failed to create quote', {
      error: error.message,
      stack: error.stack,
      customerNumber: req.body.customerNumber,
      method: 'POST',
      endpoint: '/quotes'
    });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    if (error.message === 'Customer not found') return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to create quote' });
  }
});

// Update quote
router.put('/:id', async (req, res) => {
  try {
    const quote = await updateQuote(req.params.id, req.body);
    if (!quote) return res.status(404).json({ error: 'Quote not found' });
    res.json(quote);
  } catch (error) {
    logger.error('Failed to update quote', {
      error: error.message,
      stack: error.stack,
      quoteId: req.params.id,
      method: 'PUT',
      endpoint: '/quotes/:id'
    });
    if (error.statusCode === 400) return res.status(400).json({ error: error.message });
    res.status(500).json({ error: 'Failed to update quote' });
  }
});

// Delete quote
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await deleteQuote(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Quote not found' });
    res.json({ message: 'Quote deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete quote', {
      error: error.message,
      stack: error.stack,
      quoteId: req.params.id,
      method: 'DELETE',
      endpoint: '/quotes/:id'
    });
    res.status(500).json({ error: 'Failed to delete quote' });
  }
});

// Convert quote to invoice
// Send quote via email
router.post('/:id/send-email', async (req, res) => {
  try {
    const { id } = req.params;
    const { customerEmails, customText, attachments, pdfBuffer } = req.body;

    // Get quote with all details (same loader the other quote routes use)
    const quote = await findQuoteById(id);

    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // Get customer details
    const customerResult = await query('SELECT * FROM customers WHERE id = $1', [quote.customerId]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = customerResult.rows[0];

    // Get company details
    const companyResult = await query('SELECT * FROM company WHERE id = 1');
    const company = companyResult.rows[0];

    // Send email (using existing email service)
    const emailService = await import('../services/emailService.js');

    // findQuoteById liefert bereits camelCase + geparste Beträge.
    // quote.attachments wird hier bewusst NICHT übernommen: das Frontend sendet
    // die vom Nutzer ausgewählten Angebots-Anhänge bereits in req.body.attachments —
    // ein zusätzliches Anhängen würde sie doppelt versenden.
    const quoteData = {
      id: quote.id,
      quoteNumber: quote.quoteNumber,
      customerName: quote.customerName,
      issueDate: quote.issueDate,
      validUntil: quote.validUntil,
      items: quote.items,
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      total: quote.total,
      status: quote.status,
      notes: quote.notes,
      pdfBuffer: pdfBuffer, // PDF generated on frontend
    };

    // Note: Quote emails are simpler - just PDF, no ZUGFeRD/XRechnung
    const result = await emailService.sendQuoteEmail(
      customerEmails,
      quoteData,
      {
        name: company.name,
        email: company.email,
        primaryColor: company.primary_color,
        secondaryColor: company.secondary_color,
      },
      customText,
      attachments || []
    );

    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    logger.error('Error sending quote email:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send quote email',
      error: error.message
    });
  }
});

router.post('/:id/convert-to-invoice', async (req, res) => {
  try {
    const result = await convertQuoteToInvoice(req.params.id);
    if (result.error) return res.status(result.status).json({ error: result.error });
    res.status(201).json(result.invoice);
  } catch (error) {
    logger.error('Failed to convert quote to invoice', {
      error: error.message,
      stack: error.stack,
      quoteId: req.params.id,
      method: 'POST',
      endpoint: '/quotes/:id/convert-to-invoice'
    });
    res.status(500).json({ error: 'Failed to convert quote to invoice' });
  }
});

export default router;
