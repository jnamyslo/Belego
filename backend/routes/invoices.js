import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get all invoices
router.get('/', async (req, res) => {
  try {
    const result = await query(`
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
                   'order', item_order,
                   'discountType', discount_type,
                   'discountValue', discount_value,
                   'discountAmount', discount_amount
                 ) ORDER BY item_order
               ) as items
        FROM invoice_items
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
        GROUP BY invoice_id
      ) attachments_subquery ON i.id = attachments_subquery.invoice_id
      ORDER BY i.created_at DESC
    `);

    const invoices = result.rows.map(row => ({
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
      globalDiscountType: row.global_discount_type,
      globalDiscountValue: row.global_discount_value ? parseFloat(row.global_discount_value) : null,
      globalDiscountAmount: row.global_discount_amount ? parseFloat(row.global_discount_amount) : null,
      createdAt: row.created_at
    }));

    res.json(invoices);
  } catch (error) {
    logger.error('Failed to fetch invoices', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/invoices'
    });
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
});

// Get invoice by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(`
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
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const row = result.rows[0];
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

    res.json(invoice);
  } catch (error) {
    logger.error('Failed to fetch invoice', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id,
      method: 'GET',
      endpoint: '/invoices/:id'
    });
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
});

// Create new invoice
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
      dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
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

    // Generate invoice number - format: RE-YYYY-XXX
    // Use the year from the issue date instead of current system year
    const invoiceYear = new Date(issueDate).getFullYear();
    const yearPattern = `RE-${invoiceYear}-%`;
    const lastInvoiceResult = await client.query('SELECT invoice_number FROM invoices WHERE invoice_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);
    
    // Get year-specific invoice start number, fallback to 1 if not defined
    const yearlyStartResult = await client.query('SELECT start_number FROM yearly_invoice_start_numbers WHERE year = $1', [invoiceYear]);
    const yearStartNumber = yearlyStartResult.rows.length > 0 ? yearlyStartResult.rows[0].start_number : 1;
    
    let invoiceNumber;
    if (lastInvoiceResult.rows.length === 0) {
      // No invoices for this year found - start with year-specific start number
      invoiceNumber = `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
    } else {
      const lastInvoiceNumber = lastInvoiceResult.rows[0].invoice_number;
      if (lastInvoiceNumber && lastInvoiceNumber.startsWith(`RE-${invoiceYear}-`)) {
        const numberPart = lastInvoiceNumber.substring(`RE-${invoiceYear}-`.length); // Remove "RE-YYYY-" prefix
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          // Continue from last number, but respect year start number as minimum
          const nextNumber = Math.max(lastNumber + 1, yearStartNumber);
          invoiceNumber = `RE-${invoiceYear}-${String(nextNumber).padStart(3, '0')}`;
        } else {
          invoiceNumber = `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
        }
      } else {
        invoiceNumber = `RE-${invoiceYear}-${String(yearStartNumber).padStart(3, '0')}`;
      }
    }

    // Calculate totals with discounts
    let subtotalBeforeDiscounts = 0;
    let totalItemDiscounts = 0;
    
    // Gruppiere Items nach Steuersatz für die Steuerberechnung
    const taxBreakdown = {};
    
    const processedItems = items.map(item => {
      // Berechne Item-Total vor Rabatt
      const itemTotalBeforeDiscount = item.quantity * item.unitPrice;
      subtotalBeforeDiscounts += itemTotalBeforeDiscount;
      
      // Berechne Item-Rabatt
      const itemDiscountAmount = item.discountAmount || 0;
      totalItemDiscounts += itemDiscountAmount;
      
      // Item-Total nach Item-Rabatt
      const itemTotalAfterDiscount = itemTotalBeforeDiscount - itemDiscountAmount;
      
      // Gruppiere nach Steuersatz für spätere Steuerberechnung
      const taxRate = item.taxRate || 0;
      if (!taxBreakdown[taxRate]) {
        taxBreakdown[taxRate] = 0;
      }
      taxBreakdown[taxRate] += itemTotalAfterDiscount;
      
      return {
        ...item,
        total: itemTotalAfterDiscount // Item-Total nach Rabatt (ohne Steuer)
      };
    });

    // Subtotal nach Item-Rabatten
    const subtotalAfterItemDiscounts = subtotalBeforeDiscounts - totalItemDiscounts;
    
    // Global-Rabatt wird auf die bereits rabattierte Subtotal angewendet
    const globalDiscAmount = globalDiscountAmount || 0;
    const subtotalAfterAllDiscounts = subtotalAfterItemDiscounts - globalDiscAmount;
    
    // Berechne Steuer proportional auf die rabattierte Subtotal
    let taxAmount = 0;
    if (globalDiscAmount > 0 && subtotalAfterItemDiscounts > 0) {
      // Verteile Global-Rabatt proportional auf alle Steuersätze
      const discountRatio = subtotalAfterAllDiscounts / subtotalAfterItemDiscounts;
      Object.keys(taxBreakdown).forEach(rate => {
        const taxableAmount = taxBreakdown[rate] * discountRatio;
        taxAmount += taxableAmount * (parseFloat(rate) / 100);
      });
    } else {
      // Keine Global-Rabatte: normale Steuerberechnung
      Object.keys(taxBreakdown).forEach(rate => {
        taxAmount += taxBreakdown[rate] * (parseFloat(rate) / 100);
      });
    }
    
    const total = subtotalAfterAllDiscounts + taxAmount;
    
    // Speichere die ursprüngliche Subtotal (vor Rabatten) in der DB für Reporting-Zwecke
    const subtotal = subtotalBeforeDiscounts;

    // Insert invoice
    const invoiceResult = await client.query(`
      INSERT INTO invoices (invoice_number, customer_id, customer_name, issue_date, due_date, subtotal, tax_amount, total, status, notes, global_discount_type, global_discount_value, global_discount_amount)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [invoiceNumber, customerId, customerName, issueDate, dueDate, subtotal, taxAmount, total, status, notes, globalDiscountType, globalDiscountValue, globalDiscountAmount]);

    const invoiceId = invoiceResult.rows[0].id;

    // Insert invoice items
    for (let i = 0; i < processedItems.length; i++) {
      const item = processedItems[i];
      const itemOrder = item.order !== undefined ? item.order : (i + 1);
      await client.query(`
        INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [invoiceId, item.description, item.quantity, item.unitPrice, item.taxRate, item.total, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
    }

    // Insert attachments if provided
    for (const attachment of attachments) {
      await client.query(`
        INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `, [invoiceId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
    }

    await client.query('COMMIT');

    // Fetch the complete invoice with items and attachments
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
    logger.error('Failed to create invoice', {
      error: error.message,
      stack: error.stack,
      customerNumber: req.body.customerNumber,
      method: 'POST',
      endpoint: '/invoices'
    });
    res.status(500).json({ error: 'Failed to create invoice' });
  } finally {
    client.release();
  }
});

// Update invoice
router.put('/:id', async (req, res) => {
  const { pool } = await import('../database.js');
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    const { id } = req.params;
    const updateData = req.body;
    
    // First, get the current invoice to preserve existing values
    const currentInvoice = await client.query('SELECT * FROM invoices WHERE id = $1', [id]);
    
    if (currentInvoice.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const current = currentInvoice.rows[0];
    
    // Recalculate totals if items are provided
    let calculatedSubtotal = updateData.subtotal ?? current.subtotal;
    let calculatedTaxAmount = updateData.taxAmount ?? current.tax_amount;
    let calculatedTotal = updateData.total ?? current.total;
    
    if (updateData.items && Array.isArray(updateData.items)) {
      // Recalculate totals with discounts
      let subtotalBeforeDiscounts = 0;
      let totalItemDiscounts = 0;
      
      // Gruppiere Items nach Steuersatz für die Steuerberechnung
      const taxBreakdown = {};
      
      updateData.items.forEach(item => {
        // Berechne Item-Total vor Rabatt
        const itemTotalBeforeDiscount = item.quantity * item.unitPrice;
        subtotalBeforeDiscounts += itemTotalBeforeDiscount;
        
        // Berechne Item-Rabatt
        const itemDiscountAmount = item.discountAmount || 0;
        totalItemDiscounts += itemDiscountAmount;
        
        // Item-Total nach Item-Rabatt
        const itemTotalAfterDiscount = itemTotalBeforeDiscount - itemDiscountAmount;
        
        // Gruppiere nach Steuersatz für spätere Steuerberechnung
        const taxRate = item.taxRate || 0;
        if (!taxBreakdown[taxRate]) {
          taxBreakdown[taxRate] = 0;
        }
        taxBreakdown[taxRate] += itemTotalAfterDiscount;
      });

      // Subtotal nach Item-Rabatten
      const subtotalAfterItemDiscounts = subtotalBeforeDiscounts - totalItemDiscounts;
      
      // Global-Rabatt wird auf die bereits rabattierte Subtotal angewendet
      const globalDiscAmount = updateData.globalDiscountAmount ?? current.global_discount_amount ?? 0;
      const subtotalAfterAllDiscounts = subtotalAfterItemDiscounts - globalDiscAmount;
      
      // Berechne Steuer proportional auf die rabattierte Subtotal
      let taxAmount = 0;
      if (globalDiscAmount > 0 && subtotalAfterItemDiscounts > 0) {
        // Verteile Global-Rabatt proportional auf alle Steuersätze
        const discountRatio = subtotalAfterAllDiscounts / subtotalAfterItemDiscounts;
        Object.keys(taxBreakdown).forEach(rate => {
          const taxableAmount = taxBreakdown[rate] * discountRatio;
          taxAmount += taxableAmount * (parseFloat(rate) / 100);
        });
      } else {
        // Keine Global-Rabatte: normale Steuerberechnung
        Object.keys(taxBreakdown).forEach(rate => {
          taxAmount += taxBreakdown[rate] * (parseFloat(rate) / 100);
        });
      }
      
      calculatedTotal = subtotalAfterAllDiscounts + taxAmount;
      calculatedSubtotal = subtotalBeforeDiscounts;
      calculatedTaxAmount = taxAmount;
    }
    
    // Merge current values with updates (but preserve invoice number)
    const mergedData = {
      invoiceNumber: current.invoice_number, // Always preserve existing invoice number
      customerId: updateData.customerId ?? current.customer_id,
      customerName: updateData.customerName ?? current.customer_name,
      issueDate: updateData.issueDate ?? current.issue_date,
      dueDate: updateData.dueDate ?? current.due_date,
      subtotal: calculatedSubtotal,
      taxAmount: calculatedTaxAmount,
      total: calculatedTotal,
      status: updateData.status ?? current.status,
      notes: updateData.notes ?? current.notes,
      globalDiscountType: updateData.globalDiscountType ?? current.global_discount_type,
      globalDiscountValue: updateData.globalDiscountValue ?? current.global_discount_value,
      globalDiscountAmount: updateData.globalDiscountAmount ?? current.global_discount_amount,
      items: updateData.items // items are handled separately
    };

    // Update invoice
    const invoiceResult = await client.query(`
      UPDATE invoices 
      SET invoice_number = $1, customer_id = $2, customer_name = $3, issue_date = $4, 
          due_date = $5, subtotal = $6, tax_amount = $7, total = $8, status = $9, notes = $10,
          global_discount_type = $11, global_discount_value = $12, global_discount_amount = $13
      WHERE id = $14
      RETURNING *
    `, [
      mergedData.invoiceNumber, 
      mergedData.customerId, 
      mergedData.customerName, 
      mergedData.issueDate, 
      mergedData.dueDate, 
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
      await client.query('DELETE FROM invoice_items WHERE invoice_id = $1', [id]);

      // Insert new items
      for (let i = 0; i < updateData.items.length; i++) {
        const item = updateData.items[i];
        const itemOrder = item.order !== undefined ? item.order : (i + 1);
        
        // Berechne Item-Total nach Rabatt (ohne Steuer)
        const itemTotalBeforeDiscount = item.quantity * item.unitPrice;
        const itemDiscountAmount = item.discountAmount || 0;
        const itemTotal = itemTotalBeforeDiscount - itemDiscountAmount;
        
        await client.query(`
          INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, tax_rate, total, item_order, discount_type, discount_value, discount_amount)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [id, item.description, item.quantity, item.unitPrice, item.taxRate, itemTotal, itemOrder, item.discountType || null, item.discountValue || null, item.discountAmount || null]);
      }
    }

    // Update attachments if provided
    if (updateData.attachments) {
      // Delete existing attachments
      await client.query('DELETE FROM invoice_attachments WHERE invoice_id = $1', [id]);

      // Insert new attachments
      for (const attachment of updateData.attachments) {
        await client.query(`
          INSERT INTO invoice_attachments (invoice_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
      }
    }

    await client.query('COMMIT');

    // Fetch the complete updated invoice with attachments
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
    `, [id]);

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

    res.json(invoice);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to update invoice', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id,
      method: 'PUT',
      endpoint: '/invoices/:id'
    });
    res.status(500).json({ error: 'Failed to update invoice' });
  } finally {
    client.release();
  }
});

// Delete invoice
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query('DELETE FROM invoices WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    logger.error('Failed to delete invoice', {
      error: error.message,
      stack: error.stack,
      invoiceId: req.params.id,
      method: 'DELETE',
      endpoint: '/invoices/:id'
    });
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
});

export default router;
