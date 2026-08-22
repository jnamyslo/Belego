import { defineConfig } from 'vitest/config';

// Bewusst eine .mjs-Datei und getrennt von vite.config.ts:
// Vitest würde eine TS-Config zuerst in eine temporäre .mjs bundeln, was im
// Docker-Bind-Mount (macOS) unzuverlässig ist. Die Unit-Tests decken reine
// TypeScript-Module ab (Beträge, Steuern, XML) und brauchen kein React-Plugin.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    reporters: 'default',
  },
});
