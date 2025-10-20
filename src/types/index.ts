export interface CustomerEmail {
  id: string;
  email: string;
  label?: string;
  isActive: boolean;
}

export interface Customer {
  id: string;
  customerNumber: string;
  name: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  taxId?: string;
  phone?: string;
  additionalEmails?: CustomerEmail[];
  hourlyRates?: HourlyRate[]; // Customer-specific hourly rates
  materials?: MaterialTemplate[]; // Customer-specific materials
  createdAt: Date;
}

export interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  jobNumber?: string; // Verknüpfte Auftragsnummer
  externalJobNumber?: string; // Externe Auftragsnummer
  order: number; // Sortierreihenfolge der Position
  // Rabattfelder
  discountType?: 'percentage' | 'fixed'; // Rabatttyp: Prozentual oder Festbetrag
  discountValue?: number; // Rabattwert (Prozent oder Betrag)
  discountAmount?: number; // Berechneter Rabattbetrag
}

export interface InvoiceAttachment {
  id: string;
  name: string;
  content: string; // Base64 encoded content
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  issueDate: Date;
  dueDate: Date;
  items: InvoiceItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'reminded_1x' | 'reminded_2x' | 'reminded_3x';
  notes?: string;
  attachments?: InvoiceAttachment[];
  createdAt: Date;
  // Reminder fields
  lastReminderDate?: Date;
  lastReminderSentAt?: Date;
  maxReminderStage?: number; // Highest reminder stage reached (0-3), persists even after payment
  // Gesamtrabatt-Felder
  globalDiscountType?: 'percentage' | 'fixed'; // Gesamtrabatttyp: Prozentual oder Festbetrag
  globalDiscountValue?: number; // Gesamtrabattwert (Prozent oder Betrag)
  globalDiscountAmount?: number; // Berechneter Gesamtrabattbetrag
}

export interface QuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  order: number; // Sortierreihenfolge der Position
  // Rabattfelder
  discountType?: 'percentage' | 'fixed'; // Rabatttyp: Prozentual oder Festbetrag
  discountValue?: number; // Rabattwert (Prozent oder Betrag)
  discountAmount?: number; // Berechneter Rabattbetrag
}

export interface QuoteAttachment {
  id: string;
  name: string;
  content: string; // Base64 encoded content
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  customerId: string;
  customerName: string;
  issueDate: Date;
  validUntil: Date; // Gültigkeitsdatum statt Fälligkeitsdatum
  items: QuoteItem[];
  subtotal: number;
  taxAmount: number;
  total: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'billed';
  notes?: string;
  attachments?: QuoteAttachment[];
  createdAt: Date;
  convertedToInvoiceId?: string; // Verknüpfung zur erstellten Rechnung
  // Gesamtrabatt-Felder
  globalDiscountType?: 'percentage' | 'fixed';
  globalDiscountValue?: number;
  globalDiscountAmount?: number;
}

export interface PaymentInformation {
  accountHolder?: string; // Kontoinhaber (kann unterschiedlich zur Firma sein)
  bankAccount?: string; // IBAN
  bic?: string;
  bankName?: string; // Name der Bank
  paymentTerms?: string; // Zusätzliche Zahlungsbedingungen
  paymentMethods?: string[]; // Unterstützte Zahlungsmethoden (Überweisung, PayPal, etc.)
}

export interface Company {
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  phone: string;
  email: string;
  website?: string;
  taxId: string; // USt-IdNr. (Umsatzsteuer-Identifikationsnummer)
  taxIdentificationNumber?: string; // Steuernummer
  logo?: string | null;
  icon?: string | null;
  locale?: 'de-DE' | 'en-US' | 'fr-FR' | 'es-ES';
  primaryColor?: string;
  secondaryColor?: string;
  jobTrackingEnabled?: boolean;
  reportingEnabled?: boolean; // Reporting-Modul aktiviert/deaktiviert
  quotesEnabled?: boolean; // Angebote-Modul aktiviert/deaktiviert
  defaultPaymentDays?: number; // Standard-Zahlungsziel in Tagen (Standard: 30)
  immediatePaymentClause?: string; // Klausel für sofortige Zahlung (bei 0 Tagen)
  invoiceStartNumber?: number; // Start-Rechnungsnummer (Standard: 1)
  isSmallBusiness?: boolean; // Kleinunternehmerregelung nach § 19 UStG
  // Reminder settings
  remindersEnabled?: boolean; // Zahlungserinnerungen aktiviert/deaktiviert
  reminderDaysAfterDue?: number; // Tage nach Fälligkeit bis zur ersten Mahnung
  reminderDaysBetween?: number; // Tage zwischen Mahnstufen
  reminderFeeStage1?: number; // Mahngebühr Stufe 1
  reminderFeeStage2?: number; // Mahngebühr Stufe 2
  reminderFeeStage3?: number; // Mahngebühr Stufe 3
  reminderTextStage1?: string; // Mahntext Stufe 1
  reminderTextStage2?: string; // Mahntext Stufe 2
  reminderTextStage3?: string; // Mahntext Stufe 3
  // Layout-Optionen
  companyHeaderTwoLine?: boolean; // Zweizeilige Darstellung der Firmeninformationen
  companyHeaderLine1?: string; // Erste Zeile (z.B. "BeBa montage-service Industrievertretung")
  companyHeaderLine2?: string; // Zweite Zeile (z.B. "Jörg Badekow, Saseler Kamp 78, 22393 Hamburg")
  hourlyRates?: HourlyRate[];
  materialTemplates?: MaterialTemplate[];
  invoiceTemplates?: InvoiceTemplate[];
  // Getrennte Zahlungsinformationen
  paymentInformation?: PaymentInformation;
  // Dropdown-Einstellungen
  showCombinedDropdowns?: boolean; // Zeigt allgemeine + kundenspezifische Daten in Dropdowns
  // Legacy-Felder für Rückwärtskompatibilität (deprecated)
  bankAccount?: string;
  bic?: string;
}

export interface HourlyRate {
  id: string;
  name: string;
  description?: string;
  rate: number;
  taxRate?: number; // Default tax rate for this hourly rate
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MaterialTemplate {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  unit: string;
  taxRate?: number; // Default tax rate for this material template
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  description?: string;
  unitPrice: number;
  unit: string;
  taxRate: number;
  isDefault?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface YearlyInvoiceStartNumber {
  id: number;
  year: number;
  start_number: number;
  created_at: string;
  updated_at: string;
}

export interface JobAttachment {
  id: string;
  name: string;
  content: string; // Base64 encoded content
  contentType: string;
  size: number;
  uploadedAt: Date;
}

export interface JobSignature {
  id: string;
  customerName: string; // Free text input for customer name
  signatureData: string; // Base64 encoded signature image
  signedAt: Date;
  ipAddress?: string;
}

export interface JobEntry {
  id: string;
  jobNumber: string; // Automatisch generierte Auftragsnummer (AB-2025-001)
  externalJobNumber?: string; // Optionale externe Auftragsnummer
  customerId: string;
  customerName: string;
  customerAddress?: string; // Zusätzliche Kundenanschrift für Ausführungsort
  title: string;
  description: string;
  date: Date;
  startTime?: string;
  endTime?: string;
  hoursWorked: number;
  hourlyRate: number;
  hourlyRateId?: string; // Reference to HourlyRate
  timeEntries?: JobTimeEntry[]; // New: Multiple time entries per job
  materials?: JobMaterial[];
  status: 'draft' | 'in-progress' | 'completed' | 'invoiced';
  notes?: string;
  attachments?: JobAttachment[];
  signature?: JobSignature; // Customer signature
  createdAt: Date;
  updatedAt: Date;
  tags?: string[];
  priority?: 'low' | 'medium' | 'high';
  estimatedHours?: number;
  actualHours?: number;
  location?: string;
}

export interface JobMaterial {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  total: number;
  unit?: string;
  templateId?: string; // Reference to MaterialTemplate
  // Rabattfelder für Materialien
  discountType?: 'percentage' | 'fixed'; // Rabatttyp: Prozentual oder Festbetrag
  discountValue?: number; // Rabattwert (Prozent oder Betrag)
  discountAmount?: number; // Berechneter Rabattbetrag
}

export interface JobTimeEntry {
  id: string;
  description: string;
  startTime?: string;
  endTime?: string;
  hoursWorked: number;
  hourlyRate: number;
  hourlyRateId?: string; // Reference to HourlyRate
  taxRate: number;
  total: number;
  // Rabattfelder für Zeiteinträge
  discountType?: 'percentage' | 'fixed'; // Rabatttyp: Prozentual oder Festbetrag
  discountValue?: number; // Rabattwert (Prozent oder Betrag)
  discountAmount?: number; // Berechneter Rabattbetrag
}

export interface JobInvoiceGeneration {
  type: 'single' | 'daily' | 'weekly' | 'monthly';
  jobIds: string[];
  date?: Date; // For daily/weekly/monthly grouping
  customerId: string;
}

export type ExportFormat = 'zugferd' | 'xrechnung';

// Reporting Types
export interface InvoiceJournalEntry {
  id: string;
  invoiceNumber: string;
  customerName: string;
  customerNumber?: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  taxAmount: number;
  total: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  paidAmount: number;
  overdueAmount: number;
  outstandingAmount: number;
  createdAt: Date;
}

export interface InvoiceJournalSummary {
  totalInvoices: number;
  totalAmount: number;
  paidAmount: number;
  overdueAmount: number;
  outstandingAmount: number;
  subtotalSum: number;
  taxSum: number;
}

export interface InvoiceJournalResponse {
  invoices: InvoiceJournalEntry[];
  summary: InvoiceJournalSummary;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
}

export interface MonthlyRevenueStats {
  month: number;
  invoiceCount: number;
  subtotalSum: number;
  taxSum: number;
  totalSum: number;
  paidSum: number;
  overdueSum: number;
}

export interface CustomerStats {
  customerId: string;
  customerName: string;
  invoiceCount: number;
  totalRevenue: number;
  avgInvoiceAmount: number;
}

export interface StatusDistribution {
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  count: number;
  totalAmount: number;
}

export interface YearOverview {
  totalInvoices: number;
  totalSubtotal: number;
  totalTax: number;
  totalAmount: number;
  paidAmount: number;
  overdueAmount: number;
  avgInvoiceAmount: number;
}

export interface ReportingStatistics {
  year: number;
  monthlyRevenue: MonthlyRevenueStats[];
  topCustomers: CustomerStats[];
  statusDistribution: StatusDistribution[];
  yearOverview: YearOverview | null;
}

// Reminder Types
export interface ReminderEligibility {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  dueDate: Date;
  total: number;
  currentStatus: Invoice['status'];
  nextStage: 1 | 2 | 3;
  daysSinceDue: number;
  daysSinceLastReminder?: number;
  isEligible: boolean;
  nextEligibleDate?: Date;
}