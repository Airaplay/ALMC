import React, { useState, useEffect } from 'react';
import { ArrowLeft, Loader2, CheckCircle2, AlertCircle, TrendingUp, Coins } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Skeleton } from './ui/skeleton';
import { treatCache, CACHE_KEYS, getCachedData } from '../lib/treatCache';
import { persistentCache } from '../lib/persistentCache';
import { CustomConfirmDialog } from './CustomConfirmDialog';
import { cn } from '../lib/utils';
import { toUserFacingPaymentError, TRY_AGAIN_LABEL } from '../lib/criticalErrorMessages';

interface TreatWithdrawalModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface TreatWallet {
  balance: number;
  total_earned: number;
  total_spent: number;
  total_purchased: number;
  total_withdrawn: number;
  earned_balance: number;
}

interface WithdrawalSettings {
  is_withdrawal_enabled: boolean;
  minimum_withdrawal_amount: number;
  withdrawal_fee_percentage: number;
  withdrawal_fee_fixed: number;
  treat_to_usd_rate: number;
}

export const TreatWithdrawalModal: React.FC<TreatWithdrawalModalProps> = ({
  onClose,
  onSuccess
}) => {
  const [wallet, setWallet] = useState<TreatWallet | null>(null);
  const [settings, setSettings] = useState<WithdrawalSettings | null>(null);
  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSuccessAnimation, setShowSuccessAnimation] = useState(false);
  const [netAmountTransferred, setNetAmountTransferred] = useState<number>(0);
  const [treatsWithdrawn, setTreatsWithdrawn] = useState<number>(0);
  const [showConfirmWithdraw, setShowConfirmWithdraw] = useState(false);

  useEffect(() => {
    loadWalletAndSettings();
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, []);

  const loadWalletAndSettings = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      treatCache.invalidate(CACHE_KEYS.WALLET(user.id));

      const walletData = await getCachedData(
        CACHE_KEYS.WALLET(user.id),
        async () => {
          const { data, error } = await supabase
            .from('treat_wallets')
            .select('balance, total_earned, total_spent, total_purchased, total_withdrawn, earned_balance')
            .eq('user_id', user.id)
            .limit(1);
          if (error) throw error;
          return data && data.length > 0 ? data[0] : {
            balance: 0, total_earned: 0, total_spent: 0,
            total_purchased: 0, total_withdrawn: 0, earned_balance: 0
          };
        },
        1 * 60 * 1000
      );

      setWallet(walletData);

      const settingsData = await getCachedData(
        CACHE_KEYS.WITHDRAWAL_SETTINGS,
        async () => {
          const { data, error } = await supabase
            .from('treat_withdrawal_settings')
            .select('*')
            .limit(1);
          if (error) throw error;
          return data && data.length > 0 ? data[0] : null;
        },
        10 * 60 * 1000
      );

      setSettings(settingsData);
    } catch (err) {
      console.error('Error loading wallet and settings:', err);
      setError(toUserFacingPaymentError(err, 'load'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setWithdrawalAmount(value);
      setError(null);
    }
  };

  const setPresetAmount = (percentage: number) => {
    if (wallet) {
      const amount = Math.floor(wallet.earned_balance * (percentage / 100));
      setWithdrawalAmount(amount.toString());
      setError(null);
    }
  };

  const setMaxAmount = () => {
    if (wallet) {
      setWithdrawalAmount(wallet.earned_balance.toString());
      setError(null);
    }
  };

  const amt = parseInt(withdrawalAmount) || 0;
  const usdGross = settings ? amt * settings.treat_to_usd_rate : 0;
  const fee = settings
    ? (usdGross * (settings.withdrawal_fee_percentage / 100)) + settings.withdrawal_fee_fixed
    : 0;
  const netUsd = Math.max(0, usdGross - fee);

  const handleWithdrawClick = () => {
    setError(null);
    if (!amt || amt <= 0) { setError('Please enter a valid amount'); return; }
    if (!settings) { setError('Withdrawal settings not available'); return; }
    if (amt < settings.minimum_withdrawal_amount) {
      setError(`Minimum withdrawal is ${settings.minimum_withdrawal_amount.toLocaleString()} treats`);
      return;
    }
    if (!wallet || amt > wallet.earned_balance) {
      setError(`Exceeds your earned balance of ${wallet?.earned_balance?.toLocaleString() || 0} treats`);
      return;
    }
    setShowConfirmWithdraw(true);
  };

  const handleConfirmWithdraw = async () => {
    setShowConfirmWithdraw(false);
    if (!settings?.is_withdrawal_enabled) { setError('Withdrawals are currently disabled'); return; }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error: withdrawalError } = await supabase.rpc('process_treat_withdrawal', {
        p_user_id: user.id,
        p_treats_amount: amt
      });

      if (withdrawalError) throw withdrawalError;
      if (data && !data.success) throw new Error(data.error || 'Withdrawal failed');

      treatCache.invalidate(CACHE_KEYS.WALLET(user.id));
      treatCache.invalidatePattern(`transactions:${user.id}`);
      await persistentCache.delete('profile-data');

      setTreatsWithdrawn(amt);
      setNetAmountTransferred(data.net_amount);
      setShowSuccessAnimation(true);
      onSuccess();

      setTimeout(() => { onClose(); }, 5000);
    } catch (err) {
      console.error('Error processing withdrawal:', err);
      setError(toUserFacingPaymentError(err, 'withdrawal'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const canSubmit =
    settings?.is_withdrawal_enabled &&
    amt >= (settings?.minimum_withdrawal_amount ?? 0) &&
    amt <= (wallet?.earned_balance ?? 0) &&
    !isSubmitting;

  /* ─── Loading ─── */
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] z-[110] overflow-y-auto">
        <div className="min-h-screen pb-safe">
          <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all">
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <div className="w-10" />
            </div>
          </header>
          <div className="px-5 pt-4 pb-10 space-y-6">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20 rounded bg-white/10" />
              <Skeleton className="h-9 w-40 rounded bg-white/10" />
            </div>
            <Skeleton className="h-28 rounded-2xl bg-white/10" />
            <Skeleton className="h-28 rounded-2xl bg-white/10" />
            <Skeleton className="h-14 rounded-2xl bg-white/10" />
            <div className="grid grid-cols-4 gap-2">
              {[1,2,3,4].map(i => <Skeleton key={i} className="h-12 rounded-xl bg-white/10" />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Withdrawals disabled ─── */
  if (!settings || !settings.is_withdrawal_enabled) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] z-[110] flex flex-col">
        <header className="w-full py-4 px-5">
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full transition-all">
            <ArrowLeft className="w-5 h-5 text-white" />
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="text-center max-w-xs">
            <div className="w-16 h-16 bg-red-500/15 border border-red-500/30 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-2">
              Unavailable
            </p>
            <h3 className="text-2xl font-black tracking-tight text-white mb-3 leading-none">
              Withdrawals Disabled
            </h3>
            <p className="text-sm text-white/60 leading-relaxed mb-8">
              Treat withdrawals are currently disabled by the administrator.
            </p>
            <button
              onClick={onClose}
              className="w-full py-3.5 rounded-2xl bg-white text-black font-bold text-sm transition-all active:scale-95"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Success ─── */
  if (showSuccessAnimation) {
    return (
      <div className="fixed inset-0 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] z-[110] flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="relative w-36 h-36 mx-auto mb-8 flex items-center justify-center">
            <img
              src="/assets/animations/Done.gif"
              alt="Success"
              className="w-full h-full object-contain"
              onError={(e) => {
                e.currentTarget.style.display = 'none';
                const fb = e.currentTarget.nextElementSibling as HTMLElement;
                if (fb) fb.classList.remove('hidden');
              }}
            />
            <div className="hidden w-24 h-24 bg-[#00ad74] rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-12 h-12 text-white" />
            </div>
          </div>

          <div className="border border-white/10 rounded-2xl p-6 mb-6 bg-white/5 backdrop-blur-sm">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-1">
              Transferred
            </p>
            <p className="text-5xl font-black tracking-tight leading-none text-white mb-2">
              {treatsWithdrawn.toLocaleString()}
            </p>
            <p className="text-sm text-white/50 mb-4">treats</p>
            <div className="border-t border-white/10 pt-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-1">
                Added to Live Balance
              </p>
              <p className="text-2xl font-black tracking-tight text-[#00ad74]">
                ${netAmountTransferred.toFixed(2)} <span className="text-base font-semibold text-white/40">USD</span>
              </p>
            </div>
          </div>

          <p className="text-xs text-white/40 leading-relaxed">
            Closing automatically in a moment…
          </p>
        </div>
      </div>
    );
  }

  /* ─── Main ─── */
  return (
    <div className="fixed inset-0 bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] z-[110] overflow-y-auto">
      <div className="min-h-screen pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">

        {/* Header */}
        <header className="w-full py-4 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <button
              onClick={onClose}
              aria-label="Go back"
              className="p-2 hover:bg-white/10 rounded-full transition-all active:scale-95"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div className="w-10" />
          </div>
        </header>

        <div className="px-5 pt-2 pb-10 space-y-7">

          {/* Title */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-1.5">
              Withdraw
            </p>
            <h1 className="text-3xl font-black tracking-tight leading-none text-white">
              Cash Out
            </h1>
          </div>

          {/* Balance Cards */}
          {wallet && (
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-white/10 rounded-2xl p-4 bg-white/5 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-3">
                  Total Balance
                </p>
                <p className="text-[clamp(0.95rem,4.5vw,1.5rem)] font-black tracking-tight leading-none text-white truncate mb-1">
                  {wallet.balance.toLocaleString()}
                </p>
                <p className="text-xs text-white/30">treats</p>
              </div>

              <div className="border border-[#00ad74]/30 rounded-2xl p-4 bg-[#00ad74]/5 min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-3">
                  Withdrawable
                </p>
                <p className="text-[clamp(0.95rem,4.5vw,1.5rem)] font-black tracking-tight leading-none text-[#00ad74] truncate mb-1">
                  {wallet.earned_balance.toLocaleString()}
                </p>
                <p className="text-xs text-white/30">earned treats</p>
              </div>
            </div>
          )}

          {/* Amount Input */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Amount
              </p>
              <button
                onClick={setMaxAmount}
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#00ad74] hover:opacity-80 transition-opacity"
              >
                Max
              </button>
            </div>

            <input
              type="number"
              inputMode="numeric"
              placeholder={`Min ${settings.minimum_withdrawal_amount.toLocaleString()}`}
              value={withdrawalAmount}
              onChange={handleAmountChange}
              className="w-full bg-transparent border border-white/15 rounded-2xl px-4 py-3.5 text-2xl font-black tracking-tight text-white placeholder:text-white/20 placeholder:text-base placeholder:font-normal placeholder:tracking-normal outline-none focus:ring-1 focus:ring-[#00ad74]/50 focus:border-[#00ad74]/50 transition-all"
            />

            <p className="text-[11px] text-white/30">
              Min {settings.minimum_withdrawal_amount.toLocaleString()} · Max {wallet?.earned_balance?.toLocaleString() ?? 0} treats
            </p>
          </div>

          {/* Preset Buttons */}
          <div className="grid grid-cols-4 gap-2">
            {[25, 50, 75].map(pct => (
              <button
                key={pct}
                onClick={() => setPresetAmount(pct)}
                className="flex flex-col items-center justify-center min-h-[52px] border border-white/10 rounded-xl bg-white/5 hover:bg-white/10 active:scale-95 transition-all duration-150"
              >
                <span className="text-white text-xs font-bold">{pct}%</span>
              </button>
            ))}
            <button
              onClick={setMaxAmount}
              className="flex flex-col items-center justify-center min-h-[52px] rounded-xl bg-white hover:bg-white/90 active:scale-95 transition-all duration-150 shadow-lg"
            >
              <span className="text-black text-xs font-bold tracking-widest">MAX</span>
            </button>
          </div>

          {/* Breakdown */}
          {amt > 0 && (
            <div className="border border-white/10 rounded-2xl overflow-hidden bg-white/5">
              <div className="flex justify-between items-center px-4 py-3.5 border-b border-white/[0.06]">
                <span className="text-sm text-white/50">Amount</span>
                <span className="text-sm font-semibold text-white">{amt.toLocaleString()} treats</span>
              </div>
              {fee > 0 && (
                <div className="flex justify-between items-center px-4 py-3.5 border-b border-white/[0.06]">
                  <span className="text-sm text-white/50">
                    Fee ({settings.withdrawal_fee_percentage}%{settings.withdrawal_fee_fixed > 0 ? ` + $${settings.withdrawal_fee_fixed}` : ''})
                  </span>
                  <span className="text-sm font-semibold text-red-400">−${fee.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between items-center px-4 py-3.5">
                <span className="text-sm font-semibold text-white">You receive</span>
                <div className="text-right">
                  <p className="text-sm font-bold text-[#00ad74]">${netUsd.toFixed(2)} USD</p>
                  <p className="text-[11px] text-white/30">added to Live Balance</p>
                </div>
              </div>
            </div>
          )}

          {/* Validation error */}
          {error && (
            <div className="border border-red-500/30 rounded-xl p-4 bg-red-500/10 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex items-start gap-3 flex-1">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-400 font-medium">{error}</p>
              </div>
              <button type="button" onClick={() => setError(null)} className="sm:ml-auto px-4 py-2 rounded-xl border border-red-400/40 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors whitespace-nowrap">
                {TRY_AGAIN_LABEL}
              </button>
            </div>
          )}

          {/* Inline validation hints */}
          {!error && amt > 0 && amt < settings.minimum_withdrawal_amount && (
            <p className="text-xs text-red-400 font-medium">
              Minimum withdrawal is {settings.minimum_withdrawal_amount.toLocaleString()} treats
            </p>
          )}
          {!error && wallet && amt > wallet.earned_balance && (
            <p className="text-xs text-red-400 font-medium">
              Exceeds your earned balance
            </p>
          )}

          {/* Info note */}
          <p className="text-xs text-white/30 leading-relaxed">
            Only earned treats are withdrawable. Purchased and promo treats cannot be withdrawn.
            Rate: 1 treat = ${settings.treat_to_usd_rate} USD.
          </p>

          {/* Submit */}
          <button
            onClick={handleWithdrawClick}
            disabled={!canSubmit}
            className={cn(
              "w-full min-h-[56px] rounded-2xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2 active:scale-[0.98]",
              canSubmit
                ? "bg-white text-black hover:bg-white/90 shadow-xl"
                : "bg-white/10 text-white/30 cursor-not-allowed"
            )}
          >
            {isSubmitting ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
            ) : amt > 0 ? (
              `Withdraw ${amt.toLocaleString()} Treats`
            ) : (
              'Transfer to Live Balance'
            )}
          </button>

        </div>
      </div>

      {/* Confirm Dialog */}
      <CustomConfirmDialog
        isOpen={showConfirmWithdraw}
        title="Confirm Withdrawal?"
        message={`You are about to withdraw ${withdrawalAmount} treats ($${usdGross.toFixed(2)} USD). After fees, you will receive $${netUsd.toFixed(2)} USD in your Live Balance. This action cannot be undone.`}
        confirmText="Withdraw"
        cancelText="Cancel"
        variant="warning"
        onConfirm={handleConfirmWithdraw}
        onCancel={() => setShowConfirmWithdraw(false)}
        isLoading={isSubmitting}
      />
    </div>
  );
};
