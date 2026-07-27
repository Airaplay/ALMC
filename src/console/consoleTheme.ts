/**
 * ALMC design tokens — soft minimalist SaaS (lime accent + charcoal/black anchors).
 * Visual language inspired by Bond-style dashboards: extreme rounding, white cards
 * on an off-white canvas, black active states, lime CTAs.
 */
export const AIRAPLAY_GREEN = '#33AA2D';
export const AIRAPLAY_GREEN_LIGHT = '#4bc044';
export const ALMC_LIME = '#33AA2D';
export const ALMC_INK = '#000000';
export const ALMC_LIME_DEEP = '#33AA2D';

export const consoleTheme = {
  page: "min-h-screen bg-background text-foreground font-['Inter',system-ui,sans-serif]",
  card: 'almc-card rounded-[1.25rem] border border-border/80 bg-card text-card-foreground',
  cardPad: 'almc-card rounded-[1.25rem] border border-border/80 bg-card p-5 text-card-foreground',
  cardInner: 'rounded-2xl border border-border/60 bg-secondary/70',
  cardAccent: 'almc-card-accent rounded-[1.25rem]',
  muted: 'text-muted-foreground',
  label: 'almc-label',
  display: 'text-2xl font-bold tracking-tight text-foreground tabular-nums sm:text-3xl',
  link: 'font-semibold text-[var(--almc-lime-deep)] transition-colors hover:opacity-90',
  btnPrimary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-[13px] font-semibold tracking-wide text-primary-foreground transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40',
  btnLime:
    'inline-flex h-11 items-center justify-center gap-2 rounded-full bg-[var(--almc-lime)] px-5 text-[13px] font-semibold tracking-wide text-white transition-all hover:brightness-95 active:scale-[0.98] disabled:opacity-40',
  btnSecondary:
    'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-border/80 bg-card px-5 text-[13px] font-semibold text-secondary-foreground transition-colors hover:bg-muted',
  btnGhost:
    'inline-flex items-center justify-center gap-2 rounded-full px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
  input:
    'rounded-2xl border border-border/80 bg-card px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-foreground/20 focus:outline-none focus:ring-2 focus:ring-foreground/10',
  select:
    'rounded-full border border-border/80 bg-card px-3.5 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-foreground/10',
  activeNav: 'bg-primary font-medium text-primary-foreground',
  inactiveNav:
    'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  iconAccent: 'text-[var(--almc-lime-deep)]',
  iconWell: 'rounded-2xl bg-muted p-2 text-[var(--almc-lime-deep)]',
  banner: 'rounded-2xl border border-[var(--almc-lime)]/50 bg-[var(--almc-lime)]/30',
  tag: 'almc-pill border border-transparent',
  positive: 'text-[var(--almc-lime-deep)]',
  chartStroke: ALMC_LIME_DEEP,
  chartFill: ALMC_LIME,
  chartInk: ALMC_INK,
} as const;
