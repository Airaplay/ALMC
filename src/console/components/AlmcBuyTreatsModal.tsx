import { useEffect, useState } from 'react';
import { AlertCircle, Check, CheckCircle, Coins, Sparkles } from 'lucide-react';
import { AlmcLoader } from './AlmcLoader';
import { supabase, formatTreats } from '../../lib/supabase';
import { PaymentChannelSelector } from '../../components/PaymentChannelSelector';
import {
  convertAmount,
  Currency,
  CurrencyDetectionResult,
  formatCurrencyAmount,
  getUserCurrency,
} from '../../lib/currencyDetection';
import { toUserFacingPaymentError, TRY_AGAIN_LABEL } from '../../lib/criticalErrorMessages';
import { consoleTheme } from '../consoleTheme';
import { AlmcModalShell } from './AlmcModalShell';
import { ConsolePrimaryButton } from './ConsoleFormControls';

interface AlmcBuyTreatsModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

interface TreatPackage {
  id: string;
  treats: number;
  price: number;
  bonus: number;
  popular?: boolean;
  bestValue?: boolean;
}

export function AlmcBuyTreatsModal({ onClose, onSuccess }: AlmcBuyTreatsModalProps) {
  const [packages, setPackages] = useState<TreatPackage[]>([]);
  const [selected, setSelected] = useState<TreatPackage | null>(null);
  const [showPayment, setShowPayment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState('');
  const [currencyData, setCurrencyData] = useState<CurrencyDetectionResult | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setLoading(true);
        const [{ data: pkgs, error: pkgErr }, email, currency] = await Promise.all([
          supabase
            .from('treat_packages')
            .select('*')
            .eq('is_active', true)
            .order('display_order', { ascending: true }),
          supabase.auth.getUser().then((r) => r.data.user?.email ?? ''),
          getUserCurrency(),
        ]);
        if (pkgErr) throw pkgErr;
        const mapped: TreatPackage[] = (pkgs ?? []).map((pkg: Record<string, unknown>) => ({
          id: String(pkg.id),
          treats: Number(pkg.treats) || 0,
          price: Number(pkg.price) || 0,
          bonus: Number(pkg.bonus) || 0,
          popular: Boolean(pkg.is_popular),
          bestValue: Boolean(pkg.is_best_value),
        }));
        setPackages(mapped);
        setSelected(mapped[0] ?? null);
        setUserEmail(email);
        setCurrencyData(currency);
      } catch (err) {
        setError(toUserFacingPaymentError(err, 'load'));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handlePaymentSuccess = (paymentData: Record<string, unknown>) => {
    if (!selected) return;
    const total = selected.treats + selected.bonus;
    setShowPayment(false);
    setSuccess(
      paymentData.status === 'completed'
        ? `Payment successful — ${formatTreats(total)} treats added to your wallet.`
        : 'Payment received — treats will be credited shortly.'
    );
    window.setTimeout(() => {
      onSuccess();
      onClose();
    }, 2000);
  };

  const footer =
    !showPayment && !loading && selected && currencyData ? (
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className={consoleTheme.btnSecondary + ' flex-1'}>
          Cancel
        </button>
        <ConsolePrimaryButton
          type="button"
          className="flex-1"
          onClick={() => {
            setShowPayment(true);
            setError(null);
          }}
        >
          Continue with Flutterwave
        </ConsolePrimaryButton>
      </div>
    ) : null;

  return (
    <AlmcModalShell
      title="Buy Treats"
      subtitle="Fuel your creativity — top up your wallet to promote roster releases."
      onClose={onClose}
      footer={footer}
      size="lg"
      layer="nested"
    >
      {loading ? (
        <div className="flex min-h-[200px] items-center justify-center">
          <AlmcLoader size={36} />
        </div>
      ) : showPayment && selected && currencyData ? (
        <div className="space-y-4">
          <div className={`${consoleTheme.card} p-4`}>
            <p className={consoleTheme.label}>Selected package</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-foreground">
              {formatTreats(selected.treats)}
              {selected.bonus > 0 ? (
                <span className="ml-2 text-base font-semibold text-[var(--almc-lime-deep)]">
                  +{formatTreats(selected.bonus)} bonus
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatCurrencyAmount(convertAmount(selected.price, currencyData.currency), currencyData.currency)}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowPayment(false)}
            className="text-sm font-medium text-[var(--almc-lime-deep)] hover:opacity-90"
          >
            ← Change package
          </button>
          <PaymentChannelSelector
            theme="almc"
            amount={convertAmount(selected.price, currencyData.currency)}
            amountUsd={selected.price}
            packageId={selected.id}
            userEmail={userEmail}
            currencyData={currencyData}
            onCurrencyChange={(c: Currency) =>
              setCurrencyData((prev) => (prev ? { ...prev, currency: c, detected: false } : prev))
            }
            onPaymentSuccess={handlePaymentSuccess}
            onPaymentError={setError}
            onCancel={() => setShowPayment(false)}
          />
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Treats power boosts and promotions for artists linked to your organization. Checkout is
            Flutterwave only in ALMC — pick a package, pay securely, and treats land in your wallet
            once payment confirms.
          </p>

          {error ? (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" className="text-xs font-semibold underline" onClick={() => setError(null)}>
                {TRY_AGAIN_LABEL}
              </button>
            </div>
          ) : null}

          {success ? (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--almc-lime)]/40 bg-[var(--almc-lime)]/15 p-3 text-sm text-foreground">
              <CheckCircle className="h-4 w-4 text-[var(--almc-lime-deep)]" />
              {success}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {packages.map((pkg) => {
              const isSelected = selected?.id === pkg.id;
              return (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => setSelected(pkg)}
                  className={`${consoleTheme.card} relative p-4 text-left transition-all ${
                    isSelected ? 'ring-2 ring-[var(--almc-lime-deep)] ring-offset-2 ring-offset-background' : ''
                  }`}
                >
                  {pkg.popular || pkg.bestValue ? (
                    <span className="absolute right-3 top-3 rounded-full bg-[var(--almc-lime)]/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--almc-lime-deep)]">
                      {pkg.popular ? 'Popular' : 'Best value'}
                    </span>
                  ) : null}
                  <div className="flex items-center gap-2">
                    <div className={consoleTheme.iconWell}>
                      <Coins className="h-4 w-4" />
                    </div>
                    <p className="text-2xl font-bold tabular-nums text-foreground">
                      {formatTreats(pkg.treats)}
                    </p>
                  </div>
                  {pkg.bonus > 0 ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-medium text-[var(--almc-lime-deep)]">
                      <Sparkles className="h-3 w-3" />
                      +{formatTreats(pkg.bonus)} bonus
                    </p>
                  ) : null}
                  {currencyData ? (
                    <p className="mt-3 text-lg font-semibold tabular-nums text-foreground">
                      {formatCurrencyAmount(convertAmount(pkg.price, currencyData.currency), currencyData.currency)}
                    </p>
                  ) : null}
                  {isSelected ? (
                    <Check className="absolute bottom-4 right-4 h-5 w-5 text-[var(--almc-lime-deep)]" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </AlmcModalShell>
  );
}
