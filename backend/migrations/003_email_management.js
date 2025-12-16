/**
 * Migration: Email Management
 * Adds email history and SMTP settings tables
 */

export const name = '003_email_management';

export async function up(client) {
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
      quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL,
      quote_number VARCHAR(50),
      customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
      customer_name VARCHAR(255),
      email_type VARCHAR(50) DEFAULT 'invoice',
      status VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
      error_message TEXT,
      reminder_stage INTEGER,
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
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS idx_email_history_customer_id');
  await client.query('DROP INDEX IF EXISTS idx_email_history_invoice_id');
  await client.query('DROP INDEX IF EXISTS idx_email_history_sent_at');
  await client.query('DROP INDEX IF EXISTS idx_email_history_recipient');
  await client.query('DROP TABLE IF EXISTS smtp_settings');
  await client.query('DROP TABLE IF EXISTS email_history');
}

