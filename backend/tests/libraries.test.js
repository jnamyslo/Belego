// Contract-Tests für die Drittbibliotheken, die Belego aus dem Backend nutzt.
// Sie bilden die in routes/backup.js und services/emailService.js verwendeten
// Aufrufe nach und fangen Breaking Changes bei Dependency-Updates ab.
import { describe, it, expect } from 'vitest';
import AdmZip from 'adm-zip';
import nodemailer from 'nodemailer';

describe('adm-zip (routes/backup.js)', () => {
  const buildBackupZip = () => {
    const zip = new AdmZip();
    zip.addFile('database.json', Buffer.from(JSON.stringify({ customers: [{ id: 1, name: 'Müller GmbH' }] }, null, 2)));
    zip.addFile('metadata.json', Buffer.from(JSON.stringify({ version: '1', createdAt: '2026-01-01T00:00:00Z' }, null, 2)));
    return zip.toBuffer();
  };

  it('liest ein erzeugtes Backup-ZIP verlustfrei wieder ein', () => {
    const zip = new AdmZip(buildBackupZip());
    const database = JSON.parse(zip.getEntry('database.json').getData().toString('utf8'));
    const metadata = JSON.parse(zip.getEntry('metadata.json').getData().toString('utf8'));

    expect(database.customers[0].name).toBe('Müller GmbH');
    expect(metadata.version).toBe('1');
  });

  it('liefert null für fehlende Einträge (Validierung beim Restore)', () => {
    const zip = new AdmZip();
    zip.addFile('database.json', Buffer.from('{}'));
    const reopened = new AdmZip(zip.toBuffer());

    expect(reopened.getEntry('database.json')).not.toBeNull();
    expect(reopened.getEntry('metadata.json')).toBeNull();
  });

  it('wirft bei keinem gültigen ZIP', () => {
    expect(() => new AdmZip(Buffer.from('kein zip'))).toThrow();
  });
});

describe('nodemailer (services/emailService.js)', () => {
  it('baut Mails mit mehreren Anhängen und Empfängern korrekt zusammen', async () => {
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    const info = await transporter.sendMail({
      from: 'Belego <rechnung@example.com>',
      to: 'kunde@example.com',
      cc: 'buchhaltung@example.com',
      subject: 'Rechnung RE-2026-001',
      html: '<p>Anbei Ihre Rechnung</p>',
      attachments: [
        { filename: 'Rechnung_RE-2026-001.pdf', content: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' },
        { filename: 'XRechnung_RE-2026-001.xml', content: Buffer.from('<xml/>'), contentType: 'application/xml' },
      ],
    });

    const message = JSON.parse(info.message);
    expect(info.envelope.to).toEqual(['kunde@example.com', 'buchhaltung@example.com']);
    expect(message.subject).toBe('Rechnung RE-2026-001');
    expect(message.attachments.map((a) => a.filename)).toEqual([
      'Rechnung_RE-2026-001.pdf',
      'XRechnung_RE-2026-001.xml',
    ]);
    expect(info.messageId).toMatch(/^<.+@.+>$/);
  });

  it('legt die SMTP-Optionen aus emailService.js an', () => {
    const transporter = nodemailer.createTransport({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });

    expect(typeof transporter.sendMail).toBe('function');
    expect(typeof transporter.verify).toBe('function');
    transporter.close();
  });
});
