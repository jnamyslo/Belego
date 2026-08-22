import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { Customer, HourlyRate, MaterialTemplate } from '../types';
import { apiService } from '../services/api';
import { useCrudResource, CrudApi } from '../hooks/useCrudResource';

// ============================================================================
// Types
// ============================================================================

type CustomerCreate = Omit<Customer, 'id' | 'customerNumber' | 'createdAt'>;

interface CustomerContextType {
  customers: Customer[];
  setCustomers: React.Dispatch<React.SetStateAction<Customer[]>>;
  addCustomer: (customer: CustomerCreate) => Promise<Customer>;
  updateCustomer: (id: string, customer: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  refreshCustomers: () => Promise<void>;
  getCustomerById: (id: string) => Customer | undefined;
}

// ============================================================================
// API-Bindung (Modulebene — stabile Identität für useCrudResource)
// ============================================================================

const customerApi: CrudApi<Customer, CustomerCreate> = {
  list: () => apiService.getCustomers(),
  create: (data) => apiService.createCustomer(data),
  update: (id, data) => apiService.updateCustomer(id, data),
  remove: (id) => apiService.deleteCustomer(id),
};

// ============================================================================
// Context
// ============================================================================

const CustomerContext = createContext<CustomerContextType | undefined>(undefined);

// ============================================================================
// Provider
// ============================================================================

interface CustomerProviderProps {
  children: ReactNode;
  initialCustomers?: Customer[];
}

export function CustomerProvider({ children, initialCustomers = [] }: CustomerProviderProps) {
  const resource = useCrudResource<Customer, CustomerCreate>('customer', customerApi, initialCustomers);

  const value: CustomerContextType = useMemo(() => ({
    customers: resource.items,
    setCustomers: resource.setItems,
    addCustomer: resource.add,
    updateCustomer: resource.update,
    deleteCustomer: resource.remove,
    refreshCustomers: resource.refresh,
    getCustomerById: resource.getById,
  }), [resource]);

  return (
    <CustomerContext.Provider value={value}>
      {children}
    </CustomerContext.Provider>
  );
}

// ============================================================================
// Hook
// ============================================================================

export function useCustomers(): CustomerContextType {
  const context = useContext(CustomerContext);
  if (context === undefined) {
    throw new Error('useCustomers must be used within a CustomerProvider');
  }
  return context;
}

// ============================================================================
// Customer Rate/Material Utilities
// ============================================================================

export function getHourlyRatesForCustomer(
  customers: Customer[],
  hourlyRates: HourlyRate[],
  customerId?: string
): HourlyRate[] {
  if (!customerId) {
    return hourlyRates;
  }

  const customer = customers.find(c => c.id === customerId);

  // If customer has specific hourly rates, return only those
  if (customer?.hourlyRates && customer.hourlyRates.length > 0) {
    return customer.hourlyRates;
  }

  return hourlyRates;
}

export function getMaterialTemplatesForCustomer(
  customers: Customer[],
  materialTemplates: MaterialTemplate[],
  customerId?: string
): MaterialTemplate[] {
  if (!customerId) {
    return materialTemplates;
  }

  const customer = customers.find(c => c.id === customerId);

  // If customer has specific materials, return only those
  if (customer?.materials && customer.materials.length > 0) {
    return customer.materials;
  }

  return materialTemplates;
}

interface CombinedRate extends HourlyRate {
  displayName: string;
  isGeneral: boolean;
  isCustomerSpecific: boolean;
}

interface CombinedMaterial extends MaterialTemplate {
  displayName: string;
  isGeneral: boolean;
  isCustomerSpecific: boolean;
}

export function getCombinedHourlyRatesForCustomer(
  customers: Customer[],
  hourlyRates: HourlyRate[],
  showCombinedDropdowns: boolean,
  customerId?: string
): CombinedRate[] {
  // If combined dropdowns are disabled, return the original behavior
  if (!showCombinedDropdowns) {
    const originalRates = getHourlyRatesForCustomer(customers, hourlyRates, customerId);
    const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
    return originalRates.map(rate => ({
      ...rate,
      displayName: rate.name,
      isGeneral: !customerId || !customer?.hourlyRates?.some(hr => hr.id === rate.id),
      isCustomerSpecific: !!(customerId && customer?.hourlyRates?.some(hr => hr.id === rate.id)),
    }));
  }

  const rates: CombinedRate[] = [];

  // Add general rates with marking
  hourlyRates.forEach(rate => {
    rates.push({
      ...rate,
      displayName: `${rate.name} (Allgemein)`,
      isGeneral: true,
      isCustomerSpecific: false,
    });
  });

  // Add customer-specific rates with marking
  if (customerId) {
    const customer = customers.find(c => c.id === customerId);
    if (customer?.hourlyRates && customer.hourlyRates.length > 0) {
      customer.hourlyRates.forEach(rate => {
        rates.push({
          ...rate,
          displayName: `${rate.name} (Kundenspezifisch)`,
          isGeneral: false,
          isCustomerSpecific: true,
        });
      });
    }
  }

  return rates;
}

export function getCombinedMaterialTemplatesForCustomer(
  customers: Customer[],
  materialTemplates: MaterialTemplate[],
  showCombinedDropdowns: boolean,
  customerId?: string
): CombinedMaterial[] {
  // If combined dropdowns are disabled, return the original behavior
  if (!showCombinedDropdowns) {
    const originalMaterials = getMaterialTemplatesForCustomer(customers, materialTemplates, customerId);
    const customer = customerId ? customers.find(c => c.id === customerId) : undefined;
    return originalMaterials.map(material => ({
      ...material,
      displayName: material.name,
      isGeneral: !customerId || !customer?.materials?.some(m => m.id === material.id),
      isCustomerSpecific: !!(customerId && customer?.materials?.some(m => m.id === material.id)),
    }));
  }

  const materials: CombinedMaterial[] = [];

  // Add general materials with marking
  materialTemplates.forEach(material => {
    materials.push({
      ...material,
      displayName: `${material.name} (Allgemein)`,
      isGeneral: true,
      isCustomerSpecific: false,
    });
  });

  // Add customer-specific materials with marking
  if (customerId) {
    const customer = customers.find(c => c.id === customerId);
    if (customer?.materials && customer.materials.length > 0) {
      customer.materials.forEach(material => {
        materials.push({
          ...material,
          displayName: `${material.name} (Kundenspezifisch)`,
          isGeneral: false,
          isCustomerSpecific: true,
        });
      });
    }
  }

  return materials;
}

