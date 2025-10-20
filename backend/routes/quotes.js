import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get all quotes
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT q.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order,
                   'discountType', discount_type,
                   'discountValue', discount_value,
                   'discountAmount', discount_amount
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      ORDER BY q.created_at DESC
    `);

    const quotes = result.rows.map(row => ({
      id: row.id,
      quoteNumber: row.quote_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: row.issue_date,
      validUntil: row.valid_until,
      items: row.items || [],
      attachments: row.attachments || [],
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      total: parseFloat(row.total),
      status: row.status,
      notes: row.notes,
      globalDiscountType: row.global_discount_type,
      globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
      globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
      convertedToInvoiceId: row.converted_to_invoice_id,
      createdAt: row.created_at
    }));

    res.json(quotes);
  } catch (error) {
    logger.error('Failed to fetch quotes', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/quotes'
    });
    res.status(500).json({ error: 'Failed to fetch quotes' });
  }
});

// Get quote by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
      SELECT q.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        WHERE quote_id = $1
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        WHERE quote_id = $1
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      WHERE q.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const row = result.rows[0];
    const quote = {
      id: row.id,
      quoteNumber: row.quote_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: row.issue_date,
      validUntil: row.valid_until,
      items: row.items || [],
      attachments: row.attachments || [],
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      total: parseFloat(row.total),
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at
    };

    res.json(quote);
  } catch (error) {
    logger.error('Failed to fetch quote', {
      error: error.message,
      stack: error.stack,
      quoteId: req.params.id,
      method: 'GET',
      endpoint: '/quotes/:id'
    });
    res.status(500).json({ error: 'Failed to fetch quote' });
  }
});

// Create new quote
router.post('/', async (req, res) => {
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { 
      customerId, 
      items = [], 
      notes = '',
      attachments = [],
      issueDate = new Date().toISOString().split('T')[0],
      validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status = 'draft',
      globalDiscountType = null,
      globalDiscountValue = null,
      globalDiscountAmount = null
    } = req.body;

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      throw new Error('Customer not found');
    }
    const customerName = customerResult.rows[0].name;

    // Generate quote number - format: AN-YYYY-XXX
    const quoteYear = new Date(issueDate).getFullYear();
    const yearPattern = `AN-${quoteYear}-%`;
    const lastQuoteResult = await client.query('SELECT quote_number FROM quotes WHERE quote_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);
    
    let quoteNumber;
    if (lastQuoteResult.rows.length === 0) {
      quoteNumber = `AN-${quoteYear}-001`;
    } else {
      const lastQuoteNumber = lastQuoteResult.rows[0].quote_number;
      if (lastQuoteNumber && lastQuoteNumber.startsWith(`AN-${quoteYear}-`)) {
        const numberPart = lastQuoteNumber.substring(`AN-${quoteYear}-`.length);
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          quoteNumber = `AN-${quoteYear}-${String(lastNumber + 1).padStart(3, '0')}`;
        } else {
          quoteNumber = `AN-${quoteYear}-001`;
        }
      } else {
        quoteNumber = `AN-${quoteYear}-001`;
      }
    }

    // Calculate totals
    let subtotal = 0;
    let taxAmount = 0;
    
    const processedItems = items.map(item => {
      const itemTotal = item.quantity * item.unitPrice;
      const itemTax = itemTotal * (item.taxRate / 100);
      subtotal += itemTotal;
      taxAmount += itemTax;
      return {
        ...item,
        total: itemTotal + itemTax
      };
    });

    const total = subtotal + taxAmount;

    // Insert quote
    const quoteResult = await client.query(`
      INSERT INTO quotes (quote_number, customer_id, customer_name, issue_date, valid_until, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [quoteNumber, customerId, customerName, issueDate, validUntil, subtotal, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, globalDiscountAmount]);

    const quoteId = quoteResult.rows[0].id;

    // Insert quote items
    for (let i = 0; i < processedItems.length; i++) {
      const item = processedItems[i];
      const itemOrder = item.order !== undefined ? item.order : (i + 1);
      await client.query(`
        INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [quoteId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
    }

    // Insert attachments if provided
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO quote_attachments (quote_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [quoteId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    await client.query('COMMIT');

    // Fetch the complete quote with items and attachments
    const completeQuote = await client.query(`
      SELECT q.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        WHERE quote_id = $1
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        WHERE quote_id = $1
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      WHERE q.id = $1
    `, [quoteId]);

    const row = completeQuote.rows[0];
    const quote = {
      id: row.id,
      quoteNumber: row.quote_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: row.issue_date,
      validUntil: row.valid_until,
      items: row.items || [],
      attachments: row.attachments || [],
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      total: parseFloat(row.total),
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at
    };

    res.status(201).json(quote);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to create quote', {
      error: error.message,
      stack: error.stack,
      customerNumber: req.body.customerNumber,
      method: 'POST',
      endpoint: '/quotes'
    });
    res.status(500).json({ error: 'Failed to create quote' });
  } finally {
    client.release();
  }
});

// Update quote
router.put('/:id', async (req, res) => {
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const updateData = req.body;
    
    // First, get the current quote to preserve existing values
    const currentQuote = await client.query('SELECT * FROM quotes WHERE id = $1', [id]);
    
    if (currentQuote.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }

    const current = currentQuote.rows[0];
    
    // Merge current values with updates (but preserve quote number)
    const mergedData = {
      quoteNumber: current.quote_number,
      customerId: updateData.customerId ?? current.customer_id,
      customerName: updateData.customerName ?? current.customer_name,
      issueDate: updateData.issueDate ?? current.issue_date,
      validUntil: updateData.validUntil ?? current.valid_until,
      subtotal: updateData.subtotal ?? current.subtotal,
      taxAmount: updateData.taxAmount ?? current.tax_amount,
      total: updateData.total ?? current.total,
      status: updateData.status ?? current.status,
      notes: updateData.notes ?? current.notes,
      globalDiscountType: updateData.globalDiscountType ?? current.global_discount_type,
      globalDiscountValue: updateData.globalDiscountValue ?? current.global_discount_value,
      globalDiscountAmount: updateData.globalDiscountAmount ?? current.global_discount_amount,
      items: updateData.items
    };

    // Update quote
    const quoteResult = await client.query(`
      UPDATE quotes 
      SET quote_number = $1, customer_id = $2, customer_name = $3, issue_date = $4, 
          valid_until = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13
      WHERE id = $14
      RETURNING *
    `, [
      mergedData.quoteNumber, 
      mergedData.customerId, 
      mergedData.customerName, 
      mergedData.issueDate, 
      mergedData.validUntil, 
      mergedData.subtotal, 
      mergedData.taxAmount, 
      mergedData.total, 
      mergedData.status, 
      mergedData.notes,
      mergedData.globalDiscountType,
      mergedData.globalDiscountValue,
      mergedData.globalDiscountAmount,
      id
    ]);

    // Only update items if they are provided
    if (updateData.items) {
      // Delete existing items
      await client.query('DELETE FROM quote_items WHERE quote_id = $1', [id]);

      // Insert new items
      for (let i = 0; i < updateData.items.length; i++) {
        const item = updateData.items[i];
        const itemOrder = item.order !== undefined ? item.order : (i + 1);
        await client.query(`
          INSERT INTO quote_items (quote_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [id, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
      }
    }

    // Update attachments if provided
    if (updateData.attachments) {
      // Delete existing attachments
      await client.query('DELETE FROM quote_attachments WHERE quote_id = $1', [id]);

      // Insert new attachments
      for (const attachment of updateData.attachments) {
        await client.query(`
          INSERT INTO quote_attachments (quote_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
      }
    }

    await client.query('COMMIT');

    // Fetch the complete updated quote with attachments
    const completeQuote = await client.query(`
      SELECT q.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        WHERE quote_id = $1
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        WHERE quote_id = $1
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      WHERE q.id = $1
    `, [id]);

    const row = completeQuote.rows[0];
    const quote = {
      id: row.id,
      quoteNumber: row.quote_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: row.issue_date,
      validUntil: row.valid_until,
      items: row.items || [],
      attachments: row.attachments || [],
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      total: parseFloat(row.total),
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at
    };

    res.json(quote);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to update quote', {
      error: error.message,
      stack: error.stack,
      quoteId: req.params.id,
      method: 'PUT',
      endpoint: '/quotes/:id'
    });
    res.status(500).json({ error: 'Failed to update quote' });
  } finally {
    client.release();
  }
});

// Delete quote
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM quotes WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

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

    // Get quote with all details
    const quoteResult = await query(`
      SELECT q.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order,
                   'discountType', discount_type,
                   'discountValue', discount_value,
                   'discountAmount', discount_amount
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      WHERE q.id = $1
    `, [id]);

    if (quoteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    // Get customer details
    const customerResult = await query('SELECT * FROM customers WHERE id = $1', [quote.customer_id]);
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customer = customerResult.rows[0];

    // Get company details
    const companyResult = await query('SELECT * FROM company WHERE id = 1');
    const company = companyResult.rows[0];

    // Send email (using existing email service)
    const emailService = await import('../services/emailService.js');
    
    const quoteData = {
      id: quote.id,
      quoteNumber: quote.quote_number,
      customerName: quote.customer_name,
      issueDate: quote.issue_date,
      validUntil: quote.valid_until,
      items: quote.items || [],
      subtotal: parseFloat(quote.subtotal),
      taxAmount: parseFloat(quote.tax_amount),
      total: parseFloat(quote.total),
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
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Get the quote
    const quoteResult = await client.query(`
      SELECT q.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM quotes q
      LEFT JOIN (
        SELECT quote_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order,
                   'discountType', discount_type,
                   'discountValue', discount_value,
                   'discountAmount', discount_amount
                 ) ORDER BY item_order
               ) as items
        FROM quote_items
        WHERE quote_id = $1
        GROUP BY quote_id
      ) items_subquery ON q.id = items_subquery.quote_id
      LEFT JOIN (
        SELECT quote_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM quote_attachments
        WHERE quote_id = $1
        GROUP BY quote_id
      ) attachments_subquery ON q.id = attachments_subquery.quote_id
      WHERE q.id = $1
    `, [id]);

    if (quoteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quoteResult.rows[0];

    // Check if quote is already converted
    if (quote.converted_to_invoice_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Quote has already been converted to an invoice' });
    }

    // Check if quote is accepted
    if (quote.status !== 'accepted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only accepted quotes can be converted to invoices' });
    }

    // Generate invoice number
    const invoiceYear = new Date().getFullYear();
    const yearPattern = `RE-${invoiceYear}-%`;
    const lastInvoiceResult = await client.query('SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);
    
    // Get year-specific invoice start number, fallback to 1 if not defined
    const yearlyStartResult = await client.query('SELECT start_number FROM yearly_invoice_start_numbers WHERE year = $1', [invoiceYear]);
    const yearStartNumber = yearlyStartResult.rows.length > 0 ? yearlyStartResult.rows[0].start_number : 1;
    
    let invoiceNumber;
    if (lastInvoiceResult.rows.length === 0) {
      invoiceNumber = `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
    } else {
      const lastInvoiceNumber = lastInvoiceResult.rows[0].invoice_number;
      if (lastInvoiceNumber && lastInvoiceNumber.startsWith(`RE-${invoiceYear}-`)) {
        const numberPart = lastInvoiceNumber.substring(`RE-${invoiceYear}-`.length);
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          const nextNumber = Math.max(lastNumber + 1, yearStartNumber);
          invoiceNumber = `RE-${invoiceYear}-${String(nextNumber).padStart(3, '0')}`;
        } else {
          invoiceNumber = `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
        }
      } else {
        invoiceNumber = `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
      }
    }

    // Create invoice
    const issueDate = new Date().toISOString().split('T')[0];
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      invoiceNumber,
      quote.customer_id,
      quote.customer_name,
      issueDate,
      dueDate,
      quote.subtotal,
      quote.tax_amount,
      quote.total,
      'draft',
      quote.notes ? `Erstellt aus Angebot ${quote.quote_number}\n\n${quote.notes}` : `Erstellt aus Angebot ${quote.quote_number}`,
      quote.global_discount_type,
      quote.global_discount_value,
      quote.global_discount_amount
    ]);

    const invoiceId = invoiceResult.rows[0].id;

    // Copy items
    const items = quote.items || [];
    for (const item of items) {
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        invoiceId,
        item.description,
        item.quantity,
        item.unitPrice,
        item.taxRate,
        item.total,
        item.order,
        item.discountType || null,
        item.discountValue || null,
        item.discountAmount || null
      ]);
    }

    // Copy attachments
    const attachments = quote.attachments || [];
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [invoiceId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    // Update quote to mark as converted
    await client.query(`
      UPDATE quotes
      SET converted_to_invoice_id = $1, status = 'billed'
      WHERE id = $2
    `, [invoiceId, id]);

    await client.query('COMMIT');

    // Fetch the complete invoice
    const completeInvoice = await client.query(`
      SELECT i.*, 
             COALESCE(items_subquery.items, '{}'::jsonb[]) as items,
             COALESCE(attachments_subquery.attachments, '[]'::jsonb) as attachments
      FROM invoices i
      LEFT JOIN (
        SELECT invoice_id,
               array_agg(
                 jsonb_build_object(
                   'id', id,
                   'description', description,
                   'quantity', quantity,
                   'unitPrice', unit_price,
                   'taxRate', tax_rate,
                   'total', total,
                   'order', item_order
                 ) ORDER BY item_order
               ) as items
        FROM invoice_items
        WHERE invoice_id = $1
        GROUP BY invoice_id
      ) items_subquery ON i.id = items_subquery.invoice_id
      LEFT JOIN (
        SELECT invoice_id,
               jsonb_agg(
                 jsonb_build_object(
                   'id', id,
                   'name', name,
                   'content', content,
                   'contentType', content_type,
                   'size', size,
                   'uploadedAt', uploaded_at
                 )
               ) as attachments
        FROM invoice_attachments
        WHERE invoice_id = $1
        GROUP BY invoice_id
      ) attachments_subquery ON i.id = attachments_subquery.invoice_id
      WHERE i.id = $1
    `, [invoiceId]);

    const row = completeInvoice.rows[0];
    const invoice = {
      id: row.id,
      invoiceNumber: row.invoice_number,
      customerId: row.customer_id,
      customerName: row.customer_name,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      items: row.items || [],
      attachments: row.attachments || [],
      subtotal: parseFloat(row.subtotal),
      taxAmount: parseFloat(row.tax_amount),
      total: parseFloat(row.total),
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at
    };

    res.status(201).json(invoice);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to convert quote to invoice', {
      error: error.message,
      stack: error.stack,
      quoteId: req.params.id,
      method: 'POST',
      endpoint: '/quotes/:id/convert-to-invoice'
    });
    res.status(500).json({ error: 'Failed to convert quote to invoice' });
  } finally {
    client.release();
  }
});

export default router;

