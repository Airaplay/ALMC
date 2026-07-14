import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Music2, Users, Package, Film } from 'lucide-react';
import { createOrganization, getMyOrganizations, OrgType, setStoredOrgId } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

const ORG_TYPES: Array<{ id: OrgType; label: string; description: string; icon: typeof Music2 }> = [
  { id: 'label', label: 'Record Label', description: 'Manage signed artists and releases', icon: Music2 },
  { id: 'management', label: 'Management Company', description: 'Represent and grow artist careers', icon: Users },
  { id: 'distributor', label: 'Distributor', description: 'Distribute catalog at scale', icon: Package },
  { id: 'entertainment', label: 'Entertainment Company', description: 'Media and entertainment roster', icon: Film },
];

export function ConsoleOnboardingScreen(): JSX.Element {
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    country: '',
    website: '',
    businessRegistrationNumber: '',
    description: '',
  });

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        navigate(almcRoutes.login, { replace: true });
        return;
      }
      const orgs = await getMyOrganizations();
      if (orgs.length > 0) {
        navigate(almcRoutes.home, { replace: true });
        return;
      }
      setAuthChecked(true);
    });
  }, [navigate]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <LoadingLogo />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgType) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate(almcRoutes.login, { replace: true });
        return;
      }

      const result = await createOrganization({
        type: orgType,
        name: form.name,
        email: form.email || user.email || '',
        country: form.country,
        phone: form.phone || undefined,
        website: form.website || undefined,
        business_registration_number: form.businessRegistrationNumber || undefined,
        description: form.description || undefined,
      });

      setStoredOrgId(result.organization_id);
      navigate(almcRoutes.home, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF3366]/15">
            <Building2 className="h-7 w-7 text-[#FF3366]" />
          </div>
          <h1 className="text-2xl font-bold text-white">Set up your organization</h1>
          <p className="mt-2 text-sm text-white/50">Step {step} of 2</p>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {step === 1 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {ORG_TYPES.map(({ id, label, description, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setOrgType(id);
                  setStep(2);
                }}
                className={`rounded-2xl border p-5 text-left transition hover:border-[#FF3366]/40 ${
                  orgType === id ? 'border-[#FF3366] bg-[#FF3366]/10' : 'border-white/10 bg-[#141416]'
                }`}
              >
                <Icon className="mb-3 h-6 w-6 text-[#FF3366]" />
                <p className="font-semibold text-white">{label}</p>
                <p className="mt-1 text-sm text-white/50">{description}</p>
              </button>
            ))}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-[#141416] p-6">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="text-sm text-white/50 hover:text-white"
            >
              ← Change organization type
            </button>

            <div>
              <label className="mb-1.5 block text-sm text-white/70">Company name *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:border-[#FF3366]/50 focus:outline-none"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-sm text-white/70">Company email *</label>
                <input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-white/70">Phone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-white/70">Country *</label>
              <input
                required
                value={form.country}
                onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none"
                placeholder="Nigeria"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-white/70">Website</label>
              <input
                type="url"
                value={form.website}
                onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none"
                placeholder="https://"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-white/70">Business registration number</label>
              <input
                value={form.businessRegistrationNumber}
                onChange={(e) => setForm((f) => ({ ...f, businessRegistrationNumber: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-sm text-white/70">Company description</label>
              <textarea
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] px-4 py-2.5 text-sm text-white focus:outline-none resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-[#FF3366] py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {isSubmitting ? 'Creating workspace…' : 'Create organization'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
