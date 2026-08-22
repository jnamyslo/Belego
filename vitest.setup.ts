/**
 * Test-Setup.
 *
 * `src/utils/logger.ts` liest im Konstruktor `localStorage` ('LOG_LEVEL'), um das
 * Log-Level zu bestimmen. Module, die den Logger importieren (z.B. der
 * ZUGFeRD-Generator), lassen sich daher in einer reinen Node-Umgebung nicht
 * laden. Hier wird ein minimaler In-Memory-Ersatz bereitgestellt, statt die
 * Produktionsdatei für die Tests zu verbiegen.
 */
const store = new Map<string, string>();

const localStorageStub: Storage = {
  get length() {
    return store.size;
  },
  clear: () => store.clear(),
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  key: (index: number) => Array.from(store.keys())[index] ?? null,
  removeItem: (key: string) => void store.delete(key),
  setItem: (key: string, value: string) => void store.set(key, String(value)),
};

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageStub,
    configurable: true,
  });
}
