import React, { useState, useEffect, useRef } from 'react';
import {
  X, Coins, Check, AlertCircle, Sparkles, Zap, TrendingUp,
  ChevronDown, Grid, Layers, ChevronRight, Loader2, CheckCircle,
} from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { admobService } from '../lib/admobService';
import { supabase, formatTreats, getMyAgeInfo } from '../lib/supabase';
import { PaymentChannelSelector } from './PaymentChannelSelector';
import { getUserCurrency, CurrencyDetectionResult, Currency, convertAmount, formatCurrencyAmount } from '../lib/currencyDetection';
import { toUserFacingPaymentError, TRY_AGAIN_LABEL } from '../lib/criticalErrorMessages';
import { MODAL_HEADER_SAFE_AREA_STYLE } from '../lib/modalHeaderSafeArea';

interface PurchaseTreatsModalProps {
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

export const PurchaseTreatsModal: React.FC<PurchaseTreatsModalProps> = ({ onClose, onSuccess }) => {
  const [selectedPackage, setSelectedPackage] = useState<TreatPackage | null>(null);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [showPaymentSelector, setShowPaymentSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [treatPackages, setTreatPackages] = useState<TreatPackage[]>([]);
  const [isLoadingPackages, setIsLoadingPackages] = useState(true);
  const [userEmail, setUserEmail] = useState<string>('');
  const [currencyData, setCurrencyData] = useState<CurrencyDetectionResult | null>(null);
  const [isDetectingCurrency, setIsDetectingCurrency] = useState(true);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<'carousel' | 'grid'>('carousel');
  const [showAboutTreats, setShowAboutTreats] = useState(false);
  const [isAdultForPurchases, setIsAdultForPurchases] = useState<boolean | null>(null);

  const carouselRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  /**
   * Clearance reserved for adaptive native banner + safe-area. While this modal is open we call
   * repositionActiveBottomBanner(0): body.modal-open hides the HTML tab bar but AdMob was still offset
   * by {@link MAIN_TAB_NAV_MARGIN_DP} dp — that leftover strip reads as blank space under the ad.
   */
  const MAIN_TAB_NAV_MARGIN_DP = 72;
  const MAIN_MINI_MARGIN_DP = 70;

  const [nativeBottomStackInner, setNativeBottomStackInner] = useState('0px');

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      setNativeBottomStackInner('0px');
      return;
    }
    const read = () => {
      const bannerActive =
        document.body.classList.contains('ad-banner-active') ||
        document.body.classList.contains('ad-banner-above-mini');
      if (!bannerActive) {
        setNativeBottomStackInner('0px');
        return;
      }
      // Banner pinned flush to bottom native layer (modal-open); no duplicated tab-bar inset in CSS.
      setNativeBottomStackInner('(var(--aira-banner-height, 72px))');
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  /** Scroll padding: native stack + step-specific chrome (package step reserves fixed footer ~6rem) */
  const scrollPaddingBottomCss = Capacitor.isNativePlatform()
    ? showPaymentSelector
      ? `calc(env(safe-area-inset-bottom, 0px) + ${nativeBottomStackInner} + 2rem)`
      : `calc(env(safe-area-inset-bottom, 0px) + ${nativeBottomStackInner} + 6.125rem)`
    : showPaymentSelector
      ? 'max(8rem, env(safe-area-inset-bottom, 0px))'
      : '9rem';

  const bottomBarBottomCss = Capacitor.isNativePlatform()
    ? `calc(env(safe-area-inset-bottom, 0px) + ${nativeBottomStackInner})`
    : 'env(safe-area-inset-bottom, 0px)';

  const touchStartX = useRef<number>(0);
  const touchEndX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const touchEndY = useRef<number>(0);

  useEffect(() => {
    loadTreatPackages();
    loadUserEmail();
    detectUserCurrency();
    verifyAgeGate();
    document.body.classList.add('modal-open');
    const repinTimers: number[] = [];

    if (Capacitor.isNativePlatform()) {
      // Force banner to bottom immediately, then re-assert quickly to beat route/ad handoff races.
      const repinDelays = [0, 120, 450, 1200];
      repinDelays.forEach((delayMs) => {
        const timer = window.setTimeout(() => {
        void admobService.repositionActiveBottomBanner(0);
        }, delayMs);
        repinTimers.push(timer);
      });
    }

    return () => {
      document.body.classList.remove('modal-open');
      repinTimers.forEach((timer) => window.clearTimeout(timer));
      if (Capacitor.isNativePlatform()) {
        window.setTimeout(() => {
          const mini = document.body.classList.contains('mini-player-active');
          const margin = MAIN_TAB_NAV_MARGIN_DP + (mini ? MAIN_MINI_MARGIN_DP : 0);
          void admobService.repositionActiveBottomBanner(margin);
        }, 0);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (treatPackages.length > 0 && !selectedPackage) {
      setSelectedPackage(treatPackages[0]);
      setCurrentCardIndex(0);
    }
  }, [treatPackages]);

  const loadUserEmail = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);
    } catch { /* ignore */ }
  };

  const detectUserCurrency = async () => {
    try {
      setIsDetectingCurrency(true);
      // Purchase flow should always use fresh currency context.
      setCurrencyData(await getUserCurrency());
    } catch { /* ignore */ } finally {
      setIsDetectingCurrency(false);
    }
  };

  const handleCurrencyChange = (newCurrency: Currency) => {
    if (currencyData) setCurrencyData({ ...currencyData, currency: newCurrency, detected: false });
  };

  const loadTreatPackages = async () => {
    try {
      setIsLoadingPackages(true);
      // Do not cache treat purchase screen package data.
      const { data, error } = await supabase
        .from('treat_packages')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (error) throw error;
      if (data && data.length > 0) {
        const packages: TreatPackage[] = data.map((pkg: any) => ({
          id: pkg.id,
          treats: Number(pkg.treats) || 0,
          price: Number(pkg.price) || 0,
          bonus: Number(pkg.bonus) || 0,
          popular: pkg.is_popular || false,
          bestValue: pkg.is_best_value || false,
        }));
        setTreatPackages(packages);
        if (packages.length > 0 && currentCardIndex < packages.length) {
          const nextPackage = packages[Math.min(currentCardIndex + 1, packages.length - 1)];
          if (nextPackage) { const img = new Image(); img.src = nextPackage.id; }
        }
      } else {
        setError('No treat packages available at this time');
      }
    } catch (err) {
      setError(toUserFacingPaymentError(err, 'load'));
    } finally {
      setIsLoadingPackages(false);
    }
  };

  const handleContinueToPay = () => {
    if (isAdultForPurchases === false) {
      setError('You must be 18 or older to purchase Treats.');
      return;
    }
    if (!selectedPackage) { setError('Please select a treat package'); return; }
    setShowPaymentSelector(true);
  };

  const verifyAgeGate = async () => {
    try {
      const age = await getMyAgeInfo();
      setIsAdultForPurchases(age.is_adult === true);
    } catch {
      // If age cannot be verified, fail closed for purchases.
      setIsAdultForPurchases(false);
    }
  };

  const handlePaymentSuccess = async (paymentData: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');
      if (!selectedPackage) throw new Error('No package selected');
      const totalTreats = selectedPackage.treats + selectedPackage.bonus;
      setShowPaymentSelector(false);
      if (paymentData.status === 'completed') {
        setSuccess(`Payment Successful! ${formatTreats(totalTreats)} treats have been added to your wallet.`);
      } else {
        setSuccess(`Payment received! Your treats will be credited shortly.`);
      }
      setTimeout(() => { onSuccess(); onClose(); }, 2500);
    } catch (err) {
      setError(toUserFacingPaymentError(err, 'payment'));
      setTimeout(() => { onClose(); }, 2500);
    }
  };

  const handlePaymentError = (errorMessage: string) => setError(errorMessage);

  const handleBackToPackages = () => { setShowPaymentSelector(false); setError(null); };

  const getTotalTreats = (pkg: TreatPackage) => pkg.treats + pkg.bonus;
  const getValuePerDollar = (pkg: TreatPackage) => getTotalTreats(pkg) / pkg.price;
  const getConvertedPrice = (priceUSD: number) => currencyData ? convertAmount(priceUSD, currencyData.currency) : priceUSD;

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    setIsDragging(true);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    touchEndX.current = e.touches[0].clientX;
    const diff = touchEndX.current - touchStartX.current;
    setDragOffset(Math.max(-200, Math.min(200, diff)));
  };

  const handleTouchEnd = () => {
    const swipeDistance = touchStartX.current - touchEndX.current;
    setIsDragging(false);
    if (swipeDistance > 75) handleNextCard();
    else if (swipeDistance < -75) handlePrevCard();
    setDragOffset(0);
    touchStartX.current = 0;
    touchEndX.current = 0;
  };

  const handleNextCard = () => {
    if (currentCardIndex < treatPackages.length - 1) {
      const nextIndex = currentCardIndex + 1;
      setCurrentCardIndex(nextIndex);
      setSelectedPackage(treatPackages[nextIndex]);
    }
  };

  const handlePrevCard = () => {
    if (currentCardIndex > 0) {
      const prevIndex = currentCardIndex - 1;
      setCurrentCardIndex(prevIndex);
      setSelectedPackage(treatPackages[prevIndex]);
    }
  };

  const handleCardSelect = (index: number) => {
    setCurrentCardIndex(index);
    setSelectedPackage(treatPackages[index]);
  };

  const handleModalTouchStart = (e: React.TouchEvent) => { touchStartY.current = e.touches[0].clientY; };
  const handleModalTouchEnd = (e: React.TouchEvent) => {
    touchEndY.current = e.changedTouches[0].clientY;
    if (touchEndY.current - touchStartY.current > 150 && !showPaymentSelector) onClose();
  };

  const currentPackage = treatPackages[currentCardIndex];
  const prevPackage = currentCardIndex > 0 ? treatPackages[currentCardIndex - 1] : null;
  const nextPackage = currentCardIndex < treatPackages.length - 1 ? treatPackages[currentCardIndex + 1] : null;

  const getBadgeGradient = (pkg: TreatPackage) => {
    if (pkg.popular) return 'from-blue-500 to-cyan-500';
    if (pkg.bestValue) return 'from-[#00ad74] to-emerald-500';
    return 'from-yellow-500 to-orange-500';
  };

  const getBadgeLabel = (pkg: TreatPackage) => {
    if (pkg.popular) return 'Most Popular';
    if (pkg.bestValue) return 'Best Value';
    return null;
  };

  const getBadgeIcon = (pkg: TreatPackage) => {
    if (pkg.popular) return <Sparkles className="w-3 h-3 text-white" />;
    if (pkg.bestValue) return <TrendingUp className="w-3 h-3 text-white" />;
    return <Zap className="w-3 h-3 text-white" />;
  };

  const isLoading = isLoadingPackages || isDetectingCurrency;

  return (
    <div
      ref={modalRef}
      onTouchStart={handleModalTouchStart}
      onTouchEnd={handleModalTouchEnd}
      className="fixed inset-0 bg-[#0a0a0a] z-[110] flex flex-col overflow-hidden"
    >
      {/* ── Header ── */}
      <header
        className="bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04] flex-shrink-0"
        style={MODAL_HEADER_SAFE_AREA_STYLE}
      >
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-['Inter',sans-serif] font-black text-white text-xl tracking-tight leading-tight">
              Buy Treats,
            </h1>
            <p className="text-white/35 text-xs font-light font-['Inter',sans-serif] leading-tight mt-0.5">
              fuel your creativity.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/[0.06] border border-white/[0.08] flex items-center justify-center active:scale-95 transition-transform flex-shrink-0 mt-0.5"
          >
            <X className="w-4 h-4 text-white/60" />
          </button>
        </div>
      </header>

      {/* ── Scrollable Content ── */}
      <div
        className="flex-1 overflow-y-auto px-5"
        style={{ paddingBottom: scrollPaddingBottomCss }}
      >

        {/* ── Loading Skeleton ── */}
        {isLoading && (
          <div className="pt-6 space-y-4">
            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] h-[340px] flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-white/20 animate-spin" />
            </div>
            <div className="flex justify-center gap-1.5 py-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-1.5 w-1.5 rounded-full bg-white/10" />
              ))}
            </div>
            <div className="h-14 rounded-2xl bg-white/[0.03] border border-white/[0.07]" />
          </div>
        )}

        {/* ── Payment Step ── */}
        {showPaymentSelector && selectedPackage && currencyData && (
          <div className="pt-5">
            {/* Selected package summary */}
            <div className="relative rounded-3xl overflow-hidden border border-white/[0.07] bg-white/[0.03] p-5 mb-5">
              <div className="absolute top-0 right-0 w-32 h-32 bg-[#00ad74]/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-2 relative">
                Selected Package
              </p>
              <div className="flex items-end justify-between relative">
                <div>
                  <p className="font-black text-white text-3xl tabular-nums font-['Inter',sans-serif] leading-none">
                    {formatTreats(selectedPackage.treats)}
                    {selectedPackage.bonus > 0 && (
                      <span className="text-[#00ad74] text-lg ml-1.5">+{formatTreats(selectedPackage.bonus)}</span>
                    )}
                  </p>
                  <p className="text-white/35 text-xs mt-1 font-['Inter',sans-serif]">treats total</p>
                </div>
                <p className="font-black text-white text-2xl tabular-nums font-['Inter',sans-serif]">
                  {formatCurrencyAmount(getConvertedPrice(selectedPackage.price), currencyData.currency)}
                </p>
              </div>
            </div>
            <PaymentChannelSelector
              amount={getConvertedPrice(selectedPackage.price)}
              amountUsd={selectedPackage.price}
              packageId={selectedPackage.id}
              userEmail={userEmail}
              currencyData={currencyData}
              onCurrencyChange={handleCurrencyChange}
              onPaymentSuccess={handlePaymentSuccess}
              onPaymentError={handlePaymentError}
              onCancel={handleBackToPackages}
            />
          </div>
        )}

        {/* ── Package Selection ── */}
        {!isLoading && !showPaymentSelector && currencyData && treatPackages.length > 0 && (
          <div className="pt-5 space-y-5">

            {/* Section header + view toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif]">
                  Packages
                </p>
                <p className="text-white/50 text-xs mt-0.5 font-['Inter',sans-serif]">
                  All prices in {currencyData.currency.code}
                </p>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.06]">
                <button
                  onClick={() => setViewMode('carousel')}
                  className={`p-1.5 rounded-lg transition-all ${viewMode === 'carousel' ? 'bg-white/[0.10] text-white' : 'text-white/30'}`}
                >
                  <Layers className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-1.5 rounded-lg transition-all ${viewMode === 'grid' ? 'bg-white/[0.10] text-white' : 'text-white/30'}`}
                >
                  <Grid className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Carousel View */}
            {viewMode === 'carousel' && (
              <>
                <div
                  ref={carouselRef}
                  className="relative h-[340px]"
                  onTouchStart={handleTouchStart}
                  onTouchMove={handleTouchMove}
                  onTouchEnd={handleTouchEnd}
                >
                  {/* Prev ghost card */}
                  {prevPackage && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-24 h-[260px] z-0 blur-sm opacity-40 rounded-3xl overflow-hidden"
                      style={{ transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.34,1.56,0.64,1)' }}
                    >
                      <div className={`w-full h-full bg-gradient-to-br ${getBadgeGradient(prevPackage)} opacity-30`} />
                    </div>
                  )}

                  {/* Main card */}
                  {currentPackage && (
                    <div
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[82%] max-w-xs h-[320px] z-10"
                      style={{
                        transform: `translate(-50%,-50%) translateX(${dragOffset}px) rotate(${dragOffset * 0.04}deg)`,
                        transition: isDragging ? 'none' : 'transform 0.5s cubic-bezier(0.34,1.56,0.64,1)',
                      }}
                    >
                      <div className="relative w-full h-full rounded-3xl overflow-hidden border border-white/[0.08] bg-[#111111]">
                        {/* Gradient bg glow */}
                        <div className={`absolute inset-0 bg-gradient-to-br ${getBadgeGradient(currentPackage)} opacity-[0.12]`} />

                        {/* Badge */}
                        {(currentPackage.popular || currentPackage.bestValue) && (
                          <div className={`absolute top-4 left-4 flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r ${getBadgeGradient(currentPackage)} rounded-full`}>
                            {getBadgeIcon(currentPackage)}
                            <span className="text-[10px] font-bold text-white font-['Inter',sans-serif]">
                              {getBadgeLabel(currentPackage)}
                            </span>
                          </div>
                        )}

                        {/* Card body */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-8">
                          <div className={`w-16 h-16 bg-gradient-to-br ${getBadgeGradient(currentPackage)} rounded-2xl flex items-center justify-center shadow-xl`}>
                            <Coins className="w-8 h-8 text-white" />
                          </div>

                          <div className="text-center">
                            <p className="font-black text-white text-5xl tabular-nums font-['Inter',sans-serif] leading-none">
                              {formatTreats(currentPackage.treats)}
                            </p>
                            {currentPackage.bonus > 0 && (
                              <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-[#00ad74]/15 border border-[#00ad74]/25 rounded-full">
                                <Sparkles className="w-3 h-3 text-[#00ad74]" />
                                <span className="text-[#00ad74] text-xs font-bold font-['Inter',sans-serif]">
                                  +{formatTreats(currentPackage.bonus)} bonus
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="text-center">
                            <p className="font-black text-white text-3xl tabular-nums font-['Inter',sans-serif]">
                              {formatCurrencyAmount(getConvertedPrice(currentPackage.price), currencyData.currency)}
                            </p>
                            <p className="text-white/30 text-xs mt-0.5 font-['Inter',sans-serif]">
                              {Math.round(getValuePerDollar(currentPackage))} treats per $1
                            </p>
                          </div>
                        </div>

                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
                      </div>
                    </div>
                  )}

                  {/* Next ghost card */}
                  {nextPackage && (
                    <div
                      className="absolute right-0 top-1/2 -translate-y-1/2 w-24 h-[260px] z-0 blur-sm opacity-40 rounded-3xl overflow-hidden"
                      style={{ transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.34,1.56,0.64,1)' }}
                    >
                      <div className={`w-full h-full bg-gradient-to-br ${getBadgeGradient(nextPackage)} opacity-30`} />
                    </div>
                  )}
                </div>

                {/* Dot indicators */}
                <div className="flex justify-center gap-1.5">
                  {treatPackages.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => handleCardSelect(i)}
                      className={`h-1.5 rounded-full transition-all duration-300 ${
                        i === currentCardIndex ? 'w-6 bg-white' : 'w-1.5 bg-white/20'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}

            {/* Grid View */}
            {viewMode === 'grid' && (
              <div className="grid grid-cols-2 gap-3">
                {treatPackages.map((pkg, index) => {
                  const isSelected = selectedPackage?.id === pkg.id;
                  const badge = getBadgeLabel(pkg);
                  return (
                    <button
                      key={pkg.id}
                      onClick={() => { setCurrentCardIndex(index); setSelectedPackage(pkg); }}
                      className="relative overflow-hidden rounded-2xl p-4 transition-all active:scale-[0.97] min-h-[180px] text-left border"
                      style={isSelected ? { borderColor: 'rgba(0,173,116,0.35)', background: 'rgba(0,173,116,0.06)' } : { borderColor: 'rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}
                    >
                      <div className={`absolute inset-0 bg-gradient-to-br ${getBadgeGradient(pkg)} opacity-[0.10]`} />

                      {badge && (
                        <div className={`absolute top-2.5 left-2.5 flex items-center gap-1 px-2 py-0.5 bg-gradient-to-r ${getBadgeGradient(pkg)} rounded-full`}>
                          {getBadgeIcon(pkg)}
                          <span className="text-[10px] font-bold text-white font-['Inter',sans-serif]">{badge}</span>
                        </div>
                      )}

                      {isSelected && (
                        <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-[#00ad74] flex items-center justify-center">
                          <Check className="w-3 h-3 text-black" />
                        </div>
                      )}

                      <div className="relative flex flex-col items-center justify-center h-full gap-2 pt-4">
                        <div className={`w-10 h-10 bg-gradient-to-br ${getBadgeGradient(pkg)} rounded-xl flex items-center justify-center`}>
                          <Coins className="w-5 h-5 text-white" />
                        </div>
                        <p className="font-black text-white text-2xl tabular-nums font-['Inter',sans-serif] leading-none">
                          {formatTreats(pkg.treats)}
                        </p>
                        {pkg.bonus > 0 && (
                          <div className="flex items-center gap-1 px-2 py-0.5 bg-[#00ad74]/15 border border-[#00ad74]/20 rounded-full">
                            <Sparkles className="w-2.5 h-2.5 text-[#00ad74]" />
                            <span className="text-[#00ad74] text-[10px] font-bold font-['Inter',sans-serif]">+{formatTreats(pkg.bonus)}</span>
                          </div>
                        )}
                        <p className="font-black text-white text-lg tabular-nums font-['Inter',sans-serif]">
                          {formatCurrencyAmount(getConvertedPrice(pkg.price), currencyData.currency)}
                        </p>
                        <p className="text-white/30 text-[10px] font-['Inter',sans-serif]">{Math.round(getValuePerDollar(pkg))} per $1</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Currency detection pill */}
            {currencyData.detected && (
              <div className="flex items-center justify-center">
                <span className="text-[11px] font-medium text-[#00ad74] bg-[#00ad74]/10 border border-[#00ad74]/15 px-3 py-1.5 rounded-full font-['Inter',sans-serif]">
                  Currency detected: {currencyData.currency.name} · {currencyData.country}
                </span>
              </div>
            )}


            {/* Error / Success banners */}
            {error && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-2xl bg-red-500/[0.08] border border-red-500/20">
                <div className="flex items-start gap-3 flex-1">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-red-400 text-sm font-medium font-['Inter',sans-serif]">{error}</p>
                </div>
                <button type="button" onClick={() => setError(null)} className="sm:ml-auto px-4 py-2 rounded-xl border border-red-400/40 text-red-400 text-sm font-medium hover:bg-red-500/10 transition-colors whitespace-nowrap">
                  {TRY_AGAIN_LABEL}
                </button>
              </div>
            )}
            {isAdultForPurchases === false && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-amber-500/[0.08] border border-amber-500/20">
                <AlertCircle className="w-4 h-4 text-amber-300 flex-shrink-0" />
                <p className="text-amber-200 text-sm font-medium font-['Inter',sans-serif]">
                  Purchases are only available to users aged 18+.
                </p>
              </div>
            )}
            {success && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-[#00ad74]/[0.08] border border-[#00ad74]/20">
                <CheckCircle className="w-4 h-4 text-[#00ad74] flex-shrink-0" />
                <p className="text-[#00ad74] text-sm font-medium font-['Inter',sans-serif]">{success}</p>
              </div>
            )}

            {/* About Treats */}
            <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
              <button
                onClick={() => setShowAboutTreats(!showAboutTreats)}
                className="w-full flex items-center justify-between p-4 active:bg-white/[0.04] transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Coins className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-semibold text-white/80 font-['Inter',sans-serif]">About Treats</span>
                </div>
                <ChevronDown className={`w-4 h-4 text-white/30 transition-transform duration-200 ${showAboutTreats ? 'rotate-180' : ''}`} />
              </button>
              {showAboutTreats && (
                <div className="px-4 pb-4 space-y-2.5">
                  {[
                    'Use treats to tip your favorite artists and other users',
                    'Promote your content to reach more listeners',
                    'Use Treat to unlock offline play',
                  ].map((text, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <div className="w-1 h-1 rounded-full bg-yellow-400 mt-1.5 flex-shrink-0" />
                      <p className="text-white/40 text-xs leading-relaxed font-['Inter',sans-serif]">{text}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Bottom Action Bar ── */}
      {!showPaymentSelector && !isLoading && currencyData && (
        <div
          className="fixed left-0 right-0 z-20 px-5 pt-3 pb-[max(0.75rem, env(safe-area-inset-bottom, 0px))] bg-[#0a0a0a]/95 backdrop-blur-xl border-t border-white/[0.04]"
          style={{ bottom: bottomBarBottomCss }}
        >
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 py-4 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/60 text-sm font-bold font-['Inter',sans-serif] active:scale-[0.98] transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleContinueToPay}
              disabled={!selectedPackage || isAdultForPurchases === false}
              className="flex-1 py-4 rounded-2xl bg-white text-black text-sm font-black font-['Inter',sans-serif] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {selectedPackage ? (
                <>
                  Continue
                  <ChevronRight className="w-4 h-4" />
                </>
              ) : (
                'Select Package'
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
