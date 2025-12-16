import { useState, useCallback } from 'react';

interface UseModalResult<T = undefined> {
  isOpen: boolean;
  data: T | null;
  open: (data?: T) => void;
  close: () => void;
  toggle: () => void;
}

/**
 * Hook for managing modal state.
 *
 * @param initialOpen - Whether the modal is initially open
 * @returns Modal state and controls
 *
 * @example
 * const deleteModal = useModal<Customer>();
 *
 * // Open with data
 * deleteModal.open(customerToDelete);
 *
 * // In modal component
 * {deleteModal.isOpen && (
 *   <ConfirmationModal
 *     customer={deleteModal.data}
 *     onClose={deleteModal.close}
 *   />
 * )}
 */
export function useModal<T = undefined>(initialOpen = false): UseModalResult<T> {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const [data, setData] = useState<T | null>(null);

  const open = useCallback((modalData?: T) => {
    setData(modalData ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Clear data after close animation completes
    setTimeout(() => setData(null), 300);
  }, []);

  const toggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  return {
    isOpen,
    data,
    open,
    close,
    toggle,
  };
}

