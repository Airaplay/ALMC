/** Types for artist ledger export — no runtime deps (safe to import from UI without bundling SheetJS/jspdf). */

export type LedgerExportEntry = {
  category: string;
  label: string;
  amount_usd: number | null;
  amount_treats: number | null;
  currency: string;
  occurred_at: string | null;
  ref_id: string;
};

export type LedgerExportTotals = {
  song_streams: number;
  stream_earnings_usd: number;
  stream_earnings_impression_usd: number;
  creator_pool_payout_usd: number;
  bonuses_treats: number;
  contribution_rewards_usd: number;
  referral_rewards_treats: number;
  promotions_paid_treats: number;
  withdrawals_usd: number;
};

export type LedgerExportPayload = {
  user: {
    id: string;
    display_name: string | null;
    email: string | null;
    current_balance_usd: number;
  };
  artist?: {
    artist_id: string | null;
    stage_name: string | null;
  };
  totals: LedgerExportTotals;
  entries: LedgerExportEntry[];
};
