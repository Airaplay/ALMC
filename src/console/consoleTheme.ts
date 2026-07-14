/** Airaplay brand greens — match consumer app and AuthModal. */
export const AIRAPLAY_GREEN = '#309605';
export const AIRAPLAY_GREEN_LIGHT = '#3ba208';

export const consoleTheme = {
  btnPrimary:
    'bg-[#309605] hover:bg-[#3ba208] text-white disabled:opacity-50',
  btnPrimaryGradient:
    'bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] text-white disabled:opacity-50',
  link: 'text-[#3ba208] hover:underline',
  textAccent: 'text-[#3ba208]',
  icon: 'text-[#3ba208]',
  iconBadge: 'bg-[#309605]/15',
  activeItem: 'bg-[#309605]/15 text-[#3ba208]',
  selectedBorder: 'border-[#309605] bg-[#309605]/10',
  hoverBorder: 'hover:border-[#309605]/40',
  cardHover: 'hover:border-[#309605]/30',
  inputFocus: 'focus:border-[#309605]/50 focus:outline-none',
  banner: 'border-[#309605]/30 bg-[#309605]/10',
  checkbox: 'text-[#309605] focus:ring-[#309605]/50',
} as const;
