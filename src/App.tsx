import React, { useState, useEffect } from 'react';
import { AppProvider, useLoading } from './context/AppContext';
import { Layout } from './components/Layout';
import { Dashboard } from './components/Dashboard';
import { CustomerManagement } from './components/CustomerManagement';
import { InvoiceManagement } from './components/InvoiceManagement';
import { QuoteManagement } from './components/QuoteManagement';
import { QuoteEditor } from './components/QuoteEditor';
import { Settings } from './components/Settings';
import { JobManagement } from './components/JobManagement';
import { Calendar } from './components/Calendar';
import { ReportingManagement } from './components/ReportingManagement';
import { ReminderManagement } from './components/ReminderManagement';
import { DynamicColors } from './components/DynamicColors';
import { useCompany } from './context/CompanyContext';
import { useQuotes } from './context/QuoteContext';

interface PageState {
  page: string;
  filter?: string;
  searchTerm?: string;
  quoteId?: string;
}

function App() {
  const [currentPageState, setCurrentPageState] = useState<PageState>(() => {
    // Initialize from URL hash
    const hash = window.location.hash.slice(1); // Remove #
    if (hash) {
      const [page, filter, searchTerm] = hash.split('/');
      return { page: page || 'dashboard', filter, searchTerm, quoteId: filter };
    }
    return { page: 'dashboard' };
  });

  const handlePageChange = (page: string, filter?: string, searchTerm?: string) => {
    const newState = { page, filter, searchTerm, quoteId: page === 'quote-editor' ? filter : undefined };
    setCurrentPageState(newState);
    
    // Update URL hash
    let hash = page;
    if (filter) hash += `/${filter}`;
    if (searchTerm) hash += `/${searchTerm}`;
    window.location.hash = hash;
  };

  // Listen to browser back/forward buttons
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (hash) {
        const [page, filter, searchTerm] = hash.split('/');
        setCurrentPageState({ 
          page: page || 'dashboard', 
          filter, 
          searchTerm,
          quoteId: page === 'quote-editor' ? filter : undefined 
        });
      } else {
        setCurrentPageState({ page: 'dashboard' });
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <AppProvider>
      <AppContent currentPageState={currentPageState} handlePageChange={handlePageChange} />
    </AppProvider>
  );
}

interface AppContentProps {
  currentPageState: PageState;
  handlePageChange: (page: string, filter?: string, searchTerm?: string) => void;
}

function AppContent({ currentPageState, handlePageChange }: AppContentProps) {
  const { loading } = useLoading();
  const { company } = useCompany();
  const { quotes } = useQuotes();

  // Redirect to settings when the current page's module is disabled.
  // Done as an effect (not during render) to avoid updating state while rendering.
  useEffect(() => {
    const isDisabled =
      ((currentPageState.page === 'jobs' || currentPageState.page === 'calendar') && !company.jobTrackingEnabled) ||
      ((currentPageState.page === 'quotes' || currentPageState.page === 'quote-editor') && !company.quotesEnabled) ||
      (currentPageState.page === 'reporting' && !company.reportingEnabled) ||
      (currentPageState.page === 'reminders' && !company.remindersEnabled);

    if (isDisabled) {
      handlePageChange('settings');
    }
  }, [
    currentPageState.page,
    company.jobTrackingEnabled,
    company.quotesEnabled,
    company.reportingEnabled,
    company.remindersEnabled,
    handlePageChange,
  ]);

  const renderPage = () => {
    // Show loading state while data is being fetched
    if (loading) {
      return (
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Lade Daten...</p>
          </div>
        </div>
      );
    }

    switch (currentPageState.page) {
      case 'dashboard':
        return <Dashboard onNavigate={handlePageChange} />;
      case 'customers':
        return <CustomerManagement />;
      case 'jobs':
        // Disabled if job tracking is not enabled; effect above redirects to settings
        if (!company.jobTrackingEnabled) {
          return null;
        }
        return <JobManagement onNavigate={handlePageChange} />;
      case 'calendar':
        // Disabled if job tracking is not enabled; effect above redirects to settings
        if (!company.jobTrackingEnabled) {
          return null;
        }
        return <Calendar onNavigate={handlePageChange} />;
      case 'invoices':
        return <InvoiceManagement initialFilter={currentPageState.filter} initialSearchTerm={currentPageState.searchTerm} onNavigate={handlePageChange} />;
      case 'quotes':
        // Disabled if quotes module is not enabled; effect above redirects to settings
        if (!company.quotesEnabled) {
          return null;
        }
        return <QuoteManagement onNavigate={handlePageChange} />;
      case 'quote-editor': {
        // Disabled if quotes module is not enabled; effect above redirects to settings
        if (!company.quotesEnabled) {
          return null;
        }
        const quoteToEdit = currentPageState.quoteId
          ? quotes.find(q => q.id === currentPageState.quoteId) || null
          : null;
        return <QuoteEditor
          quote={quoteToEdit}
          onClose={() => handlePageChange('quotes')}
          onNavigateToCustomers={() => handlePageChange('customers')}
          onNavigateToSettings={() => handlePageChange('settings')}
        />;
      }
      case 'reporting':
        // Disabled if reporting is not enabled; effect above redirects to settings
        if (!company.reportingEnabled) {
          return null;
        }
        return <ReportingManagement />;
      case 'reminders':
        // Disabled if reminders module is not enabled; effect above redirects to settings
        if (!company.remindersEnabled) {
          return null;
        }
        return <ReminderManagement />;
      case 'settings':
        return <Settings />;
      default:
        return <Dashboard onNavigate={handlePageChange} />;
    }
  };

  return (
    <>
      <DynamicColors />
      <Layout currentPage={currentPageState.page} onPageChange={(page) => handlePageChange(page)}>
        {renderPage()}
      </Layout>
    </>
  );
}

export default App;