import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Customer, Invoice, Quote, Company, JobEntry, HourlyRate, MaterialTemplate, InvoiceTemplate } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import { updateFavicon, updatePageTitle, setupMetaTags } from '../utils/faviconUtils';
import logger from '../utils/logger';

interface AppContextType {
  customers: Customer[];
  invoices: Invoice[];
  quotes: Quote[];
  jobEntries: JobEntry[];
  company: Company;
  materialTemplates: MaterialTemplate[];
  hourlyRates: HourlyRate[];
  loading: boolean;
  addCustomer: (customer: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>) => Promise<Customer>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  refreshCustomers: () => Promise<void>;
  addInvoice: (invoice: Omit<Invoice, 'id' | 'createdAt'>) => Promise<void>;
  updateInvoice: (id: string, invoice: Partial<Invoice>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  refreshInvoices: () => Promise<void>;
  addQuote: (quote: Omit<Quote, 'id' | 'createdAt'>) => Promise<void>;
  updateQuote: (id: string, quote: Partial<Quote>) => Promise<void>;
  deleteQuote: (id: string) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  addJobEntry: (jobEntry: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateJobEntry: (id: string, jobEntry: Partial<JobEntry>) => Promise<void>;
  deleteJobEntry: (id: string) => Promise<void>;
  refreshJobEntries: () => Promise<void>;
  addJobSignature: (id: string, signatureData: string, customerName: string) => Promise<void>;
  generateInvoiceFromJobs: (jobIds: string[], type: 'single' | 'daily' | 'monthly', date?: Date) => Promise<void>;
  updateCompany: (company: Partial<Company>) => Promise<void>;
  addHourlyRate: (hourlyRate: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateHourlyRate: (id: string, hourlyRate: Partial<HourlyRate>) => Promise<void>;
  deleteHourlyRate: (id: string) => Promise<void>;
  getHourlyRates: () => HourlyRate[];
  getHourlyRatesForCustomer: (customerId?: string) => HourlyRate[];
  getMaterialTemplatesForCustomer: (customerId?: string) => MaterialTemplate[];
  getCombinedHourlyRatesForCustomer: (customerId?: string) => (HourlyRate & { displayName: string; isGeneral: boolean; isCustomerSpecific: boolean })[];
  getCombinedMaterialTemplatesForCustomer: (customerId?: string) => (MaterialTemplate & { displayName: string; isGeneral: boolean; isCustomerSpecific: boolean })[];
  addMaterialTemplate: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateMaterialTemplate: (id: string, template: Partial<MaterialTemplate>) => Promise<void>;
  deleteMaterialTemplate: (id: string) => Promise<void>;
  getMaterialTemplates: () => MaterialTemplate[];
  addInvoiceTemplate: (template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateInvoiceTemplate: (id: string, template: Partial<InvoiceTemplate>) => Promise<void>;
  deleteInvoiceTemplate: (id: string) => Promise<void>;
  getInvoiceTemplates: () => InvoiceTemplate[];
}

const AppContext = createContext<AppContextType | undefined>(undefined);

const defaultCompany: Company = {
  name: 'Meine Firma GmbH',
  address: 'Musterstraße 123',
  city: 'Berlin',
  postalCode: '10115',
  country: 'Deutschland',
  phone: '+49 30 12345678',
  email: 'info@meinefirma.de',
  website: 'www.meinefirma.de',
  taxId: 'DE123456789',
  bankAccount: 'DE89 3704 0044 0532 0130 00',
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  jobTrackingEnabled: true,
  reportingEnabled: true, // Reporting-Modul standardmäßig aktiviert
  defaultPaymentDays: 30, // Standard-Zahlungsziel: 30 Tage
  immediatePaymentClause: 'Rechnung ist per sofort fällig, ohne Abzug', // Standard-Klausel für sofortige Zahlung
  invoiceStartNumber: 1, // Start-Rechnungsnummer: 1
  showCombinedDropdowns: false, // Standardmäßig kombinierte Dropdowns deaktiviert
  isSmallBusiness: false, // Kleinunternehmerregelung standardmäßig deaktiviert
  hourlyRates: [
    {
      id: '1',
      name: 'Standard',
      description: 'Normale Arbeitszeit',
      rate: 75.0,
      isDefault: true
    },
    {
      id: '2',
      name: 'Anfahrt',
      description: 'Anfahrtszeit zum Kunden',
      rate: 50.0,
      isDefault: false
    }
  ],
  invoiceTemplates: [
    {
      id: '1',
      name: 'Beratung',
      description: 'Beratungsleistungen',
      unitPrice: 120,
      unit: 'Stunde',
      taxRate: 19,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: '2',
      name: 'Projektmanagement',
      description: 'Projektmanagement und Koordination',
      unitPrice: 100,
      unit: 'Stunde',
      taxRate: 19,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]
};

export function AppProvider({ children }: { children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [jobEntries, setJobEntries] = useState<JobEntry[]>([]);
  const [company, setCompany] = useState<Company>(defaultCompany);
  const [materialTemplates, setMaterialTemplates] = useState<MaterialTemplate[]>([]);
  const [hourlyRates, setHourlyRates] = useState<HourlyRate[]>([]);
  const [loading, setLoading] = useState(true);

  // Load data from API on mount
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
          apiService.getHourlyRates().catch(() => [])
        ]);

        setCustomers(customersData);
        setInvoices(invoicesData);
        setQuotes(quotesData);
        setJobEntries(jobEntriesData);
        setCompany(companyData);
        setMaterialTemplates(materialTemplatesData);
        setHourlyRates(hourlyRatesData);
      } catch (error) {
        logger.error('Error loading data:', error);
        // Fallback to localStorage if API fails
        const savedCustomers = localStorage.getItem('invoice-app-customers');
        const savedInvoices = localStorage.getItem('invoice-app-invoices');
        const savedJobEntries = localStorage.getItem('invoice-app-job-entries');
        const savedCompany = localStorage.getItem('invoice-app-company');

        if (savedCustomers) {
          setCustomers(JSON.parse(savedCustomers));
        }
        if (savedInvoices) {
          setInvoices(JSON.parse(savedInvoices));
        }
        if (savedJobEntries) {
          setJobEntries(JSON.parse(savedJobEntries));
        }
        if (savedCompany) {
          setCompany(JSON.parse(savedCompany));
        }
      } finally {
        setLoading(false);
      }
    };

    // Setup meta tags on mount
    setupMetaTags();
    
    loadData();
  }, []);

  // Update favicon and page title when company data changes
  useEffect(() => {
    if (!loading) {
      updateFavicon(company.icon || null);
      updatePageTitle(company.name);
    }
  }, [company.icon, company.name, loading]);

  const addCustomer = async (customerData: Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>) => {
    try {
      const newCustomer = await apiService.createCustomer(customerData);
      setCustomers(prev => [...prev, newCustomer]);
      return newCustomer;
    } catch (error) {
      logger.error('Error adding customer:', error);
      // Fallback to localStorage behavior
      // Always format as 4-digit number with leading zeros (e.g., 0001, 0002, etc.)
      const existingNumbers = customers.map(c => parseInt(c.customerNumber)).filter(n => !isNaN(n));
      const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
      const customerNumber = String(nextNumber).padStart(4, '0');
      
      const newCustomer: Customer = {
        ...customerData,
        id: generateUUID(),
        customerNumber,
        createdAt: new Date(),
      };
      setCustomers(prev => [...prev, newCustomer]);
      localStorage.setItem('invoice-app-customers', JSON.stringify([...customers, newCustomer]));
      return newCustomer;
    }
  };

  const updateCustomer = async (id: string, customerData: Partial<Customer>) => {
    try {
      const updatedCustomer = await apiService.updateCustomer(id, customerData);
      setCustomers(prev => prev.map(customer => 
        customer.id === id ? updatedCustomer : customer
      ));
    } catch (error) {
      logger.error('Error updating customer:', error);
      // Fallback to localStorage behavior
      setCustomers(prev => prev.map(customer => 
        customer.id === id ? { ...customer, ...customerData } : customer
      ));
      const updatedCustomers = customers.map(customer => 
        customer.id === id ? { ...customer, ...customerData } : customer
      );
      localStorage.setItem('invoice-app-customers', JSON.stringify(updatedCustomers));
    }
  };

  const deleteCustomer = async (id: string) => {
    try {
      await apiService.deleteCustomer(id);
      setCustomers(prev => prev.filter(customer => customer.id !== id));
    } catch (error) {
      logger.error('Error deleting customer:', error);
      // Fallback to localStorage behavior
      const filteredCustomers = customers.filter(customer => customer.id !== id);
      setCustomers(filteredCustomers);
      localStorage.setItem('invoice-app-customers', JSON.stringify(filteredCustomers));
    }
  };

  const refreshCustomers = async () => {
    try {
      const customersData = await apiService.getCustomers();
      setCustomers(customersData);
    } catch (error) {
      logger.error('Error refreshing customers:', error);
    }
  };

  const refreshInvoices = async () => {
    try {
      const invoicesData = await apiService.getInvoices();
      setInvoices(invoicesData);
    } catch (error) {
      logger.error('Error refreshing invoices:', error);
    }
  };

  const refreshJobEntries = async () => {
    try {
      const jobEntriesData = await apiService.getJobEntries();
      setJobEntries(jobEntriesData);
    } catch (error) {
      logger.error('Error refreshing job entries:', error);
    }
  };

  const addInvoice = async (invoiceData: Omit<Invoice, 'id' | 'createdAt'>) => {
    try {
      const newInvoice = await apiService.createInvoice(invoiceData);
      setInvoices(prev => [...prev, newInvoice]);
    } catch (error) {
      logger.error('Error adding invoice:', error);
      // Fallback to localStorage behavior
      const newInvoice: Invoice = {
        ...invoiceData,
        id: generateUUID(),
        createdAt: new Date(),
      };
      setInvoices(prev => [...prev, newInvoice]);
      localStorage.setItem('invoice-app-invoices', JSON.stringify([...invoices, newInvoice]));
    }
  };

  const updateInvoice = async (id: string, invoiceData: Partial<Invoice>) => {
    try {
      const updatedInvoice = await apiService.updateInvoice(id, invoiceData);
      setInvoices(prev => prev.map(invoice => 
        invoice.id === id ? updatedInvoice : invoice
      ));
    } catch (error) {
      logger.error('Error updating invoice:', error);
      // Fallback to localStorage behavior
      setInvoices(prev => {
        const updated = prev.map(invoice => 
          invoice.id === id ? { ...invoice, ...invoiceData } : invoice
        );
        localStorage.setItem('invoice-app-invoices', JSON.stringify(updated));
        return updated;
      });
    }
  };

  const deleteInvoice = async (id: string) => {
    try {
      await apiService.deleteInvoice(id);
      setInvoices(prev => prev.filter(invoice => invoice.id !== id));
    } catch (error) {
      logger.error('Error deleting invoice:', error);
      // Fallback to localStorage behavior
      const filteredInvoices = invoices.filter(invoice => invoice.id !== id);
      setInvoices(filteredInvoices);
      localStorage.setItem('invoice-app-invoices', JSON.stringify(filteredInvoices));
    }
  };

  // Quote functions
  const refreshQuotes = async () => {
    try {
      const quotesData = await apiService.getQuotes();
      setQuotes(quotesData);
    } catch (error) {
      logger.error('Error refreshing quotes:', error);
    }
  };

  const addQuote = async (quoteData: Omit<Quote, 'id' | 'createdAt'>) => {
    try {
      const newQuote = await apiService.createQuote(quoteData);
      setQuotes(prev => [...prev, newQuote]);
    } catch (error) {
      logger.error('Error adding quote:', error);
      throw error;
    }
  };

  const updateQuote = async (id: string, quoteData: Partial<Quote>) => {
    try {
      const updatedQuote = await apiService.updateQuote(id, quoteData);
      setQuotes(prev => prev.map(quote => 
        quote.id === id ? updatedQuote : quote
      ));
    } catch (error) {
      logger.error('Error updating quote:', error);
      throw error;
    }
  };

  const deleteQuote = async (id: string) => {
    try {
      await apiService.deleteQuote(id);
      setQuotes(prev => prev.filter(quote => quote.id !== id));
    } catch (error) {
      logger.error('Error deleting quote:', error);
      throw error;
    }
  };

  // Job Management Functions
  const addJobEntry = async (jobEntryData: Omit<JobEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const newJobEntry = await apiService.createJobEntry(jobEntryData);
      setJobEntries(prev => [...prev, newJobEntry]);
    } catch (error) {
      logger.error('Error adding job entry:', error);
      
      // Fallback to localStorage
      const newJobEntry: JobEntry = {
        ...jobEntryData,
        id: generateUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setJobEntries(prev => [...prev, newJobEntry]);
      localStorage.setItem('invoice-app-job-entries', JSON.stringify([...jobEntries, newJobEntry]));
      
      // Re-throw error to inform calling component
      throw error;
    }
  };

  const updateJobEntry = async (id: string, jobEntryData: Partial<JobEntry>) => {
    try {
      const updatedJobEntry = await apiService.updateJobEntry(id, jobEntryData);
      setJobEntries(prev => prev.map(job => 
        job.id === id ? updatedJobEntry : job
      ));
    } catch (error) {
      logger.error('Error updating job entry:', error);
      // Fallback to localStorage
      const updatedJobEntry = { ...jobEntryData, updatedAt: new Date() };
      setJobEntries(prev => {
        const updated = prev.map((job: JobEntry) => 
          job.id === id ? { ...job, ...updatedJobEntry } : job
        );
        // Use the updated array for localStorage instead of the stale jobEntries
        localStorage.setItem('invoice-app-job-entries', JSON.stringify(updated));
        return updated;
      });
    }
  };

  const deleteJobEntry = async (id: string) => {
    try {
      await apiService.deleteJobEntry(id);
      setJobEntries(prev => prev.filter(job => job.id !== id));
    } catch (error) {
      logger.error('Error deleting job entry:', error);
      // Fallback to localStorage
      setJobEntries(prev => prev.filter(job => job.id !== id));
      const filteredJobs = jobEntries.filter(job => job.id !== id);
      localStorage.setItem('invoice-app-job-entries', JSON.stringify(filteredJobs));
    }
  };

  const addJobSignature = async (id: string, signatureData: string, customerName: string) => {
    try {
      const response = await apiService.addJobSignature(id, signatureData, customerName);
      
      // Update the job entry with the new signature and completed status
      setJobEntries(prev => prev.map(job => 
        job.id === id ? response.job : job
      ));
    } catch (error) {
      logger.error('Error adding job signature:', error);
      throw error; // Re-throw so the UI can handle the error
    }
  };

  const generateInvoiceFromJobs = async (jobIds: string[], type: 'single' | 'daily' | 'monthly', date?: Date) => {
    try {
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
                total: timeEntry.total,
                order: itemOrder++
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
              order: itemOrder++
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
                total: material.total,
                order: itemOrder++
              });
            });
          }
        });

        const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        const taxAmount = items.reduce((sum, item) => {
          const itemTotal = item.quantity * item.unitPrice;
          return sum + (itemTotal * (item.taxRate / 100));
        }, 0);
        const total = subtotal + taxAmount;

        // Backend will generate the invoice number automatically based on current year and company settings
        let invoiceTitle = '';
        if (type === 'daily' && date) {
          invoiceTitle = `Tagesrechnung vom ${date.toLocaleDateString('de-DE')}`;
        } else if (type === 'monthly' && date) {
          invoiceTitle = `Monatsrechnung ${date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}`;
        } else {
          invoiceTitle = `Rechnung für Auftrag${customerJobs.length > 1 ? 'e' : ''}: ${customerJobs.map(j => j.title).join(', ')}`;
        }

        const paymentDays = company.defaultPaymentDays !== undefined ? company.defaultPaymentDays : 30;
        const issueDate = date || new Date(); // Use provided date or current date
        const dueDate = new Date(issueDate.getTime() + paymentDays * 24 * 60 * 60 * 1000);
        
        const newInvoice = {
          invoiceNumber: '', // Will be set by backend
          customerId: customer.id,
          customerName: customer.name,
          issueDate: issueDate,
          dueDate: dueDate,
          items,
          subtotal,
          taxAmount,
          total,
          status: 'draft' as const,
          notes: invoiceTitle
        };

        await addInvoice(newInvoice);

        // Mark jobs as invoiced
        for (const job of customerJobs) {
          await updateJobEntry(job.id, { status: 'invoiced' });
        }
      }
    } catch (error) {
      logger.error('Error generating invoice from jobs:', error);
    }
  };

  const updateCompany = async (companyData: Partial<Company>) => {
    try {
      const updatedCompany = await apiService.updateCompany(companyData);
      setCompany(updatedCompany);
    } catch (error) {
      logger.error('Error updating company:', error);
      // Fallback to localStorage behavior
      const newCompany = { ...company, ...companyData };
      setCompany(newCompany);
      localStorage.setItem('invoice-app-company', JSON.stringify(newCompany));
    }
  };

  const getHourlyRates = () => {
    return hourlyRates;
  };

  const getHourlyRatesForCustomer = (customerId?: string) => {
    if (!customerId) {
      return hourlyRates; // Return all standard rates if no customer is selected
    }
    
    const customer = customers.find(c => c.id === customerId);
    
    // If customer has specific hourly rates, return only those
    if (customer && customer.hourlyRates && customer.hourlyRates.length > 0) {
      return customer.hourlyRates;
    }
    
    // Otherwise return all standard rates
    return hourlyRates;
  };

  const getMaterialTemplatesForCustomer = (customerId?: string) => {
    if (!customerId) {
      return materialTemplates; // Return all standard materials if no customer is selected
    }
    
    const customer = customers.find(c => c.id === customerId);
    
    // If customer has specific materials, return only those
    if (customer && customer.materials && customer.materials.length > 0) {
      return customer.materials;
    }
    
    // Otherwise return all standard materials
    return materialTemplates;
  };

  // New function to get combined hourly rates for display in dropdowns
  const getCombinedHourlyRatesForCustomer = (customerId?: string) => {
    // If combined dropdowns are disabled, return the original behavior
    if (company.showCombinedDropdowns === false) {
      // Original logic: customer-specific rates have priority, otherwise general rates
      const originalRates = getHourlyRatesForCustomer(customerId);
      return originalRates.map(rate => ({
        ...rate,
        displayName: rate.name,
        isGeneral: !customerId || !customers.find(c => c.id === customerId)?.hourlyRates?.some(hr => hr.id === rate.id),
        isCustomerSpecific: customerId && customers.find(c => c.id === customerId)?.hourlyRates?.some(hr => hr.id === rate.id)
      }));
    }

    const rates = [];
    
    // Add general rates with marking
    hourlyRates.forEach(rate => {
      rates.push({
        ...rate,
        displayName: `${rate.name} (Allgemein)`,
        isGeneral: true,
        isCustomerSpecific: false
      });
    });
    
    // Add customer-specific rates with marking
    if (customerId) {
      const customer = customers.find(c => c.id === customerId);
      if (customer && customer.hourlyRates && customer.hourlyRates.length > 0) {
        customer.hourlyRates.forEach(rate => {
          rates.push({
            ...rate,
            displayName: `${rate.name} (Kundenspezifisch)`,
            isGeneral: false,
            isCustomerSpecific: true
          });
        });
      }
    }
    
    return rates;
  };

  // New function to get combined material templates for display in dropdowns
  const getCombinedMaterialTemplatesForCustomer = (customerId?: string) => {
    // If combined dropdowns are disabled, return the original behavior
    if (company.showCombinedDropdowns === false) {
      // Original logic: customer-specific materials have priority, otherwise general materials
      const originalMaterials = getMaterialTemplatesForCustomer(customerId);
      return originalMaterials.map(material => ({
        ...material,
        displayName: material.name,
        isGeneral: !customerId || !customers.find(c => c.id === customerId)?.materials?.some(m => m.id === material.id),
        isCustomerSpecific: customerId && customers.find(c => c.id === customerId)?.materials?.some(m => m.id === material.id)
      }));
    }

    const materials = [];
    
    // Add general materials with marking
    materialTemplates.forEach(material => {
      materials.push({
        ...material,
        displayName: `${material.name} (Allgemein)`,
        isGeneral: true,
        isCustomerSpecific: false
      });
    });
    
    // Add customer-specific materials with marking
    if (customerId) {
      const customer = customers.find(c => c.id === customerId);
      if (customer && customer.materials && customer.materials.length > 0) {
        customer.materials.forEach(material => {
          materials.push({
            ...material,
            displayName: `${material.name} (Kundenspezifisch)`,
            isGeneral: false,
            isCustomerSpecific: true
          });
        });
      }
    }
    
    return materials;
  };

  // Material Template Management Functions
  const addMaterialTemplate = async (templateData: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const newTemplate = await apiService.createMaterialTemplate(templateData);
      setMaterialTemplates(prev => [...prev, newTemplate]);
    } catch (error) {
      logger.error('Error adding material template:', error);
    }
  };

  const updateMaterialTemplate = async (id: string, templateData: Partial<MaterialTemplate>) => {
    try {
      const updatedTemplate = await apiService.updateMaterialTemplate(id, templateData);
      setMaterialTemplates(prev => prev.map(template => 
        template.id === id ? updatedTemplate : template
      ));
    } catch (error) {
      logger.error('Error updating material template:', error);
    }
  };

  const deleteMaterialTemplate = async (id: string) => {
    try {
      await apiService.deleteMaterialTemplate(id);
      setMaterialTemplates(prev => prev.filter(template => template.id !== id));
    } catch (error) {
      logger.error('Error deleting material template:', error);
    }
  };

  const getMaterialTemplates = () => {
    return materialTemplates;
  };

  // Invoice Template Management Functions
  const addInvoiceTemplate = async (templateData: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newTemplate: InvoiceTemplate = {
      id: generateUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...templateData
    };

    const updatedInvoiceTemplates = [...(company.invoiceTemplates || []), newTemplate];
    
    try {
      await updateCompany({
        invoiceTemplates: updatedInvoiceTemplates
      });
    } catch (error) {
      logger.error('Error adding invoice template:', error);
      throw error;
    }
  };

  const updateInvoiceTemplate = async (id: string, templateData: Partial<InvoiceTemplate>) => {
    const updatedInvoiceTemplates = (company.invoiceTemplates || []).map(template => 
      template.id === id 
        ? { ...template, ...templateData, updatedAt: new Date() }
        : template
    );

    try {
      await updateCompany({
        invoiceTemplates: updatedInvoiceTemplates
      });
    } catch (error) {
      logger.error('Error updating invoice template:', error);
      throw error;
    }
  };

  const deleteInvoiceTemplate = async (id: string) => {
    const updatedInvoiceTemplates = (company.invoiceTemplates || []).filter(template => template.id !== id);
    
    try {
      await updateCompany({
        invoiceTemplates: updatedInvoiceTemplates
      });
    } catch (error) {
      logger.error('Error deleting invoice template:', error);
      throw error;
    }
  };

  const getInvoiceTemplates = () => {
    return company.invoiceTemplates || [];
  };

  const addHourlyRate = async (hourlyRateData: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>) => {
    try {
      const newRate = await apiService.createHourlyRate(hourlyRateData);
      setHourlyRates(prev => [...prev, newRate]);
    } catch (error) {
      logger.error('Error adding hourly rate:', error);
    }
  };

  const updateHourlyRate = async (id: string, hourlyRateData: Partial<HourlyRate>) => {
    try {
      const updatedRate = await apiService.updateHourlyRate(id, hourlyRateData);
      setHourlyRates(prev => prev.map(rate => 
        rate.id === id ? updatedRate : rate
      ));
    } catch (error) {
      logger.error('Error updating hourly rate:', error);
    }
  };

  const deleteHourlyRate = async (id: string) => {
    try {
      await apiService.deleteHourlyRate(id);
      setHourlyRates(prev => prev.filter(rate => rate.id !== id));
    } catch (error) {
      logger.error('Error deleting hourly rate:', error);
    }
  };

  return (
    <AppContext.Provider value={{
      customers,
      invoices,
      quotes,
      jobEntries,
      company,
      materialTemplates,
      hourlyRates,
      loading,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      refreshCustomers,
      addInvoice,
      updateInvoice,
      deleteInvoice,
      refreshInvoices,
      addQuote,
      updateQuote,
      deleteQuote,
      refreshQuotes,
      addJobEntry,
      updateJobEntry,
      deleteJobEntry,
      refreshJobEntries,
      addJobSignature,
      generateInvoiceFromJobs,
      updateCompany,
      addHourlyRate,
      updateHourlyRate,
      deleteHourlyRate,
      getHourlyRates,
      getHourlyRatesForCustomer,
      getMaterialTemplatesForCustomer,
      getCombinedHourlyRatesForCustomer,
      getCombinedMaterialTemplatesForCustomer,
      addMaterialTemplate,
      updateMaterialTemplate,
      deleteMaterialTemplate,
      getMaterialTemplates,
      addInvoiceTemplate,
      updateInvoiceTemplate,
      deleteInvoiceTemplate,
      getInvoiceTemplates,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}