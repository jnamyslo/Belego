#!/usr/bin/env node
/**
 * Typecheck-Ratsche.
 *
 * `npm run build` ist `vite build` (esbuild) — das entfernt Typen, ohne sie zu
 * prüfen. Dadurch sind echte Fehler unbemerkt in Produktion gelangt, z.B. ein
 * `string`, wo ein `string[]` erwartet wurde (Bulk-Rechnungsversand schlug
 * dadurch zu 100% fehl, sichtbar nur als HTTP 400).
 *
 * Ein harter Gate ist derzeit nicht möglich: es existieren noch Alt-Fehler.
 * Diese Ratsche lässt den bestehenden Stand zu, schlägt aber fehl, sobald die
 * Fehlerzahl STEIGT. So wächst die Schuld nicht weiter und kann schrittweise
 * abgebaut werden.
 *
 * Baseline senken: `node scripts/typecheck-ratchet.mjs --update`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE_FILE = new URL('../.typecheck-baseline', import.meta.url);
const UPDATE = process.argv.includes('--update');

let output = '';
try {
  output = execFileSync(
    'npx',
    ['tsc', '-p', 'tsconfig.app.json', '--noEmit'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
} catch (err) {
  // tsc exits non-zero when there are errors — that is the expected path here.
  output = `${err.stdout || ''}${err.stderr || ''}`;
}

const errorLines = output
  .split('\n')
  .filter(line => /^\S.*\(\d+,\d+\): error TS\d+/.test(line));
const count = errorLines.length;

if (UPDATE) {
  writeFileSync(BASELINE_FILE, `${count}\n`, 'utf8');
  console.log(`[typecheck] Baseline aktualisiert auf ${count}.`);
  process.exit(0);
}

if (!existsSync(BASELINE_FILE)) {
  writeFileSync(BASELINE_FILE, `${count}\n`, 'utf8');
  console.log(`[typecheck] Keine Baseline gefunden — auf ${count} gesetzt.`);
  process.exit(0);
}

const baseline = parseInt(readFileSync(BASELINE_FILE, 'utf8').trim(), 10);

if (Number.isNaN(baseline)) {
  console.error('[typecheck] .typecheck-baseline ist ungültig.');
  process.exit(1);
}

if (count > baseline) {
  console.error(`[typecheck] FEHLGESCHLAGEN: ${count} Typfehler, Baseline ist ${baseline} (+${count - baseline}).`);
  console.error('[typecheck] Neue Typfehler wurden eingeführt. Bitte beheben:\n');
  console.error(errorLines.join('\n'));
  process.exit(1);
}

if (count < baseline) {
  console.log(`[typecheck] ${count} Typfehler (Baseline ${baseline}). Verbessert um ${baseline - count}.`);
  console.log('[typecheck] Baseline mit `node scripts/typecheck-ratchet.mjs --update` nachziehen.');
  process.exit(0);
}

console.log(`[typecheck] ${count} Typfehler — unverändert zur Baseline (${baseline}).`);
process.exit(0);
