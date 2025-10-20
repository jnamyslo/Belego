import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createTables, pool } from './database.js';
import logger from './utils/logger.js';
import customersRouter from './routes/customers.js';
import invoicesRouter from './routes/invoices.js';
import quotesRouter from './routes/quotes.js';
import companyRouter from './routes/company.js';
import emailRouter from './routes/email.js';
import emailManagementRouter from './routes/emailManagement.js';
import jobsRouter from './routes/jobs.js';
import materialTemplatesRouter from './routes/materialTemplates.js';
import hourlyRatesRouter from './routes/hourlyRates.js';
import yearlyInvoiceStartNumbersRouter from './routes/yearlyInvoiceStartNumbers.js';
import backupRouter from './routes/backup.js';
import reportingRouter from './routes/reporting.js';
import remindersRouter from './routes/reminders.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' })); // Increase limit for PDF attachments
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

// API routes
app.use('/api/customers', customersRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/quotes', quotesRouter);
app.use('/api/company', companyRouter);
app.use('/api/email', emailRouter);
app.use('/api/email-management', emailManagementRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/material-templates', materialTemplatesRouter);
app.use('/api/hourly-rates', hourlyRatesRouter);
app.use('/api/yearly-invoice-start-numbers', yearlyInvoiceStartNumbersRouter);
app.use('/api/backup', backupRouter);
app.use('/api/reporting', reportingRouter);
app.use('/api/reminders', remindersRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled server error', { error: err.message, stack: err.stack, url: req.url, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
async function startServer() {
  try {
    logger.info('Connecting to database...');
    await createTables();
    logger.info('Database initialized successfully');
    
    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server started`, { port: PORT, environment: process.env.NODE_ENV || 'development' });
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');
  await pool.end();
  process.exit(0);
});

startServer();
