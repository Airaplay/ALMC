/**
 * ALMC design tokens — aligned with Airaplay-DB-V2 web theme (AuthModal, LeftSidebar).
 * Uses the same Supabase project for auth, organizations, and delegated content RLS.
 */
export const AIRAPLAY_GREEN = '#309605';
export const AIRAPLAY_GREEN_LIGHT = '#3ba208';

export const consoleTheme = {
  page: "min-h-screen bg-background text-foreground font-['Inter',sans-serif]",
  card: 'rounded-2xl border border-border bg-card text-card-foreground',
  cardInner: 'rounded-xl border border-border bg-secondary',
  muted: 'text-muted-foreground',
  link: 'font-semibold text-[#3ba208] transition-colors hover:text-[#3ba208]/90',
  btnPrimary:
    'h-12 rounded-xl bg-[#3ba208] text-[13px] font-bold tracking-wide text-white hover:bg-[#3ba208]/90 active:scale-[0.98] disabled:opacity-40',
  btnSecondary: 'rounded-xl border border-border bg-secondary text-secondary-foreground hover:bg-muted',
  input:
    'rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30',
  activeNav: 'bg-sidebar-accent font-semibold text-sidebar-accent-foreground',
  inactiveNav:
    'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
  iconAccent: 'text-[#3ba208]',
  banner: 'rounded-xl border border-primary/30 bg-primary/10',
} as const;
