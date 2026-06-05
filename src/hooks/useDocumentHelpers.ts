import {
  useCustomers,
  getCombinedHourlyRatesForCustomer,
  getCombinedMaterialTemplatesForCustomer,
  getHourlyRatesForCustomer,
  getMaterialTemplatesForCustomer,
} from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';
import { useInvoices } from '../context/InvoiceContext';
import { useJobs, generateInvoiceFromJobs } from '../context/JobContext';

export function useDocumentHelpers() {
  const { customers } = useCustomers();
  const companyCtx = useCompany();
  const { addInvoice } = useInvoices();
  const { jobEntries, updateJobEntry } = useJobs();

  return {
    getHourlyRatesForCustomer: (customerId?: string) =>
      getHourlyRatesForCustomer(customers, companyCtx.hourlyRates, customerId),

    getMaterialTemplatesForCustomer: (customerId?: string) =>
      getMaterialTemplatesForCustomer(customers, companyCtx.materialTemplates, customerId),

    getCombinedHourlyRatesForCustomer: (customerId?: string) =>
      getCombinedHourlyRatesForCustomer(
        customers,
        companyCtx.hourlyRates,
        companyCtx.company.showCombinedDropdowns ?? false,
        customerId
      ),

    getCombinedMaterialTemplatesForCustomer: (customerId?: string) =>
      getCombinedMaterialTemplatesForCustomer(
        customers,
        companyCtx.materialTemplates,
        companyCtx.company.showCombinedDropdowns ?? false,
        customerId
      ),

    generateInvoiceFromJobs: async (
      jobIds: string[],
      type: 'single' | 'daily' | 'monthly',
      date?: Date
    ) => {
      await generateInvoiceFromJobs(
        jobIds,
        type,
        jobEntries,
        customers,
        companyCtx.company,
        addInvoice,
        updateJobEntry,
        date
      );
    },
  };
}
