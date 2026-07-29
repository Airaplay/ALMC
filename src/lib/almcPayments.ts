/**
 * True when checkout runs inside ALMC (standalone app or /console embed).
 * Consumer Airaplay web/mobile keeps all admin-enabled payment channels.
 */
export function isAlmcConsoleApp(): boolean {
  const routeBase = import.meta.env.VITE_ALMC_ROUTE_BASE;
  if (typeof routeBase === 'string') {
    return true;
  }
  if (typeof window !== 'undefined') {
    return window.location.pathname.startsWith('/console');
  }
  return false;
}

export function filterTreatPaymentChannelsForAlmc<T extends { channel_type: string }>(
  channels: T[]
): T[] {
  if (!isAlmcConsoleApp()) {
    return channels;
  }
  return channels.filter((c) => c.channel_type === 'flutterwave');
}
