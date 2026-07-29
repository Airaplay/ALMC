export async function consumeGooglePlayPurchase(): Promise<void> {
  throw new Error('Google Play purchases are not available in ALMC web.');
}

export async function getOwnedGooglePlayConsumable(): Promise<null> {
  return null;
}

export async function purchaseGooglePlayConsumable(): Promise<never> {
  throw new Error('Google Play purchases are not available in ALMC web.');
}

export type GooglePlayPurchaseResult = {
  purchaseToken: string;
  productId: string;
};
