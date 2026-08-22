import { JobEntry, InvoiceItem } from '../types';
import { calculateInvoiceWithDiscounts, updateItemWithDiscount } from './discountUtils';

/**
 * Wandelt Aufträge in Rechnungspositionen um und ermittelt die Summen.
 *
 * Bewusst als reine Funktion aus dem JobInvoiceGenerator herausgelöst: Die
 * Regeln hier (Kleinunternehmer-Normalisierung, Rabattübernahme, Summenbildung)
 * sind Geldlogik und müssen testbar sein. Vorher lag sie in einer Komponente
 * und war nur über die UI erreichbar — entsprechend war sie ungetestet und
 * ignorierte Positionsrabatte.
 *
 * Reihenfolge je Auftrag: Zeiteinträge (bzw. Legacy-Stunden), danach Materialien.
 */
export function buildInvoiceItemsFromJobs(
  jobs: JobEntry[],
  isSmallBusiness = false
): InvoiceItem[] {
  const items: InvoiceItem[] = [];
  let itemOrder = 1;

  // Bei Kleinunternehmerregelung immer 0% MwSt., sonst gespeicherter Wert bzw. 19%.
  const rateFor = (stored?: number | null) =>
    isSmallBusiness ? 0 : (stored != null ? stored : 19);

  for (const job of jobs) {
    if (job.timeEntries && job.timeEntries.length > 0) {
      for (const timeEntry of job.timeEntries) {
        items.push({
          id: `time-entry-${timeEntry.id}`,
          description: `${job.title} - ${timeEntry.description}`,
          quantity: timeEntry.hoursWorked,
          unitPrice: timeEntry.hourlyRate,
          taxRate: rateFor(timeEntry.taxRate),
          discountType: timeEntry.discountType,
          discountValue: timeEntry.discountValue,
          total: timeEntry.total,
          jobNumber: job.jobNumber,
          externalJobNumber: job.externalJobNumber,
          order: itemOrder++,
        } as InvoiceItem);
      }
    } else if (job.hoursWorked > 0) {
      // Legacy-Auftrag ohne Zeiteinträge: Stunden direkt am Auftrag.
      items.push({
        id: `job-${job.id}`,
        description: `${job.title} - ${job.description}`,
        quantity: job.hoursWorked,
        unitPrice: job.hourlyRate,
        taxRate: rateFor((job as JobEntry & { taxRate?: number }).taxRate),
        total: job.hoursWorked * job.hourlyRate,
        jobNumber: job.jobNumber,
        externalJobNumber: job.externalJobNumber,
        order: itemOrder++,
      } as InvoiceItem);
    }

    if (job.materials && job.materials.length > 0) {
      for (const material of job.materials) {
        items.push({
          id: `material-${material.id}`,
          description: `${job.title} - ${material.description}`,
          quantity: material.quantity,
          unitPrice: material.unitPrice,
          taxRate: rateFor(material.taxRate),
          discountType: material.discountType,
          discountValue: material.discountValue,
          total: material.total,
          jobNumber: job.jobNumber,
          externalJobNumber: job.externalJobNumber,
          order: itemOrder++,
        } as InvoiceItem);
      }
    }
  }

  // discountAmount und total aus discountType/discountValue ableiten, damit
  // item.total nicht im Widerspruch zu quantity × unitPrice steht.
  return items.map(updateItemWithDiscount);
}

/**
 * Positionen plus Summen für eine Auftragsrechnung.
 * Die Summen laufen über dasselbe Modul wie Editoren, PDF und eRechnung.
 */
export function buildInvoiceFromJobs(jobs: JobEntry[], isSmallBusiness = false) {
  const items = buildInvoiceItemsFromJobs(jobs, isSmallBusiness);
  const { subtotal, taxAmount, total } = calculateInvoiceWithDiscounts(
    items,
    {},
    isSmallBusiness
  );
  return { items, subtotal, taxAmount, total };
}
