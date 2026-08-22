import React, { createContext, useContext, useCallback, useMemo, ReactNode } from 'react';
import { JobEntry, Customer, Company, Invoice } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import { calculateInvoiceWithDiscounts } from '../utils/discountUtils';
import { useCrudResource, CrudApi } from '../hooks/useCrudResource';
import logger from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

type JobEntryCreate = Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>;

interface JobContextType {
  jobEntries: JobEntry[];
  setJobEntries: React.Dispatch<React.SetStateAction<JobEntry[]>>;
  addJobEntry: (jobEntry: JobEntryCreate) => Promise<JobEntry>;
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>;
  deleteJobEntry: (id: string) => Promise<void>;
  refreshJobEntries: () => Promise<void>;
  addJobSignature: (id: string, signatureData: string, customerName: string) => Promise<void>;
  getJobEntryById: (id: string) => JobEntry | undefined;
}

// ============================================================================
// API-Bindung (Modulebene — stabile Identität für useCrudResource)
// ============================================================================

const jobApi: CrudApi<JobEntry, JobEntryCreate> = {
  list: () => apiService.getJobEntries(),
  create: (data) => apiService.createJobEntry(data),
  update: (id, data) => apiService.updateJobEntry(id, data),
  remove: (id) => apiService.deleteJobEntry(id),
};

// ============================================================================
// Context
// ============================================================================

const JobContext = createContext<JobContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface JobProviderProps {
  children: ReactNode;
  initialJobEntries?: JobEntry[];
}

export function JobProvider({ children, initialJobEntries = [] }: JobProviderProps) {
  const resource = useCrudResource<JobEntry, JobEntryCreate>('job entry', jobApi, initialJobEntries);
  const { setItems: setJobEntries } = resource;

  const addJobSignature = useCallback(async (id: string, signatureData: string, customerName: string): Promise<void> => {
    try {
      const response = await apiService.addJobSignature(id, signatureData, customerName);
      setJobEntries(prev => prev.map(job =>
        job.id === id ? response.job : job
      ));
    } catch (error) {
      logger.error('Error adding job signature', { error });
      throw error;
    }
  }, [setJobEntries]);

  const value: JobContextType = useMemo(() => ({
    jobEntries: resource.items,
    setJobEntries: resource.setItems,
    addJobEntry: resource.add,
    updateJobEntry: resource.update,
    deleteJobEntry: resource.remove,
    refreshJobEntries: resource.refresh,
    addJobSignature,
    getJobEntryById: resource.getById,
  }), [resource, addJobSignature]);

  return (
    <JobContext.Provider value={value}>
      {children}
    </JobContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useJobs(): JobContextType {
  const context = useContext(JobContext);
  if (context === undefined) {
    throw new Error('useJobs must be used within a JobProvider');
  }
  return context;
}

// ============================================================================
// Invoice Generation from Jobs
// ============================================================================

export async function generateInvoiceFromJobs(
  jobIds: string[],
  type: 'single' | 'daily' | 'monthly',
  jobEntries: JobEntry[],
  customers: Customer[],
  company: Company,
  addInvoice: (invoice: Omit<Invoice, 'id' | 'createdAt'>) => Promise<Invoice>,
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>,
  date?: Date
): Promise<void> {
  const selectedJobs = jobEntries.filter(job => jobIds.includes(job.id));
  if (selectedJobs.length === 0) return;

  // Group jobs by customer
  const jobsByCustomer = selectedJobs.reduce((acc, job) => {
    if (!acc[job.customerId]) {
      acc[job.customerId] = [];
    }
    acc[job.customerId].push(job);
    return acc;
  }, {} as Record<string, JobEntry[]>);

  // Generate invoices for each customer
  for (const [customerId, customerJobs] of Object.entries(jobsByCustomer)) {
    const customer = customers.find(c => c.id === customerId);
    if (!customer) continue;

    // Create invoice items from jobs
    const items = [];

    // Add job items (use time entries if available, otherwise use legacy fields)
    let itemOrder = 1;
    customerJobs.forEach(job => {
      if (job.timeEntries && job.timeEntries.length > 0) {
        job.timeEntries.forEach(timeEntry => {
          items.push({
            id: generateUUID(),
            description: `${job.title} - ${timeEntry.description}`,
            quantity: timeEntry.hoursWorked,
            unitPrice: timeEntry.hourlyRate,
            taxRate: timeEntry.taxRate != null ? timeEntry.taxRate : 19,
            discountType: timeEntry.discountType,
            discountValue: timeEntry.discountValue,
            total: timeEntry.total,
            order: itemOrder++,
          });
        });
      } else if (job.hoursWorked > 0) {
        // Only add legacy entry if there are actual hours worked and no time entries
        items.push({
          id: generateUUID(),
          description: `${job.title} - ${job.description}`,
          quantity: job.hoursWorked,
          unitPrice: job.hourlyRate,
          taxRate: 19, // Default for legacy data
          total: job.hoursWorked * job.hourlyRate,
          order: itemOrder++,
        });
      }
    });

    // Add material items
    customerJobs.forEach(job => {
      if (job.materials && job.materials.length > 0) {
        job.materials.forEach(material => {
          items.push({
            id: generateUUID(),
            description: `${job.title} - ${material.description}`,
            quantity: material.quantity,
            unitPrice: material.unitPrice,
            taxRate: material.taxRate != null ? material.taxRate : 19,
            discountType: material.discountType,
            discountValue: material.discountValue,
            total: material.total,
            order: itemOrder++,
          });
        });
      }
    });

    const { subtotal, taxAmount, total } = calculateInvoiceWithDiscounts(items, {}, company.isSmallBusiness);

    // Generate invoice title
    let invoiceTitle = '';
    if (type === 'daily' && date) {
      invoiceTitle = `Tagesrechnung vom ${date.toLocaleDateString('de-DE')}`;
    } else if (type === 'monthly' && date) {
      invoiceTitle = `Monatsrechnung ${date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;
    } else {
      invoiceTitle = `Rechnung für Auftrag${customerJobs.length > 1 ? 'e' : ''}: ${customerJobs.map(j => j.title).join(', ')}`;
    }

    const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
    const issueDate = date || new Date();
    const dueDate = new Date(issueDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);

    const newInvoice = {
      invoiceNumber: '', // Will be set by backend
      customerId: customer.id,
      customerName: customer.name,
      issueDate,
      dueDate,
      items,
      subtotal,
      taxAmount,
      total,
      status: 'draft' as const,
      notes: invoiceTitle,
    };

    await addInvoice(newInvoice);

    // Mark jobs as invoiced
    for (const job of customerJobs) {
      await updateJobEntry(job.id, { status: 'invoiced' });
    }
  }
}

