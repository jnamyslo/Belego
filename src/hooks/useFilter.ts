import { useState, useMemo, useCallback } from 'react';

type FilterValue = string | number | boolean | null | undefined;

interface UseFilterOptions<T> {
  initialFilters?: Partial<Record<keyof T, FilterValue>>;
}

interface UseFilterResult<T> {
  filters: Partial<Record<keyof T, FilterValue>>;
  setFilter: (field: keyof T, value: FilterValue) => void;
  removeFilter: (field: keyof T) => void;
  clearFilters: () => void;
  filteredItems: T[];
  activeFilterCount: number;
}

/**
 * Hook for filtering arrays by multiple fields.
 *
 * @param items - The array of items to filter
 * @param options - Filter options
 * @returns Filter state and filtered items
 *
 * @example
 * const { filters, setFilter, filteredItems, clearFilters } = useFilter(invoices);
 * setFilter('status', 'paid');
 * setFilter('customerId', selectedCustomerId);
 */
export function useFilter<T extends Record<string, unknown>>(
  items: T[],
  options: UseFilterOptions<T> = {}
): UseFilterResult<T> {
  const { initialFilters = {} } = options;

  const [filters, setFilters] = useState<Partial<Record<keyof T, FilterValue>>>(initialFilters);

  const setFilter = useCallback((field: keyof T, value: FilterValue) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
    }));
  }, []);

  const removeFilter = useCallback((field: keyof T) => {
    setFilters(prev => {
      const newFilters = { ...prev };
      delete newFilters[field];
      return newFilters;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setFilters({});
  }, []);

  const filteredItems = useMemo(() => {
    const activeFilters = Object.entries(filters).filter(
      ([, value]) => value !== null && value !== undefined && value !== ''
    );

    if (activeFilters.length === 0) {
      return items;
    }

    return items.filter(item => {
      return activeFilters.every(([field, filterValue]) => {
        const itemValue = item[field as keyof T];

        // Handle different types of comparisons
        if (filterValue === null || filterValue === undefined) {
          return true;
        }

        if (typeof filterValue === 'boolean') {
          return itemValue === filterValue;
        }

        if (typeof filterValue === 'number') {
          return itemValue === filterValue;
        }

        // String comparison (case-insensitive contains)
        if (typeof filterValue === 'string' && typeof itemValue === 'string') {
          return itemValue.toLowerCase().includes(filterValue.toLowerCase());
        }

        // Exact match for other types
        return itemValue === filterValue;
      });
    });
  }, [items, filters]);

  const activeFilterCount = Object.values(filters).filter(
    v => v !== null && v !== undefined && v !== ''
  ).length;

  return {
    filters,
    setFilter,
    removeFilter,
    clearFilters,
    filteredItems,
    activeFilterCount,
  };
}

