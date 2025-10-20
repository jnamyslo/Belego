import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Function to sanitize filename for email attachments
const sanitizeFilename = (filename) => {
  if (!filename) return 'attachment';
  
  // Replace problematic characters and normalize
  let sanitized = filename
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') // Replace filesystem-unsafe chars
    .replace(/[^\x20-\x7E\u00C0-\u024F\u1E00-\u1EFF]/g, '_') // Keep ASCII + Latin chars
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(/_{2,}/g, '_') // Replace multiple underscores with single
    .trim();
    
  // Ensure reasonable length (max 100 chars, preserve extension)
  if (sanitized.length > 100) {
    const ext = sanitized.lastIndexOf('.');
    if (ext > 0) {
      const extension = sanitized.substring(ext);
      const namepart = sanitized.substring(0, ext);
      sanitized = namepart.substring(0, 100 - extension.length) + extension;
    } else {
      sanitized = sanitized.substring(0, 100);
    }
  }
  
  return sanitized || 'attachment';
};

// SMTP Configuration
const createTransporter = async () => {
  // Try to get SMTP settings from database first
  try {
    const result = await query('SELECT * FROM smtp_settings WHERE id = 1 AND is_enabled = true');
    
    if (result.rows.length > 0) {
      const settings = result.rows[0];
      return nodemailer.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port,
        secure: settings.smtp_secure,
        auth: {
          user: settings.smtp_user,
          pass: settings.smtp_pass,
        },
        connectionTimeout: 10000, // 10 seconds
        greetingTimeout: 10000, // 10 seconds
        socketTimeout: 30000, // 30 seconds
      });
    }
  } catch (error) {
    logger.warn('Could not load SMTP settings from database, falling back to environment variables:', error.message);
  }

  // Fallback to environment variables
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000, // 10 seconds
    socketTimeout: 30000, // 30 seconds
  });
};

// Function to save email to history
const saveEmailToHistory = async (emailData, status = 'sent', errorMessage = null) => {
  try {
    const {
      sender_email,
      senderEmail,
      sender_name,
      senderName,
      recipient_email,
      recipientEmail,
      subject,
      body_html,
      bodyHtml,
      body_plain,
      bodyPlain,
      attachments = [],
      message_id,
      messageId,
      smtp_response,
      smtpResponse,
      invoice_id,
      invoiceId,
      invoice_number,
      invoiceNumber,
      quote_id,
      quoteId,
      quote_number,
      quoteNumber,
      customer_id,
      customerId,
      customer_name,
      customerName,
      email_type = 'invoice',
      emailType,
      reminder_stage,
      reminderStage
    } = emailData;

    // Support both snake_case and camelCase
    const senderEmailValue = sender_email || senderEmail;
    const senderNameValue = sender_name || senderName;
    const recipientEmailValue = recipient_email || recipientEmail;
    const bodyHtmlValue = body_html || bodyHtml;
    const bodyPlainValue = body_plain || bodyPlain;
    const messageIdValue = message_id || messageId;
    const smtpResponseValue = smtp_response || smtpResponse;
    const invoiceIdValue = invoice_id || invoiceId;
    const invoiceNumberValue = invoice_number || invoiceNumber;
    const quoteIdValue = quote_id || quoteId;
    const quoteNumberValue = quote_number || quoteNumber;
    const customerIdValue = customer_id || customerId;
    const customerNameValue = customer_name || customerName;
    const emailTypeValue = email_type || emailType || 'invoice';
    const reminderStageValue = reminder_stage || reminderStage;

    // Try to insert with all columns (newest schema)
    try {
      await query(`
        INSERT INTO email_history (
          sender_email, sender_name, recipient_email, subject, body_html, body_plain,
          attachments, message_id, smtp_response, invoice_id, invoice_number,
          quote_id, quote_number, customer_id, customer_name, email_type, reminder_stage, status, error_message, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW())
      `, [
        senderEmailValue,
        senderNameValue,
        recipientEmailValue,
        subject,
        bodyHtmlValue,
        bodyPlainValue,
        JSON.stringify(attachments),
        messageIdValue,
        smtpResponseValue ? JSON.stringify(smtpResponseValue) : null,
        invoiceIdValue,
        invoiceNumberValue,
        quoteIdValue,
        quoteNumberValue,
        customerIdValue,
        customerNameValue,
        emailTypeValue,
        reminderStageValue,
        status,
        errorMessage
      ]);
    } catch (err) {
      // Fallback for older schema without reminder_stage
      if (err.message.includes('reminder_stage')) {
        try {
          await query(`
            INSERT INTO email_history (
              sender_email, sender_name, recipient_email, subject, body_html, body_plain,
              attachments, message_id, smtp_response, invoice_id, invoice_number,
              quote_id, quote_number, customer_id, customer_name, email_type, status, error_message, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
          `, [
            senderEmailValue,
            senderNameValue,
            recipientEmailValue,
            subject,
            bodyHtmlValue,
            bodyPlainValue,
            JSON.stringify(attachments),
            messageIdValue,
            smtpResponseValue ? JSON.stringify(smtpResponseValue) : null,
            invoiceIdValue,
            invoiceNumberValue,
            quoteIdValue,
            quoteNumberValue,
            customerIdValue,
            customerNameValue,
            emailTypeValue,
            status,
            errorMessage
          ]);
        } catch (err2) {
          // Fallback for older schema without quote columns
          if (err2.message.includes('quote_id') || err2.message.includes('quote_number')) {
            await query(`
              INSERT INTO email_history (
                sender_email, sender_name, recipient_email, subject, body_html, body_plain,
                attachments, message_id, smtp_response, invoice_id, invoice_number,
                customer_id, customer_name, email_type, status, error_message, sent_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
            `, [
              senderEmailValue,
              senderNameValue,
              recipientEmailValue,
              subject,
              bodyHtmlValue,
              bodyPlainValue,
              JSON.stringify(attachments),
              messageIdValue,
              smtpResponseValue ? JSON.stringify(smtpResponseValue) : null,
              invoiceIdValue,
              invoiceNumberValue,
              customerIdValue,
              customerNameValue,
              emailTypeValue,
              status,
              errorMessage
            ]);
          } else {
            throw err2;
          }
        }
      } else {
        throw err;
      }
    }

    logger.info(`Email saved to history: ${recipientEmailValue} - ${subject} (${status})`);
  } catch (error) {
    logger.error('Error saving email to history:', error);
  }
};

// Function to get sender info from database settings or fallback to env
const getSenderInfo = async () => {
  try {
    const result = await query('SELECT email_from, email_from_name, smtp_user FROM smtp_settings WHERE id = 1 AND is_enabled = true');
    
    if (result.rows.length > 0) {
      const settings = result.rows[0];
      return {
        email: settings.email_from || settings.smtp_user,
        name: settings.email_from_name || 'Rechnungsversand'
      };
    }
  } catch (error) {
    logger.warn('Could not load sender info from database:', error.message);
  }

  // Fallback to environment variables
  return {
    email: process.env.EMAIL_FROM || process.env.SMTP_USER,
    name: process.env.EMAIL_FROM_NAME || 'Rechnungsversand'
  };
};

export const sendInvoiceEmailMultiFormat = async (customerEmail, invoiceFormats, invoiceData, customText = null, attachments = [], companySettings = { primary_color: '#2563eb', secondary_color: '#64748b' }) => {
  let emailHistoryData = null;

  try {
    const transporter = await createTransporter();
    const senderInfo = await getSenderInfo();
    
    // Build format descriptions for email body
    const formatDescriptions = {
      'zugferd': 'PDF',
      'xrechnung': 'XRechnung (strukturierte XML-Datei)'
    };
    
    const selectedFormats = invoiceFormats.map(f => formatDescriptions[f.format]).join(', ');
    
    // Calculate due date display
    const issueDate = new Date(invoiceData.issueDate);
    const dueDate = new Date(invoiceData.dueDate);
    const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
    const dueDateDisplay = daysDifference <= 0 ? 'sofort' : dueDate.toLocaleDateString('de-DE');
    
    // Get colors
    const primaryColor = companySettings.primary_color || '#2563eb';
    const secondaryColor = companySettings.secondary_color || '#64748b';
    
    // Build email HTML content with modern layout
    let emailHTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      background: #ffffff;
      padding: 30px;
      border: 1px solid #e5e7eb;
      border-top: none;
    }
    .invoice-details {
      background: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .invoice-details table {
      width: 100%;
      border-collapse: collapse;
    }
    .invoice-details td {
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .invoice-details td:first-child {
      font-weight: 600;
      width: 50%;
    }
    .invoice-details tr:last-child td {
      border-bottom: none;
    }
    .total-amount {
      background: ${primaryColor};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
    }
    .total-amount .label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 5px;
    }
    .total-amount .amount {
      font-size: 32px;
      font-weight: bold;
    }
    .custom-message {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box {
      background: #dbeafe;
      border-left: 4px solid ${primaryColor};
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .footer {
      background: #f9fafb;
      padding: 20px;
      border-radius: 0 0 8px 8px;
      border: 1px solid #e5e7eb;
      border-top: none;
      text-align: center;
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Rechnung ${invoiceData.invoiceNumber}</h1>
  </div>
  
  <div class="content">
    <p>Sehr geehrte Damen und Herren,</p>
    
    ${customText && customText.trim() ? `
    <div class="custom-message">
      <p style="margin: 0;">${customText.replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}
    
    <p style="margin: 25px 0;">
      anbei erhalten Sie die Rechnung <strong>${invoiceData.invoiceNumber}</strong> über einen Betrag von <strong>${invoiceData.total.toFixed(2).replace('.', ',')} €</strong>.
    </p>
    
    <div class="invoice-details">
      <table>
        <tr>
          <td>Rechnungsnummer:</td>
          <td><strong>${invoiceData.invoiceNumber}</strong></td>
        </tr>
        <tr>
          <td>Rechnungsdatum:</td>
          <td>${issueDate.toLocaleDateString('de-DE')}</td>
        </tr>
        <tr>
          <td>Fälligkeitsdatum:</td>
          <td>${dueDateDisplay}</td>
        </tr>
        <tr>
          <td>Formate:</td>
          <td>${selectedFormats}</td>
        </tr>
      </table>
    </div>
    
    <div class="total-amount">
      <div class="label">Rechnungsbetrag:</div>
      <div class="amount">${invoiceData.total.toFixed(2).replace('.', ',')} €</div>
    </div>
    
    <p style="margin: 25px 0;">
      Die Rechnung finden Sie in den folgenden Formaten im Anhang:
    </p>
    <ul style="margin: 10px 0 20px 20px;">`;
    
    // Add format-specific information
    invoiceFormats.forEach(({ format }) => {
      switch(format) {
        case 'zugferd':
          emailHTML += `<li><strong>ZUGFeRD-PDF:</strong> eRechnungskonforme PDF-Datei</li>`;
          break;
        case 'xrechnung':
          emailHTML += `<li><strong>XRechnung:</strong> Strukturierte XML-Rechnung (eRechnungskonform)</li>`;
          break;
      }
    });
    
    emailHTML += `</ul>`;
    
    // Add information about additional attachments if any
    if (attachments && attachments.length > 0) {
      emailHTML += `
    <div class="info-box">
      <p style="margin: 0;">
        <strong>📎 Zusätzliche Anhänge:</strong> Diese E-Mail enthält ${attachments.length} weitere Dokument${attachments.length > 1 ? 'e' : ''}.
      </p>
    </div>`;
    }
    
    emailHTML += `
  </div>
  
  <div class="footer">
    <p style="margin: 5px 0;">Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
    <p style="margin: 5px 0;">Mit freundlichen Grüßen</p>
    <p style="margin: 5px 0;"><strong>${senderInfo.name}</strong></p>
  </div>
</body>
</html>
    `.trim();
    
    // Prepare attachments array - start with invoice formats
    const emailAttachments = [];
    
    invoiceFormats.forEach(({ format, content }) => {
      let filename, contentType;
      
      switch (format) {
        case 'xrechnung':
          filename = `XRechnung_${invoiceData.invoiceNumber}.xml`;
          contentType = 'application/xml';
          break;
        case 'zugferd':
        default:
          filename = `Rechnung_${invoiceData.invoiceNumber}.pdf`;
          contentType = 'application/pdf';
          break;
      }
      
      emailAttachments.push({
        filename,
        content,
        contentType
      });
    });
    
    // Add additional attachments
    if (attachments && attachments.length > 0) {
      attachments.forEach(attachment => {
        // Ensure proper base64 content handling
        let attachmentContent = attachment.content;
        
        // If content includes data URL prefix, remove it
        if (attachmentContent.includes(',')) {
          attachmentContent = attachmentContent.split(',')[1];
        }
        
        emailAttachments.push({
          filename: sanitizeFilename(attachment.name),
          content: Buffer.from(attachmentContent, 'base64'),
          contentType: attachment.contentType || 'application/octet-stream'
        });
      });
    }

    const mailOptions = {
      from: {
        name: senderInfo.name,
        address: senderInfo.email
      },
      to: customerEmail,
      subject: `Rechnung ${invoiceData.invoiceNumber}`,
      html: emailHTML,
      attachments: emailAttachments
    };

    // Prepare email history data
    emailHistoryData = {
      sender_email: senderInfo.email,
      sender_name: senderInfo.name,
      recipient_email: customerEmail,
      subject: `Rechnung ${invoiceData.invoiceNumber}`,
      body_html: emailHTML,
      attachments: emailAttachments.map(att => ({ 
        filename: att.filename, 
        size: att.content ? Buffer.byteLength(att.content) : 0,
        contentType: att.contentType 
      })),
      invoice_id: invoiceData.id || null,
      invoice_number: invoiceData.invoiceNumber,
      customer_id: invoiceData.customerId || null,
      customer_name: invoiceData.customerName || 'Unknown',
      email_type: 'invoice_multi'
    };

    const result = await transporter.sendMail(mailOptions);
    logger.info('E-Mail erfolgreich versendet:', result.messageId);
    
    // Save successful email to history
    await saveEmailToHistory({
      ...emailHistoryData,
      message_id: result.messageId,
      smtp_response: result
    }, 'sent');

    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    logger.error('Fehler beim E-Mail-Versand:', error);
    
    // Save failed email to history if we have the data
    if (emailHistoryData) {
      await saveEmailToHistory(emailHistoryData, 'failed', error.message);
    }
    
    throw new Error(`E-Mail-Versand fehlgeschlagen: ${error.message}`);
  }
};

export const sendInvoiceEmail = async (customerEmail, invoicePDF, invoiceData, format = 'standard', customText = null, attachments = [], companySettings = { primary_color: '#2563eb', secondary_color: '#64748b' }) => {
  let emailHistoryData = null;

  try {
    const transporter = await createTransporter();
    const senderInfo = await getSenderInfo();
    
    // Determine filename and content type based on format
    let filename;
    let contentType;
    
    switch (format) {
      case 'xrechnung':
        filename = `XRechnung_${invoiceData.invoiceNumber}.xml`;
        contentType = 'application/xml';
        break;
      case 'zugferd':
      default:
        filename = `Rechnung_${invoiceData.invoiceNumber}.pdf`;
        contentType = 'application/pdf';
        break;
    }
    
    // Format description for email body
    const formatDescription = {
      'zugferd': 'als PDF',
      'xrechnung': 'als XRechnung (strukturierte XML-Datei)'
    };
    
    // Build email HTML content
    let emailHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Rechnung ${invoiceData.invoiceNumber}</h2>
        
        <p>Sehr geehrte Damen und Herren,</p>`;
    
    // Add custom text if provided
    if (customText && customText.trim()) {
      emailHTML += `
        <div style="background-color: #f0f8ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${companySettings.primary_color || '#2196f3'};">
          <p style="margin: 0; white-space: pre-line;">${customText.replace(/\n/g, '<br>')}</p>
        </div>`;
    }
    
    emailHTML += `
        <p>anbei erhalten Sie die Rechnung ${invoiceData.invoiceNumber} über einen Betrag von <strong>€${invoiceData.total.toFixed(2)}</strong>.</p>
        
        <div style="background-color: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <h3 style="margin-top: 0;">Rechnungsdetails:</h3>
          <p><strong>Rechnungsnummer:</strong> ${invoiceData.invoiceNumber}</p>
          <p><strong>Rechnungsdatum:</strong> ${new Date(invoiceData.issueDate).toLocaleDateString('de-DE')}</p>
          <p><strong>Fälligkeitsdatum:</strong> ${(() => {
            const issueDate = new Date(invoiceData.issueDate);
            const dueDate = new Date(invoiceData.dueDate);
            const daysDifference = Math.ceil((dueDate.getTime() - issueDate.getTime()) / (1000 * 3600 * 24));
            return daysDifference <= 0 ? 'sofort' : dueDate.toLocaleDateString('de-DE');
          })()}</p>
          <p><strong>Betrag:</strong> €${invoiceData.total.toFixed(2)}</p>
          <p><strong>Format:</strong> ${formatDescription[format] || formatDescription['standard']}</p>
        </div>
        
        <p>Die Rechnung finden Sie ${format === 'xrechnung' ? 'als XML-Datei' : 'als PDF-Datei'} im Anhang.</p>`;
    
    // Add format-specific information
    if (format === 'zugferd') {
      emailHTML += `
        <div style="background-color: #e6f3ff; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${companySettings.primary_color || '#0066cc'};">
          <p style="margin: 0; font-size: 14px; color: ${companySettings.primary_color || '#0066cc'};">
            <strong>📄 PDF-Format:</strong> Diese Rechnung ist als PDF-Datei für die beste Kompatibilität bereitgestellt.
          </p>
        </div>`;
    }
    
    if (format === 'xrechnung') {
      emailHTML += `
        <div style="background-color: #f0f8e6; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${companySettings.secondary_color || '#4caf50'};">
          <p style="margin: 0; font-size: 14px; color: ${companySettings.secondary_color || '#2e7d32'};">
            <strong>🗂️ XRechnung-Format:</strong> Diese strukturierte XML-Rechnung entspricht dem Standard für die eRechnungs-konforme elektronische Rechnungsstellung.
          </p>
        </div>`;
    }
    
    // Add information about additional attachments if any
    if (attachments && attachments.length > 0) {
      emailHTML += `
        <div style="background-color: #fff3e0; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid ${companySettings.secondary_color || '#ff9800'};">
          <p style="margin: 0; font-size: 14px; color: ${companySettings.secondary_color || '#e65100'};">
            <strong>📎 Zusätzliche Anhänge:</strong> Diese E-Mail enthält ${attachments.length} weitere Dokument${attachments.length > 1 ? 'e' : ''}.
          </p>
        </div>`;
    }
    
    emailHTML += `
        <p>Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
        
        <p>Mit freundlichen Grüßen<br>
        ${senderInfo.name || 'Ihr Team'}</p>
        
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
          Diese E-Mail wurde automatisch generiert. Bitte antworten Sie nicht auf diese E-Mail.
        </p>
      </div>
    `;
    
    // Prepare attachments array
    const emailAttachments = [
      {
        filename: filename,
        content: invoicePDF,
        contentType: contentType
      }
    ];
    
    // Add additional attachments
    if (attachments && attachments.length > 0) {
      attachments.forEach(attachment => {
        // Ensure proper base64 content handling
        let attachmentContent = attachment.content;
        
        // If content includes data URL prefix, remove it
        if (attachmentContent.includes(',')) {
          attachmentContent = attachmentContent.split(',')[1];
        }
        
        emailAttachments.push({
          filename: sanitizeFilename(attachment.name),
          content: Buffer.from(attachmentContent, 'base64'),
          contentType: attachment.contentType || 'application/octet-stream'
        });
      });
    }

    const mailOptions = {
      from: {
        name: senderInfo.name,
        address: senderInfo.email
      },
      to: customerEmail,
      subject: `Rechnung ${invoiceData.invoiceNumber}`,
      html: emailHTML,
      attachments: emailAttachments
    };

    // Prepare email history data
    emailHistoryData = {
      sender_email: senderInfo.email,
      sender_name: senderInfo.name,
      recipient_email: customerEmail,
      subject: `Rechnung ${invoiceData.invoiceNumber}`,
      body_html: emailHTML,
      attachments: emailAttachments.map(att => ({ 
        filename: att.filename, 
        size: att.content ? Buffer.byteLength(att.content) : 0,
        contentType: att.contentType 
      })),
      invoice_id: invoiceData.id || null,
      invoice_number: invoiceData.invoiceNumber,
      customer_id: invoiceData.customerId || null,
      customer_name: invoiceData.customerName || 'Unknown',
      email_type: format === 'xrechnung' ? 'invoice_xrechnung' : 'invoice_zugferd'
    };

    const result = await transporter.sendMail(mailOptions);
    logger.info('E-Mail erfolgreich versendet:', result.messageId);
    
    // Save successful email to history
    await saveEmailToHistory({
      ...emailHistoryData,
      message_id: result.messageId,
      smtp_response: result
    }, 'sent');
    
    return { success: true, messageId: result.messageId };
    
  } catch (error) {
    logger.error('Fehler beim E-Mail-Versand:', error);
    
    // Save failed email to history if we have the data
    if (emailHistoryData) {
      await saveEmailToHistory(emailHistoryData, 'failed', error.message);
    }
    
    throw new Error(`E-Mail-Versand fehlgeschlagen: ${error.message}`);
  }
};

export const testEmailConnection = async () => {
  try {
    const transporter = await createTransporter();
    await transporter.verify();
    return { success: true, message: 'SMTP-Verbindung erfolgreich' };
  } catch (error) {
    logger.error('SMTP-Verbindung fehlgeschlagen:', error);
    return { success: false, message: error.message };
  }
};

// Send Quote Email - uses frontend PDF generation for consistency
export const sendQuoteEmail = async (customerEmails, quoteData, companySettings, customText = null, additionalAttachments = []) => {
  try {
    const transporter = await createTransporter();
    const senderInfo = await getSenderInfo();

    // Validate email addresses
    const validEmails = customerEmails.filter(email => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    });

    if (validEmails.length === 0) {
      return {
        success: false,
        message: 'Keine gültigen E-Mail-Adressen angegeben',
      };
    }

    // Note: Quote PDF should be generated on the frontend and passed as base64
    // This ensures consistency with preview/download functionality
    // The PDF buffer should be passed from the frontend
    if (!quoteData.pdfBuffer) {
      return {
        success: false,
        message: 'PDF-Daten fehlen. Das PDF muss vom Frontend generiert werden.',
      };
    }

    const pdfBuffer = Buffer.from(quoteData.pdfBuffer, 'base64');

    // Generate email content
    const defaultText = customText || `
Sehr geehrte Damen und Herren,

anbei erhalten Sie unser Angebot ${quoteData.quoteNumber}.

Das Angebot ist gültig bis zum ${new Date(quoteData.validUntil).toLocaleDateString('de-DE')}.

Mit freundlichen Grüßen
${companySettings.name}
    `.trim();

    // Get colors
    const primaryColor = companySettings.primaryColor || companySettings.primary_color || '#2563eb';
    const secondaryColor = companySettings.secondaryColor || companySettings.secondary_color || '#64748b';
    
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      background: #ffffff;
      padding: 30px;
      border: 1px solid #e5e7eb;
      border-top: none;
    }
    .quote-details {
      background: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .quote-details table {
      width: 100%;
      border-collapse: collapse;
    }
    .quote-details td {
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .quote-details td:first-child {
      font-weight: 600;
      width: 50%;
    }
    .quote-details tr:last-child td {
      border-bottom: none;
    }
    .total-amount {
      background: ${primaryColor};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
    }
    .total-amount .label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 5px;
    }
    .total-amount .amount {
      font-size: 32px;
      font-weight: bold;
    }
    .custom-message {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .info-box {
      background: #dbeafe;
      border-left: 4px solid ${primaryColor};
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .footer {
      background: #f9fafb;
      padding: 20px;
      border-radius: 0 0 8px 8px;
      border: 1px solid #e5e7eb;
      border-top: none;
      text-align: center;
      font-size: 14px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Angebot ${quoteData.quoteNumber}</h1>
  </div>
  
  <div class="content">
    <p>Sehr geehrte Damen und Herren,</p>
    
    ${customText && customText.trim() ? `
    <div class="custom-message">
      <p style="margin: 0;">${customText.replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}
    
    <p style="margin: 25px 0;">
      anbei erhalten Sie unser Angebot <strong>${quoteData.quoteNumber}</strong> über einen Betrag von <strong>${quoteData.total.toFixed(2).replace('.', ',')} €</strong>.
    </p>
    
    <div class="quote-details">
      <table>
        <tr>
          <td>Angebotsnummer:</td>
          <td><strong>${quoteData.quoteNumber}</strong></td>
        </tr>
        <tr>
          <td>Angebotsdatum:</td>
          <td>${new Date(quoteData.issueDate).toLocaleDateString('de-DE')}</td>
        </tr>
        <tr>
          <td>Gültig bis:</td>
          <td>${new Date(quoteData.validUntil).toLocaleDateString('de-DE')}</td>
        </tr>
      </table>
    </div>
    
    <div class="total-amount">
      <div class="label">Angebotssumme:</div>
      <div class="amount">${quoteData.total.toFixed(2).replace('.', ',')} €</div>
    </div>
    
    ${additionalAttachments && additionalAttachments.length > 0 ? `
    <div class="info-box">
      <p style="margin: 0;">
        <strong>📎 Zusätzliche Anhänge:</strong> Diese E-Mail enthält ${additionalAttachments.length} weitere Dokument${additionalAttachments.length > 1 ? 'e' : ''}.
      </p>
    </div>
    ` : ''}
    
    <p style="margin: 25px 0;">
      Das vollständige Angebot finden Sie im Anhang dieser E-Mail.
    </p>
  </div>
  
  <div class="footer">
    <p style="margin: 5px 0;">Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
    <p style="margin: 5px 0;">Mit freundlichen Grüßen</p>
    <p style="margin: 5px 0;"><strong>${senderInfo.name}</strong></p>
  </div>
</body>
</html>
    `.trim();

    // Prepare attachments
    const attachments = [
      {
        filename: sanitizeFilename(`Angebot_${quoteData.quoteNumber}_${quoteData.customerName}.pdf`),
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ];

    // Add additional attachments
    for (const att of additionalAttachments) {
      if (att.content && att.name) {
        attachments.push({
          filename: sanitizeFilename(att.name),
          content: Buffer.from(att.content, 'base64'),
          contentType: att.contentType || 'application/octet-stream',
        });
      }
    }

    // Send email
    const info = await transporter.sendMail({
      from: `"${senderInfo.name}" <${senderInfo.email}>`,
      to: validEmails.join(', '),
      subject: `Angebot ${quoteData.quoteNumber} - ${companySettings.name}`,
      text: defaultText,
      html: htmlContent,
      attachments,
    });

    // Save to email history
    await saveEmailToHistory({
      senderEmail: senderInfo.email,
      senderName: senderInfo.name,
      recipientEmail: validEmails.join(', '),
      subject: `Angebot ${quoteData.quoteNumber} - ${companySettings.name}`,
      bodyHtml: htmlContent,
      bodyPlain: defaultText,
      attachments: attachments.map(att => ({ filename: att.filename, size: att.content.length })),
      messageId: info.messageId,
      smtpResponse: info,
      quoteId: quoteData.id,
      quoteNumber: quoteData.quoteNumber,
      customerName: quoteData.customerName,
      emailType: 'quote',
    });

    logger.info('Quote email sent successfully', {
      quoteId: quoteData.id,
      quoteNumber: quoteData.quoteNumber,
      recipients: validEmails,
      messageId: info.messageId,
    });

    return {
      success: true,
      message: 'Angebot erfolgreich per E-Mail versendet',
      messageId: info.messageId,
    };
  } catch (error) {
    logger.error('Error sending quote email:', error);
    
    // Save failed email to history
    try {
      await saveEmailToHistory({
        senderEmail: (await getSenderInfo()).email,
        recipientEmail: customerEmails.join(', '),
        subject: `Angebot ${quoteData.quoteNumber}`,
        bodyPlain: customText || '',
        quoteId: quoteData.id,
        quoteNumber: quoteData.quoteNumber,
        customerName: quoteData.customerName,
        emailType: 'quote',
      }, 'failed', error.message);
    } catch (historyError) {
      logger.error('Error saving failed email to history:', historyError);
    }

    return {
      success: false,
      message: `Fehler beim E-Mail-Versand: ${error.message}`,
    };
  }
};

/**
 * Send payment reminder email
 */
export const sendReminderEmail = async (customerEmails, reminderPDF, invoiceData, stage, fee, customText = null, companySettings = { primary_color: '#2563eb', secondary_color: '#64748b' }, additionalAttachments = []) => {
  try {
    logger.info('Sending reminder email', { 
      customerEmails, 
      invoiceNumber: invoiceData.invoiceNumber,
      stage,
      fee,
      additionalAttachments: additionalAttachments.length
    });

    // Create transporter
    const transporter = await createTransporter();
    if (!transporter) {
      throw new Error('E-Mail-Transporter konnte nicht erstellt werden. Bitte prüfen Sie die SMTP-Einstellungen.');
    }

    // Get sender info
    const senderInfo = await getSenderInfo();

    // Generate stage-specific subject and body
    const stageText = stage === 1 ? '1. Zahlungserinnerung' : stage === 2 ? '2. Zahlungserinnerung' : '3. Zahlungserinnerung';
    const subject = `${stageText} - Rechnung ${invoiceData.invoiceNumber}`;

    // Calculate total with fee
    const originalTotal = invoiceData.total;
    const totalWithFee = originalTotal + (fee || 0);

    // Create HTML email body
    const primaryColor = companySettings.primary_color || '#2563eb';
    const secondaryColor = companySettings.secondary_color || '#64748b';

    const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .header {
      background: linear-gradient(135deg, ${primaryColor} 0%, ${secondaryColor} 100%);
      color: white;
      padding: 30px;
      border-radius: 8px 8px 0 0;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      background: #ffffff;
      padding: 30px;
      border: 1px solid #e5e7eb;
      border-top: none;
    }
    .invoice-details {
      background: #f9fafb;
      padding: 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .invoice-details table {
      width: 100%;
      border-collapse: collapse;
    }
    .invoice-details td {
      padding: 8px 0;
      border-bottom: 1px solid #e5e7eb;
    }
    .invoice-details td:first-child {
      font-weight: 600;
      width: 50%;
    }
    .invoice-details tr:last-child td {
      border-bottom: none;
    }
    .total-amount {
      background: ${primaryColor};
      color: white;
      padding: 15px 20px;
      border-radius: 8px;
      margin: 20px 0;
      text-align: center;
    }
    .total-amount .label {
      font-size: 14px;
      opacity: 0.9;
      margin-bottom: 5px;
    }
    .total-amount .amount {
      font-size: 32px;
      font-weight: bold;
    }
    .custom-message {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .footer {
      background: #f9fafb;
      padding: 20px;
      border-radius: 0 0 8px 8px;
      border: 1px solid #e5e7eb;
      border-top: none;
      text-align: center;
      font-size: 14px;
      color: #6b7280;
    }
    .button {
      display: inline-block;
      background: ${primaryColor};
      color: white;
      padding: 12px 30px;
      text-decoration: none;
      border-radius: 6px;
      margin: 20px 0;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${stageText}</h1>
  </div>
  
  <div class="content">
    ${customText ? `
    <div class="custom-message">
      <p style="margin: 0;">${customText.replace(/\n/g, '<br>')}</p>
    </div>
    ` : ''}
    
    <div class="invoice-details">
      <table>
        <tr>
          <td>Rechnungsnummer:</td>
          <td><strong>${invoiceData.invoiceNumber}</strong></td>
        </tr>
        <tr>
          <td>Rechnungsdatum:</td>
          <td>${new Date(invoiceData.issueDate).toLocaleDateString('de-DE')}</td>
        </tr>
        <tr>
          <td>Fälligkeitsdatum:</td>
          <td>${new Date(invoiceData.dueDate).toLocaleDateString('de-DE')}</td>
        </tr>
        <tr>
          <td>Ursprünglicher Betrag:</td>
          <td>${originalTotal.toFixed(2).replace('.', ',')} €</td>
        </tr>
        ${fee > 0 ? `
        <tr>
          <td>Mahngebühr:</td>
          <td style="color: #dc2626;">${fee.toFixed(2).replace('.', ',')} €</td>
        </tr>
        ` : ''}
      </table>
    </div>
    
    <div class="total-amount">
      <div class="label">Zu zahlender Gesamtbetrag:</div>
      <div class="amount">${totalWithFee.toFixed(2).replace('.', ',')} €</div>
    </div>
    
    <p style="margin: 25px 0;">
      Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer <strong>${invoiceData.invoiceNumber}</strong> auf unser Konto.
    </p>
    
    <p style="margin: 25px 0;">
      Die vollständige ${stageText} finden Sie im Anhang dieser E-Mail.
    </p>
  </div>
  
  <div class="footer">
    <p style="margin: 5px 0;">Bei Fragen stehen wir Ihnen gerne zur Verfügung.</p>
    <p style="margin: 5px 0;">Mit freundlichen Grüßen</p>
    <p style="margin: 5px 0;"><strong>${senderInfo.name}</strong></p>
  </div>
</body>
</html>
    `.trim();

    // Create plain text version
    const plainBody = `
${stageText}

${customText ? customText + '\n\n' : ''}

Rechnungsnummer: ${invoiceData.invoiceNumber}
Rechnungsdatum: ${new Date(invoiceData.issueDate).toLocaleDateString('de-DE')}
Fälligkeitsdatum: ${new Date(invoiceData.dueDate).toLocaleDateString('de-DE')}
Ursprünglicher Betrag: ${originalTotal.toFixed(2).replace('.', ',')} €
${fee > 0 ? `Mahngebühr: ${fee.toFixed(2).replace('.', ',')} €\n` : ''}

Zu zahlender Gesamtbetrag: ${totalWithFee.toFixed(2).replace('.', ',')} €

Bitte überweisen Sie den Betrag unter Angabe der Rechnungsnummer ${invoiceData.invoiceNumber} auf unser Konto.

Die vollständige ${stageText} finden Sie im Anhang dieser E-Mail.

Bei Fragen stehen wir Ihnen gerne zur Verfügung.

Mit freundlichen Grüßen
${senderInfo.name}
    `.trim();

    // Prepare attachments - start with reminder PDF
    const emailAttachments = [
      {
        filename: sanitizeFilename(`${stageText.replace(/\./g, '')}_${invoiceData.invoiceNumber}.pdf`),
        content: Buffer.from(reminderPDF, 'base64'),
        contentType: 'application/pdf',
      },
    ];
    
    // Add additional attachments (original invoice + invoice attachments)
    if (additionalAttachments && additionalAttachments.length > 0) {
      additionalAttachments.forEach(attachment => {
        // Ensure proper base64 content handling
        let attachmentContent = attachment.content;
        
        // If content includes data URL prefix, remove it
        if (attachmentContent.includes(',')) {
          attachmentContent = attachmentContent.split(',')[1];
        }
        
        emailAttachments.push({
          filename: sanitizeFilename(attachment.name),
          content: Buffer.from(attachmentContent, 'base64'),
          contentType: attachment.contentType || 'application/octet-stream'
        });
      });
    }
    
    // Prepare email options
    const mailOptions = {
      from: `"${senderInfo.name}" <${senderInfo.email}>`,
      to: customerEmails.join(', '),
      subject: subject,
      text: plainBody,
      html: htmlBody,
      attachments: emailAttachments,
    };

    // Send email
    const info = await transporter.sendMail(mailOptions);
    logger.info('Reminder email sent successfully', { messageId: info.messageId, invoiceNumber: invoiceData.invoiceNumber, stage });

    // Save to email history
    try {
      // Build attachment list for history
      const historyAttachments = emailAttachments.map(att => ({
        filename: att.filename,
        size: att.content ? Buffer.byteLength(att.content) : 0,
        contentType: att.contentType
      }));
      
      await saveEmailToHistory({
        senderEmail: senderInfo.email,
        senderName: senderInfo.name,
        recipientEmail: customerEmails.join(', '),
        subject: subject,
        bodyHtml: htmlBody,
        bodyPlain: plainBody,
        attachments: historyAttachments,
        messageId: info.messageId,
        smtpResponse: info.response,
        invoiceId: invoiceData.id,
        invoiceNumber: invoiceData.invoiceNumber,
        customerId: invoiceData.customerId,
        customerName: invoiceData.customerName,
        emailType: 'reminder',
        reminderStage: stage,
      }, 'sent');
    } catch (historyError) {
      logger.error('Error saving reminder email to history:', historyError);
    }

    return {
      success: true,
      message: `${stageText} erfolgreich per E-Mail versendet`,
      messageId: info.messageId,
    };
  } catch (error) {
    logger.error('Error sending reminder email:', error);

    // Try to save failed email to history
    try {
      const senderInfo = await getSenderInfo();
      await saveEmailToHistory({
        senderEmail: senderInfo.email,
        senderName: senderInfo.name,
        recipientEmail: customerEmails.join(', '),
        subject: `${stage === 1 ? '1.' : stage === 2 ? '2.' : '3.'} Zahlungserinnerung - Rechnung ${invoiceData.invoiceNumber}`,
        invoiceId: invoiceData.id,
        invoiceNumber: invoiceData.invoiceNumber,
        customerId: invoiceData.customerId,
        customerName: invoiceData.customerName,
        emailType: 'reminder',
        reminderStage: stage,
      }, 'failed', error.message);
    } catch (historyError) {
      logger.error('Error saving failed reminder email to history:', historyError);
    }

    return {
      success: false,
      message: `Fehler beim E-Mail-Versand: ${error.message}`,
    };
  }
};
