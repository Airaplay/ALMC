/**
 * Excel/PDF export for Listener Earnings Ledger.
 * Import dynamically from the UI so xlsx/jspdf stay in an async chunk.
 */
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';

import type { ListenerLedgerExportEntry, ListenerLedgerExportPayload } from './listenerLedgerExport.types';

export type { ListenerLedgerExportEntry, ListenerLedgerExportTotals, ListenerLedgerExportPayload } from './listenerLedgerExport.types';

function safeFileSegment(s: string | null | undefined): string {
  const t = (s || 'listener').replace(/[^a-z0-9-_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return t.slice(0, 64) || 'listener';
}

function fmtUsd(n: number | null | undefined): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(Number(n ?? 0));
}

function fmtTreats(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} Treats`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return format(parseISO(iso), 'yyyy-MM-dd HH:mm');
  } catch {
    return iso;
  }
}

function amountCell(row: ListenerLedgerExportEntry): string {
  if (row.currency === 'USD') return fmtUsd(row.amount_usd ?? 0);
  return fmtTreats(row.amount_treats ?? 0);
}

export function buildListenerExportFilenameBase(userDisplayName: string | null): string {
  const stamp = format(new Date(), 'yyyy-MM-dd');
  return `listener-ledger_${safeFileSegment(userDisplayName)}_${stamp}`;
}

export function exportListenerLedgerExcel(payload: ListenerLedgerExportPayload, filenameBase: string): void {
  const { user, totals, entries } = payload;

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Listener Earnings Ledger — Summary'],
    ['Exported (UTC)', new Date().toISOString()],
    [],
    ['User ID', user.id],
    ['Display name', user.display_name ?? ''],
    ['Email', user.email ?? ''],
    ['Treat wallet balance', Number(user.current_balance_treats)],
    ['Live balance (USD)', Number(user.current_balance_usd)],
    [],
    ['Songs listened (rows in listening history)', totals.songs_listened],
    ['Ad interactions (impression logs)', totals.ad_interactions],
    ['Referral rewards (Treats)', Number(totals.referral_rewards_treats)],
    ['Bonus campaigns (Treats)', Number(totals.bonus_campaigns_treats)],
    ['Withdrawals — Treats (wallet total withdrawn)', Number(totals.withdrawals_treats)],
    ['Withdrawals — cash/bank (USD, non-pending requests)', Number(totals.withdrawals_usd)],
  ]);

  const ledgerHeader = [
    'When (UTC)',
    'Type',
    'Description',
    'Currency',
    'Amount USD',
    'Amount Treats',
    'Ref ID',
  ];
  const ledgerRows = entries.map((row) => [
    formatWhen(row.occurred_at),
    row.category.replace(/_/g, ' '),
    row.label,
    row.currency,
    row.currency === 'USD' ? Number(row.amount_usd ?? 0) : '',
    row.currency !== 'USD' ? Number(row.amount_treats ?? 0) : '',
    row.ref_id,
  ]);
  const ledgerSheet = XLSX.utils.aoa_to_sheet([ledgerHeader, ...ledgerRows]);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary');
  XLSX.utils.book_append_sheet(wb, ledgerSheet, 'Ledger');
  XLSX.writeFile(wb, `${filenameBase}.xlsx`);
}

export function exportListenerLedgerPdf(payload: ListenerLedgerExportPayload, filenameBase: string): void {
  const { user, totals, entries } = payload;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Listener Earnings Ledger', 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Exported ${format(new Date(), 'yyyy-MM-dd HH:mm')} (local)`, 14, 22);
  doc.setTextColor(0);

  const summaryBody: (string | number)[][] = [
    ['User ID', user.id],
    ['Display name', user.display_name ?? '—'],
    ['Email', user.email ?? '—'],
    ['Treat wallet balance', fmtTreats(user.current_balance_treats)],
    ['Live balance (USD)', fmtUsd(user.current_balance_usd)],
    ['Songs listened', totals.songs_listened],
    ['Ad interactions', totals.ad_interactions],
    ['Referral rewards (Treats)', fmtTreats(totals.referral_rewards_treats)],
    ['Bonus campaigns (Treats)', fmtTreats(totals.bonus_campaigns_treats)],
    ['Withdrawals — Treats (total)', fmtTreats(totals.withdrawals_treats)],
    ['Withdrawals — USD (payout requests)', fmtUsd(totals.withdrawals_usd)],
  ];

  autoTable(doc, {
    startY: 28,
    head: [['Field', 'Value']],
    body: summaryBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1.5 },
    headStyles: { fillColor: [48, 150, 5] },
    columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: pageW - 14 * 2 - 55 } },
  });

  const docWithTable = doc as jsPDF & { lastAutoTable?: { finalY: number } };
  const finalY = docWithTable.lastAutoTable?.finalY ?? 40;

  autoTable(doc, {
    startY: finalY + 10,
    head: [['When', 'Type', 'Description', 'Amount']],
    body: entries.map((row) => [
      formatWhen(row.occurred_at),
      row.category.replace(/_/g, ' '),
      row.label,
      amountCell(row),
    ]),
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1 },
    headStyles: { fillColor: [48, 150, 5] },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 28 },
      2: { cellWidth: pageW - 14 * 2 - 28 - 28 - 32 },
      3: { cellWidth: 32, halign: 'right' },
    },
  });

  doc.save(`${filenameBase}.pdf`);
}
