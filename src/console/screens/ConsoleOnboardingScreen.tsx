import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Music2, Users, Package, Film, LogOut } from 'lucide-react';
import { createOrganization, getMyOrganizations, OrgType, setStoredOrgId } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { supabase } from '../../lib/supabase';
import { performCompleteLogout } from '../../lib/logoutService';
import { LoadingLogo } from '../../components/LoadingLogo';
import { ConsoleAuthShell } from '../components/ConsoleAuthShell';
import {
  ConsoleErrorAlert,
  ConsolePrimaryButton,
  ConsoleSubmitArrow,
} from '../components/ConsoleFormControls';
import { consoleTheme } from '../consoleTheme';

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
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
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
      setSignedInEmail(session.user.email ?? null);
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
      <div className="flex min-h-screen items-center justify-center bg-background">
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

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError(null);
    try {
      await performCompleteLogout();
      navigate(almcRoutes.login, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign out failed');
      setIsSigningOut(false);
    }
  };

  const signOutButton = (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={isSigningOut}
      title="Sign out"
      aria-label="Sign out"
      className="absolute right-4 top-4 rounded-full p-2.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50 sm:right-6 sm:top-6"
    >
      <LogOut className="h-5 w-5" />
    </button>
  );

  return (
    <ConsoleAuthShell
      maxWidth="2xl"
      title="Set up your organization"
      subtitle={`Step ${step} of 2${signedInEmail ? ` · ${signedInEmail}` : ''}`}
      headerAction={signOutButton}
      footer={
        <p className="mt-6 text-center">
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="inline-flex items-center gap-2 text-[13px] text-white/50 hover:text-white disabled:opacity-50"
          >
            <LogOut className="h-4 w-4" />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </button>
        </p>
      }
    >
      {error ? <ConsoleErrorAlert message={error} /> : null}

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
              className={`rounded-2xl border p-5 text-left transition hover:border-primary/40 ${
                orgType === id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-secondary/50'
              }`}
            >
              <Icon className={`mb-3 h-6 w-6 ${consoleTheme.iconAccent}`} />
              <p className="font-semibold text-foreground">{label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{description}</p>
            </button>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <button
            type="button"
            onClick={() => setStep(1)}
            className="text-[13px] text-muted-foreground hover:text-foreground"
          >
            ← Change organization type
          </button>

          <div>
            <label className="mb-1.5 block text-sm text-secondary-foreground">Company name *</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className={consoleTheme.input + ' w-full'}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-sm text-secondary-foreground">Company email *</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className={consoleTheme.input + ' w-full'}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm text-secondary-foreground">Phone</label>
              <input
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className={consoleTheme.input + ' w-full'}
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-secondary-foreground">Country *</label>
            <input
              required
              value={form.country}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              className={consoleTheme.input + ' w-full'}
              placeholder="Nigeria"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-secondary-foreground">Website</label>
            <input
              type="url"
              value={form.website}
              onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              className={consoleTheme.input + ' w-full'}
              placeholder="https://"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-secondary-foreground">Business registration number</label>
            <input
              value={form.businessRegistrationNumber}
              onChange={(e) => setForm((f) => ({ ...f, businessRegistrationNumber: e.target.value }))}
              className={consoleTheme.input + ' w-full'}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm text-secondary-foreground">Company description</label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className={consoleTheme.input + ' w-full resize-none'}
            />
          </div>

          <ConsolePrimaryButton type="submit" disabled={isSubmitting} loading={isSubmitting}>
            <ConsoleSubmitArrow label={isSubmitting ? 'Creating workspace…' : 'Create organization'} />
          </ConsolePrimaryButton>
        </form>
      )}
    </ConsoleAuthShell>
  );
}
