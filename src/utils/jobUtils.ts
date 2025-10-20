import { JobEntry, JobTimeEntry } from '../types';

/**
 * Calculate total hours from all time entries in a job
 */
export function calculateTotalHours(job: JobEntry): number {
  if (job.timeEntries && job.timeEntries.length > 0) {
    return job.timeEntries.reduce((total, entry) => total + entry.hoursWorked, 0);
  }
  // Fallback to legacy hoursWorked field for backwards compatibility
  return job.hoursWorked || 0;
}

/**
 * Calculate total cost from all time entries in a job
 */
export function calculateTotalCost(job: JobEntry): number {
  if (job.timeEntries && job.timeEntries.length > 0) {
    return job.timeEntries.reduce((total, entry) => total + entry.total, 0);
  }
  // Fallback to legacy calculation for backwards compatibility
  return (job.hoursWorked || 0) * (job.hourlyRate || 0);
}

/**
 * Get all time entries for a job (including legacy single entry)
 */
export function getTimeEntries(job: JobEntry): JobTimeEntry[] {
  if (job.timeEntries && job.timeEntries.length > 0) {
    return job.timeEntries;
  }
  
  // Return legacy time entry for backwards compatibility
  if (job.hoursWorked > 0) {
    return [{
      id: 'legacy',
      description: 'Arbeitszeit',
      startTime: job.startTime,
      endTime: job.endTime,
      hoursWorked: job.hoursWorked,
      hourlyRate: job.hourlyRate,
      hourlyRateId: job.hourlyRateId,
      taxRate: 19, // Default tax rate for legacy entries
      total: job.hoursWorked * job.hourlyRate
    }];
  }
  
  return [];
}

/**
 * Create a default time entry
 */
export function createDefaultTimeEntry(hourlyRate?: number, hourlyRateId?: string, taxRate?: number): JobTimeEntry {
  return {
    id: Date.now().toString(),
    description: '',
    startTime: '',
    endTime: '',
    hoursWorked: 0,
    hourlyRate: hourlyRate || 0,
    hourlyRateId: hourlyRateId || '',
    taxRate: taxRate != null ? taxRate : 19, // Default tax rate
    total: 0
  };
}
