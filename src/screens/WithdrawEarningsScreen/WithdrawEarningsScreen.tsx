import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, DollarSign, Wallet, Building2, ChevronRight,
  Check, X, Trash2, Plus, Shield, Loader2, AlertCircle,
  Clock, ShieldCheck,
} from 'lucide-react';
import { supabase, withdrawUserFunds } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useConfirm } from '../../contexts/ConfirmContext';
import { withdrawalCurrencyService, CurrencyConversion } from '../../lib/withdrawalCurrencyService';
import { useAuth } from '../../contexts/AuthContext';

interface WithdrawalMethod {
  id: string;
  method_type: 'usdt_wallet' | 'bank_account';
  wallet_address?: string;
  bank_name?: string;
  account_number?: string;
  account_holder_name?: string;
  swift_code?: string;
  country?: string;
  is_default: boolean;
}

interface WithdrawalSettings {
  withdrawals_enabled: boolean;
  minimum_withdrawal_usd: number;
  exchange_rate: number;
  withdrawal_fee_type: 'percentage' | 'fixed';
  withdrawal_fee_value: number;
  exchange_rate_last_updated: string | null;
}

const DEFAULT_SETTINGS: WithdrawalSettings = {
  withdrawals_enabled: true,
  minimum_withdrawal_usd: 10,
  exchange_rate: 1,
  withdrawal_fee_type: 'percentage',
  withdrawal_fee_value: 0,
  exchange_rate_last_updated: null,
};

const inputCls =
  'w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl px-4 py-3.5 text-white/90 placeholder:text-white/20 text-sm outline-none focus:border-[#00ad74]/50 focus:bg-white/[0.07] transition-all font-["Inter",sans-serif]';

export const WithdrawEarningsScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { confirm } = useConfirm();
  const { user } = useAuth();

  const [withdrawalAmount, setWithdrawalAmount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDestinationPicker, setShowDestinationPicker] = useState(false);
  const [showAddMethod, setShowAddMethod] = useState(false);
  const [selectedMethodType, setSelectedMethodType] = useState<'usdt_wallet' | 'bank_account' | null>(null);
  const [savedMethods, setSavedMethods] = useState<WithdrawalMethod[]>([]);
  const [selectedMethod, setSelectedMethod] = useState<WithdrawalMethod | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [transactionData, setTransactionData] = useState<any>(null);
  const [currentEarnings, setCurrentEarnings] = useState(0);
  const [userCountry, setUserCountry] = useState<string>('US');
  const [localCurrencyConversion, setLocalCurrencyConversion] = useState<CurrencyConversion | null>(null);
  const [withdrawalSettings, setWithdrawalSettings] = useState<WithdrawalSettings | null>(null);
  const [deletingMethodId, setDeletingMethodId] = useState<string | null>(null);
  const [walletValidation, setWalletValidation] = useState<'valid' | 'invalid' | null>(null);
  const [withdrawalLocalCurrency, setWithdrawalLocalCurrency] = useState<CurrencyConversion | null>(null);
  const walletInputRef = useRef<HTMLInputElement>(null);

  const [newMethod, setNewMethod] = useState({
    wallet_address: '',
    bank_name: '',
    account_number: '',
    account_holder_name: '',
    swift_code: '',
    country: '',
  });

  useEffect(() => {
    loadWithdrawalMethods();
    loadCurrentEarnings();
    loadWithdrawalSettings();
    loadUserCurrency();
  }, []);

  useEffect(() => {
    if (currentEarnings > 0 && userCountry) loadCurrencyConversion();
  }, [currentEarnings, userCountry]);

  useEffect(() => {
    if (showAddMethod && selectedMethodType === 'usdt_wallet' && walletInputRef.current) {
      setTimeout(() => walletInputRef.current?.focus(), 100);
    }
  }, [showAddMethod, selectedMethodType]);

  useEffect(() => {
    if (newMethod.wallet_address.length === 0) { setWalletValidation(null); return; }
    const isValid = /^T[A-Za-z1-9]{33}$/.test(newMethod.wallet_address);
    if (newMethod.wallet_address.length === 34) setWalletValidation(isValid ? 'valid' : 'invalid');
    else if (newMethod.wallet_address.length > 34) setWalletValidation('invalid');
    else setWalletValidation(null);
  }, [newMethod.wallet_address]);

  const loadUserCurrency = async () => {
    try {
      if (!user?.id) return;
      const { data } = await supabase.from('users').select('country').eq('id', user.id).maybeSingle();
      if (data?.country) setUserCountry(data.country);
    } catch (err) { console.error('Error loading user currency:', err); }
  };

  const loadCurrencyConversion = async () => {
    try {
      const conversion = await withdrawalCurrencyService.convertUSDToLocal(currentEarnings, userCountry);
      setLocalCurrencyConversion(conversion);
    } catch (err) { console.error('Error converting currency:', err); }
  };

  const loadWithdrawalSettings = async () => {
    try {
      const { data, error } = await supabase.rpc('get_earnings_withdrawal_settings');
      if (error) { setWithdrawalSettings(DEFAULT_SETTINGS); return; }
      setWithdrawalSettings(data && data.length > 0 ? data[0] : DEFAULT_SETTINGS);
    } catch { setWithdrawalSettings(DEFAULT_SETTINGS); }
  };

  const loadCurrentEarnings = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('users').select('total_earnings').eq('id', user.id).single();
      if (data) setCurrentEarnings(data.total_earnings || 0);
    } catch (err) { console.error('Error loading earnings:', err); }
  };

  const loadWithdrawalMethods = async () => {
    try {
      setIsLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error: fetchError } = await supabase
        .from('withdrawal_methods').select('*').eq('user_id', user.id).order('is_default', { ascending: false });
      if (fetchError) throw fetchError;
      setSavedMethods(data || []);
      const def = data?.find((m: any) => m.is_default);
      if (def) setSelectedMethod(def);
    } catch (err) { console.error('Error loading withdrawal methods:', err); }
    finally { setIsLoading(false); }
  };

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d*\.?\d*$/.test(value)) { setWithdrawalAmount(value); setError(null); }
  };

  const setMaxAmount = () => {
    if (!withdrawalSettings || withdrawalSettings.withdrawal_fee_value === 0) {
      setWithdrawalAmount(currentEarnings.toString()); setError(null); return;
    }
    const max = withdrawalSettings.withdrawal_fee_type === 'percentage'
      ? currentEarnings
      : Math.max(0, currentEarnings - withdrawalSettings.withdrawal_fee_value);
    setWithdrawalAmount(max.toFixed(2)); setError(null);
  };

  const handleDeleteMethod = async (methodId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const methodToDelete = savedMethods.find(m => m.id === methodId);
    if (!methodToDelete) return;
    const confirmed = await confirm({
      title: 'Delete Withdrawal Destination',
      message: `Are you sure you want to delete this ${methodToDelete.method_type === 'usdt_wallet' ? 'USDT wallet' : 'bank account'}? This action cannot be undone.`,
      confirmText: 'Delete', cancelText: 'Cancel', variant: 'danger',
    });
    if (!confirmed) return;
    try {
      setDeletingMethodId(methodId); setError(null);
      const { error: deleteError } = await supabase.from('withdrawal_methods').delete().eq('id', methodId);
      if (deleteError) throw deleteError;
      const updated = savedMethods.filter(m => m.id !== methodId);
      setSavedMethods(updated);
      if (selectedMethod?.id === methodId) setSelectedMethod(updated.find(m => m.is_default) || null);
      if (updated.length === 0) setShowDestinationPicker(false);
    } catch { setError('Failed to delete withdrawal destination'); }
    finally { setDeletingMethodId(null); }
  };

  const handleSaveMethod = async () => {
    try {
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      if (selectedMethodType === 'usdt_wallet') {
        if (!newMethod.wallet_address.match(/^T[A-Za-z1-9]{33}$/)) {
          setError('Please enter a valid TRC20 wallet address (starts with T, 34 characters)'); return;
        }
      } else {
        if (!newMethod.bank_name || !newMethod.account_number || !newMethod.account_holder_name || !newMethod.country) {
          setError('Please fill in all required bank account fields'); return;
        }
      }
      const methodData: any = { user_id: user.id, method_type: selectedMethodType, is_default: savedMethods.length === 0 };
      if (selectedMethodType === 'usdt_wallet') {
        methodData.wallet_address = newMethod.wallet_address;
      } else {
        methodData.bank_name = newMethod.bank_name;
        methodData.account_number = newMethod.account_number;
        methodData.account_holder_name = newMethod.account_holder_name;
        methodData.swift_code = newMethod.swift_code || null;
        methodData.country = newMethod.country;
      }
      const { data, error: insertError } = await supabase.from('withdrawal_methods').insert(methodData).select().single();
      if (insertError) throw insertError;
      setSavedMethods([...savedMethods, data]);
      setSelectedMethod(data);
      setShowAddMethod(false);
      setSelectedMethodType(null);
      setNewMethod({ wallet_address: '', bank_name: '', account_number: '', account_holder_name: '', swift_code: '', country: '' });
    } catch { setError('Failed to save withdrawal method'); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const amount = parseFloat(withdrawalAmount);
    if (!withdrawalAmount || isNaN(amount) || amount <= 0) { setError('Please enter a valid withdrawal amount'); return; }
    if (amount > currentEarnings) { setError('Withdrawal amount cannot exceed your current earnings'); return; }
    if (!withdrawalSettings) { setError('Withdrawal settings not available. Please try again.'); return; }
    if (!withdrawalSettings.withdrawals_enabled) { setError('Withdrawals are currently disabled by administrator.'); return; }
    if (amount < withdrawalSettings.minimum_withdrawal_usd) { setError(`Minimum withdrawal amount is $${withdrawalSettings.minimum_withdrawal_usd.toFixed(2)}`); return; }
    if (!selectedMethod) { setError('Please select a withdrawal destination'); return; }
    setIsSubmitting(true);
    try {
      const result = await withdrawUserFunds(amount, selectedMethod.id);
      if (result?.success) {
        setTransactionData(result);
        if (result.amounts?.local) {
          setWithdrawalLocalCurrency({
            amount: result.amounts.local.amount,
            currency_code: result.amounts.local.currency_code,
            currency_symbol: result.amounts.local.currency_symbol,
            formatted: result.amounts.local.formatted,
          });
        }
        setShowConfirmation(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred while processing your withdrawal');
    } finally { setIsSubmitting(false); }
  };

  const calculateFees = (): number => {
    if (!withdrawalAmount || !withdrawalSettings) return 0;
    const amount = parseFloat(withdrawalAmount);
    if (isNaN(amount)) return 0;
    return withdrawalSettings.withdrawal_fee_type === 'percentage'
      ? amount * (withdrawalSettings.withdrawal_fee_value / 100)
      : withdrawalSettings.withdrawal_fee_value;
  };

  const calculateNetAmount = (): number => {
    if (!withdrawalAmount) return 0;
    const amount = parseFloat(withdrawalAmount);
    if (isNaN(amount)) return 0;
    return Math.max(0, amount - calculateFees());
  };

  /* ── Success screen ── */
  if (showConfirmation) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-[100] overflow-y-auto">
        <header className="sticky top-0 z-20 px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/8 active:scale-95 transition-transform"
            >
              <X className="w-4 h-4 text-white/80" />
            </button>
            <div>
              <h1 className="font-['Inter',sans-serif] font-black text-white text-2xl tracking-tight leading-tight">
                Withdrawal,
              </h1>
              <p className="text-white/40 text-base font-light leading-tight">status update.</p>
            </div>
          </div>
        </header>

        <div className="px-5 pt-4 pb-10 space-y-4">
          <div className="relative rounded-3xl overflow-hidden border border-[#00ad74]/20 bg-gradient-to-br from-[#00ad74]/15 via-[#009c68]/10 to-transparent p-8 text-center">
            <div className="absolute top-0 right-0 w-40 h-40 bg-[#00ad74]/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
            <div className="relative">
              <div className="flex items-center justify-center gap-2 mb-5">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ad74] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00ad74]" />
                </span>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00ad74]">Submitted</p>
              </div>

              <p
                className="font-['Inter',sans-serif] font-black text-[#00ad74] leading-none tracking-tight mb-1 tabular-nums"
                style={{ fontSize: 'clamp(2.5rem, 14vw, 4rem)' }}
              >
                ${transactionData?.amounts?.usd?.net
                  ? transactionData.amounts.usd.net.toFixed(2)
                  : parseFloat(withdrawalAmount).toFixed(2)}
              </p>
              <p className="text-[12px] text-white/35 font-semibold uppercase tracking-widest mb-2">USD</p>

              {withdrawalLocalCurrency && withdrawalLocalCurrency.currency_code !== 'USD' && (
                <p className="text-base text-white/60 font-semibold mb-4">{withdrawalLocalCurrency.formatted}</p>
              )}

              <p className="text-sm text-white/40 mt-1">Your withdrawal request has been received and is now being processed.</p>
            </div>
          </div>

          {transactionData && (
            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] px-5 py-5 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Transaction Details</p>
              <div className="space-y-2.5 text-sm">
                <div className="flex justify-between text-white/50">
                  <span>Transaction ID</span>
                  <span className="font-mono text-white/70 font-semibold text-xs">{transactionData.transaction_id}</span>
                </div>
                {transactionData.user_country && (
                  <div className="flex justify-between text-white/50">
                    <span>Country</span>
                    <span className="text-white/70 font-semibold">{transactionData.user_country}</span>
                  </div>
                )}
                {transactionData.fee_amount > 0 && (
                  <>
                    <div className="flex justify-between text-white/50">
                      <span>Gross Amount</span>
                      <span className="text-white/70 font-semibold">${transactionData.gross_amount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-white/50">
                      <span>
                        Fee ({transactionData.service_fee.type === 'percentage'
                          ? `${transactionData.service_fee.value}%`
                          : `$${transactionData.service_fee.value} fixed`})
                      </span>
                      <span className="text-red-400 font-semibold">-${transactionData.fee_amount.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/[0.06] pt-2.5 font-bold">
                      <span className="text-white/70">Net Amount</span>
                      <span className="text-[#00ad74]">${transactionData.net_amount.toFixed(2)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-[#00ad74]/8 border border-[#00ad74]/15">
            <Clock className="w-4 h-4 text-[#00ad74]/60 shrink-0" />
            <p className="text-xs text-white/40">Processing time: 1–3 business days</p>
          </div>

          <button
            onClick={() => navigate(-1)}
            className="w-full py-4 rounded-2xl bg-white text-black font-black text-sm font-['Inter',sans-serif] active:scale-[0.98] transition-transform"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  /* ── Loading ── */
  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-white/30" />
      </div>
    );
  }

  const amountNum = parseFloat(withdrawalAmount) || 0;
  const fees = calculateFees();
  const netAmount = calculateNetAmount();

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-[100] overflow-y-auto">

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/8 active:scale-95 transition-transform"
            >
              <ArrowLeft className="w-4 h-4 text-white/80" />
            </button>
            <div>
              <h1 className="font-['Inter',sans-serif] font-black text-white text-2xl tracking-tight leading-tight">
                Withdraw Earnings,
              </h1>
              <p className="text-white/40 text-base font-light leading-tight">cash out your balance.</p>
            </div>
          </div>
        </div>
      </header>

      <div className="px-5 pt-2 pb-10 space-y-4">

        {/* ── Withdrawals Disabled Banner ── */}
        {withdrawalSettings && !withdrawalSettings.withdrawals_enabled && (
          <div className="flex items-start gap-3 px-4 py-3.5 rounded-2xl bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-400">Withdrawals Disabled</p>
              <p className="text-xs text-red-400/60 mt-0.5">The platform has temporarily disabled withdrawals.</p>
            </div>
          </div>
        )}

        {/* ── Earnings Balance Card ── */}
        <div className="relative rounded-3xl overflow-hidden border border-[#00ad74]/20 bg-gradient-to-br from-[#00ad74]/15 via-[#009c68]/10 to-transparent">
          <div className="absolute top-0 right-0 w-36 h-36 bg-[#00ad74]/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
          <div className="relative px-5 py-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#00ad74]/50 mb-0.5">Available Earnings</p>
                <p
                  className="font-['Inter',sans-serif] font-black text-[#00ad74] leading-none tabular-nums"
                  style={{ fontSize: 'clamp(2rem, 10vw, 3rem)' }}
                >
                  ${currentEarnings.toFixed(2)}
                </p>
                {localCurrencyConversion && localCurrencyConversion.currency_code !== 'USD' && (
                  <p className="text-sm text-white/40 font-medium mt-1">≈ {localCurrencyConversion.formatted}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 pt-1">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3 text-[#00ad74]/50" />
                  <p className="text-[10px] text-white/30 font-semibold">Min. ${withdrawalSettings?.minimum_withdrawal_usd ?? 10}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3 h-3 text-[#00ad74]/50" />
                  <p className="text-[10px] text-white/30 font-semibold">1–3 business days</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Destination ── */}
        <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between mb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Destination</p>
              {savedMethods.length > 0 && !showAddMethod && !showDestinationPicker && (
                <button
                  onClick={() => setShowAddMethod(true)}
                  className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#00ad74]/60 active:opacity-60 transition-opacity"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              )}
            </div>

            {/* Selected method pill */}
            {!showAddMethod && !showDestinationPicker && selectedMethod && (
              <button
                onClick={() => setShowDestinationPicker(true)}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left group"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  selectedMethod.method_type === 'usdt_wallet' ? 'bg-white/10' : 'bg-[#00ad74]/15'
                }`}>
                  {selectedMethod.method_type === 'usdt_wallet'
                    ? <Wallet className="w-4 h-4 text-white/60" />
                    : <Building2 className="w-4 h-4 text-[#00ad74]" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white/90">
                    {selectedMethod.method_type === 'usdt_wallet' ? 'USDT Wallet' : 'Bank Account'}
                  </p>
                  <p className="text-[11px] text-white/35 truncate">
                    {selectedMethod.method_type === 'usdt_wallet'
                      ? `${selectedMethod.wallet_address?.slice(0, 8)}…${selectedMethod.wallet_address?.slice(-6)}`
                      : `${selectedMethod.bank_name} · ····${selectedMethod.account_number?.slice(-4)}`
                    }
                  </p>
                </div>
                <ChevronRight className="w-4 h-4 text-white/20 group-active:translate-x-0.5 transition-transform shrink-0" />
              </button>
            )}

            {/* No method yet */}
            {!showAddMethod && !showDestinationPicker && !selectedMethod && (
              <button
                onClick={() => savedMethods.length > 0 ? setShowDestinationPicker(true) : setShowAddMethod(true)}
                className="w-full py-8 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/[0.08] active:bg-white/[0.03] transition-colors"
              >
                <div className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center">
                  <Plus className="w-5 h-5 text-white/25" />
                </div>
                <p className="text-sm font-semibold text-white/40">Add Withdrawal Destination</p>
                <p className="text-[11px] text-white/20">USDT wallet or bank account</p>
              </button>
            )}

            {/* Destination picker */}
            {showDestinationPicker && (
              <div className="space-y-1.5">
                {savedMethods.map(m => (
                  <div key={m.id} className="flex items-center gap-2">
                    <button
                      onClick={() => { setSelectedMethod(m); setShowDestinationPicker(false); }}
                      className={`flex-1 flex items-center gap-3 px-3 py-3 rounded-2xl transition-colors text-left ${
                        selectedMethod?.id === m.id ? 'bg-[#00ad74]/10 border border-[#00ad74]/20' : 'bg-white/[0.04] active:bg-white/[0.08]'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                        m.method_type === 'usdt_wallet' ? 'bg-white/10' : 'bg-[#00ad74]/15'
                      }`}>
                        {m.method_type === 'usdt_wallet'
                          ? <Wallet className="w-3.5 h-3.5 text-white/60" />
                          : <Building2 className="w-3.5 h-3.5 text-[#00ad74]" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold text-white/90 truncate">
                            {m.method_type === 'usdt_wallet' ? 'USDT Wallet' : m.bank_name}
                          </p>
                          {m.is_default && (
                            <span className="text-[9px] font-bold uppercase tracking-widest text-[#00ad74]/60 shrink-0">Default</span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/30 truncate">
                          {m.method_type === 'usdt_wallet'
                            ? `${m.wallet_address?.slice(0, 8)}…${m.wallet_address?.slice(-6)}`
                            : `····${m.account_number?.slice(-4)}`
                          }
                        </p>
                      </div>
                      {selectedMethod?.id === m.id && <Check className="w-3.5 h-3.5 text-[#00ad74] shrink-0" />}
                    </button>
                    <button
                      onClick={(e) => handleDeleteMethod(m.id, e)}
                      disabled={deletingMethodId === m.id}
                      className="p-2.5 rounded-xl bg-red-500/10 active:bg-red-500/20 transition-colors"
                    >
                      {deletingMethodId === m.id
                        ? <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />
                        : <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      }
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => { setShowDestinationPicker(false); setShowAddMethod(true); }}
                  className="w-full py-3 rounded-2xl border border-dashed border-white/[0.06] text-[11px] text-white/30 font-semibold active:bg-white/[0.03] transition-colors"
                >
                  + Add New Destination
                </button>
                <button
                  onClick={() => setShowDestinationPicker(false)}
                  className="w-full py-2 text-[11px] text-white/25 font-semibold"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Add method — type selection */}
            {showAddMethod && !selectedMethodType && (
              <div className="space-y-2">
                <button
                  onClick={() => setSelectedMethodType('usdt_wallet')}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                    <Wallet className="w-4 h-4 text-white/60" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white/90">USDT Wallet Address</p>
                    <p className="text-[11px] text-white/30">TRC20 Network</p>
                  </div>
                </button>
                <button
                  onClick={() => setSelectedMethodType('bank_account')}
                  className="w-full flex items-center gap-3 px-4 py-4 rounded-2xl bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#00ad74]/15 flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-[#00ad74]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white/90">Bank Account Details</p>
                    <p className="text-[11px] text-white/30">International Transfer</p>
                  </div>
                </button>
                <button
                  onClick={() => { setShowAddMethod(false); if (savedMethods.length > 0) setShowDestinationPicker(true); }}
                  className="w-full py-2.5 text-[11px] text-white/25 font-semibold"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Add method — USDT form */}
            {showAddMethod && selectedMethodType === 'usdt_wallet' && (
              <div className="space-y-3">
                <div className="relative">
                  <input
                    ref={walletInputRef}
                    type="text"
                    value={newMethod.wallet_address}
                    onChange={(e) => setNewMethod({ ...newMethod, wallet_address: e.target.value })}
                    placeholder="T…"
                    autoComplete="off"
                    className={`${inputCls} pr-10 ${
                      walletValidation === 'valid' ? 'border-[#00ad74]/50' :
                      walletValidation === 'invalid' ? 'border-red-500/50' : ''
                    }`}
                  />
                  {walletValidation && (
                    <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
                      {walletValidation === 'valid'
                        ? <Check className="w-4 h-4 text-[#00ad74]" />
                        : <X className="w-4 h-4 text-red-400" />
                      }
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-white/25 px-1">TRC20 address — 34 characters, starts with T</p>
                {walletValidation === 'invalid' && (
                  <p className="text-[11px] text-red-400 px-1">Invalid TRC20 address. Must be 34 characters starting with 'T'</p>
                )}
                <div className="flex gap-2.5 pt-1">
                  <button
                    onClick={() => { setSelectedMethodType(null); setNewMethod({ ...newMethod, wallet_address: '' }); }}
                    className="flex-1 py-3.5 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/50 text-sm font-semibold active:bg-white/[0.08] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSaveMethod}
                    disabled={walletValidation !== 'valid'}
                    className="flex-1 py-3.5 rounded-2xl bg-white text-black text-sm font-black font-['Inter',sans-serif] disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Add method — Bank form */}
            {showAddMethod && selectedMethodType === 'bank_account' && (
              <div className="space-y-3">
                {[
                  { key: 'country', placeholder: 'Country', autoComplete: 'country-name' },
                  { key: 'bank_name', placeholder: 'Bank Name', autoComplete: 'off' },
                  { key: 'account_number', placeholder: 'Account Number', autoComplete: 'off', inputMode: 'numeric' as const },
                  { key: 'account_holder_name', placeholder: 'Account Holder Name', autoComplete: 'name' },
                  { key: 'swift_code', placeholder: 'SWIFT / BIC Code (optional)', autoComplete: 'off' },
                ].map(({ key, placeholder, autoComplete, inputMode }) => (
                  <input
                    key={key}
                    type="text"
                    value={(newMethod as any)[key]}
                    onChange={(e) => setNewMethod({ ...newMethod, [key]: e.target.value })}
                    placeholder={placeholder}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    className={inputCls}
                  />
                ))}
                <div className="flex gap-2.5 pt-1">
                  <button
                    onClick={() => {
                      setSelectedMethodType(null);
                      setNewMethod({ wallet_address: '', bank_name: '', account_number: '', account_holder_name: '', swift_code: '', country: '' });
                    }}
                    className="flex-1 py-3.5 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/50 text-sm font-semibold active:bg-white/[0.08] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSaveMethod}
                    disabled={!newMethod.bank_name || !newMethod.account_number || !newMethod.account_holder_name || !newMethod.country}
                    className="flex-1 py-3.5 rounded-2xl bg-white text-black text-sm font-black font-['Inter',sans-serif] disabled:opacity-30 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
                  >
                    Save
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Amount ── */}
        <form onSubmit={handleSubmit}>
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] px-5 py-5 space-y-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Withdrawal Amount</p>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30 text-sm font-bold font-['Inter',sans-serif]">$</span>
                <input
                  type="text"
                  value={withdrawalAmount}
                  onChange={handleAmountChange}
                  disabled={!selectedMethod}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl pl-8 pr-4 py-3.5 text-white/90 placeholder:text-white/20 text-xl font-black font-['Inter',sans-serif] outline-none focus:border-[#00ad74]/50 focus:bg-white/[0.07] transition-all disabled:opacity-40 tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={setMaxAmount}
                disabled={!selectedMethod}
                className="px-4 py-3.5 rounded-2xl bg-[#00ad74]/15 text-[#00ad74] text-xs font-black font-['Inter',sans-serif] tracking-widest uppercase active:scale-[0.96] disabled:opacity-30 transition-all"
              >
                MAX
              </button>
            </div>

            <div className="flex justify-between text-[10px] text-white/25 font-semibold px-1">
              <span>Min: ${withdrawalSettings?.minimum_withdrawal_usd ?? 10}</span>
              <span>Available: ${currentEarnings.toFixed(2)}</span>
            </div>

            {/* Fee breakdown */}
            {amountNum > 0 && withdrawalSettings && (
              <div className="rounded-2xl bg-white/[0.03] border border-white/[0.05] px-4 py-3.5 space-y-2.5 text-[13px]">
                <div className="flex justify-between text-white/40">
                  <span>Gross amount</span>
                  <span className="text-white/70 font-semibold">${amountNum.toFixed(2)}</span>
                </div>
                {fees > 0 && (
                  <div className="flex justify-between text-white/40">
                    <span>
                      Fee ({withdrawalSettings.withdrawal_fee_type === 'percentage'
                        ? `${withdrawalSettings.withdrawal_fee_value}%`
                        : `$${withdrawalSettings.withdrawal_fee_value} fixed`})
                    </span>
                    <span className="text-red-400 font-semibold">−${fees.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-white/[0.06] pt-2.5 font-bold">
                  <span className="text-white/60">You receive</span>
                  <span className="text-[#00ad74]">${netAmount.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* Validation */}
            {amountNum > 0 && withdrawalSettings && amountNum < withdrawalSettings.minimum_withdrawal_usd && (
              <p className="text-[11px] text-red-400 font-semibold">Minimum withdrawal is ${withdrawalSettings.minimum_withdrawal_usd}</p>
            )}
            {amountNum > currentEarnings && (
              <p className="text-[11px] text-red-400 font-semibold">Exceeds your available balance</p>
            )}
          </div>

          {/* ── Info panel ── */}
          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] px-5 py-5 space-y-3 mt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Withdrawal Info</p>
            <ul className="space-y-2 text-[12px] text-white/35">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-white/20">•</span>
                <span>Processing time: 1–3 business days</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-white/20">•</span>
                <span>Network: USDT (TRC-20)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-white/20">•</span>
                <span>
                  {withdrawalSettings && withdrawalSettings.withdrawal_fee_value > 0
                    ? `Fee: ${withdrawalSettings.withdrawal_fee_type === 'percentage' ? `${withdrawalSettings.withdrawal_fee_value}%` : `$${withdrawalSettings.withdrawal_fee_value.toFixed(2)} fixed`}`
                    : 'No withdrawal fees'
                  }
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-white/20">•</span>
                <span>Minimum: ${withdrawalSettings?.minimum_withdrawal_usd ?? 10}.00</span>
              </li>
            </ul>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="mt-4 px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20">
              <p className="text-red-400 text-sm font-medium">{error}</p>
            </div>
          )}

          {/* ── Trust row ── */}
          <div className="flex items-center justify-center gap-5 mt-4 text-[10px] text-white/20 font-semibold">
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3" /> Secure Transfer</span>
            <span className="w-px h-3 bg-white/[0.08]" />
            <span className="flex items-center gap-1.5"><Check className="w-3 h-3" /> Verified Process</span>
          </div>

          {/* ── Actions ── */}
          <div className="flex gap-2.5 mt-4">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 py-4 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/50 text-sm font-semibold active:bg-white/[0.08] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedMethod || !withdrawalAmount || parseFloat(withdrawalAmount) <= 0 || showAddMethod}
              className={`flex-1 py-4 rounded-2xl text-sm font-black font-['Inter',sans-serif] transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                !isSubmitting && selectedMethod && parseFloat(withdrawalAmount) > 0 && !showAddMethod
                  ? 'bg-white text-black'
                  : 'bg-white/[0.05] text-white/20 cursor-not-allowed border border-white/[0.07]'
              }`}
            >
              {isSubmitting
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Processing…</>
                : amountNum > 0 ? `Withdraw $${netAmount.toFixed(2)}` : 'Withdraw'
              }
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
