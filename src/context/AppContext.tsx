import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Customer, Invoice, Quote, Company, JobEntry, HourlyRate, MaterialTemplate, InvoiceTemplate } from '../types';
import { apiService } from '../services/api';
import { setupMetaTags } from '../utils/faviconUtils';
import logger from '../utils/logger';

// Import individual contexts
import { CustomerProvider, useCustomers, getCombinedHourlyRatesForCustomer, getCombinedMaterialTemplatesForCustomer, getHourlyRatesForCustomer, getMaterialTemplatesForCustomer } from './CustomerContext';
import { InvoiceProvider, useInvoices } from './InvoiceContext';
import { QuoteProvider, useQuotes } from './QuoteContext';
import { JobProvider, useJobs, generateInvoiceFromJobs } from './JobContext';
import { CompanyProvider, useCompany, defaultCompany } from './CompanyContext';

// ============================================================================
// Re-export hooks for convenience
// ============================================================================

export { useCustomers } from './CustomerContext';
export { useInvoices } from './InvoiceContext';
export { useQuotes } from './QuoteContext';
export { useJobs } from './JobContext';
export { useCompany } from './CompanyContext';

// ============================================================================
// Combined App Context Type (for backwards compatibility)
// ============================================================================

interface AppContextType {
  // Data
  customers: Customer[];
  invoices: Invoice[];
  quotes: Quote[];
  jobEntries: JobEntry[];
  company: Company;
  materialTemplates: MaterialTemplate[];
  hourlyRates: HourlyRate[];
  loading: boolean;
  // Customer methods
  addCustomer: (customer: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>) => Promise<Customer>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  refreshCustomers: () => Promise<void>;
  // Invoice methods
  addInvoice: (invoice: Omit<Invoice, 'id' | 'createdAt'>) => Promise<void>;
  updateInvoice: (id: string, invoice: Partial<Invoice>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  refreshInvoices: () => Promise<void>;
  // Quote methods
  addQuote: (quote: Omit<Quote, 'id' | 'createdAt'>) => Promise<void>;
  updateQuote: (id: string, quote: Partial<Quote>) => Promise<void>;
  deleteQuote: (id: string) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  // Job methods
  addJobEntry: (jobEntry: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>;
  deleteJobEntry: (id: string) => Promise<void>;
  refreshJobEntries: () => Promise<void>;
  addJobSignature: (id: string, signatureData: string, customerName: string) => Promise<void>;
  generateInvoiceFromJobs: (jobIds: string[], type: 'single' | 'daily' | 'monthly', date?: Date) => Promise<void>;
  // Company methods
  updateCompany: (company: Partial<Company>) => Promise<void>;
  // Hourly rate methods
  addHourlyRate: (rate: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateHourlyRate: (id: string, rate: Partial<HourlyRate>) => Promise<void>;
  deleteHourlyRate: (id: string) => Promise<void>;
  getHourlyRates: () => HourlyRate[];
  getHourlyRatesForCustomer: (customerId?: string) => HourlyRate[];
  getMaterialTemplatesForCustomer: (customerId?: string) => MaterialTemplate[];
  getCombinedHourlyRatesForCustomer: (customerId?: string) => (HourlyRate & { displayName: string; isGeneral: boolean; isCustomerSpecific: boolean })[];
  getCombinedMaterialTemplatesForCustomer: (customerId?: string) => (MaterialTemplate & { displayName: string; isGeneral: boolean; isCustomerSpecific: boolean })[];
  // Material template methods
  addMaterialTemplate: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateMaterialTemplate: (id: string, template: Partial<MaterialTemplate>) => Promise<void>;
  deleteMaterialTemplate: (id: string) => Promise<void>;
  getMaterialTemplates: () => MaterialTemplate[];
  // Invoice template methods
  addInvoiceTemplate: (template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateInvoiceTemplate: (id: string, template: Partial<InvoiceTemplate>) => Promise<void>;
  deleteInvoiceTemplate: (id: string) => Promise<void>;
  getInvoiceTemplates: () => InvoiceTemplate[];
}

// ============================================================================
// App Context
// ============================================================================

const AppContext = createContext<AppContextType | undefined>(undefined);

// ============================================================================
// Loading Context
// ============================================================================

interface LoadingContextType {
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

const LoadingContext = createContext<LoadingContextType | undefined>(undefined);

function useLoading(): LoadingContextType {
  const context = useContext(LoadingContext);
  if (context === undefined) {
    throw new Error('useLoading must be used within LoadingProvider');
  }
  return context;
}

// ============================================================================
// App Context Bridge (connects individual contexts to combined interface)
// ============================================================================

function AppContextBridge({ children }: { children: ReactNode }) {
  const { loading } = useLoading();
  const customerContext = useCustomers();
  const invoiceContext = useInvoices();
  const quoteContext = useQuotes();
  const jobContext = useJobs();
  const companyContext = useCompany();

  // Wrapped methods for backwards compatibility
  const addInvoiceWrapped = async (invoice: Omit<Invoice, 'id' | 'createdAt'>) => {
    await invoiceContext.addInvoice(invoice);
  };

  const addQuoteWrapped = async (quote: Omit<Quote, 'id' | 'createdAt'>) => {
    await quoteContext.addQuote(quote);
  };

  const addJobEntryWrapped = async (jobEntry: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    await jobContext.addJobEntry(jobEntry);
  };

  const generateInvoiceFromJobsWrapped = async (
    jobIds: string[],
    type: 'single' | 'daily' | 'monthly',
    date?: Date
  ) => {
    await generateInvoiceFromJobs(
      jobIds,
      type,
      jobContext.jobEntries,
      customerContext.customers,
      companyContext.company,
      invoiceContext.addInvoice,
      jobContext.updateJobEntry,
      date
    );
  };

  // Customer rate/material utilities with context data
  const getHourlyRatesForCustomerWrapped = (customerId?: string) => {
    return getHourlyRatesForCustomer(customerContext.customers, companyContext.hourlyRates, customerId);
  };

  const getMaterialTemplatesForCustomerWrapped = (customerId?: string) => {
    return getMaterialTemplatesForCustomer(customerContext.customers, companyContext.materialTemplates, customerId);
  };

  const getCombinedHourlyRatesForCustomerWrapped = (customerId?: string) => {
    return getCombinedHourlyRatesForCustomer(
      customerContext.customers,
      companyContext.hourlyRates,
      companyContext.company.showCombinedDropdowns ?? false,
      customerId
    );
  };

  const getCombinedMaterialTemplatesForCustomerWrapped = (customerId?: string) => {
    return getCombinedMaterialTemplatesForCustomer(
      customerContext.customers,
      companyContext.materialTemplates,
      companyContext.company.showCombinedDropdowns ?? false,
      customerId
    );
  };

  const value: AppContextType = {
    // Data
    customers: customerContext.customers,
    invoices: invoiceContext.invoices,
    quotes: quoteContext.quotes,
    jobEntries: jobContext.jobEntries,
    company: companyContext.company,
    materialTemplates: companyContext.materialTemplates,
    hourlyRates: companyContext.hourlyRates,
    loading,
    // Customer methods
    addCustomer: customerContext.addCustomer,
    updateCustomer: customerContext.updateCustomer,
    deleteCustomer: customerContext.deleteCustomer,
    refreshCustomers: customerContext.refreshCustomers,
    // Invoice methods
    addInvoice: addInvoiceWrapped,
    updateInvoice: invoiceContext.updateInvoice,
    deleteInvoice: invoiceContext.deleteInvoice,
    refreshInvoices: invoiceContext.refreshInvoices,
    // Quote methods
    addQuote: addQuoteWrapped,
    updateQuote: quoteContext.updateQuote,
    deleteQuote: quoteContext.deleteQuote,
    refreshQuotes: quoteContext.refreshQuotes,
    // Job methods
    addJobEntry: addJobEntryWrapped,
    updateJobEntry: jobContext.updateJobEntry,
    deleteJobEntry: jobContext.deleteJobEntry,
    refreshJobEntries: jobContext.refreshJobEntries,
    addJobSignature: jobContext.addJobSignature,
    generateInvoiceFromJobs: generateInvoiceFromJobsWrapped,
    // Company methods
    updateCompany: companyContext.updateCompany,
    // Hourly rate methods
    addHourlyRate: companyContext.addHourlyRate,
    updateHourlyRate: companyContext.updateHourlyRate,
    deleteHourlyRate: companyContext.deleteHourlyRate,
    getHourlyRates: companyContext.getHourlyRates,
    getHourlyRatesForCustomer: getHourlyRatesForCustomerWrapped,
    getMaterialTemplatesForCustomer: getMaterialTemplatesForCustomerWrapped,
    getCombinedHourlyRatesForCustomer: getCombinedHourlyRatesForCustomerWrapped,
    getCombinedMaterialTemplatesForCustomer: getCombinedMaterialTemplatesForCustomerWrapped,
    // Material template methods
    addMaterialTemplate: companyContext.addMaterialTemplate,
    updateMaterialTemplate: companyContext.updateMaterialTemplate,
    deleteMaterialTemplate: companyContext.deleteMaterialTemplate,
    getMaterialTemplates: companyContext.getMaterialTemplates,
    // Invoice template methods
    addInvoiceTemplate: companyContext.addInvoiceTemplate,
    updateInvoiceTemplate: companyContext.updateInvoiceTemplate,
    deleteInvoiceTemplate: companyContext.deleteInvoiceTemplate,
    getInvoiceTemplates: companyContext.getInvoiceTemplates,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

// ============================================================================
// Data Loader Component
// ============================================================================

interface DataLoaderProps {
  children: ReactNode;
}

function DataLoader({ children }: DataLoaderProps) {
  const { setLoading } = useLoading();
  const customerContext = useCustomers();
  const invoiceContext = useInvoices();
  const quoteContext = useQuotes();
  const jobContext = useJobs();
  const companyContext = useCompany();

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);

        // Load all data in parallel
        const [customersData, invoicesData, quotesData, jobEntriesData, companyData, materialTemplatesData, hourlyRatesData] = await Promise.all([
          apiService.getCustomers().catch(() => []),
          apiService.getInvoices().catch(() => []),
          apiService.getQuotes().catch(() => []),
          apiService.getJobEntries().catch(() => []),
          apiService.getCompany().catch(() => defaultCompany),
          apiService.getMaterialTemplates().catch(() => []),
          apiService.getHourlyRates().catch(() => []),
        ]);

        customerContext.setCustomers(customersData);
        invoiceContext.setInvoices(invoicesData);
        quoteContext.setQuotes(quotesData);
        jobContext.setJobEntries(jobEntriesData);
        companyContext.setCompany(companyData);
        companyContext.setMaterialTemplates(materialTemplatesData);
        companyContext.setHourlyRates(hourlyRatesData);
      } catch (error) {
        logger.error('Error loading data:', error);
      } finally {
        setLoading(false);
      }
    };

    // Setup meta tags on mount
    setupMetaTags();

    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}

// ============================================================================
// Main App Provider
// ============================================================================

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);

  return (
    <LoadingContext.Provider value={{ loading, setLoading }}>
      <CustomerProvider>
        <InvoiceProvider>
          <QuoteProvider>
            <JobProvider>
              <CompanyProvider loading={loading}>
                <DataLoader>
                  <AppContextBridge>
                    {children}
                  </AppContextBridge>
                </DataLoader>
              </CompanyProvider>
            </JobProvider>
          </QuoteProvider>
        </InvoiceProvider>
      </CustomerProvider>
    </LoadingContext.Provider>
  );
}

// ============================================================================
// Main Hook (for backwards compatibility)
// ============================================================================

export function useApp(): AppContextType {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
