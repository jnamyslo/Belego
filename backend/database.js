import pkg from 'pg';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper function to load and convert image to base64
async function loadImageAsBase64(imagePath) {
  try {
    const absolutePath = path.resolve(__dirname, imagePath);
    const imageBuffer = await fs.readFile(absolutePath);
    const base64 = imageBuffer.toString('base64');
    const mimeType = imagePath.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    logger.warn(`Could not load image ${imagePath}:`, error.message);
    return null;
  }
}

// Database connection configuration
export const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Create database tables
export async function createTables() {
  const client = await pool.connect();
  
  try {
    // Wait for database to be ready
    let retries = 10;
    while (retries > 0) {
      try {
        await client.query('SELECT 1');
        break;
      } catch (error) {
        logger.debug(`Database not ready, retrying...`, { retriesLeft: retries });
        retries--;
        if (retries === 0) throw error;
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Create customers table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        customer_number VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
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
        status VARCHAR(20) NOT NULL CHECK (status IN ('draft', 'sent', 'paid', 'overdue')),
        notes TEXT,
        global_discount_type VARCHAR(20),
        global_discount_value DECIMAL(10,2),
        global_discount_amount DECIMAL(10,2),
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

    // Create job_entries table
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_number VARCHAR(50) UNIQUE NOT NULL DEFAULT '',
        external_job_number VARCHAR(100),
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        date DATE NOT NULL,
        start_time TIME,
        end_time TIME,
        hours_worked DECIMAL(5,2) NOT NULL DEFAULT 0,
        hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
        materials JSONB DEFAULT '[]',
        status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in-progress', 'completed', 'invoiced')),
        notes TEXT,
        priority VARCHAR(10) CHECK (priority IN ('low', 'medium', 'high')),
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
        bank_account VARCHAR(50),
        bic VARCHAR(20),
        logo TEXT,
        icon TEXT,
        primary_color VARCHAR(7) DEFAULT '#2563eb',
        secondary_color VARCHAR(7) DEFAULT '#64748b'
      )
    `);

    // Add BIC column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS bic VARCHAR(20)
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('BIC column already exists or error adding it:', error.message);
    }

    // Add locale column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS locale VARCHAR(10) DEFAULT 'de-DE'
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Locale column already exists or error adding it:', error.message);
    }

    // Add color columns if they don't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS primary_color VARCHAR(7) DEFAULT '#2563eb'
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Primary color column already exists or error adding it:', error.message);
    }

    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS secondary_color VARCHAR(7) DEFAULT '#64748b'
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Secondary color column already exists or error adding it:', error.message);
    }

    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS job_tracking_enabled BOOLEAN DEFAULT true
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Job tracking enabled column already exists or error adding it:', error.message);
    }

    // Add reporting_enabled column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS reporting_enabled BOOLEAN DEFAULT true
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Reporting enabled column already exists or error adding it:', error.message);
    }

    // Add quotes_enabled column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS quotes_enabled BOOLEAN DEFAULT false
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Quotes enabled column already exists or error adding it:', error.message);
    }

    // Add discounts_enabled column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS discounts_enabled BOOLEAN DEFAULT true
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Discounts enabled column already exists or error adding it:', error.message);
    }

    // Quote columns will be added to email_history in migrations after the table is created

    // Add icon column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS icon TEXT
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Icon column already exists or error adding it:', error.message);
    }

    // Add default_payment_days column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS default_payment_days INTEGER DEFAULT 30
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Default payment days column already exists or error adding it:', error.message);
    }

    // Add invoice_start_number column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS invoice_start_number INTEGER DEFAULT 1
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Invoice start number column already exists or error adding it:', error.message);
    }

    // Add immediate_payment_clause column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS immediate_payment_clause TEXT DEFAULT 'Rechnung ist per sofort fällig, ohne Abzug'
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Immediate payment clause column already exists or error adding it:', error.message);
    }

    // Add is_small_business column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS is_small_business BOOLEAN DEFAULT false
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Is small business column already exists or error adding it:', error.message);
    }

    // Add tax_identification_number column if it doesn't exist (for existing databases)
    try {
      await client.query(`
        ALTER TABLE company ADD COLUMN IF NOT EXISTS tax_identification_number VARCHAR(50)
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Tax identification number column already exists or error adding it:', error.message);
    }

    // Add payment information columns if they don't exist (for new payment information separation)
    try {
      await client.query(`
        ALTER TABLE company 
        ADD COLUMN IF NOT EXISTS payment_account_holder VARCHAR(255),
        ADD COLUMN IF NOT EXISTS payment_bank_account VARCHAR(50),
        ADD COLUMN IF NOT EXISTS payment_bic VARCHAR(20),
        ADD COLUMN IF NOT EXISTS payment_bank_name VARCHAR(255),
        ADD COLUMN IF NOT EXISTS payment_terms TEXT,
        ADD COLUMN IF NOT EXISTS payment_methods JSONB DEFAULT '[]'
      `);
      logger.info('Payment information columns added successfully');
    } catch (error) {
      // Columns might already exist, ignore error
      logger.info('Payment information columns already exist or error adding them:', error.message);
    }

    // Add company header layout columns if they don't exist (for two-line company header)
    try {
      await client.query(`
        ALTER TABLE company 
        ADD COLUMN IF NOT EXISTS company_header_two_line BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS company_header_line1 TEXT,
        ADD COLUMN IF NOT EXISTS company_header_line2 TEXT
      `);
      logger.info('Company header layout columns added successfully');
    } catch (error) {
      // Columns might already exist, ignore error
      logger.info('Company header layout columns already exist or error adding them:', error.message);
    }

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

    // Create index for yearly_invoice_start_numbers if it doesn't exist
    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_yearly_invoice_start_numbers_year ON yearly_invoice_start_numbers(year)
      `);
    } catch (error) {
      logger.info('Index for yearly invoice start numbers already exists or error creating it:', error.message);
    }

    // Create yearly_invoice_start_numbers update trigger function if it doesn't exist
    try {
      await client.query(`
        CREATE OR REPLACE FUNCTION update_yearly_invoice_start_numbers_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_yearly_invoice_start_numbers_updated_at ON yearly_invoice_start_numbers;
        CREATE TRIGGER update_yearly_invoice_start_numbers_updated_at
            BEFORE UPDATE ON yearly_invoice_start_numbers
            FOR EACH ROW EXECUTE FUNCTION update_yearly_invoice_start_numbers_updated_at();
      `);
    } catch (error) {
      logger.info('Yearly invoice start numbers trigger already exists or error creating it:', error.message);
    }

    // Create hourly_rates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS hourly_rates (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_id INTEGER REFERENCES company(id) DEFAULT 1,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        rate DECIMAL(10,2) NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create job_time_entries table for multiple time entries per job
    await client.query(`
      CREATE TABLE IF NOT EXISTS job_time_entries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id UUID NOT NULL REFERENCES job_entries(id) ON DELETE CASCADE,
        description VARCHAR(255) NOT NULL DEFAULT '',
        start_time TIME,
        end_time TIME,
        hours_worked DECIMAL(5,2) NOT NULL DEFAULT 0,
        hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
        hourly_rate_id UUID REFERENCES hourly_rates(id),
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        discount_type VARCHAR(20),
        discount_value DECIMAL(10,2),
        discount_amount DECIMAL(10,2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add hourly_rate_id column to job_entries table if it doesn't exist
    try {
      await client.query(`
        ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS hourly_rate_id UUID REFERENCES hourly_rates(id)
      `);
    } catch (error) {
      // Column might already exist, ignore error
      logger.info('Hourly rate ID column already exists or error adding it:', error.message);
    }

    // Insert default company data if not exists
    const companyExists = await client.query('SELECT COUNT(*) FROM company WHERE id = 1');
    if (parseInt(companyExists.rows[0].count) === 0) {
      // Load default logo and icon from assets directory
      const logo = await loadImageAsBase64('./assets/Belego.png');
      const icon = await loadImageAsBase64('./assets/Belego_Icon.png');
      
      await client.query(`
        INSERT INTO company (id, name, address, city, postal_code, country, phone, email, website, tax_id, bank_account, bic, locale, invoice_start_number, logo, icon)
        VALUES (
          1,
          'Meine Firma GmbH',
          'Musterstraße 123',
          'Berlin',
          '10115',
          'Deutschland',
          '+49 30 12345678',
          'info@meinefirma.de',
          'www.meinefirma.de',
          'DE123456789',
          'DE89 3704 0044 0532 0130 00',
          'COBADEFFXXX',
          'de-DE',
          1,
          $1,
          $2
        )
      `, [logo, icon]);
      
      logger.info('Default company data created with Belego logo and icon');
    }

    // Insert default hourly rates if not exists
    const hourlyRatesExists = await client.query('SELECT COUNT(*) FROM hourly_rates');
    if (parseInt(hourlyRatesExists.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO hourly_rates (name, description, rate, is_default) VALUES
        ('Standard', 'Normale Arbeitszeit', 75.00, TRUE),
        ('Anfahrt', 'Anfahrtszeit zum Kunden', 50.00, FALSE)
      `);
    }

    // Insert default material templates if not exists
    const materialTemplatesExists = await client.query('SELECT COUNT(*) FROM material_templates');
    if (parseInt(materialTemplatesExists.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO material_templates (name, description, unit_price, unit, is_default) VALUES
        ('Kleinmaterial', 'Diverses Kleinmaterial und Verbrauchsmaterial', 15.00, 'Pauschale', TRUE),
        ('Kabel', 'Elektrisches Kabel', 2.50, 'Meter', FALSE),
        ('Schrauben', 'Befestigungsschrauben', 0.25, 'Stück', FALSE),
        ('Anfahrtskosten', 'Fahrtkosten und Sprit', 0.30, 'km', FALSE)
      `);
    }

    // Add show_combined_dropdowns column if it doesn't exist (migration)
    try {
      await client.query('ALTER TABLE company ADD COLUMN IF NOT EXISTS show_combined_dropdowns BOOLEAN DEFAULT FALSE');
    } catch (error) {
      logger.info('show_combined_dropdowns column already exists or error adding it:', error.message);
    }

    // Fix Foreign Key Constraint Issue for Combined Dropdowns (migration)
    try {
      // Drop the foreign key constraint on job_time_entries.hourly_rate_id
      // This allows both general and customer-specific hourly rate IDs to be stored
      await client.query('ALTER TABLE job_time_entries DROP CONSTRAINT IF EXISTS job_time_entries_hourly_rate_id_fkey');
      logger.info('Removed foreign key constraint on job_time_entries.hourly_rate_id to support combined dropdowns');
    } catch (error) {
      logger.info('Foreign key constraint already removed or error removing it:', error.message);
    }

    // Add tax_rate column to job_time_entries if it doesn't exist (migration)
    try {
      await client.query('ALTER TABLE job_time_entries ADD COLUMN IF NOT EXISTS tax_rate DECIMAL(5,2) NOT NULL DEFAULT 19');
      logger.info('Added tax_rate column to job_time_entries table');
    } catch (error) {
      logger.info('tax_rate column already exists or error adding it:', error.message);
    }

    // Update existing job_time_entries with correct tax_rate from hourly_rates (migration)
    try {
      // Check if customer_specific_hourly_rates table exists before trying to update
      const tableExists = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'customer_specific_hourly_rates'
        )
      `);
      
      if (tableExists.rows[0].exists) {
        // Update time entries that have hourly_rate_id with customer-specific hourly rates
        // (Only customer_specific_hourly_rates has tax_rate column)
        await client.query(`
          UPDATE job_time_entries jte
          SET tax_rate = cshr.tax_rate
          FROM customer_specific_hourly_rates cshr
          WHERE jte.hourly_rate_id = cshr.id
          AND jte.tax_rate = 19  -- Only update entries that still have the default value
          AND cshr.tax_rate IS NOT NULL
        `);
        
        logger.info('Updated existing job_time_entries with correct tax rates from hourly rate templates');
      } else {
        logger.info('customer_specific_hourly_rates table does not exist yet, skipping tax rate update');
      }
    } catch (error) {
      logger.info('Error updating existing job_time_entries tax rates:', error.message);
    }

    // Add job number columns if they don't exist (migration)
    try {
      await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS job_number VARCHAR(50) UNIQUE');
      await client.query('ALTER TABLE job_entries ADD COLUMN IF NOT EXISTS external_job_number VARCHAR(100)');
      
      // Update existing jobs without job numbers
      const jobsWithoutNumbers = await client.query('SELECT id, created_at FROM job_entries WHERE job_number IS NULL OR job_number = \'\'');
      for (const job of jobsWithoutNumbers.rows) {
        const jobYear = new Date(job.created_at).getFullYear();
        const yearPattern = `AB-${jobYear}-%`;
        const lastJobResult = await client.query('SELECT job_number FROM job_entries WHERE job_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);
        
        let jobNumber;
        if (lastJobResult.rows.length === 0) {
          jobNumber = `AB-${jobYear}-001`;
        } else {
          const lastJobNumber = lastJobResult.rows[0].job_number;
          const numberPart = lastJobNumber.substring(`AB-${jobYear}-`.length);
          const lastNumber = parseInt(numberPart);
          if (!isNaN(lastNumber)) {
            jobNumber = `AB-${jobYear}-${String(lastNumber + 1).padStart(3, '0')}`;
          } else {
            jobNumber = `AB-${jobYear}-001`;
          }
        }
        
        await client.query('UPDATE job_entries SET job_number = $1 WHERE id = $2', [jobNumber, job.id]);
      }
    } catch (error) {
      logger.info('Migration info:', error.message);
    }

    logger.info('Database tables created successfully');

    // Run migrations
    await runMigrations();

  } finally {
    client.release();
  }
}

// Run database migrations
async function runMigrations() {
  const client = await pool.connect();
  
  try {
    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    // Migration 1: Fix invoice_items quantity column to support decimal values
    const migration1Name = 'fix_invoice_items_quantity_decimal';
    const migration1Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration1Name]
    );

    if (migration1Exists.rows.length === 0) {
      logger.info('Running migration: Fix invoice_items quantity column to support decimal values');
      
      // Check if invoice_items table exists and has INTEGER quantity column
      const tableInfo = await client.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'invoice_items' AND column_name = 'quantity'
      `);
      
      if (tableInfo.rows.length > 0 && tableInfo.rows[0].data_type === 'integer') {
        // Alter the column type
        await client.query(`
          ALTER TABLE invoice_items 
          ALTER COLUMN quantity TYPE DECIMAL(10,2) USING quantity::DECIMAL(10,2)
        `);
        logger.info('Successfully updated invoice_items.quantity column to DECIMAL(10,2)');
      }
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration1Name]
      );
      logger.info('Migration completed: ' + migration1Name);
    }

    // Migration 2: Add signature support to job_entries
    const migration2Name = 'add_job_signature_support';
    const migration2Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration2Name]
    );

    if (migration2Exists.rows.length === 0) {
      logger.info('Running migration: Add signature support to job_entries');
      
      // Add signature column to job_entries table
      await client.query(`
        ALTER TABLE job_entries 
        ADD COLUMN IF NOT EXISTS signature JSONB
      `);
      
      logger.info('Successfully added signature column to job_entries');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration2Name]
      );
      logger.info('Migration completed: ' + migration2Name);
    }

    // Migration 3: Add customer additional emails support
    const migration3Name = 'add_customer_additional_emails';
    const migration3Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration3Name]
    );

    if (migration3Exists.rows.length === 0) {
      logger.info('Running migration: Add additional email addresses support for customers');
      
      // Create customer_emails table
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_emails (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          label VARCHAR(100),
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(customer_id, email)
        )
      `);
      
      // Create indexes
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_emails_customer_id ON customer_emails(customer_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_emails_email ON customer_emails(email)
      `);
      
      logger.info('Successfully created customer_emails table and indexes');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration3Name]
      );
      logger.info('Migration completed: ' + migration3Name);
    }

    // Migration 4: Add customer_address to job_entries
    const migration4Name = 'add_customer_address_to_jobs';
    const migration4Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration4Name]
    );

    if (migration4Exists.rows.length === 0) {
      logger.info('Running migration: Add customer_address to job_entries');
      
      // Add customer_address column to job_entries table
      await client.query(`
        ALTER TABLE job_entries 
        ADD COLUMN IF NOT EXISTS customer_address TEXT
      `);
      
      logger.info('Successfully added customer_address column to job_entries');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration4Name]
      );
      logger.info('Migration completed: ' + migration4Name);
    }

    // Migration 5: Make customer email field optional
    const migration5Name = 'make_customer_email_optional';
    const migration5Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration5Name]
    );

    if (migration5Exists.rows.length === 0) {
      logger.info('Running migration: Make customer email field optional');
      
      // Remove NOT NULL constraint from email column
      await client.query(`
        ALTER TABLE customers ALTER COLUMN email DROP NOT NULL
      `);
      
      logger.info('Successfully made customer email field optional');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration5Name]
      );
      logger.info('Migration completed: ' + migration5Name);
    }

    // Migration 6: Add email history and SMTP settings tables
    const migration6Name = 'add_email_management_tables';
    const migration6Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration6Name]
    );

    if (migration6Exists.rows.length === 0) {
      logger.info('Running migration: Add email history and SMTP settings tables');
      
      // Create email_history table
      await client.query(`
        CREATE TABLE IF NOT EXISTS email_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          sender_email VARCHAR(255) NOT NULL,
          sender_name VARCHAR(255),
          recipient_email VARCHAR(255) NOT NULL,
          subject VARCHAR(500) NOT NULL,
          body_html TEXT,
          body_plain TEXT,
          attachments JSONB DEFAULT '[]',
          message_id VARCHAR(255),
          smtp_response JSONB,
          invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
          invoice_number VARCHAR(50),
          customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
          customer_name VARCHAR(255),
          email_type VARCHAR(50) DEFAULT 'invoice',
          status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
          error_message TEXT,
          sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_email_history_recipient ON email_history(recipient_email)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_email_history_sent_at ON email_history(sent_at DESC)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_email_history_invoice_id ON email_history(invoice_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_email_history_customer_id ON email_history(customer_id)
      `);
      
      // Create smtp_settings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS smtp_settings (
          id INTEGER PRIMARY KEY DEFAULT 1,
          smtp_host VARCHAR(255),
          smtp_port INTEGER DEFAULT 587,
          smtp_secure BOOLEAN DEFAULT FALSE,
          smtp_user VARCHAR(255),
          smtp_pass VARCHAR(255),
          email_from VARCHAR(255),
          email_from_name VARCHAR(255),
          is_enabled BOOLEAN DEFAULT FALSE,
          test_email VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          CONSTRAINT single_smtp_config CHECK (id = 1)
        )
      `);
      
      logger.info('Successfully created email_history and smtp_settings tables');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration6Name]
      );
      logger.info('Migration completed: ' + migration6Name);
    }

    // Migration 7: Add customer-specific hourly rates support
    const migration7Name = 'add_customer_hourly_rates';
    const migration7Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration7Name]
    );

    if (migration7Exists.rows.length === 0) {
      logger.info('Running migration: Add customer-specific hourly rates support');
      
      // Create customer_hourly_rates table
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_hourly_rates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          hourly_rate_id UUID NOT NULL REFERENCES hourly_rates(id) ON DELETE CASCADE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(customer_id, hourly_rate_id)
        )
      `);
      
      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_hourly_rates_customer_id ON customer_hourly_rates(customer_id)
      `);
      
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_hourly_rates_hourly_rate_id ON customer_hourly_rates(hourly_rate_id)
      `);
      
      logger.info('Successfully created customer_hourly_rates table and indexes');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration7Name]
      );
      logger.info('Migration completed: ' + migration7Name);
    }

    // Migration 8: Create customer-specific hourly rates table
    const migration8Name = 'add_customer_specific_hourly_rates';
    const migration8Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration8Name]
    );

    if (migration8Exists.rows.length === 0) {
      logger.info('Running migration: Create customer-specific hourly rates table');
      
      // Create customer_specific_hourly_rates table
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_specific_hourly_rates (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          rate DECIMAL(10,2) NOT NULL,
          tax_rate DECIMAL(5,2) DEFAULT 19,
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_specific_hourly_rates_customer_id ON customer_specific_hourly_rates(customer_id)
      `);
      
      // Create trigger for updated_at
      await client.query(`
        CREATE OR REPLACE FUNCTION update_customer_specific_hourly_rates_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_customer_specific_hourly_rates_updated_at ON customer_specific_hourly_rates;
        CREATE TRIGGER update_customer_specific_hourly_rates_updated_at
            BEFORE UPDATE ON customer_specific_hourly_rates
            FOR EACH ROW EXECUTE FUNCTION update_customer_specific_hourly_rates_updated_at();
      `);
      
      logger.info('Successfully created customer_specific_hourly_rates table');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration8Name]
      );
      logger.info('Migration completed: ' + migration8Name);
    }

    // Migration 9: Create customer-specific materials table
    const migration9Name = 'add_customer_specific_materials';
    const migration9Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration9Name]
    );

    if (migration9Exists.rows.length === 0) {
      logger.info('Running migration: Create customer-specific materials table');
      
      // Create customer_specific_materials table
      await client.query(`
        CREATE TABLE IF NOT EXISTS customer_specific_materials (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          unit_price DECIMAL(10,2) NOT NULL,
          unit VARCHAR(50) DEFAULT 'Stück',
          tax_rate DECIMAL(5,2) DEFAULT 19,
          is_default BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);
      
      // Create indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_specific_materials_customer_id ON customer_specific_materials(customer_id)
      `);
      
      // Create trigger for updated_at
      await client.query(`
        CREATE OR REPLACE FUNCTION update_customer_specific_materials_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = CURRENT_TIMESTAMP;
            RETURN NEW;
        END;
        $$ language 'plpgsql';
      `);

      await client.query(`
        DROP TRIGGER IF EXISTS update_customer_specific_materials_updated_at ON customer_specific_materials;
        CREATE TRIGGER update_customer_specific_materials_updated_at
            BEFORE UPDATE ON customer_specific_materials
            FOR EACH ROW EXECUTE FUNCTION update_customer_specific_materials_updated_at();
      `);
      
      logger.info('Successfully created customer_specific_materials table');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration9Name]
      );
      logger.info('Migration completed: ' + migration9Name);
    }

    // Migration 10: Add order column to invoice_items table
    const migration10Name = 'add_invoice_items_order_column';
    const migration10Exists = await client.query(
      'SELECT 1 FROM migrations WHERE name = $1',
      [migration10Name]
    );

    if (migration10Exists.rows.length === 0) {
      logger.info('Running migration: Add order column to invoice_items table');
      
      // Add order column to invoice_items table
      await client.query(`
        ALTER TABLE invoice_items 
        ADD COLUMN IF NOT EXISTS item_order INTEGER DEFAULT 0
      `);
      
      // Update existing items with sequential order based on creation order
      await client.query(`
        WITH ordered_items AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY id) as row_num
          FROM invoice_items
        )
        UPDATE invoice_items 
        SET item_order = ordered_items.row_num
        FROM ordered_items
        WHERE invoice_items.id = ordered_items.id
      `);
      
      logger.info('Successfully added order column to invoice_items table');
      
      // Record the migration
      await client.query(
        'INSERT INTO migrations (name) VALUES ($1)',
        [migration10Name]
      );
      logger.info('Migration completed: ' + migration10Name);
    }

    // Migration 11: Add discount fields to invoices and invoice_items
    const migration11Name = 'add_discount_fields_to_invoices_and_items';
    const migration11Exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration11Name]);
    
    if (migration11Exists.rows.length === 0) {
      logger.info('Running migration: ' + migration11Name);
      
      // Add discount fields to invoices table
      await client.query(`
        ALTER TABLE invoices 
        ADD COLUMN IF NOT EXISTS global_discount_type VARCHAR(20),
        ADD COLUMN IF NOT EXISTS global_discount_value DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS global_discount_amount DECIMAL(10,2)
      `);
      
      // Add discount fields to invoice_items table
      await client.query(`
        ALTER TABLE invoice_items 
        ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20),
        ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2)
      `);
      
      // Add discount fields to job_time_entries table
      await client.query(`
        ALTER TABLE job_time_entries 
        ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20),
        ADD COLUMN IF NOT EXISTS discount_value DECIMAL(10,2),
        ADD COLUMN IF NOT EXISTS discount_amount DECIMAL(10,2)
      `);
      
      logger.info('Successfully added discount fields to invoices, invoice_items, and job_time_entries tables');
      
      // Record the migration
      await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())', [migration11Name]);
      logger.info('Migration completed: ' + migration11Name);
    }

    // Migration 12: Add 'billed' status to quotes
    const migration12Name = 'add_billed_status_to_quotes';
    const migration12Exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration12Name]);
    
    if (migration12Exists.rows.length === 0) {
      logger.info('Running migration: ' + migration12Name);
      
      // Update the CHECK constraint to include 'billed' status
      await client.query(`
        ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_status_check
      `);
      
      await client.query(`
        ALTER TABLE quotes ADD CONSTRAINT quotes_status_check 
        CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'billed'))
      `);
      
      logger.info('Successfully added billed status to quotes table');
      
      // Record the migration
      await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())', [migration12Name]);
      logger.info('Migration completed: ' + migration12Name);
    }

    // Migration 13: Add payment reminder system
    const migration13Name = 'add_payment_reminder_system';
    const migration13Exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration13Name]);
    
    if (migration13Exists.rows.length === 0) {
      logger.info('Running migration: ' + migration13Name);
      
      // Update invoices table: Add reminder tracking fields
      await client.query(`
        ALTER TABLE invoices 
        ADD COLUMN IF NOT EXISTS last_reminder_date DATE,
        ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMP WITH TIME ZONE
      `);
      
      // Update invoices status CHECK constraint to include reminder statuses
      await client.query(`
        ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check
      `);
      
      await client.query(`
        ALTER TABLE invoices ADD CONSTRAINT invoices_status_check 
        CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'))
      `);
      
      logger.info('Successfully added reminder fields to invoices table');
      
      // Add reminder settings to company table
      await client.query(`
        ALTER TABLE company 
        ADD COLUMN IF NOT EXISTS reminders_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS reminder_days_after_due INTEGER DEFAULT 7,
        ADD COLUMN IF NOT EXISTS reminder_days_between INTEGER DEFAULT 7,
        ADD COLUMN IF NOT EXISTS reminder_fee_stage_1 DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reminder_fee_stage_2 DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reminder_fee_stage_3 DECIMAL(10,2) DEFAULT 0,
        ADD COLUMN IF NOT EXISTS reminder_text_stage_1 TEXT,
        ADD COLUMN IF NOT EXISTS reminder_text_stage_2 TEXT,
        ADD COLUMN IF NOT EXISTS reminder_text_stage_3 TEXT
      `);
      
      // Set default German reminder texts
      await client.query(`
        UPDATE company 
        SET 
          reminder_text_stage_1 = 'Sehr geehrte Damen und Herren,

bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die folgende Rechnung noch nicht beglichen wurde. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Wir bitten Sie höflich, den ausstehenden Betrag innerhalb der nächsten 7 Tage zu begleichen.',
          
          reminder_text_stage_2 = 'Sehr geehrte Damen und Herren,

leider haben wir trotz unserer ersten Zahlungserinnerung noch keinen Zahlungseingang feststellen können. Wir möchten Sie nochmals dringend bitten, den ausstehenden Betrag umgehend zu begleichen.

Sollte die Zahlung nicht innerhalb von 5 Tagen bei uns eingehen, sehen wir uns gezwungen, weitere Schritte einzuleiten.',
          
          reminder_text_stage_3 = 'Sehr geehrte Damen und Herren,

trotz mehrfacher Zahlungserinnerungen ist der ausstehende Betrag noch immer nicht beglichen worden. Dies ist unsere letzte Mahnung vor rechtlichen Schritten.

Wir fordern Sie hiermit letztmalig auf, den Betrag unverzüglich, spätestens jedoch innerhalb von 3 Tagen, zu begleichen. Andernfalls werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.'
        WHERE id = 1
      `);
      
      logger.info('Successfully added reminder settings to company table with default texts');
      
      // Add reminder_stage to email_history table
      await client.query(`
        ALTER TABLE email_history 
        ADD COLUMN IF NOT EXISTS reminder_stage INTEGER
      `);
      
      logger.info('Successfully added reminder_stage to email_history table');
      
      // Record the migration
      await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())', [migration13Name]);
      logger.info('Migration completed: ' + migration13Name);
    }

    // Migration 14: Add max_reminder_stage to track highest reminder stage reached
    const migration14Name = 'add_max_reminder_stage';
    const migration14Exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration14Name]);
    
    if (migration14Exists.rows.length === 0) {
      logger.info('Running migration: ' + migration14Name);
      
      // Add max_reminder_stage column to invoices table
      await client.query(`
        ALTER TABLE invoices 
        ADD COLUMN IF NOT EXISTS max_reminder_stage INTEGER DEFAULT 0
      `);
      
      // Update existing invoices to set max_reminder_stage based on current status
      await client.query(`
        UPDATE invoices 
        SET max_reminder_stage = CASE 
          WHEN status = 'reminded_1x' THEN 1
          WHEN status = 'reminded_2x' THEN 2
          WHEN status = 'reminded_3x' THEN 3
          ELSE 0
        END
        WHERE last_reminder_date IS NOT NULL
      `);
      
      logger.info('Successfully added max_reminder_stage to invoices table');
      
      // Record the migration
      await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())', [migration14Name]);
      logger.info('Migration completed: ' + migration14Name);
    }

    // Migration 15: Add quote columns to email_history table
    const migration15Name = 'add_quote_columns_to_email_history';
    const migration15Exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration15Name]);
    
    if (migration15Exists.rows.length === 0) {
      logger.info('Running migration: ' + migration15Name);
      
      // Add quote columns to email_history table (after it has been created in migration 6)
      await client.query(`
        ALTER TABLE email_history 
        ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS quote_number VARCHAR(50)
      `);
      
      logger.info('Successfully added quote columns to email_history table');
      
      // Record the migration
      await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())', [migration15Name]);
      logger.info('Migration completed: ' + migration15Name);
    }

    // Migration 16: Add address_supplement column to customers table
    const migration16Name = 'add_address_supplement_to_customers';
    const migration16Exists = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration16Name]);
    
    if (migration16Exists.rows.length === 0) {
      logger.info('Running migration: ' + migration16Name);
      
      // Add address_supplement column to customers table
      await client.query(`
        ALTER TABLE customers 
        ADD COLUMN IF NOT EXISTS address_supplement TEXT
      `);
      
      logger.info('Successfully added address_supplement column to customers table');
      
      // Record the migration
      await client.query('INSERT INTO migrations (name, executed_at) VALUES ($1, NOW())', [migration16Name]);
      logger.info('Migration completed: ' + migration16Name);
    }

  } catch (error) {
    logger.error('Error running migrations', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    client.release();
  }
}

// Helper function to execute queries
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}
