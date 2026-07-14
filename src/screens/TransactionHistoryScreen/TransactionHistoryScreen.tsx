import React, { useState, useEffect } from 'react';
import { ArrowLeft, Clock, ArrowUpRight, ArrowDownLeft, Gift, Download, ShoppingCart, Filter, X, Calendar, DollarSign, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/card';
import { ScrollArea, ScrollBar } from '../../components/ui/scroll-area';
import { supabase } from '../../lib/supabase';
import { formatDistanceToNowStrict, format, isToday, isYesterday, isThisWeek, parseISO } from 'date-fns';
import { useNavigate } from 'react-router-dom';

interface TreatTransaction {
  id: string;
  user_id?: string;
  transaction_type: 'purchase' | 'spend' | 'earn' | 'withdraw' | 'tip_sent' | 'tip_received' | 'promotion_spent' | 'daily_checkin' | 'referral_bonus';
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

interface FilterState {
  type: string;
  dateRange: 'all' | 'today' | 'week' | 'month' | 'custom';
  customStartDate: string;
  customEndDate: string;
  minAmount: string;
  maxAmount: string;
  status: string;
}

interface GroupedTransactions {
  [key: string]: TreatTransaction[];
}

export const TransactionHistoryScreen: React.FC = () => {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<TreatTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    type: 'all',
    dateRange: 'all',
    customStartDate: '',
    customEndDate: '',
    minAmount: '',
    maxAmount: '',
    status: 'all'
  });

  useEffect(() => {
    loadTransactions();

    const transactionsChannel = supabase
      .channel('transactions_updates')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'treat_transactions'
        },
        (payload) => {
          const newTransaction = payload.new as TreatTransaction;
          supabase.auth.getUser().then(({ data: { user } }) => {
            if (user && user.id === newTransaction.user_id) {
              setTransactions((prev) => [newTransaction, ...prev]);
            }
          });
        }
      )
      .subscribe();

    return () => {
      transactionsChannel.unsubscribe();
    };
  }, [filters]);

  const loadTransactions = async () => {
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
        .limit(200);

      // Apply transaction type filter
      if (filters.type !== 'all') {
        query = query.eq('transaction_type', filters.type);
      }

      // Apply status filter
      if (filters.status !== 'all') {
        query = query.eq('status', filters.status);
      }

      // Apply date range filter
      const now = new Date();
      if (filters.dateRange === 'today') {
        const startOfToday = new Date(now.setHours(0, 0, 0, 0));
        query = query.gte('created_at', startOfToday.toISOString());
      } else if (filters.dateRange === 'week') {
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - 7);
        query = query.gte('created_at', startOfWeek.toISOString());
      } else if (filters.dateRange === 'month') {
        const startOfMonth = new Date(now);
        startOfMonth.setDate(now.getDate() - 30);
        query = query.gte('created_at', startOfMonth.toISOString());
      } else if (filters.dateRange === 'custom' && filters.customStartDate) {
        query = query.gte('created_at', new Date(filters.customStartDate).toISOString());
        if (filters.customEndDate) {
          const endDate = new Date(filters.customEndDate);
          endDate.setHours(23, 59, 59, 999);
          query = query.lte('created_at', endDate.toISOString());
        }
      }

      const { data, error: transactionError } = await query;

      if (transactionError) throw transactionError;

      let filteredData = data || [];

      // Apply amount filters (client-side)
      if (filters.minAmount) {
        const minAmt = parseFloat(filters.minAmount);
        filteredData = filteredData.filter(t => Math.abs(t.amount) >= minAmt);
      }
      if (filters.maxAmount) {
        const maxAmt = parseFloat(filters.maxAmount);
        filteredData = filteredData.filter(t => Math.abs(t.amount) <= maxAmt);
      }

      setTransactions(filteredData);
    } catch (err) {
      console.error('Error loading transactions:', err);
      setError('Failed to load transaction history');
    } finally {
      setIsLoading(false);
    }
  };

  const getDateGroupLabel = (date: Date): string => {
    if (isToday(date)) return 'Today';
    if (isYesterday(date)) return 'Yesterday';
    if (isThisWeek(date)) return 'This Week';
    return format(date, 'MMMM d, yyyy');
  };

  const groupTransactionsByDate = (transactions: TreatTransaction[]): GroupedTransactions => {
    const grouped: GroupedTransactions = {};

    transactions.forEach((transaction) => {
      const date = parseISO(transaction.created_at);
      const label = getDateGroupLabel(date);

      if (!grouped[label]) {
        grouped[label] = [];
      }
      grouped[label].push(transaction);
    });

    return grouped;
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'purchase':
        return <ShoppingCart className="w-5 h-5 text-green-500" />;
      case 'spend':
      case 'promotion_spent':
        return <ArrowUpRight className="w-5 h-5 text-red-500" />;
      case 'earn':
      case 'daily_checkin':
      case 'referral_bonus':
        return <ArrowDownLeft className="w-5 h-5 text-green-500" />;
      case 'withdraw':
        return <Download className="w-5 h-5 text-orange-500" />;
      case 'tip_sent':
        return <Gift className="w-5 h-5 text-pink-500" />;
      case 'tip_received':
        return <Gift className="w-5 h-5 text-green-500" />;
      default:
        return <Clock className="w-5 h-5 text-gray-500" />;
    }
  };

  const getTransactionColor = (type: string) => {
    switch (type) {
      case 'purchase':
      case 'earn':
      case 'tip_received':
      case 'daily_checkin':
      case 'referral_bonus':
        return 'text-green-400';
      case 'spend':
      case 'withdraw':
      case 'tip_sent':
      case 'promotion_spent':
        return 'text-red-400';
      default:
        return 'text-white';
    }
  };

  const getAmountPrefix = (type: string) => {
    switch (type) {
      case 'purchase':
      case 'earn':
      case 'tip_received':
      case 'daily_checkin':
      case 'referral_bonus':
        return '+';
      case 'spend':
      case 'withdraw':
      case 'tip_sent':
      case 'promotion_spent':
        return '-';
      default:
        return '';
    }
  };

  const formatTransactionType = (type: string): string => {
    const typeMap: { [key: string]: string } = {
      purchase: 'Purchase',
      spend: 'Spent',
      earn: 'Earned',
      withdraw: 'Withdrawal',
      tip_sent: 'Treat Sent',
      tip_received: 'Treat Received',
      promotion_spent: 'Promotion',
      daily_checkin: 'Daily Check-in',
      referral_bonus: 'Referral Bonus'
    };
    return typeMap[type] || type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' ');
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'pending':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'failed':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'cancelled':
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const resetFilters = () => {
    setFilters({
      type: 'all',
      dateRange: 'all',
      customStartDate: '',
      customEndDate: '',
      minAmount: '',
      maxAmount: '',
      status: 'all'
    });
  };

  const hasActiveFilters = () => {
    return filters.type !== 'all' ||
           filters.dateRange !== 'all' ||
           filters.minAmount !== '' ||
           filters.maxAmount !== '' ||
           filters.status !== 'all';
  };

  const groupedTransactions = groupTransactionsByDate(transactions);
  const groupKeys = Object.keys(groupedTransactions);

  return (
    <div className="flex flex-col min-h-screen pb-6">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] backdrop-blur-sm border-b border-white/10">
        <div className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-white/10 active:scale-95 rounded-full transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5 text-white" />
            </button>
            <div>
              <h1 className="font-bold text-white text-xl tracking-tight">
                Transaction History
              </h1>
              <p className="text-white/60 text-xs">
                Track your treat activity
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`p-2.5 rounded-full transition-all duration-200 min-w-[44px] min-h-[44px] flex items-center justify-center ${
              hasActiveFilters()
                ? 'bg-[#309605] text-white'
                : 'bg-white/10 text-white/80 hover:bg-white/20'
            }`}
            aria-label="Toggle filters"
          >
            <Filter className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Filters */}
        <div className="px-4 pb-3">
          <ScrollArea className="w-full">
            <div className="flex space-x-2 pb-2">
              {[
                { value: 'all', label: 'All', icon: null },
                { value: 'purchase', label: 'Purchases', icon: ShoppingCart },
                { value: 'tip_sent', label: 'Treats', icon: Gift },
                { value: 'earn', label: 'Earned', icon: ArrowDownLeft },
                { value: 'withdraw', label: 'Withdrawals', icon: Download }
              ].map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilters(prev => ({ ...prev, type: tab.value }))}
                  className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 whitespace-nowrap active:scale-95 font-medium text-sm shadow-md ${
                    filters.type === tab.value
                      ? 'bg-white text-black'
                      : 'bg-white/10 text-white/80 hover:bg-white/20'
                  }`}
                >
                  {tab.icon && <tab.icon className="w-4 h-4" />}
                  <span>{tab.label}</span>
                </button>
              ))}
            </div>
            <ScrollBar orientation="horizontal" className="opacity-0" />
          </ScrollArea>
        </div>
      </header>

      {/* Advanced Filters Panel */}
      {showAdvancedFilters && (
        <div className="sticky top-[116px] z-10 bg-gradient-to-b from-[#1a1a1a] to-[#0d0d0d] border-b border-white/10 animate-in slide-in-from-top duration-300">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-white text-base">Advanced Filters</h3>
              <button
                onClick={() => setShowAdvancedFilters(false)}
                className="p-1.5 hover:bg-white/10 rounded-full transition-all"
                aria-label="Close filters"
              >
                <X className="w-4 h-4 text-white/70" />
              </button>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="block text-white/70 text-xs font-medium mb-2">
                <Calendar className="w-3.5 h-3.5 inline mr-1" />
                Date Range
              </label>
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'today', label: 'Today' },
                  { value: 'week', label: '7 Days' },
                  { value: 'month', label: '30 Days' }
                ].map((range) => (
                  <button
                    key={range.value}
                    onClick={() => setFilters(prev => ({ ...prev, dateRange: range.value as any }))}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all active:scale-95 ${
                      filters.dateRange === range.value
                        ? 'bg-[#309605] text-white'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {range.label}
                  </button>
                ))}
              </div>
              {filters.dateRange === 'custom' && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={filters.customStartDate}
                    onChange={(e) => setFilters(prev => ({ ...prev, customStartDate: e.target.value }))}
                    className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="Start Date"
                  />
                  <input
                    type="date"
                    value={filters.customEndDate}
                    onChange={(e) => setFilters(prev => ({ ...prev, customEndDate: e.target.value }))}
                    className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-xs focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="End Date"
                  />
                </div>
              )}
            </div>

            {/* Amount Range Filter */}
            <div>
              <label className="block text-white/70 text-xs font-medium mb-2">
                <DollarSign className="w-3.5 h-3.5 inline mr-1" />
                Amount Range
              </label>
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="number"
                  value={filters.minAmount}
                  onChange={(e) => setFilters(prev => ({ ...prev, minAmount: e.target.value }))}
                  placeholder="Min"
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#309605]"
                />
                <input
                  type="number"
                  value={filters.maxAmount}
                  onChange={(e) => setFilters(prev => ({ ...prev, maxAmount: e.target.value }))}
                  placeholder="Max"
                  className="px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#309605]"
                />
              </div>
            </div>

            {/* Status Filter */}
            <div>
              <label className="block text-white/70 text-xs font-medium mb-2">Status</label>
              <div className="grid grid-cols-5 gap-2">
                {[
                  { value: 'all', label: 'All' },
                  { value: 'completed', label: 'Done' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'failed', label: 'Failed' },
                  { value: 'cancelled', label: 'Cancelled' }
                ].map((status) => (
                  <button
                    key={status.value}
                    onClick={() => setFilters(prev => ({ ...prev, status: status.value }))}
                    className={`px-2 py-2 rounded-lg text-xs font-medium transition-all active:scale-95 ${
                      filters.status === status.value
                        ? 'bg-[#309605] text-white'
                        : 'bg-white/10 text-white/70 hover:bg-white/20'
                    }`}
                  >
                    {status.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={resetFilters}
                className="flex-1 px-4 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-white text-sm font-medium transition-all active:scale-95"
              >
                Reset All
              </button>
              <button
                onClick={() => {
                  loadTransactions();
                  setShowAdvancedFilters(false);
                }}
                className="flex-1 px-4 py-2.5 bg-gradient-to-r from-[#309605] to-[#3ba208] rounded-xl text-white text-sm font-semibold transition-all active:scale-95"
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transactions List */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-3 border-[#309605] border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : error ? (
            <Card className="bg-red-500/20 border border-red-500/30">
              <CardContent className="p-6 text-center">
                <p className="text-red-400 text-sm mb-4">
                  {error}
                </p>
                <button
                  onClick={loadTransactions}
                  className="px-4 py-2 bg-red-500/30 hover:bg-red-500/40 rounded-xl text-red-400 text-sm transition-all duration-200 font-semibold active:scale-95"
                >
                  Try Again
                </button>
              </CardContent>
            </Card>
          ) : transactions.length === 0 ? (
            <Card className="bg-white/5 backdrop-blur-sm border border-white/10">
              <CardContent className="p-12 text-center">
                <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-10 h-10 text-white/60" />
                </div>
                <h3 className="font-bold text-white text-lg mb-2">
                  No Transactions Found
                </h3>
                <p className="text-white/70 text-sm mb-4">
                  {hasActiveFilters()
                    ? 'Try adjusting your filters to see more results'
                    : 'Your treat transactions will appear here'
                  }
                </p>
                {hasActiveFilters() && (
                  <button
                    onClick={resetFilters}
                    className="px-6 py-2.5 bg-white/10 hover:bg-white/20 rounded-xl text-white text-sm font-medium transition-all active:scale-95"
                  >
                    Clear Filters
                  </button>
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {groupKeys.map((groupLabel) => (
                <div key={groupLabel}>
                  {/* Date Group Header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px bg-white/10 flex-1" />
                    <h2 className="text-white/60 text-xs font-semibold uppercase tracking-wider">
                      {groupLabel}
                    </h2>
                    <div className="h-px bg-white/10 flex-1" />
                  </div>

                  {/* Transactions in Group */}
                  <div className="space-y-2">
                    {groupedTransactions[groupLabel].map((transaction) => (
                      <Card
                        key={transaction.id}
                        className="relative bg-white/5 backdrop-blur-sm border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-300 active:scale-[0.99]"
                      >
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <div className="w-11 h-11 bg-white/10 rounded-full flex items-center justify-center flex-shrink-0">
                              {getTransactionIcon(transaction.transaction_type)}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-1">
                                <h4 className="font-semibold text-white text-sm">
                                  {formatTransactionType(transaction.transaction_type)}
                                </h4>
                                <span className={`font-bold text-lg tabular-nums ${getTransactionColor(transaction.transaction_type)}`}>
                                  {getAmountPrefix(transaction.transaction_type)}{Math.abs(transaction.amount).toLocaleString()}
                                </span>
                              </div>

                              <p className="text-white/70 text-xs mb-1.5 line-clamp-1">
                                {transaction.description}
                              </p>

                              <div className="flex items-center justify-between">
                                <span className="text-white/50 text-xs">
                                  {format(parseISO(transaction.created_at), 'h:mm a')}
                                </span>

                                <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusBadgeClass(transaction.status)}`}>
                                  {transaction.status}
                                </span>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Data Retention Notice */}
          {transactions.length > 0 && (
            <div className="mt-6 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
              <p className="text-blue-400 text-xs text-center">
                Transactions older than 30 days are automatically archived
              </p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};
