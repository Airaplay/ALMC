import { Capacitor } from '@capacitor/core';

/** Fields needed by `verify-google-play-purchase` after a consumable purchase. */
export interface GooglePlayPurchaseResult {
  purchaseToken: string;
  productId: string;
  orderId: string;
}

interface NativePurchaseTransaction {
  purchaseToken?: string;
  transactionId?: string;
  productIdentifier?: string;
  orderId?: string;
}

function normalizeGooglePlayPurchase(
  transaction: NativePurchaseTransaction,
  fallbackSku: string
): GooglePlayPurchaseResult | null {
  const purchaseToken = transaction.purchaseToken?.trim() || transaction.transactionId?.trim();
  const productId = transaction.productIdentifier?.trim() || fallbackSku;
  const orderId = transaction.orderId?.trim() || transaction.transactionId?.trim();

  if (!purchaseToken || !productId || !orderId) {
    return null;
  }

  return {
    purchaseToken,
    productId,
    orderId,
  };
}

/**
 * Purchase a consumable SKU via Google Play Billing (Android app only).
 * Web bundles include this module; treat checkout hides Google Play on web.
 */
export async function purchaseGooglePlayConsumable(sku: string): Promise<GooglePlayPurchaseResult> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    throw new Error('Google Play Billing is only available in the Android app.');
  }

  const module = await import('@capgo/native-purchases');
  const { NativePurchases, PURCHASE_TYPE } = module;

  const transaction = (await NativePurchases.purchaseProduct({
    productIdentifier: sku,
    productType: PURCHASE_TYPE.INAPP,
    quantity: 1,
    isConsumable: true,
    autoAcknowledgePurchases: true,
  })) as NativePurchaseTransaction;

  const purchase = normalizeGooglePlayPurchase(transaction, sku);

  if (!purchase) {
    throw new Error(
      `Google Play purchase succeeded but required verification fields are missing for "${sku}".`
    );
  }

  return purchase;
}

/** Return owned consumable purchases for this SKU (Android app only). */
export async function getOwnedGooglePlayConsumables(sku: string): Promise<GooglePlayPurchaseResult[]> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return [];
  }

  const module = await import('@capgo/native-purchases');
  const { NativePurchases, PURCHASE_TYPE } = module;

  const { purchases } = await NativePurchases.getPurchases({
    productType: PURCHASE_TYPE.INAPP,
  });

  return (purchases as NativePurchaseTransaction[])
    .map((purchase) => normalizeGooglePlayPurchase(purchase, sku))
    .filter((purchase): purchase is GooglePlayPurchaseResult => purchase?.productId === sku);
}

/** First owned consumable for SKU, if any (used to recover unconsumed purchases). */
export async function getOwnedGooglePlayConsumable(sku: string): Promise<GooglePlayPurchaseResult | null> {
  const owned = await getOwnedGooglePlayConsumables(sku);
  return owned[0] ?? null;
}

/** Consume a verified Google Play in-app purchase so the SKU can be bought again. */
export async function consumeGooglePlayPurchase(purchaseToken: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return;
  }

  const trimmedToken = purchaseToken.trim();
  if (!trimmedToken) {
    throw new Error('Google Play purchase token is missing.');
  }

  const module = await import('@capgo/native-purchases');
  const { NativePurchases } = module;

  await NativePurchases.consumePurchase({
    purchaseToken: trimmedToken,
  });
}
