import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { Company, HourlyRate, MaterialTemplate, InvoiceTemplate } from '../types';
import { apiService } from '../services/api';
import { generateUUID } from '../utils/uuid';
import { updateFavicon, updatePageTitle } from '../utils/faviconUtils';
import logger from '../utils/logger';

// ============================================================================
// Default Values
// ============================================================================

export const defaultCompany: Company = {
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
  reportingEnabled: true,
  defaultPaymentDays: 30,
  immediatePaymentClause: 'Rechnung ist per sofort fällig, ohne Abzug',
  invoiceStartNumber: 1,
  showCombinedDropdowns: false,
  isSmallBusiness: false,
  hourlyRates: [
    {
      id: '1',
      name: 'Standard',
      description: 'Normale Arbeitszeit',
      rate: 75.0,
      isDefault: true,
    },
    {
      id: '2',
      name: 'Anfahrt',
      description: 'Anfahrtszeit zum Kunden',
      rate: 50.0,
      isDefault: false,
    },
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
      updatedAt: new Date(),
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
      updatedAt: new Date(),
    },
  ],
};

// ============================================================================
// Types
// ============================================================================

interface CompanyContextType {
  company: Company;
  setCompany: React.Dispatch<React.SetStateAction<Company>>;
  updateCompany: (company: Partial<Company>) => Promise<void>;
  // Hourly Rates
  hourlyRates: HourlyRate[];
  setHourlyRates: React.Dispatch<React.SetStateAction<HourlyRate[]>>;
  addHourlyRate: (rate: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateHourlyRate: (id: string, rate: Partial<HourlyRate>) => Promise<void>;
  deleteHourlyRate: (id: string) => Promise<void>;
  getHourlyRates: () => HourlyRate[];
  // Material Templates
  materialTemplates: MaterialTemplate[];
  setMaterialTemplates: React.Dispatch<React.SetStateAction<MaterialTemplate[]>>;
  addMaterialTemplate: (template: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateMaterialTemplate: (id: string, template: Partial<MaterialTemplate>) => Promise<void>;
  deleteMaterialTemplate: (id: string) => Promise<void>;
  getMaterialTemplates: () => MaterialTemplate[];
  // Invoice Templates
  addInvoiceTemplate: (template: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateInvoiceTemplate: (id: string, template: Partial<InvoiceTemplate>) => Promise<void>;
  deleteInvoiceTemplate: (id: string) => Promise<void>;
  getInvoiceTemplates: () => InvoiceTemplate[];
}

// ============================================================================
// Context
// ============================================================================

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface CompanyProviderProps {
  children: ReactNode;
  initialCompany?: Company;
  initialHourlyRates?: HourlyRate[];
  initialMaterialTemplates?: MaterialTemplate[];
  loading?: boolean;
}

export function CompanyProvider({
  children,
  initialCompany = defaultCompany,
  initialHourlyRates = [],
  initialMaterialTemplates = [],
  loading = false,
}: CompanyProviderProps) {
  const [company, setCompany] = useState<Company>(initialCompany);
  const [hourlyRates, setHourlyRates] = useState<HourlyRate[]>(initialHourlyRates);
  const [materialTemplates, setMaterialTemplates] = useState<MaterialTemplate[]>(initialMaterialTemplates);

  // Update favicon and page title when company data changes
  useEffect(() => {
    if (!loading) {
      updateFavicon(company.icon || null);
      updatePageTitle(company.name);
    }
  }, [company.icon, company.name, loading]);

  // --------------------------------------------------------------------------
  // Company Methods
  // --------------------------------------------------------------------------

  const updateCompanyData = useCallback(async (companyData: Partial<Company>): Promise<void> => {
    try {
      const updatedCompany = await apiService.updateCompany(companyData);
      setCompany(updatedCompany);
    } catch (error) {
      logger.error('Error updating company:', error);
      // Fallback: Update locally
      setCompany(prev => ({ ...prev, ...companyData }));
    }
  }, []);

  // --------------------------------------------------------------------------
  // Hourly Rate Methods
  // --------------------------------------------------------------------------

  const addHourlyRate = useCallback(async (hourlyRateData: Omit<HourlyRate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    try {
      const newRate = await apiService.createHourlyRate(hourlyRateData);
      setHourlyRates(prev => [...prev, newRate]);
    } catch (error) {
      logger.error('Error adding hourly rate:', error);
    }
  }, []);

  const updateHourlyRateData = useCallback(async (id: string, hourlyRateData: Partial<HourlyRate>): Promise<void> => {
    try {
      const updatedRate = await apiService.updateHourlyRate(id, hourlyRateData);
      setHourlyRates(prev => prev.map(rate =>
        rate.id === id ? updatedRate : rate
      ));
    } catch (error) {
      logger.error('Error updating hourly rate:', error);
    }
  }, []);

  const deleteHourlyRateData = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteHourlyRate(id);
      setHourlyRates(prev => prev.filter(rate => rate.id !== id));
    } catch (error) {
      logger.error('Error deleting hourly rate:', error);
    }
  }, []);

  const getHourlyRates = useCallback((): HourlyRate[] => {
    return hourlyRates;
  }, [hourlyRates]);

  // --------------------------------------------------------------------------
  // Material Template Methods
  // --------------------------------------------------------------------------

  const addMaterialTemplate = useCallback(async (templateData: Omit<MaterialTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    try {
      const newTemplate = await apiService.createMaterialTemplate(templateData);
      setMaterialTemplates(prev => [...prev, newTemplate]);
    } catch (error) {
      logger.error('Error adding material template:', error);
    }
  }, []);

  const updateMaterialTemplateData = useCallback(async (id: string, templateData: Partial<MaterialTemplate>): Promise<void> => {
    try {
      const updatedTemplate = await apiService.updateMaterialTemplate(id, templateData);
      setMaterialTemplates(prev => prev.map(template =>
        template.id === id ? updatedTemplate : template
      ));
    } catch (error) {
      logger.error('Error updating material template:', error);
    }
  }, []);

  const deleteMaterialTemplateData = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteMaterialTemplate(id);
      setMaterialTemplates(prev => prev.filter(template => template.id !== id));
    } catch (error) {
      logger.error('Error deleting material template:', error);
    }
  }, []);

  const getMaterialTemplates = useCallback((): MaterialTemplate[] => {
    return materialTemplates;
  }, [materialTemplates]);

  // --------------------------------------------------------------------------
  // Invoice Template Methods
  // --------------------------------------------------------------------------

  const addInvoiceTemplate = useCallback(async (templateData: Omit<InvoiceTemplate, 'id' | 'createdAt' | 'updatedAt'>): Promise<void> => {
    const newTemplate: InvoiceTemplate = {
      id: generateUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...templateData,
    };

    const updatedInvoiceTemplates = [...(company.invoiceTemplates || []), newTemplate];

    try {
      await updateCompanyData({ invoiceTemplates: updatedInvoiceTemplates });
    } catch (error) {
      logger.error('Error adding invoice template:', error);
      throw error;
    }
  }, [company.invoiceTemplates, updateCompanyData]);

  const updateInvoiceTemplateData = useCallback(async (id: string, templateData: Partial<InvoiceTemplate>): Promise<void> => {
    const updatedInvoiceTemplates = (company.invoiceTemplates || []).map(template =>
      template.id === id
        ? { ...template, ...templateData, updatedAt: new Date() }
        : template
    );

    try {
      await updateCompanyData({ invoiceTemplates: updatedInvoiceTemplates });
    } catch (error) {
      logger.error('Error updating invoice template:', error);
      throw error;
    }
  }, [company.invoiceTemplates, updateCompanyData]);

  const deleteInvoiceTemplateData = useCallback(async (id: string): Promise<void> => {
    const updatedInvoiceTemplates = (company.invoiceTemplates || []).filter(template => template.id !== id);

    try {
      await updateCompanyData({ invoiceTemplates: updatedInvoiceTemplates });
    } catch (error) {
      logger.error('Error deleting invoice template:', error);
      throw error;
    }
  }, [company.invoiceTemplates, updateCompanyData]);

  const getInvoiceTemplates = useCallback((): InvoiceTemplate[] => {
    return company.invoiceTemplates || [];
  }, [company.invoiceTemplates]);

  const value: CompanyContextType = {
    company,
    setCompany,
    updateCompany: updateCompanyData,
    hourlyRates,
    setHourlyRates,
    addHourlyRate,
    updateHourlyRate: updateHourlyRateData,
    deleteHourlyRate: deleteHourlyRateData,
    getHourlyRates,
    materialTemplates,
    setMaterialTemplates,
    addMaterialTemplate,
    updateMaterialTemplate: updateMaterialTemplateData,
    deleteMaterialTemplate: deleteMaterialTemplateData,
    getMaterialTemplates,
    addInvoiceTemplate,
    updateInvoiceTemplate: updateInvoiceTemplateData,
    deleteInvoiceTemplate: deleteInvoiceTemplateData,
    getInvoiceTemplates,
  };

  return (
    <CompanyContext.Provider value={value}>
      {children}
    </CompanyContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useCompany(): CompanyContextType {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompany must be used within a CompanyProvider');
  }
  return context;
}

