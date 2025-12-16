import { useState, useCallback } from 'react';

interface UseAsyncState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

interface UseAsyncResult<T, Args extends unknown[]> extends UseAsyncState<T> {
  execute: (...args: Args) => Promise<T | null>;
  reset: () => void;
}

/**
 * Hook for handling async operations with loading and error states.
 *
 * @param asyncFunction - The async function to execute
 * @returns State and execute function
 *
 * @example
 * const { data, loading, error, execute } = useAsync(async (id: string) => {
 *   return await apiService.getCustomer(id);
 * });
 *
 * // Execute the async function
 * await execute('customer-123');
 */
export function useAsync<T, Args extends unknown[] = []>(
  asyncFunction: (...args: Args) => Promise<T>
): UseAsyncResult<T, Args> {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(
    async (...args: Args): Promise<T | null> => {
      setState({ data: null, loading: true, error: null });

      try {
        const result = await asyncFunction(...args);
        setState({ data: result, loading: false, error: null });
        return result;
      } catch (error) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        setState({ data: null, loading: false, error: errorObj });
        return null;
      }
    },
    [asyncFunction]
  );

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return {
    ...state,
    execute,
    reset,
  };
}

/**
 * Hook for handling async operations that are immediately executed.
 *
 * @param asyncFunction - The async function to execute
 * @param deps - Dependencies that trigger re-execution
 * @returns State object
 *
 * @example
 * const { data: customers, loading, error } = useAsyncEffect(
 *   () => apiService.getCustomers(),
 *   []
 * );
 */
export function useAsyncValue<T>(
  asyncFunction: () => Promise<T>,
  deps: React.DependencyList
): UseAsyncState<T> {
  const [state, setState] = useState<UseAsyncState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  // Using useCallback to memoize the effect
  const memoizedFn = useCallback(asyncFunction, deps);

  // Execute on mount and when deps change
  useState(() => {
    let mounted = true;

    const execute = async () => {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const result = await memoizedFn();
        if (mounted) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (error) {
        if (mounted) {
          const errorObj = error instanceof Error ? error : new Error(String(error));
          setState({ data: null, loading: false, error: errorObj });
        }
      }
    };

    execute();

    return () => {
      mounted = false;
    };
  });

  return state;
}

