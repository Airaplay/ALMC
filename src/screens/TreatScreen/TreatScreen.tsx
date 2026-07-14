import { formatDistanceToNowStrict } from 'date-fns';
import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft, Coins, Gift, Clock, BarChart2,
  ShoppingCart, ArrowUpRight, ArrowDownLeft,
  Megaphone, ChevronRight, RefreshCw, Zap,
} from 'lucide-react';
import { PurchaseTreatsModal } from '../../components/PurchaseStreatsModal';
import { TippingModal } from '../../components/TippingModal';
import { TreatPromotionModal } from '../../components/TreatPromotionModal';
import { TreatWithdrawalModal } from '../../components/TreatWithdrawalModal';
import { AuthModal } from '../../components/AuthModal';
import { Spinner } from '../../components/Spinner';
import { supabase } from '../../lib/supabase';
import { useNavigate, useLocation } from 'react-router-dom';
import { CACHE_KEYS, getCachedData, treatCache } from '../../lib/treatCache';
import { getTreatWalletSpendable } from '../../lib/treatWalletSpendable';

interface TreatScreenProps {
  onFormVisibilityChange?: (isVisible: boolean) => void;
}

interface TreatWallet {
  balance: number;
  promo_balance: number;
  total_purchased: number;
  /** Lifetime treats bought (sum of completed purchase transactions; avoids inflated total_purchased). */
  lifetime_purchased: number;
  total_spent: number;
  total_earned: number;
  total_withdrawn: number;
  earned_balance: number;
  purchased_balance: number;
}

/** Source of truth for "Purchased" — wallet.total_purchased can be 2× after legacy double wallet updates. */
const sumCompletedPurchaseTreats = async (userId: string): Promise<number> => {
  const { data, error } = await supabase
    .from('treat_transactions')
    .select('amount')
    .eq('user_id', userId)
    .eq('transaction_type', 'purchase')
    .eq('status', 'completed');
  if (error) throw error;
  return (data || []).reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
};

interface RecentTip {
  id: string;
  sender_name: string;
  recipient_name: string;
  amount: number;
  message: string | null;
  created_at: string;
  is_sender: boolean;
}

const fmt = (n: number) => n.toLocaleString();

const fmtShort = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
};

export const TreatScreen = ({ onFormVisibilityChange }: TreatScreenProps): JSX.Element => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [wallet, setWallet] = useState<TreatWallet | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showTippingModal, setShowTippingModal] = useState(false);
  const [showPromotionModal, setShowPromotionModal] = useState(false);
  const [showWithdrawalModal, setShowWithdrawalModal] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [recentTips, setRecentTips] = useState<RecentTip[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isAnyModalOpen =
      showPurchaseModal || showTippingModal || showPromotionModal ||
      showWithdrawalModal || showAuthModal;
    onFormVisibilityChange?.(isAnyModalOpen);
  }, [showPurchaseModal, showTippingModal, showPromotionModal, showWithdrawalModal, showAuthModal, onFormVisibilityChange]);

  /** Open purchase flow when user arrives from TippingModal with 0 balance */
  useEffect(() => {
    const state = location.state as { openPurchaseTreats?: boolean } | null | undefined;
    if (!state?.openPurchaseTreats) return;
    setShowPurchaseModal(true);
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    checkAuthAndLoadData();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        checkAuthAndLoadData();
      } else if (event === 'SIGNED_OUT') {
        setIsAuthenticated(false);
        setRecentTips([]);
        setWallet(null);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    let channelRef: ReturnType<typeof supabase.channel> | null = null;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        channelRef = supabase
          .channel('treat_screen_wallet')
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'treat_wallets', filter: `user_id=eq.${user.id}` }, async (payload) => {
            const w = payload.new as any;
            let lifetimePurchased = Number(w.total_purchased) || 0;
            try {
              lifetimePurchased = await sumCompletedPurchaseTreats(user.id);
            } catch {
              /* keep wallet total_purchased fallback */
            }
            setWallet({
              balance: Number(w.balance) || 0,
              promo_balance: Number(w.promo_balance) || 0,
              total_purchased: Number(w.total_purchased) || 0,
              lifetime_purchased: lifetimePurchased,
              total_spent: Number(w.total_spent) || 0,
              total_earned: Number(w.total_earned) || 0,
              total_withdrawn: Number(w.total_withdrawn) || 0,
              earned_balance: Number(w.earned_balance) || 0,
              purchased_balance: Number(w.purchased_balance) || 0,
            });
            treatCache.invalidate(CACHE_KEYS.WALLET(user.id));
          })
          .subscribe();
      }
    });
    return () => { channelRef?.unsubscribe(); };
  }, []);

  const loadWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      treatCache.invalidate(CACHE_KEYS.WALLET(user.id));
      const [walletData, lifetimePurchased] = await Promise.all([
        getCachedData(
          CACHE_KEYS.WALLET(user.id),
          async () => {
            const { data, error } = await supabase
              .from('treat_wallets')
              .select('balance, promo_balance, total_purchased, total_spent, total_earned, total_withdrawn, earned_balance, purchased_balance')
              .eq('user_id', user.id)
              .limit(1);
            if (error) throw error;
            if (!data || data.length === 0) {
              const { data: newWallet, error: createError } = await supabase
                .from('treat_wallets')
                .insert({ user_id: user.id, balance: 0, total_purchased: 0, total_spent: 0, total_earned: 0, total_withdrawn: 0, earned_balance: 0, purchased_balance: 0 })
                .select('balance, promo_balance, total_purchased, total_spent, total_earned, total_withdrawn, earned_balance, purchased_balance')
                .limit(1);
              if (createError) throw createError;
              return newWallet[0];
            }
            return data[0];
          },
          10 * 1000
        ),
        sumCompletedPurchaseTreats(user.id),
      ]);
      if (walletData) {
        setWallet({
          balance: Number(walletData.balance) || 0,
          promo_balance: Number(walletData.promo_balance) || 0,
          total_purchased: Number(walletData.total_purchased) || 0,
          lifetime_purchased: lifetimePurchased,
          total_spent: Number(walletData.total_spent) || 0,
          total_earned: Number(walletData.total_earned) || 0,
          total_withdrawn: Number(walletData.total_withdrawn) || 0,
          earned_balance: Number(walletData.earned_balance) || 0,
          purchased_balance: Number(walletData.purchased_balance) || 0,
        });
      }
    } catch {
      setWallet({ balance: 0, promo_balance: 0, total_purchased: 0, lifetime_purchased: 0, total_spent: 0, total_earned: 0, total_withdrawn: 0, earned_balance: 0, purchased_balance: 0 });
    } finally {
      setWalletLoading(false);
    }
  };

  const loadRecentTips = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const tips = await getCachedData(
        CACHE_KEYS.RECENT_TIPS(user.id),
        async () => {
          const { data, error } = await supabase
            .from('treat_tips')
            .select('id, sender_id, recipient_id, amount, message, created_at, sender:sender_id (display_name), recipient:recipient_id (display_name)')
            .or(`sender_id.eq.${user.id},recipient_id.eq.${user.id}`)
            .order('created_at', { ascending: false })
            .limit(10);
          if (error) throw error;
          return (data || []).map((tip: any) => ({
            id: tip.id,
            sender_name: tip.sender?.display_name || 'Unknown User',
            recipient_name: tip.recipient?.display_name || 'Unknown User',
            amount: Number(tip.amount) || 0,
            message: tip.message,
            created_at: tip.created_at,
            is_sender: tip.sender_id === user.id,
          }));
        },
        60 * 1000
      );
      setRecentTips(tips);
    } catch { /* silent */ }
  };

  const checkAuthAndLoadData = async () => {
    try {
      const { getAuthenticatedSession } = await import('../../lib/supabase');
      const { session, error } = await getAuthenticatedSession();
      if (error && (error.message?.includes('Invalid Refresh Token') || error.message?.includes('refresh_token_not_found') || error.message === 'Auth session missing!')) {
        setIsAuthenticated(false);
      } else {
        setIsAuthenticated(!!session);
      }
      if (session) {
        await Promise.all([loadWallet(), loadRecentTips()]);
      }
    } catch {
      /* keep current state */
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthSuccess = () => {
    setShowAuthModal(false);
    checkAuthAndLoadData();
  };

  const handleModalSuccess = () => { checkAuthAndLoadData(); };

  const formatDate = (dateString: string): string => {
    try {
      return formatDistanceToNowStrict(new Date(dateString), { addSuffix: true });
    } catch {
      return 'Unknown date';
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (scrollContainerRef.current?.scrollTop === 0) {
      touchStartY.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = async (e: React.TouchEvent) => {
    const diff = e.changedTouches[0].clientY - touchStartY.current;
    if (diff > 100 && scrollContainerRef.current?.scrollTop === 0) {
      setIsRefreshing(true);
      await checkAuthAndLoadData();
      setTimeout(() => setIsRefreshing(false), 500);
    }
    touchStartY.current = 0;
  };

  /* ── Loading skeleton ── */
  if (isAuthenticated === null || isLoading) {
    return (
      <div className="flex flex-col min-h-[100dvh] bg-[#0a0a0a]">
        <div className="flex items-center gap-3 px-5 pt-14 pb-5">
          <div className="w-9 h-9 rounded-full bg-white/5 animate-pulse" />
          <div className="h-6 w-28 bg-white/5 rounded-lg animate-pulse" />
        </div>
        <div className="px-5 space-y-4">
          <div className="h-56 rounded-3xl bg-white/5 animate-pulse" />
          <div className="grid grid-cols-4 gap-2">
            {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[...Array(2)].map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white/5 animate-pulse" />)}
          </div>
          <div className="space-y-2 pt-2">
            <div className="h-5 w-36 bg-white/5 rounded animate-pulse" />
            {[...Array(3)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-white/5 animate-pulse" />)}
          </div>
        </div>
      </div>
    );
  }

  /* ── Unauthenticated ── */
  if (!isAuthenticated) {
    return (
      <>
        <div className="flex flex-col items-center justify-center min-h-[100dvh] px-6 bg-[#0a0a0a]">
          <div className="w-full max-w-sm">
            <div className="w-20 h-20 bg-gradient-to-br from-[#00ad74] to-[#008a5d] rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl shadow-[#00ad74]/20">
              <Coins className="w-10 h-10 text-white" />
            </div>
            <h2 className="font-['Inter',sans-serif] font-black text-white text-3xl text-center mb-3 tracking-tight">
              Treat Wallet
            </h2>
            <p className="font-['Inter',sans-serif] text-white/50 text-base text-center mb-10 leading-relaxed">
              Tip artists, promote your content, and earn treats
            </p>
            <button
              onClick={() => setShowAuthModal(true)}
              className="w-full h-14 bg-[#00ad74] hover:bg-[#009c68] active:scale-[0.98] rounded-2xl font-['Inter',sans-serif] font-bold text-white text-base transition-all duration-200"
            >
              Sign In to Continue
            </button>
          </div>
        </div>
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} onSuccess={handleAuthSuccess} />}
      </>
    );
  }

  const quickActions = [
    { label: 'Buy', icon: ShoppingCart, bg: 'bg-[#00ad74]', onClick: () => setShowPurchaseModal(true) },
    { label: 'Tip', icon: Gift, bg: 'bg-rose-500', onClick: () => setShowTippingModal(true) },
    { label: 'Promote', icon: Megaphone, bg: 'bg-amber-500', onClick: () => navigate('/promotion-center') },
    { label: 'Withdraw', icon: ArrowUpRight, bg: 'bg-sky-500', onClick: () => setShowWithdrawalModal(true) },
  ];

  const statItems = [
    { label: 'Earned', value: wallet?.total_earned ?? 0 },
    { label: 'Purchased', value: wallet?.lifetime_purchased ?? 0 },
  ];

  return (
    <div
      ref={scrollContainerRef}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="flex flex-col h-[100dvh] overflow-y-auto overflow-x-hidden scrollbar-hide bg-[#0a0a0a] content-with-nav"
      style={{ overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}
    >
      {/* Pull-to-refresh indicator */}
      {isRefreshing && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 bg-white/10 backdrop-blur-xl px-4 py-2 rounded-full border border-white/15 flex items-center gap-2">
          <Spinner size={14} className="text-white" />
          <span className="text-white/80 text-xs font-semibold">Refreshing...</span>
        </div>
      )}

      {/* ── Header ── */}
      <header
        className="sticky top-0 z-10 px-5 py-5 bg-[#0a0a0a]/90 backdrop-blur-xl"
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-white/8 active:scale-95 transition-transform"
            >
              <ArrowLeft className="w-4 h-4 text-white/80" />
            </button>
            <div>
              <h1 className="font-['Inter',sans-serif] font-black text-white text-2xl tracking-tight leading-tight">
                Your balance,
              </h1>
              <p className="text-white/40 text-base font-light leading-tight">at a glance.</p>
            </div>
          </div>
          <button
            onClick={async () => { setIsRefreshing(true); await checkAuthAndLoadData(); setIsRefreshing(false); }}
            disabled={isRefreshing}
            className="w-9 h-9 flex items-center justify-center rounded-full bg-white/8 active:scale-95 transition-transform"
          >
            <RefreshCw className={`w-4 h-4 text-white/60 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </header>

      <div className="flex-1 px-5 space-y-5">

        {/* ── Hero Balance Card ── */}
        <div className="relative rounded-3xl overflow-hidden border border-yellow-500/20 bg-gradient-to-br from-yellow-600/15 via-orange-600/10 to-transparent">
          <div className="absolute top-0 right-0 w-48 h-48 bg-yellow-500/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
          <div className="relative p-6">
            {/* Main balance */}
            {walletLoading ? (
              <div className="h-12 w-40 bg-white/5 rounded-2xl animate-pulse mb-1" />
            ) : (
              <>
                <p className="font-['Inter',sans-serif] font-black text-yellow-400 leading-none tracking-tight mb-1 tabular-nums"
                  style={{ fontSize: 'clamp(2rem, 12vw, 3.5rem)' }}>
                  {fmt(getTreatWalletSpendable(wallet))}
                </p>
                {wallet && wallet.promo_balance > 0 && (
                  <p className="text-[11px] text-white/45 font-medium mb-1 tabular-nums">
                    Includes {fmt(wallet.promo_balance)} bonus Treats (non-withdrawable)
                  </p>
                )}
              </>
            )}
            <p className="text-[12px] text-white/35 font-semibold uppercase tracking-widest mb-7">Treats</p>

            {/* Stats row */}
            <div className="grid grid-cols-2 gap-2 mb-6">
              {statItems.map((s) => (
                <div key={s.label} className="bg-yellow-500/[0.07] rounded-2xl px-4 py-3 border border-yellow-500/[0.1] flex items-center justify-between gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-yellow-500/50 whitespace-nowrap">{s.label}</p>
                  <p className="font-['Inter',sans-serif] font-black text-white/80 leading-none tabular-nums text-base">
                    {fmtShort(s.value)}
                  </p>
                </div>
              ))}
            </div>

            {/* Quick action buttons */}
            <div className="grid grid-cols-4 gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.label}
                  onClick={action.onClick}
                  className={`${action.bg} flex flex-col items-center gap-1.5 py-3.5 rounded-2xl active:scale-[0.96] transition-transform`}
                >
                  <action.icon className="w-4.5 h-4.5 text-white" style={{ width: 18, height: 18 }} />
                  <span className="text-[10px] font-bold text-white tracking-wide">{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Navigation Links ── */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: 'Transaction History', sub: 'View all activity', icon: Clock, color: 'text-sky-400', bg: 'bg-sky-500/10', path: '/transaction-history' },
            { label: 'Analytics', sub: 'Track your spending', icon: BarChart2, color: 'text-[#00ad74]', bg: 'bg-[#00ad74]/10', path: '/treat-analytics' },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="group flex items-center gap-3 p-4 rounded-2xl bg-white/[0.04] border border-white/[0.07] active:scale-[0.97] transition-transform text-left"
            >
              <div className={`w-9 h-9 rounded-xl ${item.bg} flex items-center justify-center flex-shrink-0`}>
                <item.icon className={`w-4 h-4 ${item.color}`} />
              </div>
              <div className="min-w-0">
                <p className="font-['Inter',sans-serif] font-bold text-white text-[13px] leading-tight truncate">{item.label}</p>
                <p className="text-[11px] text-white/40 mt-0.5 truncate">{item.sub}</p>
              </div>
            </button>
          ))}
        </div>

        {/* ── Recent Treats (max 8; more in History) ── */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="font-['Inter',sans-serif] font-black text-white text-[15px] tracking-tight">Recent Treats</h2>
              <p className="text-[11px] text-white/35 mt-0.5">Tips sent and received</p>
            </div>
            {recentTips.length > 0 && (
              <button
                onClick={() => navigate('/transaction-history')}
                className="flex items-center gap-0.5 text-[12px] font-bold text-white/40 active:text-white/70 transition-colors"
              >
                History <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {recentTips.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 rounded-3xl border border-dashed border-white/[0.07]">
              <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center mb-3">
                <Gift className="w-5 h-5 text-white/20" />
              </div>
              <p className="text-[13px] font-semibold text-white/40 mb-1">No recent tips</p>
              <p className="text-[11px] text-white/20 text-center px-4">Tips you send or receive will show here</p>
            </div>
          ) : (
            <div className="space-y-1">
              {recentTips.slice(0, 8).map((tip, idx) => (
                <div key={tip.id} className="flex items-center gap-3 px-3 py-3 rounded-2xl active:bg-white/[0.04] transition-colors">
                  <span className="w-5 text-center text-[11px] font-black text-white/15 flex-shrink-0 tabular-nums">
                    {idx + 1}
                  </span>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${tip.is_sender ? 'bg-rose-500/15' : 'bg-[#00ad74]/15'}`}>
                    {tip.is_sender
                      ? <ArrowUpRight className="w-4 h-4 text-rose-400" />
                      : <ArrowDownLeft className="w-4 h-4 text-[#00ad74]" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-['Inter',sans-serif] font-semibold text-white text-[13px] truncate">
                      {tip.is_sender ? `To ${tip.recipient_name}` : `From ${tip.sender_name}`}
                    </p>
                    {tip.message && (
                      <p className="text-[11px] text-white/35 truncate mt-0.5">&ldquo;{tip.message}&rdquo;</p>
                    )}
                    <p className="text-[10px] text-white/25 mt-0.5">{formatDate(tip.created_at)}</p>
                  </div>
                  <span className={`flex-shrink-0 font-['Inter',sans-serif] font-black text-[14px] tabular-nums ${tip.is_sender ? 'text-rose-400' : 'text-[#00ad74]'}`}>
                    {tip.is_sender ? '−' : '+'}{fmt(Number(tip.amount) || 0)}
                  </span>
                </div>
              ))}
            </div>
          )}
          {recentTips.length > 8 && (
            <button
              onClick={() => navigate('/transaction-history')}
              className="mt-3 w-full py-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] text-[13px] font-semibold text-white/50 active:bg-white/[0.05] transition-colors"
            >
              View full history
            </button>
          )}
        </section>

        {/* ── Getting Started (empty state) ── */}
        {recentTips.length === 0 && (
          <div className="rounded-3xl border border-[#00ad74]/15 bg-gradient-to-br from-[#00ad74]/8 to-transparent p-8 text-center">
            <div className="w-16 h-16 bg-[#00ad74]/15 rounded-3xl flex items-center justify-center mx-auto mb-5">
              <Coins className="w-8 h-8 text-[#00ad74]" />
            </div>
            <h3 className="font-['Inter',sans-serif] font-black text-white text-xl mb-2 tracking-tight">
              Welcome to Treats!
            </h3>
            <p className="font-['Inter',sans-serif] text-white/40 text-sm mb-7 leading-relaxed">
              Purchase treats to tip your favorite artistes and promote your content to more listeners
            </p>
            <button
              onClick={() => setShowPurchaseModal(true)}
              className="px-8 py-3.5 bg-[#00ad74] hover:bg-[#009c68] active:scale-[0.97] rounded-2xl font-['Inter',sans-serif] font-bold text-white text-[14px] transition-all duration-200"
            >
              Get Started
            </button>
          </div>
        )}

      </div>

      {/* ── Modals ── */}
      {showPurchaseModal && (
        <PurchaseTreatsModal onClose={() => setShowPurchaseModal(false)} onSuccess={handleModalSuccess} />
      )}
      {showTippingModal && (
        <TippingModal onClose={() => setShowTippingModal(false)} onSuccess={handleModalSuccess} />
      )}
      {showPromotionModal && (
        <TreatPromotionModal onClose={() => setShowPromotionModal(false)} onSuccess={handleModalSuccess} />
      )}
      {showWithdrawalModal && (
        <TreatWithdrawalModal onClose={() => setShowWithdrawalModal(false)} onSuccess={handleModalSuccess} />
      )}
    </div>
  );
};
