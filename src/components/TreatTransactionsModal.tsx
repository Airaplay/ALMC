import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X, ShoppingCart, Sparkles, Gift, Megaphone, Wallet,
  ArrowUpRight, ArrowDownLeft, Clock, RefreshCw, Loader2,
  CheckCircle2, AlertCircle, XCircle,
} from 'lucide-react';
import { ScrollArea, ScrollBar } from './ui/scroll-area';
import { supabase } from '../lib/supabase';
import { cn } from '../lib/utils';
import {
  format, formatDistanceToNowStrict,
  isToday, isYesterday, isThisWeek, isThisMonth,
} from 'date-fns';

interface TreatTransactionsModalProps {
  onClose: () => void;
}

interface TreatTransaction {
  id: string;
  user_id?: string;
  transaction_type: 'purchase' | 'spend' | 'earn' | 'withdraw' | 'tip_sent' | 'tip_received';
  amount: number;
  balance_before: number;
  balance_after: number;
  description: string;
  metadata: any;
  payment_method: string | null;
  payment_reference: string | null;
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  created_at: string;
}

/* ─── Helpers ─── */
const fmt = (n: number) => n.toLocaleString();

function groupByDateBucket(txs: TreatTransaction[]): Map<string, TreatTransaction[]> {
  const groups = new Map<string, TreatTransaction[]>();
  for (const tx of txs) {
    const d = new Date(tx.created_at);
    let bucket: string;
    if (isToday(d))          bucket = 'Today';
    else if (isYesterday(d)) bucket = 'Yesterday';
    else if (isThisWeek(d))  bucket = 'This Week';
    else if (isThisMonth(d)) bucket = 'This Month';
    else                     bucket = format(d, 'MMMM yyyy');
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(tx);
  }
  return groups;
}

function getTxIcon(type: string) {
  const t = type.toLowerCase();
  if (t === 'purchase')      return <ShoppingCart className="w-4 h-4 text-emerald-400" />;
  if (t === 'earn')          return <Sparkles className="w-4 h-4 text-[#00ad74]" />;
  if (t === 'tip_received')  return <Gift className="w-4 h-4 text-emerald-400" />;
  if (t === 'tip_sent')      return <Gift className="w-4 h-4 text-pink-400" />;
  if (t.includes('promo'))   return <Megaphone className="w-4 h-4 text-orange-400" />;
  if (t === 'withdraw')      return <Wallet className="w-4 h-4 text-red-400" />;
  if (t === 'spend')         return <ArrowUpRight className="w-4 h-4 text-red-400" />;
  return <Clock className="w-4 h-4 text-muted-foreground" />;
}

function getIconBg(type: string) {
  const t = type.toLowerCase();
  if (t === 'tip_sent')     return 'bg-pink-500/15';
  if (t.includes('promo'))  return 'bg-orange-500/15';
  if (t === 'withdraw')     return 'bg-red-500/15';
  if (t === 'spend')        return 'bg-red-500/15';
  if (t === 'earn')         return 'bg-[#00ad74]/10';
  return 'bg-emerald-500/15';
}

function isInflow(type: string) {
  return ['purchase', 'earn', 'tip_received'].includes(type.toLowerCase());
}

function getAmountColor(type: string) {
  return isInflow(type) ? 'text-emerald-400' : 'text-red-400';
}

function getAmountPrefix(type: string) {
  return isInflow(type) ? '+' : '-';
}

function formatTxType(type: string): string {
  switch (type) {
    case 'purchase':     return 'Purchase';
    case 'spend':        return 'Spent';
    case 'earn':         return 'Earned';
    case 'withdraw':     return 'Withdrawal';
    case 'tip_sent':     return 'Treat Sent';
    case 'tip_received': return 'Treat Received';
    default:             return type.replace(/_/g, ' ');
  }
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pending:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  failed:    'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-white/5 text-white/40 border-white/10',
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircle2 className="w-3 h-3" />;
    case 'pending':   return <Clock className="w-3 h-3" />;
    case 'failed':    return <XCircle className="w-3 h-3" />;
    case 'cancelled': return <AlertCircle className="w-3 h-3" />;
    default:          return <Clock className="w-3 h-3" />;
  }
}

const FILTER_TABS = [
  { value: 'all',          label: 'All' },
  { value: 'purchase',     label: 'Purchases' },
  { value: 'tip_sent',     label: 'Treats' },
  { value: 'tip_received', label: 'Received' },
  { value: 'withdraw',     label: 'Withdrawals' },
];

export const TreatTransactionsModal: React.FC<TreatTransactionsModalProps> = ({ onClose }) => {
  const [transactions, setTransactions] = useState<TreatTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    const event = new CustomEvent('treatTransactionsModalVisibilityChange', { detail: { isVisible: true } });
    window.dispatchEvent(event);
    return () => {
      const closeEvent = new CustomEvent('treatTransactionsModalVisibilityChange', { detail: { isVisible: false } });
      window.dispatchEvent(closeEvent);
    };
  }, []);

  const loadTransactions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let query = supabase
        .from('treat_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (filter !== 'all') query = query.eq('transaction_type', filter);

      const { data, error: txError } = await query;
      if (txError) throw txError;
      setTransactions(data || []);
    } catch (err) {
      setError('Failed to load transaction history');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadTransactions();
    const channel = supabase
      .channel('transactions_updates')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'treat_transactions' }, (payload) => {
        const newTx = payload.new as TreatTransaction;
        supabase.auth.getUser().then(({ data: { user } }) => {
          if (user && user.id === newTx.user_id) {
            setTransactions((prev) => [newTx, ...prev].slice(0, 50));
          }
        });
      })
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [loadTransactions]);

  const grouped = useMemo(() => groupByDateBucket(transactions), [transactions]);

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center sm:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative w-full max-w-md bg-[#0d0d0d] border border-white/10 rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col max-h-[92dvh] sm:max-h-[88vh] overflow-hidden">

        {/* Drag pill (mobile) */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden flex-shrink-0">
          <div className="w-10 h-1 rounded-full bg-white/20" />
        </div>

        {/* ── Header ── */}
        <div className="flex-shrink-0 px-5 pt-3 pb-4 sm:pt-5 border-b border-white/8">
          <div className="flex items-start justify-between mb-1">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-white/40 mb-1">
                Treat Wallet
              </p>
              <h2 className="text-xl font-black tracking-tight text-white leading-none">
                Transaction History
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors active:scale-95 mt-0.5"
              aria-label="Close"
            >
              <X className="w-4.5 h-4.5 text-white/70" />
            </button>
          </div>
          {!isLoading && !error && (
            <p className="text-[11px] text-white/40 mt-1.5">
              {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} · Complete activity log
            </p>
          )}
        </div>

        {/* ── Filter Tabs ── */}
        <div className="flex-shrink-0 px-5 py-3 border-b border-white/8">
          <ScrollArea className="w-full">
            <div className="flex gap-2 pb-0.5">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value)}
                  className={cn(
                    'whitespace-nowrap px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all duration-200 active:scale-95',
                    filter === tab.value
                      ? 'bg-white text-black shadow'
                      : 'bg-white/8 text-white/60 hover:bg-white/14 hover:text-white'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="opacity-0 h-0" />
          </ScrollArea>
        </div>

        {/* ── Refresh row ── */}
        <div className="flex-shrink-0 flex items-center justify-end px-5 py-2">
          <button
            onClick={loadTransactions}
            disabled={isLoading}
            className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] uppercase text-white/30 hover:text-white/60 transition-colors active:scale-95"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('w-3 h-3', isLoading && 'animate-spin')} />
            Refresh
          </button>
        </div>

        {/* ── Content ── */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 pb-8">

            {/* Loading skeleton */}
            {isLoading && (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-1 py-3">
                    <div className="w-10 h-10 bg-white/8 rounded-full animate-pulse flex-shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-3.5 w-28 bg-white/8 rounded-full animate-pulse" />
                      <div className="h-2.5 w-40 bg-white/6 rounded-full animate-pulse" />
                    </div>
                    <div className="h-3.5 w-16 bg-white/8 rounded-full animate-pulse" />
                  </div>
                ))}
              </div>
            )}

            {/* Error state */}
            {!isLoading && error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-6 text-center mx-1 mt-2">
                <p className="text-red-400 text-sm mb-3">{error}</p>
                <button
                  onClick={loadTransactions}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 rounded-xl text-red-400 text-xs font-semibold transition-colors active:scale-95"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Empty state */}
            {!isLoading && !error && transactions.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
                  <Clock className="w-7 h-7 text-white/20" />
                </div>
                <h3 className="text-base font-bold text-white mb-1.5 tracking-tight">
                  No Transactions Yet
                </h3>
                <p className="text-xs text-white/40 leading-relaxed max-w-[220px]">
                  {filter === 'all'
                    ? 'Your treat activity will appear here once you start using treats'
                    : `No ${filter.replace(/_/g, ' ')} transactions found`}
                </p>
              </div>
            )}

            {/* Transaction list grouped by date */}
            {!isLoading && !error && transactions.length > 0 && (
              <div className="space-y-6 mt-1">
                {Array.from(grouped.entries()).map(([bucket, txs]) => (
                  <div key={bucket}>
                    {/* Date bucket label */}
                    <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-white/30 mb-2 px-1">
                      {bucket}
                    </p>

                    {/* Card group */}
                    <div className="bg-white/4 border border-white/8 rounded-2xl overflow-hidden divide-y divide-white/6">
                      {txs.map((tx) => {
                        const inflow = isInflow(tx.transaction_type);
                        const statusStyle = STATUS_STYLES[tx.status?.toLowerCase()] ?? STATUS_STYLES.cancelled;
                        return (
                          <div
                            key={tx.id}
                            className="flex items-center gap-3 px-4 py-3.5 hover:bg-white/5 active:bg-white/8 transition-colors"
                          >
                            {/* Icon */}
                            <div className={cn(
                              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
                              getIconBg(tx.transaction_type)
                            )}>
                              {getTxIcon(tx.transaction_type)}
                            </div>

                            {/* Info */}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-white truncate leading-tight">
                                {tx.description || formatTxType(tx.transaction_type)}
                              </p>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-[10px] text-white/35">
                                  {formatDistanceToNowStrict(new Date(tx.created_at), { addSuffix: true })}
                                </span>
                                {tx.status && (
                                  <span className={cn(
                                    'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-semibold tracking-wide capitalize border',
                                    statusStyle
                                  )}>
                                    <StatusIcon status={tx.status} />
                                    {tx.status}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Amount */}
                            <div className="text-right flex-shrink-0">
                              <p className={cn(
                                'text-sm font-black tracking-tight',
                                getAmountColor(tx.transaction_type)
                              )}>
                                {getAmountPrefix(tx.transaction_type)}{fmt(tx.amount)}
                              </p>
                              {tx.balance_after !== null && (
                                <p className="text-[10px] text-white/25 mt-0.5">
                                  Bal {fmt(tx.balance_after)}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

          </div>
        </ScrollArea>

        {/* Safe area spacer */}
        <div className="flex-shrink-0 h-safe-bottom sm:h-0" />
      </div>
    </div>
  );
};
