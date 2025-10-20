import { Customer } from '../types';

export function findDuplicateCustomer(customers: Customer[], newCustomer: { name: string; email: string }, excludeId?: string): Customer | null {
  return customers.find(existing => 
    existing.id !== excludeId && ( // Exclude the current customer being edited
      existing.name.toLowerCase() === newCustomer.name.toLowerCase() ||
      (newCustomer.email && existing.email && existing.email.toLowerCase() === newCustomer.email.toLowerCase())
    )
  ) || null;
}

export function showDuplicateCustomerAlert(duplicateCustomer: Customer): boolean {
  const message = `Ein Kunde mit ähnlichen Daten existiert bereits:\n\nName: ${duplicateCustomer.name}\nE-Mail: ${duplicateCustomer.email || 'Nicht angegeben'}\nKunden-Nr: ${formatCustomerNumber(duplicateCustomer.customerNumber)}\n\nMöchten Sie trotzdem fortfahren?`;
  return window.confirm(message);
}

/**
 * Formats customer number to always display as 4 digits with leading zeros
 * @param customerNumber - The customer number to format
 * @returns Formatted customer number (e.g., "0001", "0042", "1234")
 */
export function formatCustomerNumber(customerNumber: string | number): string {
  if (!customerNumber) return '0000';
  
  const numericValue = typeof customerNumber === 'string' ? parseInt(customerNumber) : customerNumber;
  
  if (isNaN(numericValue)) return customerNumber.toString();
  
  return String(numericValue).padStart(4, '0');
}