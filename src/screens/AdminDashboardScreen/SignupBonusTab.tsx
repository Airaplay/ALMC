import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Gift, RefreshCw, Users } from 'lucide-react';
import { Card } from '../../components/ui/card';
import { LoadingLogo } from '../../components/LoadingLogo';
import { supabase } from '../../lib/supabase';

function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatSignupBonusDbError(message: string): string {
  const lower = message.toLowerCase();
  if (
    lower.includes('permission') ||
    lower.includes('policy') ||
    lower.includes('42501') ||
    lower.includes('row-level security')
  ) {
    return 'Only admin or account roles can view or change sign-up bonus settings.';
  }
  return message;
}

const DEFAULT_SIGNUP_BONUS_FORM = {
  is_enabled: false,
  bonus_amount_treats: 50,
  min_signup_date_local: '',
  end_at_local: '',
  max_total_users: '',
  require_email_verified: false,
};

type SignupBonusClaimRow = {
  user_id: string;
  treats_awarded: number;
  claimed_at: string;
  campaign_signature: string;
};

type SignupBonusSettingsRow = {
  is_enabled: boolean;
  bonus_amount_treats: number;
  min_signup_date: string;
  end_at: string | null;
  max_total_users: number | null;
  require_email_verified: boolean;
  total_users_awarded: number;
  total_treats_awarded: number;
};

export const SignupBonusTab = () => {
  const [form, setForm] = useState(DEFAULT_SIGNUP_BONUS_FORM);
  const [totals, setTotals] = useState({ users: 0, treats: 0 });
  const [claims, setClaims] = useState<SignupBonusClaimRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fallbackMinSignupIso, setFallbackMinSignupIso] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      setInfo(null);

      const { data: settingsData, error: settingsError } = await supabase
        .from('signup_bonus_settings')
        .select('*')
        .eq('singleton_key', true)
        .maybeSingle();

      if (settingsError) {
        throw new Error(formatSignupBonusDbError(settingsError.message));
      }

      const { data: claimsData, error: claimsError } = await supabase
        .from('signup_bonus_claims')
        .select('user_id, treats_awarded, claimed_at, campaign_signature')
        .order('claimed_at', { ascending: false })
        .limit(50);

      if (claimsError) {
        console.warn('SignupBonusTab claims:', claimsError);
        setClaims([]);
      } else {
        setClaims((claimsData as SignupBonusClaimRow[]) || []);
      }

      if (!settingsData) {
        const defaultMinSignupIso = new Date().toISOString();
        setFallbackMinSignupIso(defaultMinSignupIso);
        setForm({
          ...DEFAULT_SIGNUP_BONUS_FORM,
          min_signup_date_local: toDatetimeLocalValue(defaultMinSignupIso),
        });
        setTotals({ users: 0, treats: 0 });
        setInfo('No sign-up bonus settings exist yet. Configure below and save to create the campaign.');
        return;
      }

      const row = settingsData as SignupBonusSettingsRow;
      setFallbackMinSignupIso(row.min_signup_date);
      setForm({
        is_enabled: row.is_enabled,
        bonus_amount_treats: row.bonus_amount_treats,
        min_signup_date_local: toDatetimeLocalValue(row.min_signup_date),
        end_at_local: toDatetimeLocalValue(row.end_at),
        max_total_users: row.max_total_users != null ? String(row.max_total_users) : '',
        require_email_verified: row.require_email_verified,
      });
      setTotals({
        users: row.total_users_awarded,
        treats: Number(row.total_treats_awarded) || 0,
      });
    } catch (e) {
      console.error('SignupBonusTab load:', e);
      setError(
        e instanceof Error
          ? formatSignupBonusDbError(e.message)
          : 'Failed to load sign-up bonus settings'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (form.bonus_amount_treats < 1 || form.bonus_amount_treats > 1_000_000) {
      setError('Bonus amount must be between 1 and 1,000,000 treats.');
      return;
    }

    let maxUsers: number | null = null;
    if (form.max_total_users.trim() !== '') {
      const n = parseInt(form.max_total_users, 10);
      if (Number.isNaN(n) || n < 1) {
        setError('Max total users must be a positive integer, or leave blank for no cap.');
        return;
      }
      maxUsers = n;
    }

    const minIso =
      fromDatetimeLocalValue(form.min_signup_date_local) ?? fallbackMinSignupIso ?? new Date().toISOString();

    let endAtIso: string | null = null;
    if (form.end_at_local.trim() !== '') {
      endAtIso = fromDatetimeLocalValue(form.end_at_local);
      if (!endAtIso) {
        setError('Campaign end date is invalid.');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const { data: { session }, error: authError } = await supabase.auth.getSession();
      const user = session?.user;
      if (authError || !user) {
        throw new Error('Authentication required');
      }

      const { error: upsertError } = await supabase
        .from('signup_bonus_settings')
        .upsert(
          {
            singleton_key: true,
            is_enabled: form.is_enabled,
            bonus_amount_treats: form.bonus_amount_treats,
            min_signup_date: minIso,
            end_at: endAtIso,
            max_total_users: maxUsers,
            require_email_verified: form.require_email_verified,
            updated_by: user.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'singleton_key' }
        );

      if (upsertError) {
        throw new Error(formatSignupBonusDbError(upsertError.message));
      }

      setSuccess('Sign-up bonus settings saved.');
      setInfo(null);
      setTimeout(() => setSuccess(null), 4000);
      await load();
    } catch (e) {
      console.error('SignupBonusTab save:', e);
      setError(
        e instanceof Error ? formatSignupBonusDbError(e.message) : 'Failed to save settings'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-center py-12">
          <LoadingLogo variant="pulse" size={32} />
          <p className="ml-4 text-gray-700">Loading sign-up bonus settings...</p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-gray-900">Sign-up bonus</h3>
            <p className="text-sm text-gray-600 max-w-2xl mt-1">
              Control the one-time treat grant for new accounts (<code className="text-xs bg-gray-100 px-1 rounded">claim_signup_bonus</code>
              ). Totals update as users claim.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
          title="Refresh"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      {info && !error && !success && (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
          {info}
        </div>
      )}

      {(success || error) && (
        <div
          className={`p-4 rounded-lg ${
            error ? 'bg-red-100 border border-red-200 text-red-700' : 'bg-green-100 border border-green-200 text-green-700'
          }`}
        >
          {error || success}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-1">
            <Users className="w-5 h-5 text-blue-600" />
            <h4 className="text-gray-700 font-medium">Users awarded</h4>
          </div>
          <p className="text-2xl font-bold text-gray-900">{totals.users.toLocaleString()}</p>
        </Card>
        <Card className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center gap-3 mb-1">
            <Gift className="w-5 h-5 text-green-600" />
            <h4 className="text-gray-700 font-medium">Treats granted (cumulative)</h4>
          </div>
          <p className="text-2xl font-bold text-gray-900">{totals.treats.toLocaleString()}</p>
        </Card>
      </div>

      <Card className="bg-white rounded-lg shadow">
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Enable sign-up bonus</h4>
                <p className="text-gray-600 text-sm">When off, new users will not receive the automatic grant.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_enabled}
                  onChange={(ev) => setForm((p) => ({ ...p, is_enabled: ev.target.checked }))}
                  className="sr-only"
                />
                <div
                  className={`w-11 h-6 rounded-full transition-colors duration-200 ${
                    form.is_enabled ? 'bg-[#309605]' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${
                      form.is_enabled ? 'translate-x-5' : 'translate-x-0'
                    } mt-0.5 ml-0.5`}
                  />
                </div>
              </label>
            </div>

            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <h4 className="font-medium text-gray-900 mb-1">Require verified email</h4>
                <p className="text-gray-600 text-sm">If enabled, only users with a confirmed email can claim (per server rules).</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.require_email_verified}
                  onChange={(ev) => setForm((p) => ({ ...p, require_email_verified: ev.target.checked }))}
                  className="sr-only"
                />
                <div
                  className={`w-11 h-6 rounded-full transition-colors duration-200 ${
                    form.require_email_verified ? 'bg-[#309605]' : 'bg-gray-300'
                  }`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full shadow transform transition-transform duration-200 ${
                      form.require_email_verified ? 'translate-x-5' : 'translate-x-0'
                    } mt-0.5 ml-0.5`}
                  />
                </div>
              </label>
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">Bonus amount (treats)</label>
              <input
                type="number"
                min={1}
                max={1_000_000}
                value={form.bonus_amount_treats}
                onChange={(ev) =>
                  setForm((p) => ({ ...p, bonus_amount_treats: parseInt(ev.target.value, 10) || 0 }))
                }
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-[#309605]"
              />
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">Eligible sign-ups after (local time)</label>
              <input
                type="datetime-local"
                value={form.min_signup_date_local}
                onChange={(ev) => setForm((p) => ({ ...p, min_signup_date_local: ev.target.value }))}
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-[#309605]"
              />
              <p className="mt-1 text-xs text-gray-500">Accounts created before this time are not eligible.</p>
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">Campaign end (optional)</label>
              <input
                type="datetime-local"
                value={form.end_at_local}
                onChange={(ev) => setForm((p) => ({ ...p, end_at_local: ev.target.value }))}
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-[#309605]"
              />
              <p className="mt-1 text-xs text-gray-500">Clear the field to run with no end date.</p>
            </div>

            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">Max claiming users (optional)</label>
              <input
                type="number"
                min={1}
                placeholder="No cap"
                value={form.max_total_users}
                onChange={(ev) => setForm((p) => ({ ...p, max_total_users: ev.target.value }))}
                className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] focus:border-[#309605]"
              />
              <p className="mt-1 text-xs text-gray-500">Leave empty for unlimited claims (subject to other rules).</p>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full sm:w-auto px-6 py-3 rounded-lg font-semibold text-white bg-[#309605] hover:bg-[#287704] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Saving…' : 'Save settings'}
            </button>
          </form>
        </div>
      </Card>

      <Card className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h4 className="font-semibold text-gray-900">Recent claims (last 50)</h4>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-600">
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Treats</th>
                <th className="px-4 py-3 font-medium">Campaign</th>
                <th className="px-4 py-3 font-medium">Claimed at</th>
              </tr>
            </thead>
            <tbody>
              {claims.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-500">
                    No claims yet.
                  </td>
                </tr>
              ) : (
                claims.map((c) => (
                  <tr key={c.user_id} className="border-t border-gray-100">
                    <td className="px-4 py-3 font-mono text-xs text-gray-800">{c.user_id}</td>
                    <td className="px-4 py-3 text-gray-900">{c.treats_awarded}</td>
                    <td className="px-4 py-3 text-gray-700 max-w-[200px] truncate" title={c.campaign_signature}>
                      {c.campaign_signature}
                    </td>
                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                      {new Date(c.claimed_at).toLocaleString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
