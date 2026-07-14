import React, { useState, useEffect } from 'react';
import { ArrowLeft, Search, Loader2, X, Clock, Send } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { supabase, searchUsersByUsername } from '../lib/supabase';
import { Skeleton } from './ui/skeleton';
import { treatCache, CACHE_KEYS, getCachedData } from '../lib/treatCache';
import { getTreatWalletSpendable } from '../lib/treatWalletSpendable';
import { CustomConfirmDialog } from './CustomConfirmDialog';

interface TippingModalProps {
  onClose: () => void;
  onSuccess: () => void;
  recipientId?: string | null;
  contentId?: string | null;
  contentType?: string | null;
  recipientName?: string | null;
  recipientAvatar?: string | null;
}

interface TreatWallet {
  balance: number;
  promo_balance: number;
}

interface TipRecipient {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  role: string;
}

const QUICK_AMOUNTS = [5, 10, 25, 50, 100, 250];

const fmtShort = (n: number): string => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return n.toLocaleString();
};

export const TippingModal: React.FC<TippingModalProps> = ({
  onClose,
  onSuccess,
  recipientId,
  contentId,
  contentType,
  recipientName,
  recipientAvatar
}) => {
  const [wallet, setWallet] = useState<TreatWallet | null>(null);
  const [selectedRecipient, setSelectedRecipient] = useState<TipRecipient | null>(null);
  const [tipAmount, setTipAmount] = useState<string>('');
  const [tipMessage, setTipMessage] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<TipRecipient[]>([]);
  const [recentRecipients, setRecentRecipients] = useState<TipRecipient[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingRecents, setIsLoadingRecents] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showConfirmTip, setShowConfirmTip] = useState(false);
  const [sentAmount, setSentAmount] = useState(0);

  useEffect(() => {
    loadWalletAndRecipient();
    loadRecentRecipients();
    document.body.classList.add('modal-open');
    return () => {
      document.body.classList.remove('modal-open');
    };
  }, [recipientId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        searchUsers(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const loadWalletAndRecipient = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: walletData, error: walletError } = await supabase
        .from('treat_wallets')
        .select('balance, promo_balance')
        .eq('user_id', user.id)
        .maybeSingle();

      if (walletError) throw walletError;
      setWallet(
        walletData
          ? {
              balance: Number(walletData.balance) || 0,
              promo_balance: Number((walletData as { promo_balance?: unknown }).promo_balance) || 0,
            }
          : { balance: 0, promo_balance: 0 }
      );

      if (recipientId) {
        const { data: recipientData, error: recipientError } = await supabase
          .from('users')
          .select('id, display_name, username, avatar_url, role')
          .eq('id', recipientId)
          .maybeSingle();

        if (recipientError) console.error('Error loading recipient:', recipientError);

        if (recipientData) {
          setSelectedRecipient(recipientData);
        } else if (recipientName) {
          setSelectedRecipient({
            id: recipientId,
            display_name: recipientName,
            username: null,
            avatar_url: recipientAvatar || null,
            role: 'creator'
          });
        } else {
          setError('Recipient not found. Please search for a user to tip.');
        }
      }
    } catch (err) {
      console.error('Error loading wallet and recipient:', err);
      setError('Failed to load wallet information');
    }
  };

  const loadRecentRecipients = async () => {
    try {
      setIsLoadingRecents(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const recipients = await getCachedData(
        CACHE_KEYS.RECENT_RECIPIENTS(user.id),
        async () => {
          const { data, error } = await supabase
            .from('treat_tips')
            .select(`recipient:recipient_id (id, display_name, username, avatar_url, role)`)
            .eq('sender_id', user.id)
            .order('created_at', { ascending: false })
            .limit(5);

          if (error) throw error;

          const uniqueRecipients = new Map();
          data?.forEach((tip: any) => {
            if (tip.recipient && !uniqueRecipients.has(tip.recipient.id)) {
              uniqueRecipients.set(tip.recipient.id, tip.recipient);
            }
          });
          return Array.from(uniqueRecipients.values());
        },
        2 * 60 * 1000
      );

      setRecentRecipients(recipients);
    } catch (err) {
      console.error('Error loading recent recipients:', err);
    } finally {
      setIsLoadingRecents(false);
    }
  };

  const searchUsers = async (query: string) => {
    try {
      setIsSearching(true);
      const users = await searchUsersByUsername(query);
      const { data: { user } } = await supabase.auth.getUser();
      setSearchResults(users.filter(u => u.id !== user?.id));
    } catch (err) {
      console.error('Error searching users:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDeleteRecipient = async (recipientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('treat_tips')
        .delete()
        .eq('sender_id', user.id)
        .eq('recipient_id', recipientId);
      if (error) { console.error('Error deleting tips:', error); return; }
      setRecentRecipients(prev => prev.filter(r => r.id !== recipientId));
      treatCache.invalidate(CACHE_KEYS.RECENT_RECIPIENTS(user.id));
    } catch (err) {
      console.error('Error deleting recipient:', err);
    }
  };

  const handleTipAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value === '' || /^\d+$/.test(value)) setTipAmount(value);
  };

  const spendable = wallet ? getTreatWalletSpendable(wallet) : 0;

  const calculateRemainingBalance = (): number => {
    if (!wallet || !tipAmount) return spendable;
    return Math.max(0, spendable - (parseInt(tipAmount) || 0));
  };

  const handleTipClick = () => {
    const amount = parseInt(tipAmount);
    if (!amount || amount <= 0) { setError('Please enter a valid tip amount'); return; }
    if (!wallet || amount > spendable) { setError('Insufficient treats balance'); return; }
    if (!selectedRecipient) { setError('Please select a recipient'); return; }
    setShowConfirmTip(true);
  };

  const handleConfirmTip = async () => {
    setShowConfirmTip(false);
    if (!selectedRecipient) { setError('Please select a recipient'); return; }
    const amount = parseInt(tipAmount);
    if (!amount || amount <= 0) { setError('Please enter a valid tip amount'); return; }
    if (!wallet || amount > spendable) { setError('Insufficient treats balance'); return; }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error: tipError } = await supabase
        .from('treat_tips')
        .insert({
          sender_id: user.id,
          recipient_id: selectedRecipient.id,
          amount,
          message: tipMessage.trim() || null,
          content_id: contentId || null,
          content_type: contentType || null
        });

      if (tipError) throw tipError;

      updateListenerStatsForTip(user.id, selectedRecipient.id, amount).catch(err => {
        console.warn('Failed to update listener stats:', err);
      });

      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (currentUser) {
        treatCache.invalidate(CACHE_KEYS.WALLET(currentUser.id));
        treatCache.invalidate(CACHE_KEYS.RECENT_RECIPIENTS(currentUser.id));
        treatCache.invalidatePattern(`tips:recent:${currentUser.id}`);
      }

      setSentAmount(amount);
      setSuccess(`Successfully sent ${amount} treats to ${selectedRecipient.display_name || selectedRecipient.username}!`);
      setTipAmount('');
      setTipMessage('');

      setTimeout(() => {
        onSuccess();
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Error sending tip:', err);
      setError(err instanceof Error ? err.message : 'Failed to send tip');
    } finally {
      setIsSubmitting(false);
    }
  };

  const amt = parseInt(tipAmount) || 0;
  const canSend = amt > 0 && !!wallet && amt <= spendable && !!selectedRecipient && !isSubmitting;

  return (
    <div className="fixed inset-0 bg-[#0a0a0a] z-[110] overflow-y-auto">
      <div className="min-h-screen pb-safe">

        {/* ── Header ── */}
        <header className="sticky top-0 z-20 px-5 pt-6 pb-4 bg-[#0a0a0a]/90 backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={onClose}
                className="w-9 h-9 flex items-center justify-center rounded-full bg-white/8 active:scale-95 transition-transform"
              >
                <ArrowLeft className="w-4 h-4 text-white/80" />
              </button>
              <div>
                <h1 className="font-['Inter',sans-serif] font-black text-white text-2xl tracking-tight leading-tight">
                  Send Treat,
                </h1>
                <p className="text-white/40 text-base font-light leading-tight">to a creator.</p>
              </div>
            </div>
          </div>
        </header>

        <div className="px-5 pt-2 pb-10 space-y-4">

          {/* ── Success State ── */}
          {success ? (
            <div className="space-y-4 pt-6">
              <div className="relative rounded-3xl overflow-hidden border border-yellow-500/20 bg-gradient-to-br from-yellow-600/15 via-orange-600/10 to-transparent p-8 text-center">
                <div className="absolute top-0 right-0 w-40 h-40 bg-yellow-500/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
                <div className="relative">
                  <div className="flex items-center justify-center gap-2 mb-5">
                    <span className="relative flex h-2.5 w-2.5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00ad74] opacity-75" />
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#00ad74]" />
                    </span>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#00ad74]">Confirmed</p>
                  </div>
                  <p
                    className="font-['Inter',sans-serif] font-black text-yellow-400 leading-none tracking-tight mb-1 tabular-nums"
                    style={{ fontSize: 'clamp(2.5rem, 14vw, 4rem)' }}
                  >
                    {fmtShort(sentAmount)}
                  </p>
                  <p className="text-[12px] text-white/35 font-semibold uppercase tracking-widest mb-4">Treats Sent</p>
                  <p className="text-sm text-white/50">
                    to <span className="text-white/80 font-semibold">{selectedRecipient?.display_name}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="w-full py-4 rounded-2xl bg-white text-black font-bold text-sm active:scale-[0.98] transition-transform"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              {/* ── Balance Card ── */}
              {wallet && (
                <div className="relative rounded-3xl overflow-hidden border border-yellow-500/20 bg-gradient-to-br from-yellow-600/15 via-orange-600/10 to-transparent">
                  <div className="absolute top-0 right-0 w-36 h-36 bg-yellow-500/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
                  <div className="relative px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-500/50 mb-0.5">Available Balance</p>
                      <p
                        className="font-['Inter',sans-serif] font-black text-yellow-400 leading-none tabular-nums"
                        style={{ fontSize: 'clamp(1.6rem, 8vw, 2.4rem)' }}
                      >
                        {fmtShort(spendable)}
                      </p>
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-yellow-500/40">Treats</p>
                  </div>
                </div>
              )}

              {/* ── Recipient Selection ── */}
              {!selectedRecipient ? (
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
                  <div className="px-5 pt-5 pb-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-4">Select Recipient</p>

                    {/* Recent */}
                    {isLoadingRecents && (
                      <div className="space-y-2 mb-4">
                        {[1, 2].map(i => (
                          <Skeleton key={i} className="h-14 rounded-2xl bg-white/[0.05]" />
                        ))}
                      </div>
                    )}

                    {!isLoadingRecents && recentRecipients.length > 0 && !searchQuery && (
                      <div className="mb-4">
                        <div className="flex items-center gap-1.5 mb-2.5">
                          <Clock className="w-3 h-3 text-white/25" />
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/25">Recent</p>
                        </div>
                        <div className="space-y-1.5">
                          {recentRecipients.map((r) => (
                            <button
                              key={r.id}
                              onClick={() => setSelectedRecipient(r)}
                              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-white/[0.04] active:bg-white/[0.08] transition-colors text-left group"
                            >
                              <Avatar className="w-9 h-9 shrink-0">
                                <AvatarImage src={r.avatar_url || undefined} />
                                <AvatarFallback className="bg-white/10 text-white/60 text-xs font-bold">
                                  {(r.display_name || 'U')[0]}
                                </AvatarFallback>
                              </Avatar>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-white/90 truncate">{r.display_name}</p>
                                {r.username && <p className="text-[11px] text-white/35">@{r.username}</p>}
                              </div>
                              <button
                                onClick={(e) => handleDeleteRecipient(r.id, e)}
                                className="p-1.5 rounded-full opacity-0 group-hover:opacity-100 active:opacity-100 hover:bg-red-500/20 transition-all"
                              >
                                <X className="w-3 h-3 text-white/40" />
                              </button>
                            </button>
                          ))}
                        </div>
                        <div className="mt-4 border-t border-white/[0.06] pt-3">
                          <p className="text-[10px] text-white/25 text-center">or search for someone new</p>
                        </div>
                      </div>
                    )}

                    {/* Search Input */}
                    <div className="relative mt-1">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/25" />
                      {isSearching && (
                        <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 animate-spin" />
                      )}
                      <input
                        type="text"
                        placeholder="Search by name or @username…"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl pl-10 pr-10 py-3 text-white/90 placeholder:text-white/25 text-sm outline-none focus:border-yellow-500/40 focus:bg-white/[0.07] transition-all"
                      />
                    </div>
                  </div>

                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="px-3 pb-3 space-y-1">
                      {searchResults.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => { setSelectedRecipient(r); setSearchQuery(''); setSearchResults([]); }}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl hover:bg-white/[0.05] active:bg-white/[0.08] transition-colors text-left"
                        >
                          <Avatar className="w-10 h-10 shrink-0">
                            <AvatarImage src={r.avatar_url || undefined} />
                            <AvatarFallback className="bg-white/10 text-white/60 text-xs font-bold">
                              {(r.display_name || 'U')[0]}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-white/90 truncate">{r.display_name}</p>
                            {r.username && <p className="text-[11px] text-white/35">@{r.username}</p>}
                          </div>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-white/25 shrink-0">{r.role}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                    <div className="px-5 pb-5 text-center">
                      <p className="text-sm text-white/30">No users found for "{searchQuery}"</p>
                    </div>
                  )}
                </div>
              ) : (
                /* ── Selected Recipient ── */
                <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] px-5 py-4 flex items-center gap-4">
                  <Avatar className="w-12 h-12 shrink-0">
                    <AvatarImage src={selectedRecipient.avatar_url || undefined} />
                    <AvatarFallback className="bg-white/10 text-white/60 font-bold">
                      {(selectedRecipient.display_name || 'U')[0]}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 mb-0.5">Sending to</p>
                    <p className="text-base font-bold text-white/90 truncate">{selectedRecipient.display_name}</p>
                    {selectedRecipient.username && (
                      <p className="text-[11px] text-white/35">@{selectedRecipient.username}</p>
                    )}
                  </div>
                  <button
                    onClick={() => { setSelectedRecipient(null); setTipAmount(''); setTipMessage(''); setError(null); }}
                    className="px-4 py-2 rounded-2xl bg-white/[0.06] active:bg-white/[0.1] text-white/50 text-xs font-semibold transition-colors"
                  >
                    Change
                  </button>
                </div>
              )}

              {/* ── Amount ── */}
              {selectedRecipient && (
                <>
                  <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] px-5 py-5 space-y-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">Select Amount</p>

                    <div className="grid grid-cols-3 gap-2">
                      {QUICK_AMOUNTS.map((a) => (
                        <button
                          key={a}
                          onClick={() => setTipAmount(String(a))}
                          disabled={!!wallet && a > spendable}
                          className={`py-3.5 rounded-2xl font-black text-sm transition-all active:scale-[0.96] font-['Inter',sans-serif] ${
                            tipAmount === String(a)
                              ? 'bg-yellow-400 text-black'
                              : 'bg-white/[0.05] text-white/70 border border-white/[0.07] disabled:opacity-20 disabled:cursor-not-allowed'
                          }`}
                        >
                          {a}
                        </button>
                      ))}
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-white/25 mb-2">Custom amount</p>
                      <input
                        type="text"
                        value={tipAmount}
                        onChange={handleTipAmountChange}
                        placeholder="0"
                        className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl px-4 py-3.5 text-white/90 placeholder:text-white/20 text-xl font-black font-['Inter',sans-serif] outline-none focus:border-yellow-500/40 focus:bg-white/[0.07] transition-all tabular-nums"
                      />
                    </div>

                    {tipAmount && wallet && (
                      <div className={`px-4 py-3 rounded-2xl text-xs font-semibold ${
                        parseInt(tipAmount) > spendable
                          ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                          : 'bg-[#00ad74]/10 border border-[#00ad74]/20 text-[#00ad74]'
                      }`}>
                        {parseInt(tipAmount) > spendable
                          ? `Insufficient balance — you have ${spendable.toLocaleString()} treats`
                          : `Remaining after tip: ${calculateRemainingBalance().toLocaleString()} treats`
                        }
                      </div>
                    )}
                  </div>

                  {/* ── Message ── */}
                  <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] px-5 py-5 space-y-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">
                      Message <span className="normal-case tracking-normal font-normal text-white/20">— optional</span>
                    </p>
                    <textarea
                      value={tipMessage}
                      onChange={(e) => setTipMessage(e.target.value)}
                      placeholder="Say something nice…"
                      rows={3}
                      className="w-full bg-white/[0.05] border border-white/[0.08] rounded-2xl px-4 py-3 text-white/90 placeholder:text-white/20 text-sm resize-none outline-none focus:border-yellow-500/40 focus:bg-white/[0.07] transition-all"
                    />
                  </div>

                  {/* ── Error ── */}
                  {error && (
                    <div className="px-4 py-3 rounded-2xl bg-red-500/10 border border-red-500/20">
                      <p className="text-red-400 text-sm font-medium">{error}</p>
                    </div>
                  )}

                  {/* ── Send Button ── */}
                  <button
                    onClick={handleTipClick}
                    disabled={!canSend}
                    className={`w-full py-4 rounded-2xl font-black text-sm font-['Inter',sans-serif] transition-all flex items-center justify-center gap-2 active:scale-[0.98] ${
                      canSend
                        ? 'bg-yellow-400 text-black hover:bg-yellow-300'
                        : 'bg-white/[0.05] text-white/25 cursor-not-allowed border border-white/[0.07]'
                    }`}
                  >
                    {isSubmitting ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</>
                    ) : (
                      <><Send className="w-4 h-4" /> {amt > 0 ? `Send ${fmtShort(amt)} Treats` : 'Send Treats'}</>
                    )}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <CustomConfirmDialog
        isOpen={showConfirmTip}
        title="Send Treat?"
        message={`You are about to send ${tipAmount} treats to ${selectedRecipient?.display_name || recipientName}${tipMessage ? ` with message: "${tipMessage}"` : ''}. This action cannot be undone.`}
        confirmText="Send Treat"
        cancelText="Cancel"
        variant="info"
        onConfirm={handleConfirmTip}
        onCancel={() => setShowConfirmTip(false)}
        isLoading={isSubmitting}
      />
    </div>
  );
};

async function updateListenerStatsForTip(userId: string, recipientId: string, amount: number): Promise<void> {
  try {
    const { data: artist, error: artistError } = await supabase
      .from('artist_profiles')
      .select('id')
      .eq('user_id', recipientId)
      .maybeSingle();

    if (artistError || !artist?.id) return;

    const { error: statsError } = await supabase.rpc('update_listener_stats', {
      p_user_id: userId,
      p_artist_id: artist.id,
      p_plays_increment: 0,
      p_treats_increment: amount
    });

    if (statsError) console.error('Error updating listener stats:', statsError);
  } catch (error) {
    console.error('Error in updateListenerStatsForTip:', error);
  }
}
