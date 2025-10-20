import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';
import PDFDocument from 'pdfkit';

const router = express.Router();

// Get invoice journal data for reporting
router.get('/invoice-journal', async (req, res) => {
  try {
    const { startDate, endDate, customerId } = req.query;

    let whereClause = '1=1';
    let params = [];
    let paramIndex = 1;

    // Add date filters
    if (startDate) {
      whereClause += ` AND i.issue_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereClause += ` AND i.issue_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Add customer filter
    if (customerId) {
      whereClause += ` AND i.customer_id = $${paramIndex}`;
      params.push(customerId);
      paramIndex++;
    }

    const result = await query(`
      SELECT 
        i.id,
        i.invoice_number,
        i.customer_name,
        i.issue_date,
        i.due_date,
        i.subtotal,
        i.tax_amount,
        i.total,
        i.status,
        i.created_at,
        c.customer_number,
        CASE 
          WHEN i.status = 'paid' THEN i.total 
          ELSE 0 
        END as paid_amount,
        CASE 
          WHEN i.status = 'overdue' THEN i.total 
          ELSE 0 
        END as overdue_amount,
        CASE 
          WHEN i.status IN ('draft', 'sent') THEN i.total 
          ELSE 0 
        END as outstanding_amount
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY i.issue_date DESC, i.invoice_number DESC
    `, params);

    const invoices = result.rows;

    // Calculate summary statistics
    const summary = {
      totalInvoices: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.total), 0),
      paidAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.paid_amount), 0),
      overdueAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.overdue_amount), 0),
      outstandingAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.outstanding_amount), 0),
      subtotalSum: invoices.reduce((sum, inv) => sum + parseFloat(inv.subtotal), 0),
      taxSum: invoices.reduce((sum, inv) => sum + parseFloat(inv.tax_amount), 0)
    };

    res.json({
      invoices: invoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoice_number,
        customerName: inv.customer_name,
        customerNumber: inv.customer_number,
        issueDate: inv.issue_date,
        dueDate: inv.due_date,
        subtotal: parseFloat(inv.subtotal),
        taxAmount: parseFloat(inv.tax_amount),
        total: parseFloat(inv.total),
        status: inv.status,
        paidAmount: parseFloat(inv.paid_amount),
        overdueAmount: parseFloat(inv.overdue_amount),
        outstandingAmount: parseFloat(inv.outstanding_amount),
        createdAt: inv.created_at
      })),
      summary,
      dateRange: {
        startDate: startDate || null,
        endDate: endDate || null
      }
    });
  } catch (error) {
    logger.error('Error fetching invoice journal:', error);
    res.status(500).json({ error: 'Failed to fetch invoice journal' });
  }
});

// Generate invoice journal PDF
router.post('/invoice-journal/pdf', async (req, res) => {
  try {
    const { startDate, endDate, customerId, title = 'Rechnungsjournal' } = req.body;

    // Get company data
    const companyResult = await query('SELECT * FROM company LIMIT 1');
    const company = companyResult.rows[0] || {};

    // Get invoice journal data (reuse the logic from GET endpoint)
    let whereClause = '1=1';
    let params = [];
    let paramIndex = 1;

    if (startDate) {
      whereClause += ` AND i.issue_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }
    if (endDate) {
      whereClause += ` AND i.issue_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }
    if (customerId) {
      whereClause += ` AND i.customer_id = $${paramIndex}`;
      params.push(customerId);
      paramIndex++;
    }

    const result = await query(`
      SELECT 
        i.id,
        i.invoice_number,
        i.customer_name,
        i.issue_date,
        i.due_date,
        i.subtotal,
        i.tax_amount,
        i.total,
        i.status,
        i.created_at,
        c.customer_number,
        CASE 
          WHEN i.status = 'paid' THEN i.total 
          ELSE 0 
        END as paid_amount,
        CASE 
          WHEN i.status = 'overdue' THEN i.total 
          ELSE 0 
        END as overdue_amount,
        CASE 
          WHEN i.status IN ('draft', 'sent') THEN i.total 
          ELSE 0 
        END as outstanding_amount
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE ${whereClause}
      ORDER BY i.issue_date DESC, i.invoice_number DESC
    `, params);

    const invoices = result.rows;

    // Calculate summary
    const summary = {
      totalInvoices: invoices.length,
      totalAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.total), 0),
      paidAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.paid_amount), 0),
      overdueAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.overdue_amount), 0),
      outstandingAmount: invoices.reduce((sum, inv) => sum + parseFloat(inv.outstanding_amount), 0),
      subtotalSum: invoices.reduce((sum, inv) => sum + parseFloat(inv.subtotal), 0),
      taxSum: invoices.reduce((sum, inv) => sum + parseFloat(inv.tax_amount), 0)
    };

    // Create PDF
    const doc = new PDFDocument({ 
      margin: 50,
      size: 'A4',
      layout: 'landscape' // Use landscape for better table display
    });

    // Set response headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rechnungsjournal_${new Date().toISOString().split('T')[0]}.pdf"`);

    // Pipe PDF to response
    doc.pipe(res);

    // Company header
    const primaryColor = company.primary_color || '#2563eb';
    
    // Title and company info positioning
    const titleY = 70;
    const titleFontSize = 20;
    
    // Add company logo if available with original aspect ratio, vertically centered to title
    if (company.logo) {
      try {
        const logoBuffer = Buffer.from(company.logo.replace(/^data:image\/[a-z]+;base64,/, ''), 'base64');
        
        // Position logo vertically centered to the title text
        // Approximate vertical center: titleY - (titleFontSize / 3)
        const logoY = titleY + 20;
        
        // Only specify width - PDFKit will automatically maintain aspect ratio
        doc.image(logoBuffer, 50, logoY, { width: 80 });
      } catch (error) {
        logger.warn('Error adding logo to PDF:', error);
      }
    }

    // Title and company info
    doc.fontSize(titleFontSize)
       .fillColor(primaryColor)
       .text(title, 150, titleY)
       .fontSize(12)
       .fillColor('black')
       .text(company.name || 'Firma', 150, 95);

    if (company.address) {
      doc.text(company.address, 150, 110);
    }

    // Date range info
    const today = new Date().toLocaleDateString('de-DE');
    doc.fontSize(10)
       .text(`Erstellt am: ${today}`, 600, 70);

    if (startDate || endDate) {
      const dateRangeText = `Zeitraum: ${startDate || 'Anfang'} bis ${endDate || 'Ende'}`;
      doc.text(dateRangeText, 600, 85);
    }

    // Summary section
    let yPosition = 150;
    doc.fontSize(14)
       .fillColor(primaryColor)
       .text('Zusammenfassung', 50, yPosition);

    yPosition += 25;
    doc.fontSize(10)
       .fillColor('black')
       .text(`Anzahl Rechnungen: ${summary.totalInvoices}`, 50, yPosition)
       .text(`Nettosumme: ${summary.subtotalSum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`, 200, yPosition)
       .text(`MwSt.: ${summary.taxSum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`, 350, yPosition)
       .text(`Bruttosumme: ${summary.totalAmount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })}`, 500, yPosition);

    // Table header
    yPosition += 40;
    
    // Draw table header background
    doc.rect(50, yPosition - 5, 500, 20).fillAndStroke(primaryColor, primaryColor);
    
    doc.fontSize(9)
       .fillColor('white')
       .text('Rech.-Nr.', 55, yPosition)
       .text('Datum', 130, yPosition)
       .text('Kunde', 200, yPosition)
       .text('Netto', 320, yPosition)
       .text('MwSt.', 380, yPosition)
       .text('Brutto', 440, yPosition)
       .text('Status', 500, yPosition);

    yPosition += 25;

    // Table content
    doc.fillColor('black');
    
    invoices.forEach((invoice, index) => {
      // Check if we need a new page
      if (yPosition > 520) {
        doc.addPage();
        yPosition = 50;
        
        // Repeat header on new page
        doc.rect(50, yPosition - 5, 500, 20).fillAndStroke(primaryColor, primaryColor);
        doc.fontSize(9)
           .fillColor('white')
           .text('Rech.-Nr.', 55, yPosition)
           .text('Datum', 130, yPosition)
           .text('Kunde', 200, yPosition)
           .text('Netto', 320, yPosition)
           .text('MwSt.', 380, yPosition)
           .text('Brutto', 440, yPosition)
           .text('Status', 500, yPosition);
        
        yPosition += 25;
        doc.fillColor('black');
      }

      // Alternate row background
      if (index % 2 === 0) {
        doc.rect(50, yPosition - 3, 500, 15).fill('#f8f9fa');
      }

      const issueDate = new Date(invoice.issue_date).toLocaleDateString('de-DE');
      
      // Status translation
      const statusMap = {
        'draft': 'Entwurf',
        'sent': 'Gesendet',
        'paid': 'Bezahlt',
        'overdue': 'Überfällig'
      };

      doc.fontSize(8)
         .fillColor('black')
         .text(invoice.invoice_number, 55, yPosition)
         .text(issueDate, 130, yPosition)
         .text(invoice.customer_name?.substring(0, 25) || '', 200, yPosition)
         .text(parseFloat(invoice.subtotal).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 320, yPosition)
         .text(parseFloat(invoice.tax_amount).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 380, yPosition)
         .text(parseFloat(invoice.total).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 440, yPosition)
         .text(statusMap[invoice.status] || invoice.status, 500, yPosition);

      yPosition += 15;
    });

    // Final totals row
    yPosition += 10;
    doc.rect(50, yPosition - 5, 500, 20).fillAndStroke('#e5e7eb', '#e5e7eb');
    doc.fontSize(9)
       .fillColor('black')
       .font('Helvetica-Bold')
       .text('SUMME:', 55, yPosition)
       .text(summary.subtotalSum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 320, yPosition)
       .text(summary.taxSum.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 380, yPosition)
       .text(summary.totalAmount.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }), 440, yPosition);

    // Finalize PDF
    doc.end();
    
  } catch (error) {
    logger.error('Error generating invoice journal PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

// Get reporting statistics
router.get('/statistics', async (req, res) => {
  try {
    const { year = new Date().getFullYear() } = req.query;

    // Monthly revenue statistics
    const monthlyRevenueResult = await query(`
      SELECT 
        EXTRACT(MONTH FROM issue_date) as month,
        COUNT(*) as invoice_count,
        SUM(subtotal) as subtotal_sum,
        SUM(tax_amount) as tax_sum,
        SUM(total) as total_sum,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as paid_sum,
        SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as overdue_sum
      FROM invoices
      WHERE EXTRACT(YEAR FROM issue_date) = $1
      GROUP BY EXTRACT(MONTH FROM issue_date)
      ORDER BY month
    `, [year]);

    // Customer statistics
    const customerStatsResult = await query(`
      SELECT 
        i.customer_id,
        i.customer_name,
        COUNT(*) as invoice_count,
        SUM(i.total) as total_revenue,
        AVG(i.total) as avg_invoice_amount
      FROM invoices i
      WHERE EXTRACT(YEAR FROM i.issue_date) = $1
      GROUP BY i.customer_id, i.customer_name
      ORDER BY total_revenue DESC
      LIMIT 10
    `, [year]);

    // Status distribution
    const statusDistributionResult = await query(`
      SELECT 
        status,
        COUNT(*) as count,
        SUM(total) as total_amount
      FROM invoices
      WHERE EXTRACT(YEAR FROM issue_date) = $1
      GROUP BY status
    `, [year]);

    // Year overview
    const yearOverviewResult = await query(`
      SELECT 
        COUNT(*) as total_invoices,
        SUM(subtotal) as total_subtotal,
        SUM(tax_amount) as total_tax,
        SUM(total) as total_amount,
        SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END) as paid_amount,
        SUM(CASE WHEN status = 'overdue' THEN total ELSE 0 END) as overdue_amount,
        AVG(total) as avg_invoice_amount
      FROM invoices
      WHERE EXTRACT(YEAR FROM issue_date) = $1
    `, [year]);

    res.json({
      year: parseInt(year),
      monthlyRevenue: monthlyRevenueResult.rows.map(row => ({
        month: parseInt(row.month),
        invoiceCount: parseInt(row.invoice_count),
        subtotalSum: parseFloat(row.subtotal_sum || 0),
        taxSum: parseFloat(row.tax_sum || 0),
        totalSum: parseFloat(row.total_sum || 0),
        paidSum: parseFloat(row.paid_sum || 0),
        overdueSum: parseFloat(row.overdue_sum || 0)
      })),
      topCustomers: customerStatsResult.rows.map(row => ({
        customerId: row.customer_id,
        customerName: row.customer_name,
        invoiceCount: parseInt(row.invoice_count),
        totalRevenue: parseFloat(row.total_revenue),
        avgInvoiceAmount: parseFloat(row.avg_invoice_amount)
      })),
      statusDistribution: statusDistributionResult.rows.map(row => ({
        status: row.status,
        count: parseInt(row.count),
        totalAmount: parseFloat(row.total_amount)
      })),
      yearOverview: yearOverviewResult.rows[0] ? {
        totalInvoices: parseInt(yearOverviewResult.rows[0].total_invoices),
        totalSubtotal: parseFloat(yearOverviewResult.rows[0].total_subtotal || 0),
        totalTax: parseFloat(yearOverviewResult.rows[0].total_tax || 0),
        totalAmount: parseFloat(yearOverviewResult.rows[0].total_amount || 0),
        paidAmount: parseFloat(yearOverviewResult.rows[0].paid_amount || 0),
        overdueAmount: parseFloat(yearOverviewResult.rows[0].overdue_amount || 0),
        avgInvoiceAmount: parseFloat(yearOverviewResult.rows[0].avg_invoice_amount || 0)
      } : null
    });
  } catch (error) {
    logger.error('Error fetching reporting statistics:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

export default router;
