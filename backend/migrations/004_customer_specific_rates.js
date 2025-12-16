/**
 * Migration: Customer-Specific Hourly Rates and Materials
 * Adds support for customer-specific pricing
 */

export const name = '004_customer_specific_rates';

export async function up(client) {
  // Create customer_hourly_rates junction table
  await client.query(`
    CREATE TABLE IF NOT EXISTS customer_hourly_rates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      hourly_rate_id UUID NOT NULL REFERENCES hourly_rates(id) ON DELETE CASCADE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE(customer_id, hourly_rate_id)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_hourly_rates_customer_id ON customer_hourly_rates(customer_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_hourly_rates_hourly_rate_id ON customer_hourly_rates(hourly_rate_id)
  `);

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

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_specific_hourly_rates_customer_id ON customer_specific_hourly_rates(customer_id)
  `);

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

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_customer_specific_materials_customer_id ON customer_specific_materials(customer_id)
  `);

  // Create triggers for updated_at
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
}

export async function down(client) {
  await client.query('DROP TRIGGER IF EXISTS update_customer_specific_materials_updated_at ON customer_specific_materials');
  await client.query('DROP FUNCTION IF EXISTS update_customer_specific_materials_updated_at()');
  await client.query('DROP TRIGGER IF EXISTS update_customer_specific_hourly_rates_updated_at ON customer_specific_hourly_rates');
  await client.query('DROP FUNCTION IF EXISTS update_customer_specific_hourly_rates_updated_at()');
  await client.query('DROP INDEX IF EXISTS idx_customer_specific_materials_customer_id');
  await client.query('DROP TABLE IF EXISTS customer_specific_materials');
  await client.query('DROP INDEX IF EXISTS idx_customer_specific_hourly_rates_customer_id');
  await client.query('DROP TABLE IF EXISTS customer_specific_hourly_rates');
  await client.query('DROP INDEX IF EXISTS idx_customer_hourly_rates_hourly_rate_id');
  await client.query('DROP INDEX IF EXISTS idx_customer_hourly_rates_customer_id');
  await client.query('DROP TABLE IF EXISTS customer_hourly_rates');
}

