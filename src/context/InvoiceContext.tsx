import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { Invoice } from '../types';
import { apiService } from '../services/api';
import { useCrudResource, CrudApi } from '../hooks/useCrudResource';

// ============================================================================
// Types
// ============================================================================

type InvoiceCreate = Omit<Invoice, 'id' | 'createdAt'>;

interface InvoiceContextType {
  invoices: Invoice[];
  setInvoices: React.Dispatch<React.SetStateAction<Invoice[]>>;
  addInvoice: (invoice: InvoiceCreate) => Promise<Invoice>;
  updateInvoice: (id: string, invoice: Partial<Invoice>) => Promise<void>;
  deleteInvoice: (id: string) => Promise<void>;
  refreshInvoices: () => Promise<void>;
  getInvoiceById: (id: string) => Invoice | undefined;
}

// ============================================================================
// API-Bindung (Modulebene — stabile Identität für useCrudResource)
// ============================================================================

const invoiceApi: CrudApi<Invoice, InvoiceCreate> = {
  list: () => apiService.getInvoices(),
  create: (data) => apiService.createInvoice(data),
  update: (id, data) => apiService.updateInvoice(id, data),
  remove: (id) => apiService.deleteInvoice(id),
};

// ============================================================================
// Context
// ============================================================================

const InvoiceContext = createContext<InvoiceContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface InvoiceProviderProps {
  children: ReactNode;
  initialInvoices?: Invoice[];
}

export function InvoiceProvider({ children, initialInvoices = [] }: InvoiceProviderProps) {
  const resource = useCrudResource<Invoice, InvoiceCreate>('invoice', invoiceApi, initialInvoices);

  const value: InvoiceContextType = useMemo(() => ({
    invoices: resource.items,
    setInvoices: resource.setItems,
    addInvoice: resource.add,
    updateInvoice: resource.update,
    deleteInvoice: resource.remove,
    refreshInvoices: resource.refresh,
    getInvoiceById: resource.getById,
  }), [resource]);

  return (
    <InvoiceContext.Provider value={value}>
      {children}
    </InvoiceContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useInvoices(): InvoiceContextType {
  const context = useContext(InvoiceContext);
  if (context === undefined) {
    throw new Error('useInvoices must be used within an InvoiceProvider');
  }
  return context;
}
