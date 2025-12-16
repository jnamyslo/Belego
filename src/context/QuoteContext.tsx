import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { Quote } from '../types';
import { apiService } from '../services/api';
import logger from '../utils/logger';

// ============================================================================
// Types
// ============================================================================

interface QuoteContextType {
  quotes: Quote[];
  setQuotes: React.Dispatch<React.SetStateAction<Quote[]>>;
  addQuote: (quote: Omit<Quote, 'id' | 'createdAt'>) => Promise<Quote>;
  updateQuote: (id: string, quote: Partial<Quote>) => Promise<void>;
  deleteQuote: (id: string) => Promise<void>;
  refreshQuotes: () => Promise<void>;
  getQuoteById: (id: string) => Quote | undefined;
}

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
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes);

  const getQuoteById = useCallback((id: string): Quote | undefined => {
    return quotes.find(q => q.id === id);
  }, [quotes]);

  const addQuote = useCallback(async (quoteData: Omit<Quote, 'id' | 'createdAt'>): Promise<Quote> => {
    try {
      const newQuote = await apiService.createQuote(quoteData);
      setQuotes(prev => [...prev, newQuote]);
      return newQuote;
    } catch (error) {
      logger.error('Error adding quote:', error);
      throw error;
    }
  }, []);

  const updateQuote = useCallback(async (id: string, quoteData: Partial<Quote>): Promise<void> => {
    try {
      const updatedQuote = await apiService.updateQuote(id, quoteData);
      setQuotes(prev => prev.map(quote =>
        quote.id === id ? updatedQuote : quote
      ));
    } catch (error) {
      logger.error('Error updating quote:', error);
      throw error;
    }
  }, []);

  const deleteQuote = useCallback(async (id: string): Promise<void> => {
    try {
      await apiService.deleteQuote(id);
      setQuotes(prev => prev.filter(quote => quote.id !== id));
    } catch (error) {
      logger.error('Error deleting quote:', error);
      throw error;
    }
  }, []);

  const refreshQuotes = useCallback(async (): Promise<void> => {
    try {
      const quotesData = await apiService.getQuotes();
      setQuotes(quotesData);
    } catch (error) {
      logger.error('Error refreshing quotes:', error);
    }
  }, []);

  const value: QuoteContextType = {
    quotes,
    setQuotes,
    addQuote,
    updateQuote,
    deleteQuote,
    refreshQuotes,
    getQuoteById,
  };

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

