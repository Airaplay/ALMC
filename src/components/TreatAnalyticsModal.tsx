import React, { useState, useEffect } from 'react';
import {
  ArrowLeft, TrendingUp, TrendingDown, Coins, Gift,
  ShoppingCart, ArrowUpRight, History, Loader2, BarChart3,
} from 'lucide-react';
import { ScrollArea, ScrollBar } from '../../components/ui/scroll-area';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

interface AnalyticsData {
  totalPurchased: number;
  totalSpent: number;
  totalEarned: number;
  totalTipped: number;
  totalReceived: number;
  currentBalance: number;
  purchaseCount: number;
  spendCount: number;
  tipsSentCount: number;
  tipsReceivedCount: number;
  avgDailyInflow?: number;
  avgDailyOutflow?: number;
  savingsRate?: number;
}

interface SpendingCategory {
  category: string;
  amount: number;
  percentage: number;
  count: number;
}

const PERIODS = [
  { value: '7d' as const, label: '7 Days' },
  { value: '30d' as const, label: '30 Days' },
  { value: 'all' as const, label: 'All Time' },
];

const fmt = (n: number) => n.toLocaleString();

export const TreatAnalyticsScreen: React.FC = () => {
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState<AnalyticsData>({
    totalPurchased: 0,
    totalSpent: 0,
    totalEarned: 0,
    totalTipped: 0,
    totalReceived: 0,
    currentBalance: 0,
    purchaseCount: 0,
    spendCount: 0,
    tipsSentCount: 0,
    tipsReceivedCount: 0,
    avgDailyInflow: 0,
    avgDailyOutflow: 0,
    savingsRate: 0,
  });
  const [spendingCategories, setSpendingCategories] = useState<SpendingCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timePeriod, setTimePeriod] = useState<'7d' | '30d' | 'all'>('30d');

  useEffect(() => {
    loadAnalytics();
  }, [timePeriod]);

  const loadAnalytics = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const startDate = getStartDate();
      let transactionQuery = supabase
        .from('treat_transactions')
        .select('*')
        .eq('user_id', user.id);

      if (timePeriod !== 'all') {
        transactionQuery = transactionQuery.gte('created_at', startDate);
      }

      const { data: transactions, error: transactionError } = await transactionQuery;
      if (transactionError) throw transactionError;

      const { data: wallet, error: walletError } = await supabase
        .from('treat_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .maybeSingle();
      if (walletError) throw walletError;

      const totalPurchased = transactions?.filter(t => t.transaction_type === 'purchase').reduce((s, t) => s + Number(t.amount), 0) || 0;
      const totalSpent = transactions?.filter(t => t.transaction_type === 'spend').reduce((s, t) => s + Number(t.amount), 0) || 0;
      const totalEarned = transactions?.filter(t => t.transaction_type === 'earn').reduce((s, t) => s + Number(t.amount), 0) || 0;
      const totalTipped = transactions?.filter(t => t.transaction_type === 'tip_sent').reduce((s, t) => s + Number(t.amount), 0) || 0;
      const totalReceived = transactions?.filter(t => t.transaction_type === 'tip_received').reduce((s, t) => s + Number(t.amount), 0) || 0;

      const purchaseCount = transactions?.filter(t => t.transaction_type === 'purchase').length || 0;
      const spendCount = transactions?.filter(t => t.transaction_type === 'spend').length || 0;
      const tipsSentCount = transactions?.filter(t => t.transaction_type === 'tip_sent').length || 0;
      const tipsReceivedCount = transactions?.filter(t => t.transaction_type === 'tip_received').length || 0;

      const totalInflowAmount = totalPurchased + totalEarned + totalReceived;
      const totalOutflowAmount = totalSpent + totalTipped;
      const daysInPeriod = timePeriod === '7d' ? 7 : timePeriod === '30d' ? 30 : 365;

      setAnalytics({
        totalPurchased,
        totalSpent,
        totalEarned,
        totalTipped,
        totalReceived,
        currentBalance: Number(wallet?.balance) || 0,
        purchaseCount,
        spendCount,
        tipsSentCount,
        tipsReceivedCount,
        avgDailyInflow: totalInflowAmount / daysInPeriod,
        avgDailyOutflow: totalOutflowAmount / daysInPeriod,
        savingsRate: totalInflowAmount > 0 ? ((totalInflowAmount - totalOutflowAmount) / totalInflowAmount) * 100 : 0,
      });

      const totalSpending = totalTipped + totalSpent;
      const categoriesArray: SpendingCategory[] = [
        { category: 'Tips Sent', amount: totalTipped, percentage: totalSpending > 0 ? (totalTipped / totalSpending) * 100 : 0, count: tipsSentCount },
        { category: 'Promotions', amount: totalSpent, percentage: totalSpending > 0 ? (totalSpent / totalSpending) * 100 : 0, count: spendCount },
      ].filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);

      setSpendingCategories(categoriesArray);
    } catch (err) {
      console.error('Error loading analytics:', err);
      setError('Failed to load analytics data');
    } finally {
      setIsLoading(false);
    }
  };

  const getStartDate = (): string => {
    const date = new Date();
    if (timePeriod === '7d') date.setDate(date.getDate() - 7);
    else if (timePeriod === '30d') date.setDate(date.getDate() - 30);
    return date.toISOString();
  };

  const totalInflow = analytics.totalPurchased + analytics.totalEarned + analytics.totalReceived;
  const totalOutflow = analytics.totalSpent + analytics.totalTipped;
  const netChange = totalInflow - totalOutflow;

  const getPeriodLabel = () => {
    switch (timePeriod) {
      case '7d': return 'Last 7 Days';
      case '30d': return 'Last 30 Days';
      case 'all': return 'All Time';
      default: return '';
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#0a0a0a] pb-28">

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 bg-[#0a0a0a]/95 backdrop-blur-xl border-b border-white/[0.04] px-5 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="font-['Inter',sans-serif] font-black text-white text-xl tracking-tight leading-tight">
              Treat Analytics,
            </h1>
            <p className="text-white/35 text-xs font-light font-['Inter',sans-serif] leading-tight mt-0.5">
              your financial insights.
            </p>
          </div>
          <button
            onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center active:scale-95 transition-transform flex-shrink-0 mt-0.5"
          >
            <ArrowLeft className="w-4 h-4 text-white/60" />
          </button>
        </div>

        {/* Period pills */}
        <ScrollArea className="w-full">
          <div className="flex gap-2 pb-0.5">
            {PERIODS.map((option) => (
              <button
                key={option.value}
                onClick={() => setTimePeriod(option.value)}
                className={`px-4 py-1.5 rounded-full text-xs font-bold font-['Inter',sans-serif] whitespace-nowrap transition-all active:scale-95 ${
                  timePeriod === option.value
                    ? 'bg-white text-black'
                    : 'bg-white/[0.06] text-white/50 border border-white/[0.08]'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      </header>

      {/* ── Content ── */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-5 space-y-4">

          {/* Loading */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 className="w-6 h-6 text-white/20 animate-spin" />
              <p className="text-white/30 text-xs font-['Inter',sans-serif]">Loading analytics…</p>
            </div>
          )}

          {/* Error */}
          {!isLoading && error && (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/[0.06] p-6 text-center">
              <p className="text-red-400 text-sm font-['Inter',sans-serif] mb-4">{error}</p>
              <button
                onClick={loadAnalytics}
                className="px-5 py-2 rounded-2xl bg-red-500/20 text-red-400 text-xs font-bold font-['Inter',sans-serif] active:scale-95 transition-all"
              >
                Try Again
              </button>
            </div>
          )}

          {/* Data */}
          {!isLoading && !error && (
            <>

              {/* ── Balance + Net row ── */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-2">
                    Balance
                  </p>
                  <p className="font-black text-yellow-400 text-3xl tabular-nums font-['Inter',sans-serif] leading-none">
                    {fmt(analytics.currentBalance)}
                  </p>
                  <p className="text-white/25 text-[10px] mt-1 font-['Inter',sans-serif]">Treats</p>
                </div>
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-2">
                    Net {getPeriodLabel()}
                  </p>
                  <p className={`font-black text-3xl tabular-nums font-['Inter',sans-serif] leading-none ${netChange >= 0 ? 'text-[#00ad74]' : 'text-red-400'}`}>
                    {netChange >= 0 ? '+' : ''}{fmt(netChange)}
                  </p>
                  <p className="text-white/25 text-[10px] mt-1 font-['Inter',sans-serif]">Treats</p>
                </div>
              </div>

              {/* ── In / Out / Retention strip ── */}
              <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
                <div className="grid grid-cols-3 divide-x divide-white/[0.05]">
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-1.5">In</p>
                    <p className="font-black text-[#00ad74] text-lg tabular-nums font-['Inter',sans-serif]">+{fmt(totalInflow)}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-1.5">Out</p>
                    <p className="font-black text-red-400 text-lg tabular-nums font-['Inter',sans-serif]">-{fmt(totalOutflow)}</p>
                  </div>
                  <div className="p-4 text-center">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-1.5">Rate</p>
                    <p className={`font-black text-lg tabular-nums font-['Inter',sans-serif] ${(analytics.savingsRate || 0) >= 0 ? 'text-[#00ad74]' : 'text-red-400'}`}>
                      {(analytics.savingsRate || 0).toFixed(1)}%
                    </p>
                  </div>
                </div>
              </div>

              {/* ── Daily averages ── */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4 flex flex-col items-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-[#00ad74]/15 flex items-center justify-center">
                    <TrendingUp className="w-4.5 h-4.5 text-[#00ad74]" style={{ width: 18, height: 18 }} />
                  </div>
                  <p className="font-black text-white text-xl tabular-nums font-['Inter',sans-serif]">
                    {fmt(Math.round(analytics.avgDailyInflow || 0))}
                  </p>
                  <p className="text-white/30 text-xs font-['Inter',sans-serif]">Daily In</p>
                </div>
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-4 flex flex-col items-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-red-500/15 flex items-center justify-center">
                    <TrendingDown className="w-4.5 h-4.5 text-red-400" style={{ width: 18, height: 18 }} />
                  </div>
                  <p className="font-black text-white text-xl tabular-nums font-['Inter',sans-serif]">
                    {fmt(Math.round(analytics.avgDailyOutflow || 0))}
                  </p>
                  <p className="text-white/30 text-xs font-['Inter',sans-serif]">Daily Out</p>
                </div>
              </div>

              {/* ── Income Sources ── */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-3">
                  Income Sources
                </p>

                {totalInflow > 0 ? (
                  <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden divide-y divide-white/[0.04]">
                    {analytics.totalPurchased > 0 && (
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-9 h-9 rounded-2xl bg-[#00ad74]/15 flex items-center justify-center flex-shrink-0">
                          <ShoppingCart className="w-4 h-4 text-[#00ad74]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white font-['Inter',sans-serif]">Purchased</p>
                          <p className="text-white/35 text-xs font-['Inter',sans-serif]">
                            {analytics.purchaseCount} transaction{analytics.purchaseCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <p className="font-black text-[#00ad74] text-base tabular-nums font-['Inter',sans-serif]">
                          +{fmt(analytics.totalPurchased)}
                        </p>
                      </div>
                    )}
                    {analytics.totalEarned > 0 && (
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-9 h-9 rounded-2xl bg-yellow-500/15 flex items-center justify-center flex-shrink-0">
                          <Coins className="w-4 h-4 text-yellow-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white font-['Inter',sans-serif]">Earned</p>
                          <p className="text-white/35 text-xs font-['Inter',sans-serif]">From ad revenue</p>
                        </div>
                        <p className="font-black text-yellow-400 text-base tabular-nums font-['Inter',sans-serif]">
                          +{fmt(analytics.totalEarned)}
                        </p>
                      </div>
                    )}
                    {analytics.totalReceived > 0 && (
                      <div className="flex items-center gap-3 p-4">
                        <div className="w-9 h-9 rounded-2xl bg-pink-500/15 flex items-center justify-center flex-shrink-0">
                          <Gift className="w-4 h-4 text-pink-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white font-['Inter',sans-serif]">Tips Received</p>
                          <p className="text-white/35 text-xs font-['Inter',sans-serif]">
                            {analytics.tipsReceivedCount} tip{analytics.tipsReceivedCount !== 1 ? 's' : ''}
                          </p>
                        </div>
                        <p className="font-black text-pink-400 text-base tabular-nums font-['Inter',sans-serif]">
                          +{fmt(analytics.totalReceived)}
                        </p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-8 flex flex-col items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center">
                      <TrendingUp className="w-5 h-5 text-white/20" />
                    </div>
                    <p className="text-white/30 text-sm font-['Inter',sans-serif]">No income this period</p>
                  </div>
                )}
              </section>

              {/* ── Spending Breakdown ── */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-3">
                  Spending Breakdown
                </p>

                {spendingCategories.length > 0 ? (
                  <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden divide-y divide-white/[0.04]">
                    {spendingCategories.map((category, i) => {
                      const isPromotion = category.category === 'Promotions';
                      const iconColor = isPromotion ? 'text-orange-400' : 'text-pink-400';
                      const bgColor = isPromotion ? 'bg-orange-500/15' : 'bg-pink-500/15';
                      const barColor = isPromotion ? 'bg-orange-500' : 'bg-pink-500';
                      const Icon = isPromotion ? BarChart3 : Gift;
                      return (
                        <div key={i} className="p-4">
                          <div className="flex items-center gap-3 mb-3">
                            <div className={`w-9 h-9 rounded-2xl ${bgColor} flex items-center justify-center flex-shrink-0`}>
                              <Icon className={`w-4 h-4 ${iconColor}`} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-white font-['Inter',sans-serif]">{category.category}</p>
                              <p className="text-white/35 text-xs font-['Inter',sans-serif]">
                                {category.count} transaction{category.count !== 1 ? 's' : ''}
                              </p>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className={`font-black text-base tabular-nums font-['Inter',sans-serif] ${iconColor}`}>
                                {fmt(category.amount)}
                              </p>
                              <p className="text-white/25 text-[10px] font-['Inter',sans-serif]">{category.percentage.toFixed(1)}%</p>
                            </div>
                          </div>
                          <div className="h-1 rounded-full bg-white/[0.06]">
                            <div
                              className={`h-1 rounded-full transition-all duration-500 ${barColor}`}
                              style={{ width: `${category.percentage}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-8 flex flex-col items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/[0.05] flex items-center justify-center">
                      <TrendingDown className="w-5 h-5 text-white/20" />
                    </div>
                    <p className="text-white/30 text-sm font-['Inter',sans-serif]">No spending this period</p>
                  </div>
                )}
              </section>

              {/* ── View History CTA ── */}
              <button
                onClick={() => navigate('/transaction-history')}
                className="w-full py-4 rounded-3xl border border-white/[0.07] bg-white/[0.03] text-white/50 text-sm font-bold font-['Inter',sans-serif] flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
              >
                <History className="w-4 h-4" />
                View Transaction History
                <ArrowUpRight className="w-4 h-4" />
              </button>

            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
