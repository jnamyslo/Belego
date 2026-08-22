import { useState, useCallback, useMemo, Dispatch, SetStateAction } from 'react';
import logger from '../utils/logger';

/**
 * Die vier API-Aufrufe, die eine Ressource für CRUD benötigt.
 *
 * WICHTIG: Das übergebene Objekt muss eine stabile Identität haben (auf
 * Modulebene definieren, nicht im Render-Body), sonst ändern sich die
 * useCallback-Referenzen bei jedem Render.
 */
export interface CrudApi<T, TCreate> {
  list: () => Promise<T[]>;
  create: (data: TCreate) => Promise<T>;
  update: (id: string, data: Partial<T>) => Promise<T>;
  remove: (id: string) => Promise<void>;
}

export interface CrudResource<T, TCreate> {
  items: T[];
  setItems: Dispatch<SetStateAction<T[]>>;
  add: (data: TCreate) => Promise<T>;
  update: (id: string, data: Partial<T>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  getById: (id: string) => T | undefined;
}

/**
 * Gemeinsame CRUD-Logik für die Ressourcen-Contexts (Kunden, Rechnungen,
 * Angebote, Aufträge).
 *
 * Fehlersemantik — bewusst asymmetrisch:
 * - Schreibzugriffe (add/update/remove) werfen den Fehler weiter. Ein
 *   fehlgeschlagener Schreibvorgang darf NIE als Erfolg erscheinen; früher
 *   wurde hier lokal ein Fake-Datensatz erzeugt, wodurch Daten scheinbar
 *   gespeichert wurden und beim nächsten Laden verschwanden.
 * - refresh() wirft NICHT. Ein fehlgeschlagener Lesevorgang bedeutet nur
 *   veraltete Daten (nicht verlorene) und wird häufig ohne await in Effects
 *   aufgerufen — ein Throw würde dort nur zu einer unbehandelten Rejection
 *   führen.
 *
 * Aufrufer von add/update/remove MÜSSEN den Fehler abfangen und dem Nutzer
 * anzeigen.
 */
export function useCrudResource<T extends { id: string }, TCreate>(
  resourceName: string,
  api: CrudApi<T, TCreate>,
  initialItems: T[] = []
): CrudResource<T, TCreate> {
  const [items, setItems] = useState<T[]>(initialItems);

  const getById = useCallback((id: string): T | undefined => {
    return items.find(item => item.id === id);
  }, [items]);

  const add = useCallback(async (data: TCreate): Promise<T> => {
    try {
      const created = await api.create(data);
      setItems(prev => [...prev, created]);
      return created;
    } catch (error) {
      logger.error(`Error adding ${resourceName}`, { error });
      throw error;
    }
  }, [api, resourceName]);

  const update = useCallback(async (id: string, data: Partial<T>): Promise<void> => {
    try {
      const updated = await api.update(id, data);
      setItems(prev => prev.map(item => (item.id === id ? updated : item)));
    } catch (error) {
      logger.error(`Error updating ${resourceName}`, { error });
      throw error;
    }
  }, [api, resourceName]);

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      await api.remove(id);
      setItems(prev => prev.filter(item => item.id !== id));
    } catch (error) {
      logger.error(`Error deleting ${resourceName}`, { error });
      throw error;
    }
  }, [api, resourceName]);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await api.list();
      setItems(data);
    } catch (error) {
      // Bewusst kein Throw: siehe Fehlersemantik oben.
      logger.error(`Error refreshing ${resourceName}`, { error });
    }
  }, [api, resourceName]);

  return useMemo(() => ({
    items,
    setItems,
    add,
    update,
    remove,
    refresh,
    getById,
  }), [items, setItems, add, update, remove, refresh, getById]);
}
