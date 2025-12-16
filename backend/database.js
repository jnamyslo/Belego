import pkg from 'pg';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { runMigrations, getMigrationStatus } from './migrations/index.js';

dotenv.config();

const { Pool } = pkg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Load and convert image to base64
 * @param {string} imagePath - Path to the image file
 * @returns {Promise<string|null>} Base64 encoded image or null
 */
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

/**
 * Wait for database to be ready with retries
 * @param {import('pg').PoolClient} client - Database client
 * @param {number} maxRetries - Maximum number of retries
 */
async function waitForDatabase(client, maxRetries = 10) {
  let retries = maxRetries;
  while (retries > 0) {
    try {
      await client.query('SELECT 1');
      return;
    } catch (error) {
      logger.debug(`Database not ready, retrying...`, { retriesLeft: retries });
      retries--;
      if (retries === 0) throw error;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// ============================================================================
// Database Pool Configuration
// ============================================================================

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

// ============================================================================
// Database Initialization
// ============================================================================

/**
 * Initialize database tables and run migrations
 */
export async function createTables() {
  const client = await pool.connect();

  try {
    // Wait for database to be ready
    await waitForDatabase(client);

    // Run all pending migrations
    await runMigrations(client);

    // Log migration status
    const status = await getMigrationStatus(client);
    logger.info('Migration status', {
      executed: status.executed.length,
      pending: status.pending.length,
    });

    // Insert default data if needed
    await insertDefaultData(client);

    logger.info('Database initialized successfully');
  } finally {
    client.release();
  }
}

/**
 * Insert default data for new installations
 * @param {import('pg').PoolClient} client - Database client
 */
async function insertDefaultData(client) {
  // Check if company exists
  const companyExists = await client.query('SELECT COUNT(*) FROM company WHERE id = 1');
  if (parseInt(companyExists.rows[0].count) === 0) {
    // Load default logo and icon from assets directory
    const logo = await loadImageAsBase64('./assets/Belego.png');
    const icon = await loadImageAsBase64('./assets/Belego_Icon.png');

    await client.query(`
      INSERT INTO company (
        id, name, address, city, postal_code, country, phone, email, 
        website, tax_id, bank_account, bic, locale, invoice_start_number, 
        logo, icon, reminder_text_stage_1, reminder_text_stage_2, reminder_text_stage_3
      ) VALUES (
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
        $2,
        $3,
        $4,
        $5
      )
    `, [
      logo,
      icon,
      `Sehr geehrte Damen und Herren,

bei der Durchsicht unserer Unterlagen ist uns aufgefallen, dass die folgende Rechnung noch nicht beglichen wurde. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.

Wir bitten Sie höflich, den ausstehenden Betrag innerhalb der nächsten 7 Tage zu begleichen.`,
      `Sehr geehrte Damen und Herren,

leider haben wir trotz unserer ersten Zahlungserinnerung noch keinen Zahlungseingang feststellen können. Wir möchten Sie nochmals dringend bitten, den ausstehenden Betrag umgehend zu begleichen.

Sollte die Zahlung nicht innerhalb von 5 Tagen bei uns eingehen, sehen wir uns gezwungen, weitere Schritte einzuleiten.`,
      `Sehr geehrte Damen und Herren,

trotz mehrfacher Zahlungserinnerungen ist der ausstehende Betrag noch immer nicht beglichen worden. Dies ist unsere letzte Mahnung vor rechtlichen Schritten.

Wir fordern Sie hiermit letztmalig auf, den Betrag unverzüglich, spätestens jedoch innerhalb von 3 Tagen, zu begleichen. Andernfalls werden wir ohne weitere Ankündigung rechtliche Schritte einleiten.`
    ]);

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
    logger.info('Default hourly rates created');
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
    logger.info('Default material templates created');
  }
}

// ============================================================================
// Query Helper
// ============================================================================

/**
 * Execute a database query
 * @param {string} text - SQL query text
 * @param {any[]} params - Query parameters
 * @returns {Promise<import('pg').QueryResult>}
 */
export async function query(text, params) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export default {
  pool,
  createTables,
  query,
};
