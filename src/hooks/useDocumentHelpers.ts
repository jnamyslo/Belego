import {
  useCustomers,
  getCombinedHourlyRatesForCustomer,
  getCombinedMaterialTemplatesForCustomer,
  getHourlyRatesForCustomer,
  getMaterialTemplatesForCustomer,
} from '../context/CustomerContext';
import { useCompany } from '../context/CompanyContext';

/**
 * Bindet die Stundensatz-/Material-Auflösung an die Contexts, aus denen sie ihre
 * Daten zieht: die Logik liegt im CustomerContext, die Firmenvorlagen und das
 * Flag `showCombinedDropdowns` im CompanyContext. Aufrufer brauchen dadurch nur
 * die Kunden-ID zu übergeben.
 */
export function useDocumentHelpers() {
  const { customers } = useCustomers();
  const companyCtx = useCompany();

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
  };
}
