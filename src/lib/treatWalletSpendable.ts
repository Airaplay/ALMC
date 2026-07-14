/**
 * Treats available to spend (tips, promos, etc.): main wallet balance plus
 * non-withdrawable promo_balance (e.g. sign-up bonus, admin promo credits).
 */
export function getTreatWalletSpendable(
  w: { balance?: unknown; promo_balance?: unknown } | null | undefined
): number {
  if (!w) return 0;
  return (Number(w.balance) || 0) + (Number(w.promo_balance) || 0);
}
