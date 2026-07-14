/** Types for listener ledger export — no runtime deps (safe to import from UI). */

export type ListenerLedgerExportEntry = {
  category: string;
  label: string;
  amount_usd: number | null;
  amount_treats: number | null;
  currency: string;
  occurred_at: string | null;
  ref_id: string;
};

export type ListenerLedgerExportTotals = {
  songs_listened: number;
  ad_interactions: number;
  referral_rewards_treats: number;
  bonus_campaigns_treats: number;
  withdrawals_treats: number;
  withdrawals_usd: number;
};

export type ListenerLedgerExportPayload = {
  user: {
    id: string;
    display_name: string | null;
    email: string | null;
    current_balance_treats: number;
    current_balance_usd: number;
  };
  totals: ListenerLedgerExportTotals;
  entries: ListenerLedgerExportEntry[];
};
