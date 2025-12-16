/**
 * Migration: Initial Schema
 * Creates all base tables for the application
 */

export const name = '001_initial_schema';

export async function up(client) {
  // Create customers table
  await client.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_number VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      address TEXT NOT NULL,
      address_supplement TEXT,
      city VARCHAR(100) NOT NULL,
      postal_code VARCHAR(20) NOT NULL,
      country VARCHAR(100) NOT NULL,
      tax_id VARCHAR(50),
      phone VARCHAR(50),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create invoices table
  await client.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_number VARCHAR(50) UNIQUE NOT NULL,
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      customer_name VARCHAR(255) NOT NULL,
      issue_date DATE NOT NULL,
      due_date DATE NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      tax_amount DECIMAL(10,2) NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x')),
      notes TEXT,
      global_discount_type VARCHAR(20),
      global_discount_value DECIMAL(10,2),
      global_discount_amount DECIMAL(10,2),
      last_reminder_date DATE,
      last_reminder_sent_at TIMESTAMP WITH TIME ZONE,
      max_reminder_stage INTEGER DEFAULT 0,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create invoice_items table
  await client.query(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity DECIMAL(10,2) NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      tax_rate DECIMAL(5,2) NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      discount_type VARCHAR(20),
      discount_value DECIMAL(10,2),
      discount_amount DECIMAL(10,2),
      item_order INTEGER DEFAULT 1
    )
  `);

  // Create invoice_attachments table
  await client.query(`
    CREATE TABLE IF NOT EXISTS invoice_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create quotes table
  await client.query(`
    CREATE TABLE IF NOT EXISTS quotes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_number VARCHAR(50) UNIQUE NOT NULL,
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      customer_name VARCHAR(255) NOT NULL,
      issue_date DATE NOT NULL,
      valid_until DATE NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      tax_amount DECIMAL(10,2) NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'billed')),
      notes TEXT,
      global_discount_type VARCHAR(20),
      global_discount_value DECIMAL(10,2),
      global_discount_amount DECIMAL(10,2),
      converted_to_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create quote_items table
  await client.query(`
    CREATE TABLE IF NOT EXISTS quote_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity DECIMAL(10,2) NOT NULL,
      unit_price DECIMAL(10,2) NOT NULL,
      tax_rate DECIMAL(5,2) NOT NULL,
      total DECIMAL(10,2) NOT NULL,
      discount_type VARCHAR(20),
      discount_value DECIMAL(10,2),
      discount_amount DECIMAL(10,2),
      item_order INTEGER DEFAULT 1
    )
  `);

  // Create quote_attachments table
  await client.query(`
    CREATE TABLE IF NOT EXISTS quote_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create company table
  await client.query(`
    CREATE TABLE IF NOT EXISTS company (
      id INTEGER PRIMARY KEY DEFAULT 1,
      name VARCHAR(255) NOT NULL,
      address TEXT NOT NULL,
      city VARCHAR(100) NOT NULL,
      postal_code VARCHAR(20) NOT NULL,
      country VARCHAR(100) NOT NULL,
      phone VARCHAR(50) NOT NULL,
      email VARCHAR(255) NOT NULL,
      website VARCHAR(255),
      tax_id VARCHAR(50) NOT NULL,
      tax_identification_number VARCHAR(50),
      bank_account VARCHAR(50),
      bic VARCHAR(20),
      logo TEXT,
      icon TEXT,
      locale VARCHAR(10) DEFAULT 'de-DE',
      primary_color VARCHAR(7) DEFAULT '#2563eb',
      secondary_color VARCHAR(7) DEFAULT '#64748b',
      job_tracking_enabled BOOLEAN DEFAULT true,
      reporting_enabled BOOLEAN DEFAULT true,
      quotes_enabled BOOLEAN DEFAULT false,
      discounts_enabled BOOLEAN DEFAULT true,
      reminders_enabled BOOLEAN DEFAULT false,
      default_payment_days INTEGER DEFAULT 30,
      immediate_payment_clause TEXT DEFAULT 'Rechnung ist per sofort fällig, ohne Abzug',
      invoice_start_number INTEGER DEFAULT 1,
      is_small_business BOOLEAN DEFAULT false,
      show_combined_dropdowns BOOLEAN DEFAULT false,
      company_header_two_line BOOLEAN DEFAULT false,
      company_header_line1 TEXT,
      company_header_line2 TEXT,
      reminder_days_after_due INTEGER DEFAULT 7,
      reminder_days_between INTEGER DEFAULT 7,
      reminder_fee_stage_1 DECIMAL(10,2) DEFAULT 0,
      reminder_fee_stage_2 DECIMAL(10,2) DEFAULT 0,
      reminder_fee_stage_3 DECIMAL(10,2) DEFAULT 0,
      reminder_text_stage_1 TEXT,
      reminder_text_stage_2 TEXT,
      reminder_text_stage_3 TEXT,
      payment_account_holder VARCHAR(255),
      payment_bank_account VARCHAR(50),
      payment_bic VARCHAR(20),
      payment_bank_name VARCHAR(255),
      payment_terms TEXT,
      payment_methods JSONB DEFAULT '[]'
    )
  `);

  // Create job_entries table
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_number VARCHAR(50) UNIQUE NOT NULL DEFAULT '',
      external_job_number VARCHAR(100),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      customer_address TEXT,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      date DATE NOT NULL,
      start_time TIME,
      end_time TIME,
      hours_worked DECIMAL(5,2) NOT NULL DEFAULT 0,
      hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      hourly_rate_id UUID,
      materials JSONB DEFAULT '[]',
      status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in-progress', 'completed', 'invoiced')),
      notes TEXT,
      priority VARCHAR(10) CHECK (priority IN ('low', 'medium', 'high')),
      signature JSONB,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create job_attachments table
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID NOT NULL REFERENCES job_entries(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      content_type VARCHAR(100) NOT NULL,
      size INTEGER NOT NULL,
      uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create hourly_rates table
  await client.query(`
    CREATE TABLE IF NOT EXISTS hourly_rates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id INTEGER REFERENCES company(id) DEFAULT 1,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      rate DECIMAL(10,2) NOT NULL,
      tax_rate DECIMAL(5,2) DEFAULT 19,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create material_templates table
  await client.query(`
    CREATE TABLE IF NOT EXISTS material_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id INTEGER REFERENCES company(id) DEFAULT 1,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      unit_price DECIMAL(10,2) NOT NULL,
      unit VARCHAR(50) DEFAULT 'Stück',
      tax_rate DECIMAL(5,2) DEFAULT 19,
      is_default BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create job_time_entries table
  await client.query(`
    CREATE TABLE IF NOT EXISTS job_time_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      job_id UUID NOT NULL REFERENCES job_entries(id) ON DELETE CASCADE,
      description VARCHAR(255) NOT NULL DEFAULT '',
      start_time TIME,
      end_time TIME,
      hours_worked DECIMAL(5,2) NOT NULL DEFAULT 0,
      hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
      hourly_rate_id UUID,
      tax_rate DECIMAL(5,2) NOT NULL DEFAULT 19,
      total DECIMAL(10,2) NOT NULL DEFAULT 0,
      discount_type VARCHAR(20),
      discount_value DECIMAL(10,2),
      discount_amount DECIMAL(10,2),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);

  // Create yearly_invoice_start_numbers table
  await client.query(`
    CREATE TABLE IF NOT EXISTS yearly_invoice_start_numbers (
      id SERIAL PRIMARY KEY,
      year INTEGER NOT NULL,
      start_number INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(year)
    )
  `);

  // Create migrations table
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
}

export async function down(client) {
  // Drop tables in reverse order of creation (respecting foreign keys)
  const tables = [
    'migrations',
    'yearly_invoice_start_numbers',
    'job_time_entries',
    'material_templates',
    'hourly_rates',
    'job_attachments',
    'job_entries',
    'quote_attachments',
    'quote_items',
    'quotes',
    'invoice_attachments',
    'invoice_items',
    'invoices',
    'company',
    'customers'
  ];

  for (const table of tables) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}

