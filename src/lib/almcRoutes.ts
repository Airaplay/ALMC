/** Route base: empty string for standalone ALMC app; `/console` when embedded in Airaplay-DB-V2. */
const BASE = (import.meta.env.VITE_ALMC_ROUTE_BASE as string | undefined) ?? '/console';

function almcPath(segment?: string): string {
  if (!segment) {
    return BASE || '/';
  }
  const joined = `${BASE}/${segment}`.replace(/\/+/g, '/');
  return joined.startsWith('/') ? joined : `/${joined}`;
}

function consumerBase(): string {
  return (import.meta.env.VITE_AIRAPLAY_CONSUMER_URL as string | undefined)?.replace(/\/$/, '') || '';
}

export const almcRoutes = {
  home: almcPath(),
  login: almcPath('login'),
  onboarding: almcPath('onboarding'),
  acceptArtist: almcPath('accept-artist'),
  acceptTeam: almcPath('accept-team'),
  acceptArtistInviteUrl: (token: string) =>
    `${window.location.origin}${almcPath('accept-artist')}?token=${encodeURIComponent(token)}`,
  acceptTeamInviteUrl: (token: string) =>
    `${window.location.origin}${almcPath('accept-team')}?token=${encodeURIComponent(token)}`,
  consumerHome: () => consumerBase() || '/',
  consumerProfile: () => `${consumerBase() || ''}/profile`.replace(/^\/\//, '/'),
  consumerTermsSignup: () => {
    const base = consumerBase();
    return base ? `${base}/terms/user-signup` : '/terms/user-signup';
  },
};
