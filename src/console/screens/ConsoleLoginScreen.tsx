import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Building2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getMyOrganizations } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { LoadingLogo } from '../../components/LoadingLogo';

export function ConsoleLoginScreen(): JSX.Element {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkExistingAuth();
  }, []);

  const checkExistingAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await routeAfterLogin();
        return;
      }
    } catch {
      // continue to login form
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const routeAfterLogin = async () => {
    if (redirect && (redirect.startsWith('/console') || redirect.startsWith('/login') || redirect === almcRoutes.home)) {
      navigate(redirect, { replace: true });
      return;
    }
    const organizations = await getMyOrganizations();
    if (organizations.length === 0) {
      navigate(almcRoutes.onboarding, { replace: true });
    } else {
      navigate(almcRoutes.home, { replace: true });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
      await routeAfterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <LoadingLogo />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b] p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#FF3366]/15">
            <Building2 className="h-7 w-7 text-[#FF3366]" />
          </div>
          <h1 className="text-2xl font-bold text-white">Airaplay Console</h1>
          <p className="mt-2 text-sm text-white/50">Label & Management Console for organizations</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-[#141416] p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-sm text-red-300">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-sm font-medium text-white/70">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] py-2.5 pl-10 pr-4 text-sm text-white focus:border-[#FF3366]/50 focus:outline-none"
                placeholder="you@label.com"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-white/70">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-[#0f0f11] py-2.5 pl-10 pr-10 text-sm text-white focus:border-[#FF3366]/50 focus:outline-none"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-[#FF3366] py-3 text-sm font-semibold text-white hover:bg-[#FF3366]/90 disabled:opacity-50"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in to Console'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-white/40">
          Use your Airaplay account.{' '}
          <a href="/" className="text-[#FF3366] hover:underline">
            Back to Airaplay
          </a>
        </p>
      </div>
    </div>
  );
}
