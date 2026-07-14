import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Coins } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CACHE_KEYS, getCachedData, treatCache } from '../lib/treatCache';

interface TreatWalletWidgetProps {
  className?: string;
}

export const TreatWalletWidget: React.FC<TreatWalletWidgetProps> = ({
  className = ''
}) => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isInitialized) {
      if (isAuthenticated && user) {
        loadBalance(user.id);
      } else {
        setBalance(0);
      }
      setIsLoading(false);
    }
  }, [isAuthenticated, user, isInitialized]);

  // Real-time subscription for wallet updates
  useEffect(() => {
    if (!user?.id) return;

    const walletChannel = supabase
      .channel(`treat_wallet_${user.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'treat_wallets',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          const updatedWallet = payload.new as { balance: number };
          setBalance(Number(updatedWallet.balance) || 0);
          treatCache.invalidate(CACHE_KEYS.WALLET(user.id));
        }
      )
      .subscribe();

    return () => {
      walletChannel.unsubscribe();
    };
  }, [user]);

  const loadBalance = useCallback(async (uid: string) => {
    try {
      // Use caching for faster loads
      const walletData = await getCachedData(
        CACHE_KEYS.WALLET(uid),
        async () => {
          const { data, error } = await supabase
            .from('treat_wallets')
            .select('balance')
            .eq('user_id', uid)
            .maybeSingle();

          if (error) throw error;
          return data;
        },
        60 * 1000 // Cache for 60 seconds
      );

      setBalance(walletData ? Number(walletData.balance) || 0 : 0);
    } catch (error) {
      console.error('Error loading treat balance:', error);
      setBalance(0);
    }
  }, []);

  const formattedBalance = useMemo(() => {
    if (balance >= 1000000) {
      return `${(balance / 1000000).toFixed(1)}M`;
    } else if (balance >= 1000) {
      return `${(balance / 1000).toFixed(1)}K`;
    }
    return balance.toLocaleString();
  }, [balance]);

  const handleClick = useCallback(() => {
    navigate('/treats');
  }, [navigate]);

  if (!isAuthenticated || isLoading) {
    return null;
  }

  return (
    <button
      onClick={handleClick}
      className={`flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 backdrop-blur-sm border border-yellow-500/30 rounded-full active:from-yellow-600/30 active:to-orange-600/30 transition-colors touch-manipulation ${className}`}
      aria-label="View Treats Wallet"
    >
      <div className="w-5 h-5 bg-gradient-to-r from-yellow-600 to-orange-600 rounded-full flex items-center justify-center flex-shrink-0">
        <Coins className="w-2.5 h-2.5 text-white" />
      </div>
      <span className="font-medium text-yellow-400 text-xs tabular-nums">
        {formattedBalance}
      </span>
    </button>
  );
};