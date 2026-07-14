export const PAYMENT_POPUP_MESSAGE_TYPE = 'airaplay-payment-return';

export function isFlutterwavePaymentSuccessUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return (
      parsed.searchParams.get('payment') === 'success' &&
      parsed.searchParams.get('provider') === 'flutterwave'
    );
  } catch {
    return url.includes('payment=success') && url.includes('provider=flutterwave');
  }
}

/** When Flutterwave redirects the checkout popup back to our site, close it immediately. */
export function closePaymentPopupIfReturnUrl(): boolean {
  if (typeof window === 'undefined' || !window.opener) return false;

  const params = new URLSearchParams(window.location.search);
  if (params.get('payment') !== 'success' || params.get('provider') !== 'flutterwave') {
    return false;
  }

  try {
    window.opener.postMessage(
      {
        type: PAYMENT_POPUP_MESSAGE_TYPE,
        status: 'success',
        reference: params.get('reference'),
      },
      window.location.origin,
    );
  } catch {
    /* ignore postMessage failures */
  }

  window.close();
  return true;
}

export function closePaymentPopupWindow(popup: Window | null | undefined): void {
  try {
    if (popup && !popup.closed) {
      popup.close();
    }
  } catch {
    /* ignore cross-origin close failures */
  }
}
