import { useState, useEffect } from 'react';
import { X, Calendar, Clock, Coins, TrendingUp, AlertCircle, Gift, Loader2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { PurchaseTreatsModal } from './PurchaseStreatsModal';
import { CustomConfirmModal } from './CustomConfirmModal';

interface PromotionSetupModalProps {
  promotionType: 'song' | 'video' | 'profile' | 'album' | 'short_clip' | 'playlist';
  targetId: string | null;
  targetTitle: string;
  targetCoverUrl?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

interface PromotionSection {
  id: string;
  section_name: string;
  section_key: string;
  description: string | null;
  treats_cost: number;
  duration_hours: number;
  is_available?: boolean;
  unavailable_reason?: string;
  cooldown_until?: string;
  current_promotion_id?: string;
}

interface TreatWallet {
  balance: number;
}

export const PromotionSetupModal = ({
  promotionType,
  targetId,
  targetTitle,
  targetCoverUrl,
  onClose,
  onSuccess
}: PromotionSetupModalProps): JSX.Element => {
  const [promotionSections, setPromotionSections] = useState<PromotionSection[]>([]);
  const [selectedSection, setSelectedSection] = useState<PromotionSection | null>(null);
  const [durationDays, setDurationDays] = useState<number>(1);
  const [startTime, setStartTime] = useState<string>('00:00');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [wallet, setWallet] = useState<TreatWallet | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(targetCoverUrl || null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showTopUpModal, setShowTopUpModal] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => {
    initializeModal();
    fetchCoverImage();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    setStartDate(today.toISOString().split('T')[0]);
    setStartTime('00:00');

    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    setEndDate(tomorrow.toISOString().split('T')[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promotionType, targetId]);

  const fetchCoverImage = async () => {
    if (targetCoverUrl || !targetId) return;

    try {
      let query;
      switch (promotionType) {
        case 'song':
          query = supabase.from('songs').select('cover_image_url').eq('id', targetId).maybeSingle();
          break;
        case 'video':
        case 'short_clip':
          // Videos and short clips are stored in content_uploads; thumbnail is inside metadata
          query = supabase.from('content_uploads').select('metadata').eq('id', targetId).maybeSingle();
          break;
        case 'album':
          query = supabase.from('albums').select('cover_image_url').eq('id', targetId).maybeSingle();
          break;
        case 'playlist':
          query = supabase.from('playlists').select('cover_image_url').eq('id', targetId).maybeSingle();
          break;
        case 'profile':
          // Avatar is on the users table, not artist_profiles
          query = supabase.from('users').select('avatar_url').eq('id', targetId).maybeSingle();
          break;
        default:
          return;
      }

      const { data, error } = await query;
      if (!error && data) {
        const imageUrl =
          data.cover_image_url ||
          data.avatar_url ||
          (data as any).metadata?.thumbnail_url ||
          (data as any).metadata?.cover_url ||
          null;
        setCoverImageUrl(imageUrl);
      }
    } catch (err) {
      console.error('Error fetching cover image:', err);
    }
  };

  const initializeModal = async () => {
    await getCreatorStatus();
    await loadData();
  };

  const getCreatorStatus = async (): Promise<boolean> => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;

      const { data, error } = await supabase
        .from('artist_profiles').select('id').eq('user_id', user.id).maybeSingle();

      if (error) { console.error('Error checking creator status:', error); return false; }
      return !!data;
    } catch (error) {
      console.error('Error in getCreatorStatus:', error);
      return false;
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [sectionsResult, walletResult] = await Promise.allSettled([
        loadPromotionSections(),
        loadWallet()
      ]);

      if (sectionsResult.status === 'rejected') throw sectionsResult.reason;
      if (walletResult.status === 'rejected') console.warn('Wallet load failed:', walletResult.reason);
    } catch (err) {
      console.error('[PromotionSetupModal] Error loading data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load promotion options');
    } finally {
      setIsLoading(false);
    }
  };

  const loadPromotionSections = async () => {
    try {
      if (!targetId) throw new Error('No content selected');

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const [sectionsData, availData] = await Promise.all([
        supabase
          .from('promotion_section_pricing')
          .select(`
            id,
            treats_cost,
            duration_hours,
            promotion_sections!section_id(
              id,
              section_name,
              section_key,
              description,
              sort_order
            )
          `)
          .eq('is_active', true)
          .eq('content_type', promotionType)
          .order('promotion_sections(sort_order)', { ascending: true }),
        supabase
          .rpc('get_available_promotion_sections', {
            p_target_id: targetId,
            p_promotion_type: promotionType,
            p_user_id: user.id
          })
          .then(result => result.error ? [] : result.data || [])
          .catch(() => [])
      ]);

      if (sectionsData.error) throw sectionsData.error;

      const sections: PromotionSection[] = (sectionsData.data || []).map((item: any) => {
        const sectionId = item.promotion_sections.id;
        const availInfo = Array.isArray(availData)
          ? availData.find((a: any) => a.section_id === sectionId)
          : undefined;

        return {
          id: sectionId,
          section_name: item.promotion_sections.section_name,
          section_key: item.promotion_sections.section_key,
          description: item.promotion_sections.description,
          treats_cost: item.treats_cost,
          duration_hours: item.duration_hours,
          is_available: availInfo?.is_available ?? true,
          unavailable_reason: availInfo?.unavailable_reason,
          cooldown_until: availInfo?.cooldown_until,
          current_promotion_id: availInfo?.current_promotion_id
        };
      });

      setPromotionSections(sections);

      const firstAvailable = sections.find(s => s.is_available !== false);
      if (firstAvailable) setSelectedSection(firstAvailable);
      else if (sections.length > 0) setSelectedSection(sections[0]);
    } catch (err) {
      console.error('Error loading promotion sections:', err);
      throw err;
    }
  };

  const loadWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Please sign in to continue');

      const { data, error } = await supabase
        .from('treat_wallets').select('balance').eq('user_id', user.id).maybeSingle();

      if (error) throw error;
      setWallet(data || { balance: 0 });
    } catch (err) {
      console.error('[PromotionSetupModal] Error loading wallet:', err);
      throw err;
    }
  };

  const calculateCost = (): number => {
    if (!selectedSection) return 0;
    return Number(selectedSection.treats_cost) * durationDays;
  };

  const calculateDurationFromDates = (): number => {
    if (!startDate || !endDate || !startTime) return 1;
    const startDateTime = new Date(`${startDate}T${startTime}:00`);
    const endDateTime = new Date(`${endDate}T${startTime}:00`);
    const days = Math.ceil((endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, days);
  };

  useEffect(() => {
    if (startDate && endDate && startTime) {
      setDurationDays(calculateDurationFromDates());
    }
  }, [startDate, endDate, startTime]);

  const handleContinueClick = () => {
    if (!wallet) { setError('Wallet information not available'); return; }
    if (!selectedSection) { setError('Please select a promotion section'); return; }

    if (selectedSection.is_available === false) {
      if (selectedSection.unavailable_reason === 'already_active') {
        setError('This content is already promoted in this section. Please wait until the current promotion ends.');
      } else if (selectedSection.unavailable_reason === 'cooldown_active') {
        setError('This content is in cooldown period. Please wait 2 hours after your previous promotion ends.');
      } else {
        setError('This section is currently unavailable for promotion.');
      }
      return;
    }

    const days = calculateDurationFromDates();
    if (days < 1) { setError('Promotion must be at least 1 full day'); return; }
    if (!startDate) { setError('Please select a start date'); return; }
    if (!endDate) { setError('Please select an end date'); return; }

    const startDateTime = new Date(`${startDate}T${startTime}:00`);
    const endDateTime = new Date(`${endDate}T${startTime}:00`);

    if (endDateTime <= startDateTime) {
      setError('End date must be after start date');
      return;
    }

    const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
    if (durationHours % 24 !== 0) {
      setError('Promotion must be in full 24-hour periods');
      return;
    }

    if (calculateCost() > wallet.balance) {
      setShowTopUpModal(true);
      return;
    }

    setShowConfirmation(true);
  };

  const handleConfirmPromotion = async () => {
    if (!wallet || !selectedSection) return;

    const treatsCost = Number(selectedSection.treats_cost) * durationDays;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const startDateTime = new Date(`${startDate}T${startTime}:00`);
      const endDateTime = new Date(`${endDate}T${startTime}:00`);
      const actualDurationMs = endDateTime.getTime() - startDateTime.getTime();

      const { error: promotionError } = await supabase
        .from('promotions')
        .insert({
          user_id: user.id,
          promotion_type: promotionType,
          promotion_section_id: selectedSection.id,
          target_id: targetId,
          target_title: targetTitle,
          treats_cost: treatsCost,
          duration_hours: Math.ceil(actualDurationMs / (1000 * 60 * 60)),
          duration_days: Math.ceil(actualDurationMs / (1000 * 60 * 60 * 24)),
          start_date: startDateTime.toISOString(),
          end_date: endDateTime.toISOString(),
          status: 'pending_approval',
          impressions_target: treatsCost * 20,
          impressions_actual: 0,
          clicks: 0
        })
        .select('id')
        .single();

      if (promotionError) throw new Error(promotionError.message || 'Failed to create promotion');

      setSuccess('Promotion submitted for approval!');
      await loadWallet();

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (err) {
      console.error('Error creating promotion:', err);
      setError(err instanceof Error ? err.message : 'Failed to create promotion');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getPromotionTypeLabel = (): string => {
    const labels: Record<string, string> = { song: 'Song', video: 'Video', profile: 'Profile', album: 'Album' };
    return labels[promotionType] || 'Content';
  };

  const inputCls = 'w-full h-11 bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 text-white/90 text-sm outline-none focus:border-[#00ad74]/40 focus:bg-white/[0.06] transition-all font-["Inter",sans-serif] [color-scheme:dark]';

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-[110] flex flex-col">
        <header className="px-5 pt-6 pb-4 border-b border-white/[0.04] flex items-center gap-3">
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.07] flex items-center justify-center">
            <X className="w-4 h-4 text-white/70" />
          </button>
          <div>
            <div className="h-5 w-32 rounded-lg bg-white/[0.06] animate-pulse" />
            <div className="h-3 w-24 rounded-lg bg-white/[0.04] animate-pulse mt-1.5" />
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-white/20 animate-spin" />
        </div>
      </div>
    );
  }

  if (error && promotionSections.length === 0) {
    return (
      <div className="fixed inset-0 bg-[#0a0a0a] z-[110] flex flex-col">
        <header className="px-5 pt-6 pb-4 border-b border-white/[0.04] flex items-center gap-3">
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.07] flex items-center justify-center active:scale-[0.93] transition-transform">
            <X className="w-4 h-4 text-white/70" />
          </button>
          <div>
            <h1 className="font-black text-white text-xl tracking-tight font-['Inter',sans-serif]">Setup Boost,</h1>
            <p className="text-white/35 text-xs font-light font-['Inter',sans-serif]">promote your content.</p>
          </div>
        </header>

        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
            <AlertCircle className="w-7 h-7 text-red-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-white text-lg font-['Inter',sans-serif]">Failed to load</p>
            <p className="text-white/40 text-sm mt-1 font-['Inter',sans-serif]">{error}</p>
          </div>
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={onClose}
              className="flex-1 py-3.5 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/70 text-sm font-bold font-['Inter',sans-serif] active:scale-[0.98] transition-transform"
            >
              Close
            </button>
            <button
              onClick={() => { setError(null); loadData(); }}
              className="flex-1 py-3.5 rounded-2xl bg-white text-black text-sm font-black font-['Inter',sans-serif] active:scale-[0.98] transition-transform"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-[110] flex flex-col overflow-hidden">

      <header className="px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl border-b border-white/[0.04] flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-white/[0.05] border border-white/[0.07] flex items-center justify-center active:scale-[0.93] active:bg-white/[0.08] transition-all flex-shrink-0"
          >
            <X className="w-4 h-4 text-white/70" />
          </button>
          <div>
            <h1 className="font-['Inter',sans-serif] font-black text-white text-xl tracking-tight leading-tight">
              Setup Boost,
            </h1>
            <p className="text-white/35 text-xs font-light font-['Inter',sans-serif] leading-tight">
              promote your content.
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="px-5 py-5 pb-32 space-y-5">

          <div className="flex items-center gap-3 p-4 rounded-2xl border border-[#00ad74]/15 bg-[#00ad74]/5">
            {coverImageUrl ? (
              <img
                src={coverImageUrl}
                alt={targetTitle}
                loading="lazy"
                className="w-12 h-12 rounded-xl object-cover flex-shrink-0 bg-white/[0.05]"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-[#00ad74]/20 flex items-center justify-center flex-shrink-0">
                <Gift className="w-6 h-6 text-[#00ad74]" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white/35 text-[10px] font-bold uppercase tracking-widest font-['Inter',sans-serif]">
                Boosting {getPromotionTypeLabel()}
              </p>
              <p className="font-bold text-white/90 text-sm truncate font-['Inter',sans-serif] mt-0.5">
                {targetTitle}
              </p>
            </div>
          </div>

          {wallet && (
            <div className="flex items-center gap-4 p-4 rounded-2xl border border-yellow-500/15 bg-yellow-500/5">
              <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center flex-shrink-0">
                <Coins className="w-5 h-5 text-yellow-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white/35 text-[10px] font-bold uppercase tracking-widest font-['Inter',sans-serif]">Available Balance</p>
                <p className="font-black text-yellow-400 text-xl tabular-nums font-['Inter',sans-serif] leading-tight">
                  {wallet.balance.toLocaleString()} <span className="text-sm font-semibold text-white/40">treats</span>
                </p>
              </div>
              <button
                onClick={() => setShowTopUpModal(true)}
                className="flex-shrink-0 px-3 py-1.5 rounded-xl bg-yellow-500/15 border border-yellow-500/20 text-yellow-400 text-xs font-bold font-['Inter',sans-serif] active:scale-[0.97] transition-transform"
              >
                Top Up
              </button>
            </div>
          )}

          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-4">Duration</p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <p className="text-white/35 text-xs font-['Inter',sans-serif] mb-1.5">Start Date</p>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      min={new Date().toISOString().split('T')[0]}
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                </div>
                <div>
                  <p className="text-white/35 text-xs font-['Inter',sans-serif] mb-1.5">End Date</p>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      min={startDate || new Date().toISOString().split('T')[0]}
                      className={`${inputCls} pl-9`}
                    />
                  </div>
                </div>
              </div>

              <div>
                <p className="text-white/35 text-xs font-['Inter',sans-serif] mb-1.5">Start Time</p>
                <div className="relative">
                  <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25 pointer-events-none" />
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={`${inputCls} pl-9`}
                  />
                </div>
              </div>

              {durationDays > 0 && selectedSection && (
                <div className="mt-4 pt-4 border-t border-white/[0.06] space-y-2">
                  {[
                    { label: 'Duration', value: `${durationDays} day${durationDays !== 1 ? 's' : ''} (${durationDays * 24}h)` },
                    { label: 'Per day', value: `${Number(selectedSection.treats_cost).toLocaleString()} treats` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between">
                      <p className="text-white/35 text-sm font-['Inter',sans-serif]">{label}</p>
                      <p className="text-white/70 text-sm font-semibold font-['Inter',sans-serif] tabular-nums">{value}</p>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
                    <p className="text-white/70 text-sm font-bold font-['Inter',sans-serif]">Total Cost</p>
                    <div className="flex items-center gap-1.5">
                      <Coins className="w-4 h-4 text-yellow-400" />
                      <p className="font-black text-white text-base tabular-nums font-['Inter',sans-serif]">
                        {calculateCost().toLocaleString()}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-4">Boost Section</p>

              {promotionSections.length === 0 ? (
                <div className="flex flex-col items-center py-10 gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center">
                    <AlertCircle className="w-5 h-5 text-white/20" />
                  </div>
                  <p className="text-white/25 text-sm font-['Inter',sans-serif] text-center">
                    No sections available for this content type.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {promotionSections.map((section) => {
                    const isUnavailable = section.is_available === false;
                    const isAlreadyActive = section.unavailable_reason === 'already_active';
                    const isInCooldown = section.unavailable_reason === 'cooldown_active';
                    const isSelected = selectedSection?.id === section.id;

                    return (
                      <button
                        key={section.id}
                        onClick={() => !isUnavailable && setSelectedSection(section)}
                        disabled={isUnavailable}
                        className={`w-full text-left p-4 rounded-2xl border transition-all active:scale-[0.98] ${
                          isUnavailable
                            ? 'border-red-500/20 bg-red-500/5 opacity-60 cursor-not-allowed'
                            : isSelected
                            ? 'border-[#00ad74]/30 bg-[#00ad74]/8'
                            : 'border-white/[0.07] bg-white/[0.02] active:bg-white/[0.05]'
                        }`}
                        style={isSelected && !isUnavailable ? { background: 'rgba(0,173,116,0.06)' } : undefined}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              {isSelected && !isUnavailable && (
                                <div className="w-4 h-4 rounded-full bg-[#00ad74] flex items-center justify-center flex-shrink-0">
                                  <svg className="w-2.5 h-2.5 text-black" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                </div>
                              )}
                              <p className={`font-bold text-sm font-['Inter',sans-serif] ${isSelected ? 'text-white' : 'text-white/70'}`}>
                                {section.section_name}
                              </p>
                              {isUnavailable && (
                                <span className="px-1.5 py-0.5 rounded-md bg-red-500/15 border border-red-500/20 text-red-400 text-[10px] font-bold font-['Inter',sans-serif]">
                                  {isAlreadyActive ? 'Active' : 'Cooldown'}
                                </span>
                              )}
                            </div>

                            {section.description && (
                              <p className="text-white/35 text-xs font-['Inter',sans-serif] leading-relaxed mt-0.5">
                                {section.description}
                              </p>
                            )}

                            {isUnavailable && (
                              <p className="text-red-400/70 text-xs font-['Inter',sans-serif] mt-1.5">
                                {isAlreadyActive
                                  ? 'Already promoted in this section'
                                  : isInCooldown && section.cooldown_until
                                  ? `Cooldown until ${new Date(section.cooldown_until).toLocaleString()}`
                                  : 'Currently unavailable'}
                              </p>
                            )}
                          </div>

                          <div className="text-right flex-shrink-0">
                            <div className="flex items-center gap-1 justify-end">
                              <Coins className="w-3.5 h-3.5 text-yellow-400" />
                              <p className="font-black text-white text-base tabular-nums font-['Inter',sans-serif]">
                                {Number(section.treats_cost).toLocaleString()}
                              </p>
                            </div>
                            <p className="text-white/25 text-[10px] font-['Inter',sans-serif]">per day</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4 space-y-1.5">
            <p className="text-white/30 text-[10px] font-bold uppercase tracking-widest font-['Inter',sans-serif] mb-2">How It Works</p>
            {[
              'Boosts run in full 24-hour periods',
              'Price is per day — multiply for longer runs',
              'Goes live immediately when Auto-Approval is enabled',
              'Track performance in the Campaigns tab',
              'Treats are deducted upon confirmation',
            ].map((item) => (
              <div key={item} className="flex items-start gap-2">
                <div className="w-1 h-1 rounded-full bg-white/20 flex-shrink-0 mt-1.5" />
                <p className="text-white/30 text-xs font-['Inter',sans-serif]">{item}</p>
              </div>
            ))}
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-4 rounded-2xl bg-red-500/8 border border-red-500/20">
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-400 text-sm font-['Inter',sans-serif] leading-relaxed">{error}</p>
            </div>
          )}

          {success && (
            <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-[#00ad74]/8 border border-[#00ad74]/20">
              <CheckCircle className="w-4 h-4 text-[#00ad74] flex-shrink-0" />
              <p className="text-[#00ad74] text-sm font-bold font-['Inter',sans-serif]">{success}</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-4 rounded-2xl bg-white/[0.05] border border-white/[0.07] text-white/60 text-sm font-bold font-['Inter',sans-serif] active:scale-[0.98] disabled:opacity-40 transition-transform"
            >
              Cancel
            </button>
            <button
              onClick={handleContinueClick}
              disabled={isSubmitting || !startDate || !endDate || !startTime || !selectedSection || durationDays < 1}
              className="flex-1 py-4 rounded-2xl bg-[#00ad74] text-black text-sm font-black font-['Inter',sans-serif] flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-transform"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <><TrendingUp className="w-4 h-4" /> Start Boost</>
              )}
            </button>
          </div>
        </div>
      </div>

      {showTopUpModal && (
        <PurchaseTreatsModal
          onClose={() => setShowTopUpModal(false)}
          onSuccess={() => {
            setShowTopUpModal(false);
            loadWallet();
          }}
        />
      )}

      <CustomConfirmModal
        isOpen={showConfirmation}
        title="Confirm Promotion"
        message={`You are about to boost "${targetTitle}" in ${selectedSection?.section_name} for ${durationDays} day${durationDays !== 1 ? 's' : ''} at a cost of ${calculateCost().toLocaleString()} treats. After this promotion, your balance will be ${((wallet?.balance || 0) - calculateCost()).toLocaleString()} treats. This action cannot be undone.`}
        confirmText="Confirm Boost"
        cancelText="Cancel"
        variant="warning"
        onConfirm={handleConfirmPromotion}
        onCancel={() => setShowConfirmation(false)}
      />
    </div>
  );
};
