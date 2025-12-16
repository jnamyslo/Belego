import logger from './logger.js';

/**
 * Async route wrapper that catches errors and passes them to the error handler
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express route handler
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Standard success response
 * @param {import('express').Response} res - Express response object
 * @param {any} data - Response data
 * @param {number} statusCode - HTTP status code (default: 200)
 */
export function sendSuccess(res, data, statusCode = 200) {
  res.status(statusCode).json(data);
}

/**
 * Standard error response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Error message
 * @param {number} statusCode - HTTP status code (default: 500)
 */
export function sendError(res, message, statusCode = 500) {
  logger.error(message);
  res.status(statusCode).json({ error: message });
}

/**
 * Not found response
 * @param {import('express').Response} res - Express response object
 * @param {string} resource - Resource name
 */
export function sendNotFound(res, resource = 'Resource') {
  res.status(404).json({ error: `${resource} nicht gefunden` });
}

/**
 * Validation error response
 * @param {import('express').Response} res - Express response object
 * @param {string} message - Validation error message
 */
export function sendValidationError(res, message) {
  res.status(400).json({ error: message });
}

/**
 * Convert snake_case to camelCase
 * @param {string} str - Snake case string
 * @returns {string} Camel case string
 */
export function snakeToCamel(str) {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert camelCase to snake_case
 * @param {string} str - Camel case string
 * @returns {string} Snake case string
 */
export function camelToSnake(str) {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Transform database row from snake_case to camelCase
 * @param {Object} row - Database row with snake_case keys
 * @returns {Object} Object with camelCase keys
 */
export function transformRow(row) {
  if (!row) return null;
  
  const transformed = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = snakeToCamel(key);
    transformed[camelKey] = value;
  }
  return transformed;
}

/**
 * Transform multiple database rows
 * @param {Array} rows - Array of database rows
 * @returns {Array} Array of transformed objects
 */
export function transformRows(rows) {
  return rows.map(transformRow);
}

/**
 * Build SQL SET clause from object
 * @param {Object} data - Object with fields to update
 * @param {number} startIndex - Starting parameter index (default: 1)
 * @returns {{ clause: string, values: any[], nextIndex: number }}
 */
export function buildSetClause(data, startIndex = 1) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  const setParts = [];
  const values = [];
  let index = startIndex;

  for (const [key, value] of entries) {
    const snakeKey = camelToSnake(key);
    setParts.push(`${snakeKey} = $${index}`);
    values.push(value);
    index++;
  }

  return {
    clause: setParts.join(', '),
    values,
    nextIndex: index,
  };
}

/**
 * Build SQL INSERT clause from object
 * @param {Object} data - Object with fields to insert
 * @param {number} startIndex - Starting parameter index (default: 1)
 * @returns {{ columns: string, placeholders: string, values: any[], nextIndex: number }}
 */
export function buildInsertClause(data, startIndex = 1) {
  const entries = Object.entries(data).filter(([, value]) => value !== undefined);
  const columns = [];
  const placeholders = [];
  const values = [];
  let index = startIndex;

  for (const [key, value] of entries) {
    const snakeKey = camelToSnake(key);
    columns.push(snakeKey);
    placeholders.push(`$${index}`);
    values.push(value);
    index++;
  }

  return {
    columns: columns.join(', '),
    placeholders: placeholders.join(', '),
    values,
    nextIndex: index,
  };
}

/**
 * Parse pagination parameters from request query
 * @param {Object} query - Request query object
 * @param {Object} defaults - Default values
 * @returns {{ page: number, limit: number, offset: number }}
 */
export function parsePagination(query, defaults = { page: 1, limit: 20 }) {
  const page = Math.max(1, parseInt(query.page) || defaults.page);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || defaults.limit));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

/**
 * Create paginated response
 * @param {Array} items - Items for current page
 * @param {number} total - Total number of items
 * @param {number} page - Current page
 * @param {number} limit - Items per page
 * @returns {Object} Paginated response object
 */
export function paginatedResponse(items, total, page, limit) {
  const totalPages = Math.ceil(total / limit);
  
  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
  };
}

export default {
  asyncHandler,
  sendSuccess,
  sendError,
  sendNotFound,
  sendValidationError,
  snakeToCamel,
  camelToSnake,
  transformRow,
  transformRows,
  buildSetClause,
  buildInsertClause,
  parsePagination,
  paginatedResponse,
};

