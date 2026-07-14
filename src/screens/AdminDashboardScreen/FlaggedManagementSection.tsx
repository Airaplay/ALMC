import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, RefreshCw, ShieldOff, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Card, CardContent } from '../../components/ui/card';
import { LoadingLogo } from '../../components/LoadingLogo';

type FlaggedTab = 'accounts' | 'referrals' | 'plays';

type ReviewStatus = 'pending' | 'cleared' | 'confirmed';

interface FlaggedAccountRow {
  user_id: string;
  is_flagged: boolean;
  reason: string | null;
  flagged_at: string | null;
  updated_at: string;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  review_notes: string | null;
  user: { display_name: string | null; email: string | null } | null;
}

interface FlaggedReferralRow {
  id: string;
  referrer_id: string;
  referred_id: string;
  referral_code: string | null;
  status: string;
  reward_amount: number;
  created_at: string;
  flagged_for_abuse: boolean;
  abuse_reason: string | null;
  abuse_flagged_at: string | null;
  abuse_review_status: ReviewStatus;
  abuse_reviewed_at: string | null;
  abuse_review_notes: string | null;
  referrer: { display_name: string | null; email: string | null } | null;
  referred: { display_name: string | null; email: string | null } | null;
}

interface FlaggedPlayEventRow {
  id: number;
  user_id: string;
  content_id: string;
  content_type: string;
  reason: string | null;
  ip_address: string | null;
  user_agent: string | null;
  detected_at: string;
  review_status: ReviewStatus;
  reviewed_at: string | null;
  review_notes: string | null;
  user: { display_name: string | null; email: string | null } | null;
}

const formatName = (u: { display_name: string | null; email: string | null } | null): string => {
  if (!u) return 'Unknown';
  return u.display_name || u.email || 'Unknown';
};

const badgeForStatus = (s: ReviewStatus) => {
  if (s === 'cleared') return 'bg-gray-100 text-gray-700';
  if (s === 'confirmed') return 'bg-red-100 text-red-700';
  return 'bg-yellow-100 text-yellow-700';
};

export const FlaggedManagementSection = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<FlaggedTab>('accounts');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [flaggedAccounts, setFlaggedAccounts] = useState<FlaggedAccountRow[]>([]);
  const [flaggedReferrals, setFlaggedReferrals] = useState<FlaggedReferralRow[]>([]);
  const [flaggedPlays, setFlaggedPlays] = useState<FlaggedPlayEventRow[]>([]);

  const [actionNotes, setActionNotes] = useState('');

  const load = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [accountsRes, referralsRes, playsRes] = await Promise.all([
        supabase
          .from('user_bot_flags')
          .select(`
            user_id,
            is_flagged,
            reason,
            flagged_at,
            updated_at,
            review_status,
            reviewed_at,
            review_notes,
            user:users!user_bot_flags_public_user_id_fkey(display_name, email)
          `)
          .eq('is_flagged', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('referrals')
          .select(`
            id,
            referrer_id,
            referred_id,
            referral_code,
            status,
            reward_amount,
            created_at,
            flagged_for_abuse,
            abuse_reason,
            abuse_flagged_at,
            abuse_review_status,
            abuse_reviewed_at,
            abuse_review_notes,
            referrer:users!referrals_referrer_id_fkey(display_name, email),
            referred:users!referrals_referred_id_fkey(display_name, email)
          `)
          .eq('flagged_for_abuse', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('flagged_play_events')
          .select(`
            id,
            user_id,
            content_id,
            content_type,
            reason,
            ip_address,
            user_agent,
            detected_at,
            review_status,
            reviewed_at,
            review_notes,
            user:users!flagged_play_events_public_user_id_fkey(display_name, email)
          `)
          .eq('review_status', 'pending')
          .order('detected_at', { ascending: false })
          .limit(200),
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (referralsRes.error) throw referralsRes.error;
      if (playsRes.error) throw playsRes.error;

      setFlaggedAccounts((accountsRes.data || []) as any);
      setFlaggedReferrals((referralsRes.data || []) as any);
      setFlaggedPlays((playsRes.data || []) as any);
    } catch (e: any) {
      console.error('Error loading flagged items:', e);
      setError(e?.message || 'Failed to load flagged items');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const accountsCounts = useMemo(() => {
    const pending = flaggedAccounts.filter(a => a.review_status === 'pending').length;
    const confirmed = flaggedAccounts.filter(a => a.review_status === 'confirmed').length;
    return { total: flaggedAccounts.length, pending, confirmed };
  }, [flaggedAccounts]);

  const referralCounts = useMemo(() => {
    const pending = flaggedReferrals.filter(r => r.abuse_review_status === 'pending').length;
    const confirmed = flaggedReferrals.filter(r => r.abuse_review_status === 'confirmed').length;
    return { total: flaggedReferrals.length, pending, confirmed };
  }, [flaggedReferrals]);

  const playCounts = useMemo(() => {
    const pending = flaggedPlays.filter(p => p.review_status === 'pending').length;
    const confirmed = flaggedPlays.filter(p => p.review_status === 'confirmed').length;
    return { total: flaggedPlays.length, pending, confirmed };
  }, [flaggedPlays]);

  const clearBotFlag = async (userId: string) => {
    try {
      const { error: rpcError } = await supabase.rpc('admin_clear_user_bot_flag', {
        p_user_id: userId,
        p_notes: actionNotes || null,
      });
      if (rpcError) throw rpcError;
      setActionNotes('');
      await load();
    } catch (e: any) {
      console.error('Error clearing bot flag:', e);
      alert(e?.message || 'Failed to clear flag');
    }
  };

  const reviewReferralFlag = async (referralId: string, clearFlag: boolean) => {
    try {
      const { error: rpcError } = await supabase.rpc('admin_review_referral_abuse_flag', {
        p_referral_id: referralId,
        p_clear_flag: clearFlag,
        p_notes: actionNotes || null,
      });
      if (rpcError) throw rpcError;
      setActionNotes('');
      await load();
    } catch (e: any) {
      console.error('Error reviewing referral abuse flag:', e);
      alert(e?.message || 'Failed to update referral flag');
    }
  };

  const reviewPlayEvent = async (eventId: number, clear: boolean) => {
    try {
      const { error: rpcError } = await supabase.rpc('admin_review_flagged_play_event', {
        p_event_id: eventId,
        p_clear: clear,
        p_notes: actionNotes || null,
      });
      if (rpcError) throw rpcError;
      setActionNotes('');
      await load();
    } catch (e: any) {
      console.error('Error reviewing play event:', e);
      alert(e?.message || 'Failed to update play event');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingLogo variant="pulse" size={32} />
        <p className="ml-4 text-gray-700">Loading flagged items...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Flagged</h2>
            <p className="text-sm text-gray-400 mt-0.5">Review flagged accounts and referral abuse</p>
          </div>
        </div>

        <button
          onClick={load}
          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-100 border border-red-200 rounded-lg">
          <p className="text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm font-medium">Flagged Accounts</h3>
              <span className="text-xs text-gray-500">{accountsCounts.pending} pending</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{accountsCounts.total}</p>
            <p className="text-xs text-gray-500 mt-1">Confirmed: {accountsCounts.confirmed}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm font-medium">Flagged Referrals</h3>
              <span className="text-xs text-gray-500">{referralCounts.pending} pending</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{referralCounts.total}</p>
            <p className="text-xs text-gray-500 mt-1">Confirmed: {referralCounts.confirmed}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-gray-600 text-sm font-medium">Flagged Plays</h3>
              <span className="text-xs text-gray-500">{playCounts.pending} pending</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{playCounts.total}</p>
            <p className="text-xs text-gray-500 mt-1">Confirmed: {playCounts.confirmed}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setActiveTab('accounts')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'accounts'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Accounts
        </button>
        <button
          onClick={() => setActiveTab('referrals')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'referrals'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Referrals
        </button>
        <button
          onClick={() => setActiveTab('plays')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'plays'
              ? 'bg-[#309605] text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          Content / Plays
        </button>

        <div className="flex-1" />

        <input
          value={actionNotes}
          onChange={(e) => setActionNotes(e.target.value)}
          placeholder="Optional notes for review actions…"
          className="w-full max-w-[420px] px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
        />
      </div>

      {activeTab === 'accounts' ? (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Flagged Accounts</h3>

            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">User</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Reason</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Flagged</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Review</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedAccounts.map((a) => (
                    <tr key={a.user_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        <div className="font-medium">{formatName(a.user)}</div>
                        <div className="text-xs text-gray-500 font-mono">{a.user_id.slice(0, 8)}…</div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-700">{a.reason || '—'}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {a.flagged_at ? new Date(a.flagged_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeForStatus(a.review_status)}`}>
                          {a.review_status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => clearBotFlag(a.user_id)}
                            className="px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors text-sm font-medium flex items-center gap-2"
                            title="Clear flag (unfreeze earning gate)"
                          >
                            <ShieldOff className="w-4 h-4" />
                            Clear
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {flaggedAccounts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">
                        No flagged accounts.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : activeTab === 'referrals' ? (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Flagged Referrals</h3>

            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referrer</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Referred</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Reason</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Review</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedReferrals.map((r) => (
                    <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        <div className="font-medium">{formatName(r.referrer)}</div>
                        <div className="text-xs text-gray-500 font-mono">{r.referrer_id.slice(0, 8)}…</div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-900">
                        <div className="font-medium">{formatName(r.referred)}</div>
                        <div className="text-xs text-gray-500 font-mono">{r.referred_id.slice(0, 8)}…</div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-700">{r.abuse_reason || '—'}</td>
                      <td className="py-3 px-4">
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${badgeForStatus(r.abuse_review_status)}`}>
                          {r.abuse_review_status}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => reviewReferralFlag(r.id, false)}
                            className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium flex items-center gap-2"
                            title="Confirm abuse flag"
                          >
                            <XCircle className="w-4 h-4" />
                            Confirm
                          </button>
                          <button
                            onClick={() => reviewReferralFlag(r.id, true)}
                            className="px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors text-sm font-medium flex items-center gap-2"
                            title="Clear abuse flag"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Clear
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {flaggedReferrals.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">
                        No flagged referrals.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Flagged Content / Plays</h3>

            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">User</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Content</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Reason</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Detected</th>
                    <th className="text-left py-3 px-4 text-sm font-medium text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {flaggedPlays.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4 text-sm text-gray-900">
                        <div className="font-medium">{formatName(p.user)}</div>
                        <div className="text-xs text-gray-500 font-mono">{p.user_id.slice(0, 8)}…</div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-700">
                        <div className="font-mono text-xs">{p.content_type}:{p.content_id.slice(0, 8)}…</div>
                        <div className="text-xs text-gray-400">{p.ip_address || '—'}</div>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-700">{p.reason || '—'}</td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {p.detected_at ? new Date(p.detected_at).toLocaleString() : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => reviewPlayEvent(p.id, false)}
                            className="px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm font-medium flex items-center gap-2"
                            title="Confirm flagged play"
                          >
                            <XCircle className="w-4 h-4" />
                            Confirm
                          </button>
                          <button
                            onClick={() => reviewPlayEvent(p.id, true)}
                            className="px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors text-sm font-medium flex items-center gap-2"
                            title="Clear flagged play"
                          >
                            <CheckCircle className="w-4 h-4" />
                            Clear
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {flaggedPlays.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-gray-500">
                        No flagged plays.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

