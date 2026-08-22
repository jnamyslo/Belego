import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { Quote } from '../types';
import { apiService } from '../services/api';
import { useCrudResource, CrudApi } from '../hooks/useCrudResource';

// ============================================================================
// Types
// ============================================================================

type QuoteCreate = Omit<Quote, 'id' | 'createdAt'>;

interface QuoteContextType {
  quotes: Quote[];
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  addQuote: (quote: QuoteCreate) => Promise<Quote>;
  updateQuote: (id: string, quote: Partial<Quote>) => Promise<void>;
  deleteQuote: (id: string) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  getQuoteById: (id: string) => Quote | undefined;
}

// ============================================================================
// API-Bindung (Modulebene — stabile Identität für useCrudResource)
// ============================================================================

const quoteApi: CrudApi<Quote, QuoteCreate> = {
  list: () => apiService.getQuotes(),
  create: (data) => apiService.createQuote(data),
  update: (id, data) => apiService.updateQuote(id, data),
  remove: (id) => apiService.deleteQuote(id),
};

// ============================================================================
// Context
// ============================================================================

const QuoteContext = createContext<QuoteContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface QuoteProviderProps {
  children: ReactNode;
  initialQuotes?: Quote[];
}

export function QuoteProvider({ children, initialQuotes = [] }: QuoteProviderProps) {
  const resource = useCrudResource<Quote, QuoteCreate>('quote', quoteApi, initialQuotes);

  const value: QuoteContextType = useMemo(() => ({
    quotes: resource.items,
    setQuotes: resource.setItems,
    addQuote: resource.add,
    updateQuote: resource.update,
    deleteQuote: resource.remove,
    refreshQuotes: resource.refresh,
    getQuoteById: resource.getById,
  }), [resource]);

  return (
    <QuoteContext.Provider value={value}>
      {children}
    </QuoteContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useQuotes(): QuoteContextType {
  const context = useContext(QuoteContext);
  if (context === undefined) {
    throw new Error('useQuotes must be used within a QuoteProvider');
  }
  return context;
}
