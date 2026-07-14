/**
 * Excel/PDF export for Artist Earnings Ledger.
 * Import this module dynamically from the UI so xlsx/jspdf stay in an async chunk
 * and Vite resolves `xlsx` via the alias in vite.config.ts (not `xlsx/xlsx.mjs` directly).
 */
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, parseISO } from 'date-fns';

import type { LedgerExportEntry, LedgerExportPayload } from './artistLedgerExport.types';

export type { LedgerExportEntry, LedgerExportTotals, LedgerExportPayload } from './artistLedgerExport.types';

function safeFileSegment(s: string | null | undefined): string {
  const t = (s || 'artist').replace(/[^a-z0-9-_]+/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return t.slice(0, 64) || 'artist';
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

function amountCell(row: LedgerExportEntry): string {
  if (row.currency === 'USD') return fmtUsd(row.amount_usd ?? 0);
  return fmtTreats(row.amount_treats ?? 0);
}

export function buildExportFilenameBase(userDisplayName: string | null): string {
  const stamp = format(new Date(), 'yyyy-MM-dd');
  return `artist-ledger_${safeFileSegment(userDisplayName)}_${stamp}`;
}

export function exportArtistLedgerExcel(payload: LedgerExportPayload, filenameBase: string): void {
  const { user, artist, totals, entries } = payload;

  const summarySheet = XLSX.utils.aoa_to_sheet([
    ['Artist Earnings Ledger — Summary'],
    ['Exported (UTC)', new Date().toISOString()],
    [],
    ['User ID', user.id],
    ['Display name', user.display_name ?? ''],
    ['Email', user.email ?? ''],
    ['Stage name', artist?.stage_name ?? ''],
    ['Artist entity ID', artist?.artist_id ?? ''],
    ['Current balance (USD)', Number(user.current_balance_usd)],
    [],
    ['Song streams (sum of play counts)', totals.song_streams],
    ['Stream earnings — impressions (USD)', Number(totals.stream_earnings_impression_usd)],
    ['Stream earnings — creator pool (USD)', Number(totals.creator_pool_payout_usd)],
    ['Stream earnings — total (USD)', Number(totals.stream_earnings_usd)],
    ['Bonuses — treats (admin grants etc.)', Number(totals.bonuses_treats)],
    ['Contribution rewards (USD)', Number(totals.contribution_rewards_usd)],
    ['Referral rewards (Treats)', Number(totals.referral_rewards_treats)],
    ['Promotions paid (Treats)', Number(totals.promotions_paid_treats)],
    ['Withdrawals completed (USD)', Number(totals.withdrawals_usd)],
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

export function exportArtistLedgerPdf(payload: LedgerExportPayload, filenameBase: string): void {
  const { user, artist, totals, entries } = payload;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Artist Earnings Ledger', 14, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(`Exported ${format(new Date(), 'yyyy-MM-dd HH:mm')} (local)`, 14, 22);
  doc.setTextColor(0);

  const summaryBody: (string | number)[][] = [
    ['User ID', user.id],
    ['Display name', user.display_name ?? '—'],
    ['Email', user.email ?? '—'],
    ['Stage name', artist?.stage_name ?? '—'],
    ['Current balance (USD)', fmtUsd(user.current_balance_usd)],
    ['Song streams', totals.song_streams],
    ['Stream earnings total (USD)', fmtUsd(totals.stream_earnings_usd)],
    ['Referral rewards (Treats)', fmtTreats(totals.referral_rewards_treats)],
    ['Promotions paid (Treats)', fmtTreats(totals.promotions_paid_treats)],
    ['Withdrawals completed (USD)', fmtUsd(totals.withdrawals_usd)],
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
