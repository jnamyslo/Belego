/**
 * Migration: Customer Additional Emails
 * Adds support for multiple email addresses per customer
 */

export const name = '002_customer_emails';

export async function up(client) {
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
}

export async function down(client) {
  await client.query('DROP INDEX IF EXISTS idx_customer_emails_email');
  await client.query('DROP INDEX IF EXISTS idx_customer_emails_customer_id');
  await client.query('DROP TABLE IF EXISTS customer_emails');
}

