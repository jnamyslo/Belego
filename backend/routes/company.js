import express from 'express';
import { query } from '../database.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Get company information
router.get('/', async (req, res) => {
  try {
    const companyResult = await query('SELECT * FROM company WHERE id = 1');
    
    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: 'Company information not found' });
    }

    const row = companyResult.rows[0];
    
    // Get hourly rates
    const hourlyRatesResult = await query('SELECT * FROM hourly_rates ORDER BY is_default DESC, name ASC');
    const hourlyRates = hourlyRatesResult.rows.map(rate => ({
      id: rate.id,
      name: rate.name,
      description: rate.description,
      rate: parseFloat(rate.rate),
      isDefault: rate.is_default
    }));

    const company = {
      name: row.name,
      address: row.address,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      phone: row.phone,
      email: row.email,
      website: row.website,
      taxId: row.tax_id,
      taxIdentificationNumber: row.tax_identification_number,
      logo: row.logo,
      icon: row.icon,
      locale: row.locale,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      jobTrackingEnabled: row.job_tracking_enabled || false,
      reportingEnabled: row.reporting_enabled || false,
      quotesEnabled: row.quotes_enabled || false,
      discountsEnabled: row.discounts_enabled !== null ? row.discounts_enabled : true,
      defaultPaymentDays: row.default_payment_days !== null ? row.default_payment_days : 30,
      immediatePaymentClause: row.immediate_payment_clause,
      invoiceStartNumber: row.invoice_start_number || 1,
      // Reminder settings
      remindersEnabled: row.reminders_enabled || false,
      reminderDaysAfterDue: row.reminder_days_after_due !== null ? row.reminder_days_after_due : 7,
      reminderDaysBetween: row.reminder_days_between !== null ? row.reminder_days_between : 7,
      reminderFeeStage1: row.reminder_fee_stage_1 !== null ? parseFloat(row.reminder_fee_stage_1) : 0,
      reminderFeeStage2: row.reminder_fee_stage_2 !== null ? parseFloat(row.reminder_fee_stage_2) : 0,
      reminderFeeStage3: row.reminder_fee_stage_3 !== null ? parseFloat(row.reminder_fee_stage_3) : 0,
      reminderTextStage1: row.reminder_text_stage_1,
      reminderTextStage2: row.reminder_text_stage_2,
      reminderTextStage3: row.reminder_text_stage_3,
      // Separated payment information
      paymentInformation: {
        accountHolder: row.payment_account_holder,
        bankAccount: row.payment_bank_account,
        bic: row.payment_bic,
        bankName: row.payment_bank_name,
        paymentTerms: row.payment_terms,
        paymentMethods: row.payment_methods || []
      },
      // Company header layout options
      companyHeaderTwoLine: row.company_header_two_line || false,
      companyHeaderLine1: row.company_header_line1,
      companyHeaderLine2: row.company_header_line2,
      // Dropdown settings
      showCombinedDropdowns: row.show_combined_dropdowns !== null ? row.show_combined_dropdowns : false,
      // Small business regulation
      isSmallBusiness: row.is_small_business || false,
      // Legacy fields for backward compatibility
      bankAccount: row.bank_account || row.payment_bank_account,
      bic: row.bic || row.payment_bic,
      hourlyRates: hourlyRates
    };

    res.json(company);
  } catch (error) {
    logger.error('Error fetching company:', error);
    res.status(500).json({ error: 'Failed to fetch company information' });
  }
});

// Update company information
router.put('/', async (req, res) => {
  try {
    const updates = [];
    const values = [];
    let paramIndex = 1;

    // Build dynamic update query based on provided fields
    if (req.body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(req.body.name);
    }
    if (req.body.address !== undefined) {
      updates.push(`address = $${paramIndex++}`);
      values.push(req.body.address);
    }
    if (req.body.city !== undefined) {
      updates.push(`city = $${paramIndex++}`);
      values.push(req.body.city);
    }
    if (req.body.postalCode !== undefined) {
      updates.push(`postal_code = $${paramIndex++}`);
      values.push(req.body.postalCode);
    }
    if (req.body.country !== undefined) {
      updates.push(`country = $${paramIndex++}`);
      values.push(req.body.country);
    }
    if (req.body.phone !== undefined) {
      updates.push(`phone = $${paramIndex++}`);
      values.push(req.body.phone);
    }
    if (req.body.email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(req.body.email);
    }
    if (req.body.website !== undefined) {
      updates.push(`website = $${paramIndex++}`);
      values.push(req.body.website);
    }
    if (req.body.taxId !== undefined) {
      updates.push(`tax_id = $${paramIndex++}`);
      values.push(req.body.taxId);
    }
    if (req.body.taxIdentificationNumber !== undefined) {
      updates.push(`tax_identification_number = $${paramIndex++}`);
      values.push(req.body.taxIdentificationNumber);
    }
    if (req.body.bankAccount !== undefined) {
      updates.push(`bank_account = $${paramIndex++}`);
      values.push(req.body.bankAccount);
    }
    if (req.body.bic !== undefined) {
      updates.push(`bic = $${paramIndex++}`);
      values.push(req.body.bic);
    }
    if (req.body.logo !== undefined) {
      updates.push(`logo = $${paramIndex++}`);
      values.push(req.body.logo);
    }
    if (req.body.icon !== undefined) {
      updates.push(`icon = $${paramIndex++}`);
      values.push(req.body.icon);
    }
    if (req.body.locale !== undefined) {
      updates.push(`locale = $${paramIndex++}`);
      values.push(req.body.locale);
    }
    if (req.body.primaryColor !== undefined) {
      updates.push(`primary_color = $${paramIndex++}`);
      values.push(req.body.primaryColor);
    }
    if (req.body.secondaryColor !== undefined) {
      updates.push(`secondary_color = $${paramIndex++}`);
      values.push(req.body.secondaryColor);
    }
    if (req.body.jobTrackingEnabled !== undefined) {
      updates.push(`job_tracking_enabled = $${paramIndex++}`);
      values.push(req.body.jobTrackingEnabled);
    }
    if (req.body.reportingEnabled !== undefined) {
      updates.push(`reporting_enabled = $${paramIndex++}`);
      values.push(req.body.reportingEnabled);
    }
    if (req.body.quotesEnabled !== undefined) {
      updates.push(`quotes_enabled = $${paramIndex++}`);
      values.push(req.body.quotesEnabled);
    }
    if (req.body.discountsEnabled !== undefined) {
      updates.push(`discounts_enabled = $${paramIndex++}`);
      values.push(req.body.discountsEnabled);
    }
    if (req.body.defaultPaymentDays !== undefined) {
      updates.push(`default_payment_days = $${paramIndex++}`);
      values.push(req.body.defaultPaymentDays);
    }
    if (req.body.immediatePaymentClause !== undefined) {
      updates.push(`immediate_payment_clause = $${paramIndex++}`);
      values.push(req.body.immediatePaymentClause);
    }
    if (req.body.invoiceStartNumber !== undefined) {
      updates.push(`invoice_start_number = $${paramIndex++}`);
      values.push(req.body.invoiceStartNumber);
    }
    
    // Handle payment information fields
    if (req.body.paymentInformation) {
      const paymentInfo = req.body.paymentInformation;
      
      if (paymentInfo.accountHolder !== undefined) {
        updates.push(`payment_account_holder = $${paramIndex++}`);
        values.push(paymentInfo.accountHolder);
      }
      if (paymentInfo.bankAccount !== undefined) {
        updates.push(`payment_bank_account = $${paramIndex++}`);
        values.push(paymentInfo.bankAccount);
      }
      if (paymentInfo.bic !== undefined) {
        updates.push(`payment_bic = $${paramIndex++}`);
        values.push(paymentInfo.bic);
      }
      if (paymentInfo.bankName !== undefined) {
        updates.push(`payment_bank_name = $${paramIndex++}`);
        values.push(paymentInfo.bankName);
      }
      if (paymentInfo.paymentTerms !== undefined) {
        updates.push(`payment_terms = $${paramIndex++}`);
        values.push(paymentInfo.paymentTerms);
      }
      if (paymentInfo.paymentMethods !== undefined) {
        updates.push(`payment_methods = $${paramIndex++}`);
        values.push(JSON.stringify(paymentInfo.paymentMethods));
      }
    }

    // Handle company header layout fields
    if (req.body.companyHeaderTwoLine !== undefined) {
      updates.push(`company_header_two_line = $${paramIndex++}`);
      values.push(req.body.companyHeaderTwoLine);
    }
    if (req.body.companyHeaderLine1 !== undefined) {
      updates.push(`company_header_line1 = $${paramIndex++}`);
      values.push(req.body.companyHeaderLine1);
    }
    if (req.body.companyHeaderLine2 !== undefined) {
      updates.push(`company_header_line2 = $${paramIndex++}`);
      values.push(req.body.companyHeaderLine2);
    }
    if (req.body.showCombinedDropdowns !== undefined) {
      updates.push(`show_combined_dropdowns = $${paramIndex++}`);
      values.push(req.body.showCombinedDropdowns);
    }
    if (req.body.isSmallBusiness !== undefined) {
      updates.push(`is_small_business = $${paramIndex++}`);
      values.push(req.body.isSmallBusiness);
    }
    
    // Handle reminder settings
    if (req.body.remindersEnabled !== undefined) {
      updates.push(`reminders_enabled = $${paramIndex++}`);
      values.push(req.body.remindersEnabled);
    }
    if (req.body.reminderDaysAfterDue !== undefined) {
      updates.push(`reminder_days_after_due = $${paramIndex++}`);
      values.push(req.body.reminderDaysAfterDue);
    }
    if (req.body.reminderDaysBetween !== undefined) {
      updates.push(`reminder_days_between = $${paramIndex++}`);
      values.push(req.body.reminderDaysBetween);
    }
    if (req.body.reminderFeeStage1 !== undefined) {
      updates.push(`reminder_fee_stage_1 = $${paramIndex++}`);
      values.push(req.body.reminderFeeStage1);
    }
    if (req.body.reminderFeeStage2 !== undefined) {
      updates.push(`reminder_fee_stage_2 = $${paramIndex++}`);
      values.push(req.body.reminderFeeStage2);
    }
    if (req.body.reminderFeeStage3 !== undefined) {
      updates.push(`reminder_fee_stage_3 = $${paramIndex++}`);
      values.push(req.body.reminderFeeStage3);
    }
    if (req.body.reminderTextStage1 !== undefined) {
      updates.push(`reminder_text_stage_1 = $${paramIndex++}`);
      values.push(req.body.reminderTextStage1);
    }
    if (req.body.reminderTextStage2 !== undefined) {
      updates.push(`reminder_text_stage_2 = $${paramIndex++}`);
      values.push(req.body.reminderTextStage2);
    }
    if (req.body.reminderTextStage3 !== undefined) {
      updates.push(`reminder_text_stage_3 = $${paramIndex++}`);
      values.push(req.body.reminderTextStage3);
    }

    // Add the ID for the WHERE clause
    values.push(1);
    const whereParamIndex = paramIndex;

    let result = null;
    
    // Only run UPDATE if there are fields to update
    if (updates.length > 0) {
      const updateQuery = `
        UPDATE company SET
          ${updates.join(', ')}
        WHERE id = $${whereParamIndex}
        RETURNING *
      `;
      result = await query(updateQuery, values);
    } else {
      // If no fields to update, just fetch the current data
      result = await query('SELECT * FROM company WHERE id = 1');
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Company information not found' });
    }

    // Update hourly rates if provided
    if (req.body.hourlyRates && Array.isArray(req.body.hourlyRates)) {
      // Delete existing hourly rates
      await query('DELETE FROM hourly_rates WHERE company_id = 1');
      
      // Insert new hourly rates
      for (const rate of req.body.hourlyRates) {
        await query(`
          INSERT INTO hourly_rates (id, name, description, rate, is_default, company_id)
          VALUES ($1, $2, $3, $4, $5, 1)
        `, [rate.id, rate.name, rate.description || null, rate.rate, rate.isDefault || false]);
      }
    }

    // Get updated hourly rates
    const hourlyRatesResult = await query('SELECT * FROM hourly_rates ORDER BY is_default DESC, name ASC');
    const updatedHourlyRates = hourlyRatesResult.rows.map(rate => ({
      id: rate.id,
      name: rate.name,
      description: rate.description,
      rate: parseFloat(rate.rate),
      isDefault: rate.is_default
    }));

    const row = result.rows[0];
    const company = {
      name: row.name,
      address: row.address,
      city: row.city,
      postalCode: row.postal_code,
      country: row.country,
      phone: row.phone,
      email: row.email,
      website: row.website,
      taxId: row.tax_id,
      taxIdentificationNumber: row.tax_identification_number,
      logo: row.logo,
      icon: row.icon,
      locale: row.locale,
      primaryColor: row.primary_color,
      secondaryColor: row.secondary_color,
      jobTrackingEnabled: row.job_tracking_enabled,
      reportingEnabled: row.reporting_enabled,
      quotesEnabled: row.quotes_enabled || false,
      discountsEnabled: row.discounts_enabled !== null ? row.discounts_enabled : true,
      defaultPaymentDays: row.default_payment_days !== null ? row.default_payment_days : 30,
      immediatePaymentClause: row.immediate_payment_clause,
      invoiceStartNumber: row.invoice_start_number || 1,
      // Reminder settings
      remindersEnabled: row.reminders_enabled || false,
      reminderDaysAfterDue: row.reminder_days_after_due !== null ? row.reminder_days_after_due : 7,
      reminderDaysBetween: row.reminder_days_between !== null ? row.reminder_days_between : 7,
      reminderFeeStage1: row.reminder_fee_stage_1 !== null ? parseFloat(row.reminder_fee_stage_1) : 0,
      reminderFeeStage2: row.reminder_fee_stage_2 !== null ? parseFloat(row.reminder_fee_stage_2) : 0,
      reminderFeeStage3: row.reminder_fee_stage_3 !== null ? parseFloat(row.reminder_fee_stage_3) : 0,
      reminderTextStage1: row.reminder_text_stage_1,
      reminderTextStage2: row.reminder_text_stage_2,
      reminderTextStage3: row.reminder_text_stage_3,
      // Separated payment information
      paymentInformation: {
        accountHolder: row.payment_account_holder,
        bankAccount: row.payment_bank_account,
        bic: row.payment_bic,
        bankName: row.payment_bank_name,
        paymentTerms: row.payment_terms,
        paymentMethods: row.payment_methods || []
      },
      // Company header layout options
      companyHeaderTwoLine: row.company_header_two_line || false,
      companyHeaderLine1: row.company_header_line1,
      companyHeaderLine2: row.company_header_line2,
      // Dropdown settings
      showCombinedDropdowns: row.show_combined_dropdowns !== null ? row.show_combined_dropdowns : false,
      // Small business regulation
      isSmallBusiness: row.is_small_business || false,
      // Legacy fields for backward compatibility
      bankAccount: row.bank_account || row.payment_bank_account,
      bic: row.bic || row.payment_bic,
      hourlyRates: updatedHourlyRates
    };

    res.json(company);
  } catch (error) {
    logger.error('Error updating company:', error);
    res.status(500).json({ error: 'Failed to update company information' });
  }
});

export default router;
