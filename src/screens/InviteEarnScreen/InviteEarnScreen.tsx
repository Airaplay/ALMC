import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, Check, Share2, Users, Gift, Zap, UserPlus, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { shareContent, PRODUCTION_ORIGIN } from '../../lib/shareService';
import { useAuth } from '../../contexts/AuthContext';
import { cn } from '../../lib/utils';

interface ReferralStats {
  totalReferrals: number;
  pendingReferrals: number;
  activeReferrals: number;
  rewardedReferrals: number;
  totalEarned: number;
}

export const InviteEarnScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [referralCode, setReferralCode] = useState('');
  const [referralLink, setReferralLink] = useState('');
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [referralStats, setReferralStats] = useState<ReferralStats>({
    totalReferrals: 0,
    pendingReferrals: 0,
    activeReferrals: 0,
    rewardedReferrals: 0,
    totalEarned: 0,
  });
  const [rewardPerReferral, setRewardPerReferral] = useState(100);

  useEffect(() => {
    loadReferralData();
  }, [user]);

  const loadReferralData = async () => {
      if (!user) {
        navigate('/profile');
        return;
      }
    try {
      setIsLoading(true);
      const { data: codeData } = await supabase
        .from('referral_codes')
        .select('code')
        .eq('user_id', user.id)
        .maybeSingle();
      let code = codeData?.code ?? null;
      if (!code) {
        const { data } = await supabase.rpc('generate_referral_code', { p_user_id: user.id });
        code = data ?? null;
      }
      if (code) {
        setReferralCode(code);
        setReferralLink(`${PRODUCTION_ORIGIN}/r/${encodeURIComponent(code)}`);
      }

      const { data: referrals } = await supabase
        .from('referrals')
        .select('*')
        .eq('referrer_id', user.id);
      if (referrals) {
        setReferralStats({
          totalReferrals: referrals.length,
          pendingReferrals: referrals.filter((r) => r.status === 'pending').length,
          activeReferrals: referrals.filter((r) => r.status === 'active').length,
          rewardedReferrals: referrals.filter((r) => r.status === 'rewarded').length,
          totalEarned: referrals.reduce((sum, r) => sum + (r.reward_amount || 0), 0),
        });
      }
      const { data: settings } = await supabase
        .from('referral_settings')
        .select('reward_per_referral')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (settings) setRewardPerReferral(settings.reward_per_referral);
    } catch (err) {
      console.error('Error loading referral data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!referralCode) return;
    try {
      await navigator.clipboard.writeText(referralCode);
      setIsCodeCopied(true);
      setTimeout(() => setIsCodeCopied(false), 2500);
    } catch {
      console.error('Failed to copy code');
    }
  };

  const handleCopyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setIsLinkCopied(true);
      setTimeout(() => setIsLinkCopied(false), 2500);
    } catch {
      console.error('Failed to copy link');
    }
  };

  const handleShare = async () => {
    try {
      await shareContent({
        title: 'Join Airaplay',
        text: `Join me on Airaplay! Use my referral code ${referralCode} to sign up and we both earn rewards!`,
        url: referralLink,
        dialogTitle: 'Share Referral Link',
      });
    } catch {
      handleCopyLink();
    }
  };

  const steps = [
    { n: 1, icon: Share2, title: 'Share Your Link', desc: 'Send your personal referral link to friends via any platform.' },
    { n: 2, icon: UserPlus, title: 'They Sign Up', desc: 'Your friends create an account on Airaplay using your link.' },
    { n: 3, icon: Zap, title: 'They Get Active', desc: 'Once they listen and engage, they become verified active users.' },
    { n: 4, icon: Gift, title: 'You Earn Treats', desc: `${rewardPerReferral} Treats land in your wallet for every successful referral.` },
  ];

  const statItems = [
    { label: 'Total Invites', value: referralStats.totalReferrals, icon: Users },
    { label: 'Pending', value: referralStats.pendingReferrals, icon: Zap },
    { label: 'Active', value: referralStats.activeReferrals, icon: UserPlus },
    { label: 'Rewarded', value: referralStats.rewardedReferrals, icon: Star },
  ];

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white font-['Inter',sans-serif]">
      <main className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 content-with-nav">
        {/* Sticky sub-header — matches Create Screen */}
        <div
          className="sticky top-0 z-10 border-b border-white/10 px-4 py-3.5 flex items-center gap-3 bg-[#1a1a1a]"
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
        >
        <button
            type="button"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}
            className="min-w-[44px] min-h-[44px] p-2 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors flex items-center justify-center -ml-1"
            aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-white/80" />
        </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 mb-0.5">
              Referral Rewards
            </p>
            <h1 className="text-[15px] font-black tracking-tight text-white leading-none">
          Invite & Earn
        </h1>
          </div>
        </div>

        {isLoading ? (
          <div className="px-4 sm:px-6 py-10 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-28 bg-white/5 rounded-2xl animate-pulse" />
            ))}
        </div>
      ) : (
          <div className="px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8 max-w-[600px] mx-auto">
            {/* Hero banner — Create-style surfaces */}
            <div className="relative rounded-3xl overflow-hidden border border-white/10 bg-white/5">
              <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(48,150,5,0.15),transparent_60%)]" />
              <div className="absolute top-0 right-0 w-48 h-48 sm:w-64 sm:h-64 rounded-full bg-[#309605]/10 blur-3xl -translate-y-1/2 translate-x-1/4" />

              <div className="relative p-6 sm:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
                  <div className="space-y-3 min-w-0">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#309605]/20 border border-[#309605]/30">
                      <Gift className="w-3.5 h-3.5 text-[#309605]" />
                      <span className="text-[11px] font-bold text-[#309605] uppercase tracking-widest">
                        Referral Program
                      </span>
              </div>
                    <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white leading-[1.15]">
                      Invite friends.
                      <br />
                      <span className="text-white/70">Earn Treats.</span>
                </h2>
                    <p className="text-[13px] sm:text-sm text-white/50 leading-relaxed max-w-sm">
                      Share Airaplay with your network and receive{' '}
                      <span className="font-bold text-[#309605]">{rewardPerReferral} Treats</span>{' '}
                      for every friend who becomes an active listener.
                    </p>
                  </div>
                  <div className="flex-shrink-0 text-center sm:text-right">
                    <p className="text-[11px] text-white/50 uppercase tracking-widest font-semibold mb-1">
                      Per Referral
                    </p>
                    <p className="text-5xl sm:text-7xl font-black tabular-nums text-white leading-none">
                      {rewardPerReferral}
                    </p>
                    <p className="text-sm text-white/50 font-medium mt-1">Treats</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Referral code + link */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 px-1">
                Your Invite Details
              </p>

              <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
                <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 border-b border-white/10">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2 sm:mb-3">
                    Referral Code
                  </p>
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-xl sm:text-3xl font-black tracking-[0.2em] sm:tracking-[0.3em] text-white tabular-nums break-all">
                      {referralCode || '— — — —'}
                    </p>
                    <button
                      type="button"
                      onClick={handleCopyCode}
                      className={cn(
                        'flex items-center justify-center gap-2 min-h-[44px] min-w-[132px] px-4 py-2.5 rounded-xl text-sm font-bold transition-all shrink-0',
                        isCodeCopied
                          ? 'bg-[#309605]/20 text-[#309605] border border-[#309605]/30'
                          : 'bg-white/10 hover:bg-white/15 text-white border border-white/10'
                      )}
                    >
                      {isCodeCopied ? (
                        <>
                          <Check className="w-4 h-4" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" /> Copy Code
                        </>
                      )}
                    </button>
                  </div>
            </div>

                <div className="px-4 sm:px-6 py-3 sm:py-4">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-2">
                    Referral Link
                  </p>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex-1 bg-white/5 rounded-xl px-3 sm:px-4 py-2.5 sm:py-3 border border-white/10 min-w-0">
                      <p className="text-[11px] sm:text-[12px] text-white/50 truncate font-mono">
                {referralLink || '...'}
              </p>
            </div>
                  </div>
                </div>

                <div className="px-4 sm:px-6 pb-4 sm:pb-6 grid grid-cols-2 gap-3">
              <button
                    type="button"
                onClick={handleCopyLink}
                    className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl border border-white/10 hover:bg-white/5 hover:border-white/20 text-white text-sm font-semibold transition-all active:scale-[0.98]"
              >
                {isLinkCopied ? (
                  <>
                        <Check className="w-4 h-4 text-[#309605]" /> Link Copied
                  </>
                ) : (
                  <>
                        <Copy className="w-4 h-4" /> Copy Link
                  </>
                )}
              </button>
              <button
                    type="button"
                onClick={handleShare}
                    className="min-h-[48px] flex items-center justify-center gap-2 rounded-xl bg-white text-black text-sm font-bold hover:opacity-90 active:scale-[0.98] transition-all"
              >
                    <Share2 className="w-4 h-4" /> Share Now
              </button>
            </div>
              </div>
            </div>

            {/* Stats — opaque surfaces + isolation avoid Android WebView compositing glitches (noise between cards) */}
            <div className="space-y-3 relative isolate [transform:translateZ(0)] [contain:paint]">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 px-1">
                Your Performance
              </p>

              <div className="rounded-2xl border border-white/10 bg-[#141414] p-4 sm:p-6 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">
                    Total Treats Earned
                  </p>
                  <p className="text-4xl sm:text-5xl font-black tabular-nums text-white leading-none">
                {referralStats.totalEarned}
                  </p>
                  <p className="text-xs text-white/50 mt-2">
                    Across {referralStats.rewardedReferrals} rewarded referral
                    {referralStats.rewardedReferrals !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#309605]/20 border border-[#309605]/30 flex items-center justify-center flex-shrink-0">
                  <Gift className="w-7 h-7 sm:w-8 sm:h-8 text-[#309605]" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 [backface-visibility:hidden]">
                {statItems.map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-white/10 bg-[#141414] p-3 sm:p-4 flex flex-col gap-2 sm:gap-3 min-h-[96px]"
                  >
                    <Icon className="w-4 h-4 text-white/50 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-xl sm:text-2xl font-black tabular-nums text-white leading-none">
                        {value}
                      </p>
                      <p className="text-[11px] text-white/50 mt-1 font-medium">{label}</p>
                </div>
                </div>
                ))}
              </div>
                </div>

            {/* How it works */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/60 px-1">
                How It Works
              </p>

              <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden divide-y divide-white/10">
                {steps.map(({ n, icon: Icon, title, desc }, idx) => (
                  <div key={n} className="flex items-start gap-3 sm:gap-5 px-4 sm:px-6 py-4 sm:py-5">
                    <div className="flex flex-col items-center gap-1 flex-shrink-0 pt-0.5">
                      <div
                        className={cn(
                          'w-8 h-8 rounded-xl flex items-center justify-center',
                          idx === steps.length - 1
                            ? 'bg-gradient-to-r from-[#309605] to-[#3ba208] shadow-lg shadow-[#309605]/20'
                            : 'bg-white/10 border border-white/10'
                        )}
                      >
                        <span
                          className={cn(
                            'text-xs font-black',
                            idx === steps.length - 1 ? 'text-white' : 'text-white/60'
                          )}
                        >
                          {n}
                        </span>
                      </div>
                    </div>
                    <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Icon className="w-4 h-4 text-white/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white leading-tight">{title}</p>
                      <p className="text-xs text-white/50 leading-relaxed mt-1">{desc}</p>
                    </div>
                </div>
                ))}
              </div>
            </div>
        </div>
      )}
      </main>
    </div>
  );
};
