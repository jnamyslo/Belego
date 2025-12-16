import { useState, useMemo, useCallback } from 'react';
import { useDebounce } from './useDebounce';

interface UseSearchOptions<T> {
  searchFields: (keyof T)[];
  debounceMs?: number;
  caseSensitive?: boolean;
}

interface UseSearchResult<T> {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  filteredItems: T[];
  isSearching: boolean;
  clearSearch: () => void;
}

/**
 * Hook for searching/filtering arrays by multiple fields.
 *
 * @param items - The array of items to search
 * @param options - Search options
 * @returns Search state and filtered items
 *
 * @example
 * const { searchTerm, setSearchTerm, filteredItems } = useSearch(customers, {
 *   searchFields: ['name', 'email', 'customerNumber'],
 *   debounceMs: 300
 * });
 */
export function useSearch<T extends Record<string, unknown>>(
  items: T[],
  options: UseSearchOptions<T>
): UseSearchResult<T> {
  const { searchFields, debounceMs = 300, caseSensitive = false } = options;

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebounce(searchTerm, debounceMs);

  const isSearching = searchTerm !== debouncedSearchTerm;

  const filteredItems = useMemo(() => {
    if (!debouncedSearchTerm.trim()) {
      return items;
    }

    const searchValue = caseSensitive
      ? debouncedSearchTerm.trim()
      : debouncedSearchTerm.trim().toLowerCase();

    return items.filter(item => {
      return searchFields.some(field => {
        const fieldValue = item[field];
        if (fieldValue == null) return false;

        const stringValue = String(fieldValue);
        const compareValue = caseSensitive ? stringValue : stringValue.toLowerCase();

        return compareValue.includes(searchValue);
      });
    });
  }, [items, debouncedSearchTerm, searchFields, caseSensitive]);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
  }, []);

  return {
    searchTerm,
    setSearchTerm,
    filteredItems,
    isSearching,
    clearSearch,
  };
}

