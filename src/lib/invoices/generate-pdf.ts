// Builds the PDF for one monthly invoice summary (org-wide, one row per
// billing account/service inside it, for either the Google or Render
// invoice — see the Invoice model comment in schema.prisma). English-only
// by design (owner request) — this sidesteps pdfkit's total lack of bidi/
// RTL support entirely and lets it use its built-in Helvetica fonts, which
// render crisp and bold at any size (no external font file, no reordering
// logic needed).

import PDFDocument from 'pdfkit';

const PAGE_MARGIN = 50;
const PAGE_WIDTH = 595.28; // A4 @ 72dpi

export interface InvoiceBreakdownLine {
  title: string; // e.g. "BILLING 1 — My Billing Account 1", or a Render service name
  subtitle?: string; // e.g. a billing account id — omitted for Render
  amount: string; // pre-formatted, e.g. "12.34 ILS"
}

export interface BuildInvoicePdfInput {
  organizationName: string; // e.g. "reshetimes-org"
  periodLabel: string; // e.g. "07/2026"
  totalAmountLabel: string; // e.g. "1,234.56 ILS"
  totalLabel: string; // e.g. "TOTAL FOR ORGANIZATION" or "TOTAL FOR RENDER"
  generatedAtLabel: string; // e.g. "24/08/2026 14:30"
  sourceNote: string; // provider-specific disclaimer line under the header
  breakdownColumnLabel: string; // e.g. "BILLING ACCOUNT" or "SERVICE"
  lines: InvoiceBreakdownLine[];
}

export function buildInvoicePdf(input: BuildInvoicePdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE_MARGIN });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const colWidth = PAGE_WIDTH - PAGE_MARGIN * 2;

    // Header
    doc.font('Helvetica-Bold').fontSize(24).fillColor('#6d28d9').text('PAY SCOPE', PAGE_MARGIN, PAGE_MARGIN);
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor('#000000')
      .text('Monthly Billing Summary', PAGE_MARGIN, PAGE_MARGIN + 30);
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#374151')
      .text(input.organizationName, PAGE_MARGIN, PAGE_MARGIN + 50);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#4b5563')
      .text(input.sourceNote, PAGE_MARGIN, PAGE_MARGIN + 66, { width: colWidth });

    doc.moveTo(PAGE_MARGIN, PAGE_MARGIN + 92).lineTo(PAGE_WIDTH - PAGE_MARGIN, PAGE_MARGIN + 92).strokeColor('#d1d5db').lineWidth(1).stroke();

    // Meta rows
    let y = PAGE_MARGIN + 112;
    const metaRow = (label: string, value: string) => {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#4b5563').text(label, PAGE_MARGIN, y);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(value, PAGE_MARGIN, y + 14);
      y += 38;
    };
    metaRow('PERIOD', input.periodLabel);
    metaRow('GENERATED AT', input.generatedAtLabel);

    // Total — the headline number
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#4b5563').text(input.totalLabel, PAGE_MARGIN, y);
    doc.font('Helvetica-Bold').fontSize(28).fillColor('#6d28d9').text(input.totalAmountLabel, PAGE_MARGIN, y + 16);
    y += 62;

    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_WIDTH - PAGE_MARGIN, y).strokeColor('#d1d5db').lineWidth(1).stroke();
    y += 16;

    // Per-item breakdown table.
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#4b5563');
    doc.text(input.breakdownColumnLabel, PAGE_MARGIN, y);
    doc.text('AMOUNT', PAGE_MARGIN, y, { align: 'right', width: colWidth });
    y += 16;
    doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_WIDTH - PAGE_MARGIN, y).strokeColor('#d1d5db').lineWidth(1).stroke();
    y += 10;

    for (const line of input.lines) {
      if (y > 760) {
        doc.addPage();
        y = PAGE_MARGIN;
      }
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(line.title, PAGE_MARGIN, y);
      if (line.subtitle) {
        doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(line.subtitle, PAGE_MARGIN, y + 14);
      }
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(line.amount, PAGE_MARGIN, y, { align: 'right', width: colWidth });
      y += line.subtitle ? 32 : 22;
    }

    doc.end();
  });
}
