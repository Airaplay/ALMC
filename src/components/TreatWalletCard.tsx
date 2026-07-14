import { useState, useEffect } from 'react';
import { Coins, TrendingUp, Gift, Download } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { supabase } from '../lib/supabase';
import { CACHE_KEYS, getCachedData, treatCache } from '../lib/treatCache';
import { getTreatWalletSpendable } from '../lib/treatWalletSpendable';

interface TreatWallet {
  balance: number;
  promo_balance: number;
  total_purchased: number;
  total_spent: number;
  total_earned: number;
  total_withdrawn: number;
  earned_balance: number;
}

interface TreatWalletCardProps {
  onPurchase: () => void;
  onTip: () => void;
  onPromote: () => void;
  onWithdraw: () => void;
  /** When false, hides Earned Balance stat (e.g. on TreatScreen for simpler UI). Default true. */
  showEarnedAndSpent?: boolean;
}

export const TreatWalletCard = ({ onPurchase, onTip, onPromote, onWithdraw, showEarnedAndSpent = true }: TreatWalletCardProps): JSX.Element => {
  const [wallet, setWallet] = useState<TreatWallet | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let channelRef: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        treatCache.invalidate(CACHE_KEYS.WALLET(user.id));
      }
    });

    loadTreatWallet();

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        channelRef = supabase
          .channel('wallet_updates')
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'treat_wallets',
              filter: `user_id=eq.${user.id}`
            },
            (payload) => {
              const updatedWallet = payload.new as any;
              setWallet({
                balance: Number(updatedWallet.balance) || 0,
                promo_balance: Number(updatedWallet.promo_balance) || 0,
                total_purchased: Number(updatedWallet.total_purchased) || 0,
                total_spent: Number(updatedWallet.total_spent) || 0,
                total_earned: Number(updatedWallet.total_earned) || 0,
                total_withdrawn: Number(updatedWallet.total_withdrawn) || 0,
                earned_balance: Number(updatedWallet.earned_balance) || 0
              });
              treatCache.invalidate(CACHE_KEYS.WALLET(user.id));
            }
          )
          .subscribe();
      }
    });

    return () => {
      if (channelRef) {
        channelRef.unsubscribe();
      }
    };
  }, []);

  const loadTreatWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Use caching for faster loads
      const walletData = await getCachedData(
        CACHE_KEYS.WALLET(user.id),
        async () => {
          // Use limit(1) instead of single() for better performance
          const { data, error } = await supabase
            .from('treat_wallets')
            .select('balance, promo_balance, total_purchased, total_spent, total_earned, total_withdrawn, earned_balance, purchased_balance')
            .eq('user_id', user.id)
            .limit(1);

          if (error) throw error;

          // If no wallet exists, create one
          if (!data || data.length === 0) {
            const { data: newWallet, error: createError } = await supabase
              .from('treat_wallets')
              .insert({
                user_id: user.id,
                balance: 0,
                total_purchased: 0,
                total_spent: 0,
                total_earned: 0,
                total_withdrawn: 0,
                earned_balance: 0,
                purchased_balance: 0
              })
              .select('balance, promo_balance, total_purchased, total_spent, total_earned, total_withdrawn, earned_balance, purchased_balance')
              .limit(1);

            if (createError) throw createError;
            return newWallet[0];
          }

          return data[0];
        },
        10 * 1000 // Cache for 10 seconds
      );

      if (walletData) {
        setWallet({
          balance: Number(walletData.balance) || 0,
          promo_balance: Number(walletData.promo_balance) || 0,
          total_purchased: Number(walletData.total_purchased) || 0,
          total_spent: Number(walletData.total_spent) || 0,
          total_earned: Number(walletData.total_earned) || 0,
          total_withdrawn: Number(walletData.total_withdrawn) || 0,
          earned_balance: Number(walletData.earned_balance) || 0
        });
      }
    } catch (error) {
      console.error('Error loading treat wallet:', error);
      // Set default values on error to prevent infinite loading
      setWallet({
        balance: 0,
        promo_balance: 0,
        total_purchased: 0,
        total_spent: 0,
        total_earned: 0,
        total_withdrawn: 0,
        earned_balance: 0
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 backdrop-blur-sm border border-yellow-500/30">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-yellow-600/30 rounded-full animate-pulse" />
              <div className="space-y-2">
                <div className="h-5 w-28 bg-white/10 rounded animate-pulse" />
                <div className="h-4 w-32 bg-white/10 rounded animate-pulse" />
              </div>
            </div>
            <div className="text-right space-y-2">
              <div className="h-8 w-20 bg-white/10 rounded animate-pulse ml-auto" />
              <div className="h-4 w-12 bg-white/10 rounded animate-pulse ml-auto" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white/5 p-4 rounded-xl">
                <div className="h-3 w-16 bg-white/10 rounded animate-pulse mb-2" />
                <div className="h-5 w-12 bg-white/10 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-r from-yellow-600/20 to-orange-600/20 backdrop-blur-sm border border-yellow-500/30">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-r from-yellow-600 to-orange-600 rounded-full flex items-center justify-center shadow-lg shadow-yellow-600/25">
              <Coins className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg">
                Treat Wallet
              </h3>
              <p className="font-['Inter',sans-serif] text-white/70 text-sm">
                Your digital currency
              </p>
            </div>
          </div>
          
          <div className="text-right">
            <p className="font-['Inter',sans-serif] font-bold text-white text-2xl">
              {Number(getTreatWalletSpendable(wallet)).toLocaleString()}
            </p>
            {wallet && wallet.promo_balance > 0 && (
              <p className="font-['Inter',sans-serif] text-white/50 text-[11px] mt-0.5">
                {wallet.promo_balance.toLocaleString()} bonus (non-withdrawable)
              </p>
            )}
            <p className="font-['Inter',sans-serif] text-white/70 text-sm">
              treats
            </p>
          </div>
        </div>
        {/* Stats Grid - optional (Earned Balance only; Spent and Withdrawn removed from UI) */}
        {showEarnedAndSpent && (
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="p-4 bg-white/5 rounded-xl border border-white/10">
              <p className="font-['Inter',sans-serif] text-white/60 text-xs mb-2">
                Earned Balance
              </p>
              <p className="font-['Inter',sans-serif] font-bold text-white text-xl">
                {Number(wallet?.total_earned || 0).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className={`grid grid-cols-2 gap-3 ${showEarnedAndSpent ? 'mt-3' : 'mt-6'}`}>
          <button
            onClick={onPurchase}
            className="flex items-center justify-center gap-2 h-12 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 shadow-lg shadow-green-600/25"
          >
            <Download className="w-4 h-4" />
            Purchase
          </button>
          
          <button
            onClick={onTip}
            className="flex items-center justify-center gap-2 h-12 bg-gradient-to-r from-pink-600 to-red-600 hover:from-pink-700 hover:to-red-700 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 shadow-lg shadow-pink-600/25"
          >
            <Gift className="w-4 h-4" />
            Treat
          </button>
        </div>

        
        <div className="grid grid-cols-2 gap-3 mt-3">
          <button
            onClick={onPromote}
            className="flex items-center justify-center gap-2 h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 shadow-lg shadow-purple-600/25"
          >
            <TrendingUp className="w-4 h-4" />
            Promote
          </button>

          <button
            onClick={onWithdraw}
            className="flex items-center justify-center gap-2 h-12 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 shadow-lg shadow-blue-600/25"
          >
            <Coins className="w-4 h-4" />
            Withdraw
          </button>
        </div>
      </CardContent>
    </Card>
  );
};