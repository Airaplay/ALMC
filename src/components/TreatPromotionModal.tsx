import React, { useState, useEffect } from 'react';
import { X, TrendingUp, Coins, Target, Clock, BarChart, AlertCircle } from 'lucide-react';
import { Card, CardContent } from './ui/card';
import { supabase } from '../lib/supabase';
import { CustomConfirmDialog } from './CustomConfirmDialog';

interface TreatPromotionModalProps {
  onClose: () => void;
  onSuccess: () => void;
  contentId?: string | null;
  contentType?: 'song_promotion' | 'profile_promotion';
  contentTitle?: string;
}

interface TreatWallet {
  balance: number;
}

interface PromotionPackage {
  id: string;
  name: string;
  treats: number;
  duration: number; // hours
  targetImpressions: number;
  description: string;
  popular?: boolean;
}

export const TreatPromotionModal: React.FC<TreatPromotionModalProps> = ({
  onClose,
  onSuccess,
  contentId,
  contentType = 'song_promotion',
  contentTitle
}) => {
  const [wallet, setWallet] = useState<TreatWallet | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<PromotionPackage | null>(null);
  const [customTreats, setCustomTreats] = useState<string>('');
  const [customDuration, setCustomDuration] = useState<string>('24');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [showConfirmPromotion, setShowConfirmPromotion] = useState(false);

  // Promotion packages
  const promotionPackages: PromotionPackage[] = [
    {
      id: 'basic',
      name: 'Basic Boost',
      treats: 50,
      duration: 24,
      targetImpressions: 1000,
      description: '24-hour promotion to 1K users'
    },
    {
      id: 'popular',
      name: 'Popular Push',
      treats: 150,
      duration: 48,
      targetImpressions: 3000,
      description: '48-hour promotion to 3K users',
      popular: true
    },
    {
      id: 'premium',
      name: 'Premium Blast',
      treats: 300,
      duration: 72,
      targetImpressions: 7500,
      description: '72-hour promotion to 7.5K users'
    },
    {
      id: 'ultimate',
      name: 'Ultimate Reach',
      treats: 500,
      duration: 168,
      targetImpressions: 15000,
      description: '1-week promotion to 15K users'
    }
  ];

  useEffect(() => {
    loadWallet();

    // Hide bottom navigation bar when modal opens
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, []);

  const loadWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: walletData, error: walletError } = await supabase
        .from('treat_wallets')
        .select('balance')
        .eq('user_id', user.id)
        .limit(1);

      if (walletError) {
        throw walletError;
      }

      setWallet(walletData && walletData.length > 0 ? walletData[0] : { balance: 0 });
    } catch (err) {
      console.error('Error loading wallet:', err);
      setError('Failed to load wallet information');
    }
  };

  const calculateEstimatedImpressions = (treats: number, duration: number): number => {
    // Simple algorithm: 1 treat = ~20 impressions, with duration multiplier
    const baseImpressions = treats * 20;
    const durationMultiplier = Math.min(duration / 24, 7); // Max 7x multiplier for week-long campaigns
    return Math.round(baseImpressions * durationMultiplier);
  };

  const handleCustomTreatsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setCustomTreats(value);
    }
  };

  const handleCustomDurationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) {
      setCustomDuration(value);
    }
  };

  const handlePromotionClick = () => {
    const treatsToSpend = useCustom ? parseInt(customTreats) : (selectedPackage?.treats || 0);
    const _durationHours = useCustom ? parseInt(customDuration) : (selectedPackage?.duration || 24);

    if (!treatsToSpend || treatsToSpend <= 0) {
      setError('Please enter a valid treat amount');
      return;
    }

    if (!wallet || treatsToSpend > wallet.balance) {
      setError('Insufficient treats balance');
      return;
    }

    if (!contentId) {
      setError('No content selected for promotion');
      return;
    }

    setShowConfirmPromotion(true);
  };

  const handleConfirmPromotion = async () => {
    setShowConfirmPromotion(false);
    if (!contentId) {
      setError('No content selected for promotion');
      return;
    }

    let treatsToSpend: number;
    let durationHours: number;
    let targetImpressions: number;

    if (useCustom) {
      treatsToSpend = parseInt(customTreats);
      durationHours = parseInt(customDuration);
      
      if (!treatsToSpend || treatsToSpend <= 0) {
        setError('Please enter a valid number of treats');
        return;
      }
      
      if (!durationHours || durationHours <= 0) {
        setError('Please enter a valid duration');
        return;
      }
      
      targetImpressions = calculateEstimatedImpressions(treatsToSpend, durationHours);
    } else {
      if (!selectedPackage) {
        setError('Please select a promotion package');
        return;
      }
      
      treatsToSpend = selectedPackage.treats;
      durationHours = selectedPackage.duration;
      targetImpressions = selectedPackage.targetImpressions;
    }

    if (!wallet || treatsToSpend > wallet.balance) {
      setError('Insufficient treats balance');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error('User not authenticated');
      }

      // Calculate end time
      const endsAt = new Date();
      endsAt.setHours(endsAt.getHours() + durationHours);

      // Create promotion
      const { error: promotionError } = await supabase
        .from('treat_promotions')
        .insert({
          user_id: user.id,
          promotion_type: contentType,
          target_id: contentId,
          target_title: contentTitle || 'Untitled Content',
          treats_spent: treatsToSpend,
          duration_hours: durationHours,
          target_impressions: targetImpressions,
          ends_at: endsAt.toISOString()
        });

      if (promotionError) throw promotionError;

      setSuccess(`Promotion started! Your content will be promoted for ${durationHours} hours.`);
      
      // Close modal after success
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Error starting promotion:', err);
      setError(err instanceof Error ? err.message : 'Failed to start promotion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDuration = (hours: number): string => {
    if (hours < 24) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    } else if (hours < 168) {
      const days = Math.floor(hours / 24);
      return `${days} day${days !== 1 ? 's' : ''}`;
    } else {
      const weeks = Math.floor(hours / 168);
      return `${weeks} week${weeks !== 1 ? 's' : ''}`;
    }
  };

  const formatImpressions = (impressions: number): string => {
    if (impressions >= 1000000) {
      return `${(impressions / 1000000).toFixed(1)}M`;
    } else if (impressions >= 1000) {
      return `${(impressions / 1000).toFixed(1)}K`;
    }
    return impressions.toLocaleString();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <Card className="w-full max-w-md bg-gradient-to-b from-gray-900/95 to-black/95 backdrop-blur-xl border border-white/20 shadow-2xl max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 rounded-full flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-white" />
              </div>
              <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl">
                Promote Content
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-colors duration-200"
            >
              <X className="w-5 h-5 text-white/80" />
            </button>
          </div>

          {/* Content Info */}
          {contentTitle && (
            <div className="mb-6 p-4 bg-white/5 rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-400" />
                <span className="font-['Inter',sans-serif] text-white/80 text-sm">
                  Promoting
                </span>
              </div>
              <p className="font-['Inter',sans-serif] font-medium text-white text-base">
                {contentTitle}
              </p>
              <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                {contentType === 'song_promotion' ? 'Song Promotion' : 'Profile Promotion'}
              </p>
            </div>
          )}

          {/* Wallet Balance */}
          {wallet && (
            <div className="mb-6 p-4 bg-gradient-to-r from-yellow-600/20 to-orange-600/20 rounded-xl border border-yellow-500/30">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Coins className="w-5 h-5 text-yellow-400" />
                  <span className="font-['Inter',sans-serif] text-white/80 text-sm">
                    Available Balance
                  </span>
                </div>
                <span className="font-['Inter',sans-serif] font-bold text-white text-lg">
                  {wallet.balance.toLocaleString()} treats
                </span>
              </div>
            </div>
          )}

          {/* Package Selection Toggle */}
          <div className="mb-6">
            <div className="flex bg-white/10 rounded-xl p-1">
              <button
                onClick={() => setUseCustom(false)}
                className={`flex-1 py-2 px-4 rounded-lg transition-all duration-200 ${
                  !useCustom
                    ? 'bg-purple-600 text-white'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                <span className="font-['Inter',sans-serif] font-medium text-sm">
                  Packages
                </span>
              </button>
              <button
                onClick={() => setUseCustom(true)}
                className={`flex-1 py-2 px-4 rounded-lg transition-all duration-200 ${
                  useCustom
                    ? 'bg-purple-600 text-white'
                    : 'text-white/70 hover:text-white'
                }`}
              >
                <span className="font-['Inter',sans-serif] font-medium text-sm">
                  Custom
                </span>
              </button>
            </div>
          </div>

          {/* Promotion Packages */}
          {!useCustom ? (
            <div className="space-y-3 mb-6">
              {promotionPackages.map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackage(pkg)}
                  className={`relative p-4 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                    selectedPackage?.id === pkg.id
                      ? 'border-purple-500 bg-purple-500/20'
                      : 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/30'
                  }`}
                >
                  {pkg.popular && (
                    <div className="absolute -top-2 left-4 px-3 py-1 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-full text-white text-xs font-bold">
                      Most Popular
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-['Inter',sans-serif] font-bold text-white text-base mb-1">
                        {pkg.name}
                      </h4>
                      <p className="font-['Inter',sans-serif] text-white/70 text-sm mb-2">
                        {pkg.description}
                      </p>
                      <div className="flex items-center gap-4 text-white/60 text-xs">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {formatDuration(pkg.duration)}
                        </div>
                        <div className="flex items-center gap-1">
                          <BarChart className="w-3 h-3" />
                          {formatImpressions(pkg.targetImpressions)} reach
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="flex items-center gap-1 mb-1">
                        <Coins className="w-4 h-4 text-yellow-400" />
                        <span className="font-['Inter',sans-serif] font-bold text-white text-lg">
                          {pkg.treats}
                        </span>
                      </div>
                      <p className="font-['Inter',sans-serif] text-white/70 text-xs">
                        treats
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* Custom Promotion */
            <div className="space-y-4 mb-6">
              <div>
                <label className="font-['Inter',sans-serif] font-medium text-white/80 text-sm mb-2 block">
                  Treats to Spend
                </label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/60" />
                  <input
                    type="text"
                    value={customTreats}
                    onChange={handleCustomTreatsChange}
                    placeholder="Enter treats amount"
                    className="w-full h-12 pl-10 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                  />
                </div>
              </div>

              <div>
                <label className="font-['Inter',sans-serif] font-medium text-white/80 text-sm mb-2 block">
                  Duration (Hours)
                </label>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/60" />
                  <input
                    type="text"
                    value={customDuration}
                    onChange={handleCustomDurationChange}
                    placeholder="Enter duration in hours"
                    className="w-full h-12 pl-10 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all duration-200"
                  />
                </div>
              </div>

              {/* Custom Promotion Preview */}
              {customTreats && customDuration && (
                <div className="p-4 bg-purple-500/20 border border-purple-500/30 rounded-xl">
                  <h4 className="font-['Inter',sans-serif] font-medium text-white text-sm mb-2">
                    Estimated Reach
                  </h4>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart className="w-4 h-4 text-purple-400" />
                      <span className="font-['Inter',sans-serif] text-white/80 text-sm">
                        {formatImpressions(calculateEstimatedImpressions(parseInt(customTreats), parseInt(customDuration)))} impressions
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-purple-400" />
                      <span className="font-['Inter',sans-serif] text-white/80 text-sm">
                        {formatDuration(parseInt(customDuration))}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Error/Success Messages */}
          {error && (
            <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg mb-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400" />
                <p className="font-['Inter',sans-serif] text-red-400 text-sm">{error}</p>
              </div>
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg mb-4">
              <p className="font-['Inter',sans-serif] text-green-400 text-sm">{success}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 h-12 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handlePromotionClick}
              disabled={
                isSubmitting ||
                (!useCustom && !selectedPackage) ||
                (useCustom && (!customTreats || !customDuration)) ||
                !wallet ||
                (useCustom ? parseInt(customTreats) > wallet.balance : (selectedPackage && selectedPackage.treats > wallet.balance) || false)
              }
              className="flex-1 h-12 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-['Inter',sans-serif] font-medium text-white transition-all duration-200 shadow-lg shadow-purple-600/25"
            >
              {isSubmitting ? (
                <div className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Starting...
                </div>
              ) : (
                <div className="flex items-center justify-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Start Promotion
                </div>
              )}
            </button>
          </div>

          {/* Info */}
          <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
            <h4 className="font-['Inter',sans-serif] font-medium text-blue-400 text-sm mb-2">
              How Promotions Work
            </h4>
            <ul className="space-y-1 text-xs text-white/70">
              <li>• Your content will be shown to more users</li>
              <li>• Promotion runs for the selected duration</li>
              <li>• You can track performance in your analytics</li>
              <li>• Treats are spent when promotion starts</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Promotion Confirmation */}
      <CustomConfirmDialog
        isOpen={showConfirmPromotion}
        title="Start Promotion?"
        message={`You are about to spend ${useCustom ? customTreats : selectedPackage?.treats} treats to promote "${contentTitle || 'your content'}" for ${useCustom ? customDuration : selectedPackage?.duration} hours. This action cannot be undone.`}
        confirmText="Start Promotion"
        cancelText="Cancel"
        variant="info"
        onConfirm={handleConfirmPromotion}
        onCancel={() => setShowConfirmPromotion(false)}
        isLoading={isSubmitting}
      />
    </div>
  );
};