import express from 'express';
import { pool } from '../database.js';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

const router = express.Router();

// Helper function to safely parse materials
const parseMaterials = (materialsData) => {
  if (!materialsData || materialsData === 'null' || materialsData === null || materialsData === '') {
    return [];
  }
  
  // If it's already an array, return it
  if (Array.isArray(materialsData)) {
    return materialsData;
  }
  
  // If it's a string, try to parse it
  if (typeof materialsData === 'string') {
    try {
      return JSON.parse(materialsData);
    } catch (error) {
      logger.warn('Failed to parse materials string', { 
        error: error.message, 
        materialsData: typeof materialsData === 'string' ? materialsData.substring(0, 100) : materialsData 
      });
      return [];
    }
  }
  
  // For any other type, return empty array
  return [];
};

// Helper function to format job data
const formatJobData = (row, customerName = null) => ({
  id: row.id,
  jobNumber: row.job_number,
  externalJobNumber: row.external_job_number,
  customerId: row.customer_id,
  customerName: customerName || row.customer_name,
  customerAddress: row.customer_address,
  title: row.title,
  description: row.description,
  date: row.date,
  startTime: row.start_time,
  endTime: row.end_time,
  hoursWorked: parseFloat(row.hours_worked) || 0,
  hourlyRate: parseFloat(row.hourly_rate) || 0,
  hourlyRateId: row.hourly_rate_id,
  timeEntries: row.time_entries || [],
  materials: parseMaterials(row.materials),
  status: row.status,
  notes: row.notes,
  priority: row.priority,
  attachments: row.attachments || [],
  signature: row.signature || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

// Get all job entries
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT j.*, c.name as customer_name,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             COALESCE(
               json_agg(
                 DISTINCT jsonb_build_object(
                   'id', jte.id,
                   'description', jte.description,
                   'startTime', jte.start_time,
                   'endTime', jte.end_time,
                   'hoursWorked', jte.hours_worked,
                   'hourlyRate', jte.hourly_rate,
                   'hourlyRateId', jte.hourly_rate_id,
                   'taxRate', jte.tax_rate,
                   'total', jte.total
                 )
               ) FILTER (WHERE jte.id IS NOT NULL), '[]'::json
             ) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      GROUP BY j.id, c.name
      ORDER BY j.date DESC, j.created_at DESC
    `);
    
    const jobs = result.rows.map(row => formatJobData(row));
    res.json(jobs);
  } catch (error) {
    logger.error('Failed to fetch jobs', {
      error: error.message,
      stack: error.stack,
      method: 'GET',
      endpoint: '/jobs'
    });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// Get a specific job entry
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT j.*, c.name as customer_name,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             COALESCE(
               json_agg(
                 DISTINCT jsonb_build_object(
                   'id', jte.id,
                   'description', jte.description,
                   'startTime', jte.start_time,
                   'endTime', jte.end_time,
                   'hoursWorked', jte.hours_worked,
                   'hourlyRate', jte.hourly_rate,
                   'hourlyRateId', jte.hourly_rate_id,
                   'taxRate', jte.tax_rate,
                   'total', jte.total
                 )
               ) FILTER (WHERE jte.id IS NOT NULL), '[]'::json
             ) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const job = formatJobData(result.rows[0]);
    res.json(job);
  } catch (error) {
    logger.error('Error fetching job:', error);
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// Create a new job entry
router.post('/', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const {
      customerId,
      customerAddress,
      title,
      description,
      date,
      startTime,
      endTime,
      hoursWorked,
      hourlyRate,
      hourlyRateId,
      timeEntries,
      materials,
      status,
      notes,
      priority,
      attachments,
      externalJobNumber
    } = req.body;

    // Validate required fields
    if (!customerId || !title || !description) {
      return res.status(400).json({ 
        error: 'Missing required fields', 
        details: {
          customerId: !customerId ? 'Customer ID is required' : null,
          title: !title ? 'Title is required' : null,
          description: !description ? 'Description is required' : null
        }
      });
    }

    // Get customer name
    const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
    if (customerResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Customer not found', customerId });
    }
    const customerName = customerResult.rows[0].name;

    // Validate date format
    const jobDate = new Date(date);
    if (isNaN(jobDate.getTime())) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid date format' });
    }
    const formattedDate = jobDate.toISOString().split('T')[0]; // YYYY-MM-DD format
    
    // Generate job number - format: AB-YYYY-XXX
    const currentYear = new Date().getFullYear();
    const yearPattern = `AB-${currentYear}-%`;
    const lastJobResult = await client.query('SELECT job_number FROM job_entries WHERE job_number LIKE $1 ORDER BY created_at DESC LIMIT 1', [yearPattern]);
    
    let jobNumber;
    if (lastJobResult.rows.length === 0) {
      jobNumber = `AB-${currentYear}-001`;
    } else {
      const lastJobNumber = lastJobResult.rows[0].job_number;
      if (lastJobNumber && lastJobNumber.startsWith(`AB-${currentYear}-`)) {
        const numberPart = lastJobNumber.substring(`AB-${currentYear}-`.length);
        const lastNumber = parseInt(numberPart);
        if (!isNaN(lastNumber)) {
          jobNumber = `AB-${currentYear}-${String(lastNumber + 1).padStart(3, '0')}`;
        } else {
          jobNumber = `AB-${currentYear}-001`;
        }
      } else {
        jobNumber = `AB-${currentYear}-001`;
      }
    }
    
    // Create job entry with generated job number
    const result = await client.query(`
      INSERT INTO job_entries (
        job_number, external_job_number, customer_id, customer_address, title, description, date,
        hours_worked, hourly_rate, hourly_rate_id, materials, status, notes, priority
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      jobNumber, externalJobNumber || null, customerId, customerAddress || null, title, description, formattedDate,
      hoursWorked || 0, hourlyRate || 0, hourlyRateId || null, JSON.stringify(materials || []), status || 'draft', notes, priority
    ]);

    const jobId = result.rows[0].id;

    // Save time entries if provided
    if (timeEntries && Array.isArray(timeEntries) && timeEntries.length > 0) {
      for (const timeEntry of timeEntries) {
        await client.query(`
          INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          jobId,
          timeEntry.description || '',
          timeEntry.startTime || null,
          timeEntry.endTime || null,
          timeEntry.hoursWorked || 0,
          timeEntry.hourlyRate || 0,
          timeEntry.hourlyRateId || null,
          timeEntry.taxRate != null ? timeEntry.taxRate : 19,
          timeEntry.total || 0
        ]);
      }
    } else if (hoursWorked > 0 || startTime || endTime) {
      // Backward compatibility: create a single time entry from legacy fields
      await client.query(`
        INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        jobId,
        'Arbeitszeit',
        startTime || null,
        endTime || null,
        hoursWorked || 0,
        hourlyRate || 0,
        hourlyRateId || null,
        19, // Default tax rate for legacy entries
        (hoursWorked || 0) * (hourlyRate || 0)
      ]);
    }

    // Save attachments if provided
    if (attachments && Array.isArray(attachments)) {
      for (const attachment of attachments) {
        await client.query(`
          INSERT INTO job_attachments (job_id, name, content, content_type, size)
          VALUES ($1, $2, $3, $4, $5)
        `, [jobId, attachment.name, attachment.content, attachment.contentType, attachment.size]);
      }
    }

    await client.query('COMMIT');

    // Fetch the complete job with attachments and time entries
    const completeJob = await client.query(`
      SELECT j.*, c.name as customer_name,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             COALESCE(
               json_agg(
                 DISTINCT jsonb_build_object(
                   'id', jte.id,
                   'description', jte.description,
                   'startTime', jte.start_time,
                   'endTime', jte.end_time,
                   'hoursWorked', jte.hours_worked,
                   'hourlyRate', jte.hourly_rate,
                   'hourlyRateId', jte.hourly_rate_id,
                   'taxRate', jte.tax_rate,
                   'total', jte.total
                 )
               ) FILTER (WHERE jte.id IS NOT NULL), '[]'::json
             ) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name
    `, [jobId]);

    const job = formatJobData(completeJob.rows[0]);
    res.status(201).json(job);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error creating job:', error);
    res.status(500).json({ 
      error: 'Failed to create job', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    client.release();
  }
});

// Update a job entry
router.put('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Check if job exists and get current status
    const currentJobResult = await client.query('SELECT status FROM job_entries WHERE id = $1', [id]);
    if (currentJobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const currentJob = currentJobResult.rows[0];
    
    // Prevent editing if job is already invoiced
    if (currentJob.status === 'invoiced') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Cannot edit invoiced job', 
        message: 'Jobs that have been invoiced cannot be modified to maintain invoice integrity.' 
      });
    }
    
    const {
      customerId,
      customerAddress,
      title,
      description,
      date,
      startTime,
      endTime,
      hoursWorked,
      hourlyRate,
      hourlyRateId,
      materials,
      status,
      notes,
      priority,
      attachments,
      timeEntries,
      externalJobNumber
    } = req.body;

    // Get customer name if customerId is provided
    let customerName = null;
    if (customerId) {
      const customerResult = await client.query('SELECT name FROM customers WHERE id = $1', [customerId]);
      if (customerResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Customer not found' });
      }
      customerName = customerResult.rows[0].name;
    }

    // Prepare the update query - only update fields that are provided
    const updates = [];
    const values = [];
    let paramIndex = 1;

    if (customerId !== undefined) {
      updates.push(`customer_id = $${paramIndex++}`);
      values.push(customerId);
    }
    if (customerAddress !== undefined) {
      updates.push(`customer_address = $${paramIndex++}`);
      values.push(customerAddress);
    }
    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(description);
    }
    if (date !== undefined) {
      updates.push(`date = $${paramIndex++}`);
      values.push(date);
    }
    if (startTime !== undefined && startTime !== '' && startTime !== null) {
      updates.push(`start_time = $${paramIndex++}`);
      values.push(startTime);
    }
    if (endTime !== undefined && endTime !== '' && endTime !== null) {
      updates.push(`end_time = $${paramIndex++}`);
      values.push(endTime);
    }
    if (hoursWorked !== undefined) {
      updates.push(`hours_worked = $${paramIndex++}`);
      values.push(hoursWorked);
    }
    if (hourlyRate !== undefined) {
      updates.push(`hourly_rate = $${paramIndex++}`);
      values.push(hourlyRate);
    }
    if (hourlyRateId !== undefined) {
      updates.push(`hourly_rate_id = $${paramIndex++}`);
      values.push(hourlyRateId);
    }
    if (materials !== undefined) {
      updates.push(`materials = $${paramIndex++}`);
      values.push(JSON.stringify(materials || []));
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(status);
    }
    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex++}`);
      values.push(notes);
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      values.push(priority);
    }
    if (externalJobNumber !== undefined) {
      updates.push(`external_job_number = $${paramIndex++}`);
      values.push(externalJobNumber);
    }
    if (req.body.signature !== undefined) {
      updates.push(`signature = $${paramIndex++}`);
      values.push(req.body.signature ? JSON.stringify(req.body.signature) : null);
    }

    // Always update the updated_at timestamp
    updates.push(`updated_at = NOW()`);
    
    // Add the ID for the WHERE clause
    values.push(id);
    const whereParamIndex = paramIndex; // Use the next parameter index for WHERE clause

    const updateQuery = `
      UPDATE job_entries SET
        ${updates.join(', ')}
      WHERE id = $${whereParamIndex}
      RETURNING *
    `;

    const result = await client.query(updateQuery, values);

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }

    // Handle time entries update if provided
    if (timeEntries !== undefined) {
      // Delete existing time entries
      await client.query('DELETE FROM job_time_entries WHERE job_id = $1', [id]);
      
      // Insert new time entries
      if (Array.isArray(timeEntries) && timeEntries.length > 0) {
        for (const timeEntry of timeEntries) {
          await client.query(`
            INSERT INTO job_time_entries (job_id, description, start_time, end_time, hours_worked, hourly_rate, hourly_rate_id, tax_rate, total)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `, [
            id,
            timeEntry.description || '',
            timeEntry.startTime || null,
            timeEntry.endTime || null,
            timeEntry.hoursWorked || 0,
            timeEntry.hourlyRate || 0,
            timeEntry.hourlyRateId || null,
            timeEntry.taxRate != null ? timeEntry.taxRate : 19,
            timeEntry.total || 0
          ]);
        }
      }
    }

    // Handle attachments update if provided
    if (attachments !== undefined) {
      // Delete existing attachments
      await client.query('DELETE FROM job_attachments WHERE job_id = $1', [id]);
      
      // Insert new attachments
      if (Array.isArray(attachments)) {
        for (const attachment of attachments) {
          await client.query(`
            INSERT INTO job_attachments (job_id, name, content, content_type, size)
            VALUES ($1, $2, $3, $4, $5)
          `, [id, attachment.name, attachment.content, attachment.contentType, attachment.size]);
        }
      }
    }

    await client.query('COMMIT');

    // Fetch the complete job with attachments and time entries
    const completeJob = await client.query(`
      SELECT j.*, c.name as customer_name,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', jte.id,
                 'description', jte.description,
                 'startTime', jte.start_time,
                 'endTime', jte.end_time,
                 'hoursWorked', jte.hours_worked,
                 'hourlyRate', jte.hourly_rate,
                 'hourlyRateId', jte.hourly_rate_id,
                 'total', jte.total
               )
             ) FILTER (WHERE jte.id IS NOT NULL) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name
    `, [id]);

    const job = formatJobData(completeJob.rows[0]);
    res.json(job);
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error updating job:', error);
    res.status(500).json({ error: 'Failed to update job' });
  } finally {
    client.release();
  }
});

// Delete a job entry
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    
    // Check if job exists and get current status
    const currentJobResult = await client.query('SELECT status FROM job_entries WHERE id = $1', [id]);
    if (currentJobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const currentJob = currentJobResult.rows[0];
    
    // Prevent deleting if job is already invoiced
    if (currentJob.status === 'invoiced') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Cannot delete invoiced job', 
        message: 'Jobs that have been invoiced cannot be deleted to maintain invoice integrity.' 
      });
    }
    
    // Delete attachments first (due to foreign key constraint)
    await client.query('DELETE FROM job_attachments WHERE job_id = $1', [id]);
    
    // Delete the job
    const result = await client.query('DELETE FROM job_entries WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Job not found' });
    }
    
    await client.query('COMMIT');
    res.json({ message: 'Job deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error deleting job:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  } finally {
    client.release();
  }
});

// Delete multiple job entries
router.delete('/', async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'Invalid job IDs' });
    }

    // Check if any jobs are invoiced
    const placeholders = ids.map((_, index) => `$${index + 1}`).join(',');
    const invoicedJobsResult = await pool.query(
      `SELECT id FROM job_entries WHERE id IN (${placeholders}) AND status = 'invoiced'`,
      ids
    );
    
    if (invoicedJobsResult.rows.length > 0) {
      const invoicedJobIds = invoicedJobsResult.rows.map(row => row.id);
      return res.status(403).json({ 
        error: 'Cannot delete invoiced jobs', 
        message: 'Some jobs have been invoiced and cannot be deleted to maintain invoice integrity.',
        invoicedJobIds 
      });
    }

    const result = await pool.query(
      `DELETE FROM job_entries WHERE id IN (${placeholders}) RETURNING id`,
      ids
    );
    
    res.json({ 
      message: `${result.rows.length} jobs deleted successfully`,
      deletedIds: result.rows.map(row => row.id)
    });
  } catch (error) {
    logger.error('Error deleting jobs:', error);
    res.status(500).json({ error: 'Failed to delete jobs' });
  }
});

// Add signature to job
router.post('/:id/signature', async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const { signatureData, customerName } = req.body;
    
    logger.debug('Adding signature for job', {
      jobId: id,
      customerName,
      signatureDataLength: signatureData ? signatureData.length : 0,
      hasValidSignature: signatureData && signatureData.startsWith('data:image/')
    });
    
    // Validate required fields
    if (!signatureData || !customerName) {
      logger.warn('Signature upload failed - missing required fields', { jobId: id, hasSignatureData: !!signatureData, hasCustomerName: !!customerName });
      return res.status(400).json({ 
        error: 'Missing required fields', 
        details: {
          signatureData: !signatureData ? 'Signature data is required' : null,
          customerName: !customerName ? 'Customer name is required' : null
        }
      });
    }
    
    // Additional validation for signature data format
    if (!signatureData.startsWith('data:image/png;base64,')) {
      logger.warn('Signature upload failed - invalid data format', { jobId: id, signatureDataPrefix: signatureData ? signatureData.substring(0, 30) : 'null' });
      return res.status(400).json({ 
        error: 'Invalid signature data format',
        details: {
          signatureData: 'Signature data must be a valid PNG data URL'
        }
      });
    }
    
    // Check if job exists
    const currentJobResult = await client.query('SELECT status FROM job_entries WHERE id = $1', [id]);
    
    if (currentJobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      logger.warn('Signature upload failed - job not found', { jobId: id });
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const currentJob = currentJobResult.rows[0];
    
    // Prevent adding signature if job is already invoiced
    if (currentJob.status === 'invoiced') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        error: 'Cannot add signature to invoiced job', 
        message: 'Jobs that have been invoiced cannot be modified to maintain invoice integrity.' 
      });
    }
    
    // Create signature object
    const signature = {
      id: randomUUID(),
      customerName: customerName.trim(),
      signatureData,
      signedAt: new Date().toISOString(),
      ipAddress: req.ip || req.connection.remoteAddress
    };
    
    // Update job with signature and set status to completed
    const result = await client.query(`
      UPDATE job_entries SET
        signature = $1,
        status = 'completed',
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
    `, [JSON.stringify(signature), id]);
    
    await client.query('COMMIT');
    
    // Fetch the complete job with customer name
    const completeJob = await client.query(`
      SELECT j.*, c.name as customer_name,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', ja.id,
                 'name', ja.name,
                 'content', ja.content,
                 'contentType', ja.content_type,
                 'size', ja.size,
                 'uploadedAt', ja.uploaded_at
               )
             ) FILTER (WHERE ja.id IS NOT NULL) as attachments,
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', jte.id,
                 'description', jte.description,
                 'startTime', jte.start_time,
                 'endTime', jte.end_time,
                 'hoursWorked', jte.hours_worked,
                 'hourlyRate', jte.hourly_rate,
                 'hourlyRateId', jte.hourly_rate_id,
                 'taxRate', jte.tax_rate,
                 'total', jte.total
               )
             ) FILTER (WHERE jte.id IS NOT NULL) as time_entries
      FROM job_entries j
      LEFT JOIN customers c ON j.customer_id = c.id
      LEFT JOIN job_attachments ja ON j.id = ja.job_id
      LEFT JOIN job_time_entries jte ON j.id = jte.job_id
      WHERE j.id = $1
      GROUP BY j.id, c.name
    `, [id]);

    const job = formatJobData(completeJob.rows[0]);
    res.json({ 
      message: 'Signature added successfully and job marked as completed',
      job 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error adding signature:', error);
    res.status(500).json({ error: 'Failed to add signature' });
  } finally {
    client.release();
  }
});

export default router;
