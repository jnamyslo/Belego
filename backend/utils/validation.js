/**
 * Validation utilities for request data
 */

/**
 * Check if a value is a valid UUID
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function isValidUUID(value) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return typeof value === 'string' && uuidRegex.test(value);
}

/**
 * Check if a value is a valid email
 * @param {string} value - Value to check
 * @returns {boolean}
 */
export function isValidEmail(value) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return typeof value === 'string' && emailRegex.test(value);
}

/**
 * Check if a value is a non-empty string
 * @param {any} value - Value to check
 * @returns {boolean}
 */
export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Check if a value is a valid date
 * @param {any} value - Value to check
 * @returns {boolean}
 */
export function isValidDate(value) {
  if (!value) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

/**
 * Check if a value is a positive number
 * @param {any} value - Value to check
 * @returns {boolean}
 */
export function isPositiveNumber(value) {
  const num = parseFloat(value);
  return !isNaN(num) && num >= 0;
}

/**
 * Check if a value is a valid status
 * @param {string} value - Value to check
 * @param {string[]} validStatuses - Array of valid status values
 * @returns {boolean}
 */
export function isValidStatus(value, validStatuses) {
  return validStatuses.includes(value);
}

/**
 * Validation error class
 */
export class ValidationError extends Error {
  constructor(field, message) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

/**
 * Validate required fields in an object
 * @param {Object} data - Object to validate
 * @param {string[]} requiredFields - Array of required field names
 * @throws {ValidationError} If a required field is missing
 */
export function validateRequired(data, requiredFields) {
  for (const field of requiredFields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      throw new ValidationError(field, `${field} ist erforderlich`);
    }
  }
}

/**
 * Validate an object against a schema
 * @param {Object} data - Object to validate
 * @param {Object} schema - Validation schema
 * @returns {{ valid: boolean, errors: Array<{field: string, message: string}> }}
 */
export function validateSchema(data, schema) {
  const errors = [];

  for (const [field, rules] of Object.entries(schema)) {
    const value = data[field];

    // Check required
    if (rules.required && (value === undefined || value === null || value === '')) {
      errors.push({ field, message: `${field} ist erforderlich` });
      continue;
    }

    // Skip further validation if value is optional and not provided
    if (value === undefined || value === null) {
      continue;
    }

    // Check type
    if (rules.type) {
      switch (rules.type) {
        case 'string':
          if (typeof value !== 'string') {
            errors.push({ field, message: `${field} muss ein String sein` });
          }
          break;
        case 'number':
          if (typeof value !== 'number' && isNaN(parseFloat(value))) {
            errors.push({ field, message: `${field} muss eine Zahl sein` });
          }
          break;
        case 'boolean':
          if (typeof value !== 'boolean') {
            errors.push({ field, message: `${field} muss ein Boolean sein` });
          }
          break;
        case 'email':
          if (!isValidEmail(value)) {
            errors.push({ field, message: `${field} muss eine gültige E-Mail-Adresse sein` });
          }
          break;
        case 'uuid':
          if (!isValidUUID(value)) {
            errors.push({ field, message: `${field} muss eine gültige UUID sein` });
          }
          break;
        case 'date':
          if (!isValidDate(value)) {
            errors.push({ field, message: `${field} muss ein gültiges Datum sein` });
          }
          break;
      }
    }

    // Check min length
    if (rules.minLength !== undefined && typeof value === 'string' && value.length < rules.minLength) {
      errors.push({ field, message: `${field} muss mindestens ${rules.minLength} Zeichen haben` });
    }

    // Check max length
    if (rules.maxLength !== undefined && typeof value === 'string' && value.length > rules.maxLength) {
      errors.push({ field, message: `${field} darf maximal ${rules.maxLength} Zeichen haben` });
    }

    // Check min value
    if (rules.min !== undefined && parseFloat(value) < rules.min) {
      errors.push({ field, message: `${field} muss mindestens ${rules.min} sein` });
    }

    // Check max value
    if (rules.max !== undefined && parseFloat(value) > rules.max) {
      errors.push({ field, message: `${field} darf maximal ${rules.max} sein` });
    }

    // Check enum values
    if (rules.enum && !rules.enum.includes(value)) {
      errors.push({ field, message: `${field} muss einer der Werte sein: ${rules.enum.join(', ')}` });
    }

    // Custom validator
    if (rules.validate && typeof rules.validate === 'function') {
      const customError = rules.validate(value, data);
      if (customError) {
        errors.push({ field, message: customError });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate discount fields on invoices/quotes (global and per-item)
 * @param {Object} data - Request data containing discount fields and optional items array
 * @returns {{ valid: boolean, message?: string }}
 */
export function validateDiscountFields(data) {
  const { globalDiscountType, globalDiscountValue, items } = data;

  // Validate global discount
  if (globalDiscountType === 'percentage') {
    const val = parseFloat(globalDiscountValue);
    if (isNaN(val) || val < 0 || val > 100) {
      return { valid: false, message: 'Ungültiger Rabatt: Prozentwert muss zwischen 0 und 100 liegen' };
    }
  } else if (globalDiscountType === 'fixed') {
    const val = parseFloat(globalDiscountValue);
    if (isNaN(val) || val < 0) {
      return { valid: false, message: 'Ungültiger Rabatt: Festbetrag muss größer oder gleich 0 sein' };
    }
  }

  // Validate per-item discounts
  if (Array.isArray(items)) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.discountType === 'percentage') {
        const val = parseFloat(item.discountValue);
        if (isNaN(val) || val < 0 || val > 100) {
          return { valid: false, message: `Ungültiger Rabatt in Position ${i + 1}: Prozentwert muss zwischen 0 und 100 liegen` };
        }
      } else if (item.discountType === 'fixed') {
        const val = parseFloat(item.discountValue);
        if (isNaN(val) || val < 0) {
          return { valid: false, message: `Ungültiger Rabatt in Position ${i + 1}: Festbetrag muss größer oder gleich 0 sein` };
        }
      }
    }
  }

  return { valid: true };
}

// Common validation schemas
export const schemas = {
  customer: {
    name: { required: true, type: 'string', minLength: 1, maxLength: 255 },
    email: { type: 'email' },
    address: { required: true, type: 'string' },
    city: { required: true, type: 'string', maxLength: 100 },
    postalCode: { required: true, type: 'string', maxLength: 20 },
    country: { required: true, type: 'string', maxLength: 100 },
  },
  invoice: {
    customerId: { required: true, type: 'uuid' },
    customerName: { required: true, type: 'string' },
    issueDate: { required: true, type: 'date' },
    dueDate: { required: true, type: 'date' },
    status: { required: true, enum: ['draft', 'sent', 'paid', 'overdue', 'reminded_1x', 'reminded_2x', 'reminded_3x'] },
  },
  quote: {
    customerId: { required: true, type: 'uuid' },
    customerName: { required: true, type: 'string' },
    issueDate: { required: true, type: 'date' },
    validUntil: { required: true, type: 'date' },
    status: { required: true, enum: ['draft', 'sent', 'accepted', 'rejected', 'expired', 'billed'] },
  },
  jobEntry: {
    customerId: { required: true, type: 'uuid' },
    title: { required: true, type: 'string', minLength: 1 },
    date: { required: true, type: 'date' },
    status: { enum: ['draft', 'in-progress', 'completed', 'invoiced'] },
  },
};

export default {
  isValidUUID,
  isValidEmail,
  isNonEmptyString,
  isValidDate,
  isPositiveNumber,
  isValidStatus,
  ValidationError,
  validateRequired,
  validateSchema,
  validateDiscountFields,
  schemas,
};

