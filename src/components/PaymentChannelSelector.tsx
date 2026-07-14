import React, { useState, useEffect } from 'react';
import { CreditCard, Wallet, DollarSign, Check, AlertCircle, Smartphone } from 'lucide-react';
import {
  getEnabledTreatPaymentChannels,
  getPlayProductIdForTreatPackage,
  processPayment,
  PaymentChannel,
} from '../lib/paymentChannels';
import { paymentMonitor } from '../lib/paymentMonitor';
import { supabase } from '../lib/supabase';
import {
  consumeGooglePlayPurchase,
  getOwnedGooglePlayConsumable,
  purchaseGooglePlayConsumable,
} from '../lib/playBilling';
import type { GooglePlayPurchaseResult } from '../lib/playBilling';
import { Currency, CurrencyDetectionResult, formatCurrencyAmount } from '../lib/currencyDetection';
import { CurrencySelector } from './CurrencySelector';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

interface PaymentChannelSelectorProps {
  /** Amount shown to the user and charged in their selected currency */
  amount: number;
  /** Canonical package price in USD (stored as amount_usd in the database) */
  amountUsd: number;
  packageId: string;
  userEmail: string;
  currencyData: CurrencyDetectionResult;
  onCurrencyChange: React.Dispatch<Currency>;
  onPaymentSuccess: React.Dispatch<Record<string, unknown>>;
  onPaymentError: React.Dispatch<string>;
  onCancel: () => void;
}

interface PaymentProcessingState {
  paymentId: string | null;
  isMonitoring: boolean;
  isVerifying: boolean;
}

interface GooglePlayVerificationResult {
  success?: boolean;
  payment_id?: string;
  error?: string;
  duplicate?: boolean;
}

const isEdgeFunctionRelayFailure = (message: string | undefined): boolean => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('failed to send a request to the edge function') ||
    normalized.includes('network request failed') ||
    normalized.includes('failed to fetch') ||
    normalized.includes('fetch failed')
  );
};

const isAlreadyConsumedPurchaseError = (message: string | undefined): boolean => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('already consumed') || normalized.includes('not owned') || normalized.includes('item_not_owned');
};

export const PaymentChannelSelector: React.FC<PaymentChannelSelectorProps> = ({
  amount,
  amountUsd,
  packageId,
  userEmail,
  currencyData,
  onCurrencyChange,
  onPaymentSuccess,
  onPaymentError,
  onCancel
}) => {
  const [paymentChannels, setPaymentChannels] = useState<PaymentChannel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<PaymentChannel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingState, setProcessingState] = useState<PaymentProcessingState>({
    paymentId: null,
    isMonitoring: false,
    isVerifying: false
  });

  useEffect(() => {
    loadPaymentChannels();

    return () => {
      if (processingState.paymentId && processingState.isMonitoring) {
        paymentMonitor.unsubscribeAll();
      }
      // Clean up Capacitor Browser listeners
      Browser.removeAllListeners();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadPaymentChannels = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const channels = await getEnabledTreatPaymentChannels();
      setPaymentChannels(channels);

      if (channels.length === 1) {
        setSelectedChannel(channels[0]);
      }
    } catch (err) {
      console.error('Error loading payment channels:', err);
      setError('Failed to load payment options');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePayment = async () => {
    if (!selectedChannel) {
      onPaymentError('Please select a payment method');
      return;
    }

    setIsProcessing(true);
    setError(null);

    const isNativePlatform = Capacitor.isNativePlatform();

    if (selectedChannel.channel_type === 'google_play') {
      try {
        const sku = getPlayProductIdForTreatPackage(selectedChannel, packageId);
        if (!sku) {
          const msg =
            'This package is not linked to a Google Play product. Your administrator must map package IDs in the Google Play payment channel.';
          setError(msg);
          onPaymentError(msg);
          return;
        }

        // Best effort: refresh auth before verification; do not block if refresh transiently fails.
        const refreshAuthForVerification = async () => {
          try {
            await supabase.auth.refreshSession();
          } catch (refreshErr) {
            console.warn('[PaymentChannelSelector] Session refresh failed before Google Play verification, continuing:', refreshErr);
          }
        };

        const verifyGooglePlayPurchase = async (purchase: GooglePlayPurchaseResult): Promise<GooglePlayVerificationResult> => {
          await refreshAuthForVerification();

          const payload = {
            payment_channel_id: selectedChannel.id,
            package_id: packageId,
            purchase_token: purchase.purchaseToken,
            product_id: purchase.productId,
            order_id: purchase.orderId,
            amount_usd: amountUsd,
          };

          let data: unknown = null;
          let fnError: { message?: string } | null = null;
          const maxAttempts = 3;

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const response = await supabase.functions.invoke('verify-google-play-purchase', {
              body: payload,
            });
            data = response.data;
            fnError = response.error as { message?: string } | null;

            if (!fnError) break;

            const shouldRetry = isEdgeFunctionRelayFailure(fnError.message) && attempt < maxAttempts;
            if (!shouldRetry) break;

            // Short exponential backoff for transient relay failures.
            const retryDelayMs = 800 * attempt;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }

          if (fnError) {
            throw new Error(fnError.message || (data as { error?: string } | null)?.error || 'Could not verify Google Play purchase');
          }

          const row = data as GooglePlayVerificationResult | null;
          if (!row?.success || !row.payment_id) {
            throw new Error(row?.error || 'Could not verify Google Play purchase');
          }

          return row;
        };

        const finishGooglePlayPurchase = async (purchaseToken: string): Promise<boolean> => {
          try {
            await consumeGooglePlayPurchase(purchaseToken);
            return true;
          } catch (consumeErr) {
            const consumeMessage = consumeErr instanceof Error ? consumeErr.message : 'Could not finish Google Play purchase';
            if (isAlreadyConsumedPurchaseError(consumeMessage)) {
              return true;
            }

            console.warn('[PaymentChannelSelector] Google Play purchase verified but consumption failed:', consumeErr);
            const msg =
              'Payment verified and treats were credited, but Google Play could not finish this purchase. Please try again in a moment before buying this package again.';
            setError(msg);
            onPaymentError(msg);
            return false;
          }
        };

        const ownedPurchase = await getOwnedGooglePlayConsumable(sku);
        if (ownedPurchase) {
          const ownedRow = await verifyGooglePlayPurchase(ownedPurchase);
          const finishedOwnedPurchase = await finishGooglePlayPurchase(ownedPurchase.purchaseToken);
          if (!finishedOwnedPurchase) return;

          onPaymentSuccess({
            payment_method: 'google_play',
            payment_reference: ownedPurchase.orderId,
            payment_id: ownedRow.payment_id,
            status: 'completed',
            amount,
          });
          return;
        }

        const purchase = await purchaseGooglePlayConsumable(sku);
        const row = await verifyGooglePlayPurchase(purchase);
        const finishedPurchase = await finishGooglePlayPurchase(purchase.purchaseToken);
        if (!finishedPurchase) return;

        onPaymentSuccess({
          payment_method: 'google_play',
          payment_reference: purchase.orderId,
          payment_id: row.payment_id,
          status: 'completed',
          amount,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Google Play purchase failed';
        setError(msg);
        onPaymentError(msg);
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    let paymentWindow: Window | null = null;
    const needsPopup = selectedChannel.channel_type === 'flutterwave' || selectedChannel.channel_type === 'paystack';

    // For web platforms only, create popup window
    if (needsPopup && !isNativePlatform) {
      paymentWindow = window.open('', '_blank', 'width=600,height=700,scrollbars=yes,resizable=yes');

      if (!paymentWindow || paymentWindow.closed || typeof paymentWindow.closed === 'undefined') {
        setError('Popup blocked. Please allow popups for this site and try again.');
        onPaymentError('Popup blocked. Please allow popups for this site and try again.');
        setIsProcessing(false);
        return;
      }

      // Safely create payment loader HTML using DOM manipulation instead of document.write
      const loaderHTML = `<!DOCTYPE html>
<html>
  <head>
    <title>Processing Payment...</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: white;
      }
      .loader {
        text-align: center;
      }
      .spinner {
        width: 50px;
        height: 50px;
        border: 4px solid rgba(255, 255, 255, 0.1);
        border-top-color: #309605;
        border-radius: 50%;
        animation: spin 1s linear infinite;
        margin: 0 auto 20px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      p {
        font-size: 16px;
        opacity: 0.8;
      }
    </style>
  </head>
  <body>
    <div class="loader">
      <div class="spinner"></div>
      <p>Preparing your payment...</p>
    </div>
  </body>
</html>`;

      // Use document.open/write/close safely as a fallback for popup windows
      // This is acceptable here since content is static and from our own codebase
      paymentWindow.document.open();
      paymentWindow.document.write(loaderHTML);
      paymentWindow.document.close();
    }

    try {
      const result = await processPayment(
        selectedChannel.id,
        amount,
        amountUsd,
        packageId,
        userEmail,
        currencyData
      );

      console.log('[PaymentChannelSelector] Payment result:', result);

      if (result.success && result.data) {
        const paymentData = result.data;
        const paymentId = paymentData.payment_id;

        setProcessingState({
          paymentId: paymentId,
          isMonitoring: true,
          isVerifying: false,
        });

        const monitorPayment = async () => {
          const unsubscribe = paymentMonitor.subscribe(paymentId, (update) => {
            if (update.status === 'completed') {
              console.log('[PaymentChannelSelector] Payment completed via real-time subscription');
              setProcessingState(prev => ({ ...prev, isVerifying: false }));
              onPaymentSuccess({
                payment_method: selectedChannel.channel_type,
                payment_reference: paymentData.reference,
                payment_id: paymentId,
                status: 'completed',
                amount: update.amount
              });
              unsubscribe();
            } else if (update.status === 'failed') {
              console.log('[PaymentChannelSelector] Payment failed via real-time subscription');
              setProcessingState(prev => ({ ...prev, isVerifying: false }));
              onPaymentError('Payment failed. Please try again.');
              setError('Payment failed. Please try again.');
              unsubscribe();
            }
          });

          setTimeout(async () => {
            // Poll payment status (this will also trigger auto-verification after 30 seconds if still pending)
            const status = await paymentMonitor.pollPaymentStatus(paymentId);
            
            if (status && status.status === 'completed') {
              console.log('[PaymentChannelSelector] Payment completed via polling');
              onPaymentSuccess({
                payment_method: selectedChannel.channel_type,
                payment_reference: paymentData.reference,
                payment_id: paymentId,
                status: 'completed',
                amount: status.amount
              });
              unsubscribe();
            } else if (status && status.status === 'pending') {
              // Payment still pending after 30 seconds - auto-verification should have been triggered
              // Poll again after a short delay to check if verification completed it
              setTimeout(async () => {
                const finalStatus = await paymentMonitor.pollPaymentStatus(paymentId, 15);
                if (finalStatus && finalStatus.status === 'completed') {
                  console.log('[PaymentChannelSelector] Payment completed via delayed polling');
                  onPaymentSuccess({
                    payment_method: selectedChannel.channel_type,
                    payment_reference: paymentData.reference,
                    payment_id: paymentId,
                    status: 'completed',
                    amount: finalStatus.amount
                  });
                }
                unsubscribe();
              }, 10000); // Wait 10 more seconds for verification to complete
              return; // Don't unsubscribe yet, wait for final check
            } else {
              // Payment failed or cancelled
              unsubscribe();
            }
          }, 30000); // Reduced from 60000 to 30000 (30 seconds)
        };

        if (selectedChannel.channel_type === 'paystack' && paymentData.authorization_url) {
          monitorPayment();

          if (isNativePlatform) {
            // Use Capacitor Browser for native platforms
            await Browser.open({ url: paymentData.authorization_url });

            // Listen for browser close event
            Browser.addListener('browserFinished', async () => {
              console.log('[PaymentChannelSelector] Browser closed, checking payment status...');

              // Set verifying state instead of processing
              setProcessingState(prev => ({ ...prev, isVerifying: true }));
              setError(null);

              // Poll payment status immediately
              const status = await paymentMonitor.pollPaymentStatus(paymentId, 10);

              if (status && status.status === 'completed') {
                console.log('[PaymentChannelSelector] Payment completed');
                onPaymentSuccess({
                  payment_method: selectedChannel.channel_type,
                  payment_reference: paymentData.reference,
                  payment_id: paymentId,
                  status: 'completed',
                  amount: status.amount
                });
                setProcessingState(prev => ({ ...prev, isVerifying: false }));
              } else if (status && status.status === 'failed') {
                console.log('[PaymentChannelSelector] Payment failed');
                setProcessingState(prev => ({ ...prev, isVerifying: false }));
                onPaymentError('Payment failed. Please try again.');
                setError('Payment failed. Please try again.');
              } else {
                console.log('[PaymentChannelSelector] Payment pending, monitoring continues...');
                // Keep verifying state active - monitoring will continue in background
              }

              Browser.removeAllListeners();
            });
          } else if (paymentWindow && !paymentWindow.closed) {
            // Use popup window for web platforms
            paymentWindow.location.href = paymentData.authorization_url;
            setError(null);

            let intervalId: number;
            let hasCheckedOnClose = false;

            const checkPaymentInterval = () => {
              intervalId = window.setInterval(async () => {
                if (paymentWindow && paymentWindow.closed && !hasCheckedOnClose) {
                  hasCheckedOnClose = true;
                  clearInterval(intervalId);

                  console.log('[PaymentChannelSelector] Payment window closed, checking payment status...');

                  // Set verifying state instead of processing
                  setProcessingState(prev => ({ ...prev, isVerifying: true }));
                  setError(null);

                  const status = await paymentMonitor.pollPaymentStatus(paymentId, 10);

                  if (status && status.status === 'completed') {
                    console.log('[PaymentChannelSelector] Payment completed after window close');
                    onPaymentSuccess({
                      payment_method: selectedChannel.channel_type,
                      payment_reference: paymentData.reference,
                      payment_id: paymentId,
                      status: 'completed',
                      amount: status.amount
                    });
                    setProcessingState(prev => ({ ...prev, isVerifying: false }));
                  } else if (status && status.status === 'failed') {
                    console.log('[PaymentChannelSelector] Payment failed after window close');
                    setProcessingState(prev => ({ ...prev, isVerifying: false }));
                    onPaymentError('Payment failed. Please try again.');
                    setError('Payment failed. Please try again.');
                  } else {
                    console.log('[PaymentChannelSelector] Payment still pending, monitoring continues...');
                    // Keep verifying state active - monitoring will continue in background
                  }
                }
              }, 500);
            };

            checkPaymentInterval();

            setTimeout(() => {
              if (intervalId) {
                clearInterval(intervalId);
              }
            }, 600000);
          } else {
            setError('Payment window was closed. Please try again.');
            onPaymentError('Payment window was closed. Please try again.');
          }
        } else if (selectedChannel.channel_type === 'flutterwave' && paymentData.payment_link) {
          monitorPayment();

          if (isNativePlatform) {
            // Use Capacitor Browser for native platforms
            await Browser.open({ url: paymentData.payment_link });

            // Listen for browser close event
            Browser.addListener('browserFinished', async () => {
              console.log('[PaymentChannelSelector] Browser closed, checking payment status...');

              // Set verifying state instead of processing
              setProcessingState(prev => ({ ...prev, isVerifying: true }));
              setError(null);

              // Poll payment status immediately
              const status = await paymentMonitor.pollPaymentStatus(paymentId, 10);

              if (status && status.status === 'completed') {
                console.log('[PaymentChannelSelector] Payment completed');
                onPaymentSuccess({
                  payment_method: selectedChannel.channel_type,
                  payment_reference: paymentData.reference,
                  payment_id: paymentId,
                  status: 'completed',
                  amount: status.amount
                });
                setProcessingState(prev => ({ ...prev, isVerifying: false }));
              } else if (status && status.status === 'failed') {
                console.log('[PaymentChannelSelector] Payment failed');
                setProcessingState(prev => ({ ...prev, isVerifying: false }));
                onPaymentError('Payment failed. Please try again.');
                setError('Payment failed. Please try again.');
              } else {
                console.log('[PaymentChannelSelector] Payment pending, monitoring continues...');
                // Keep verifying state active - monitoring will continue in background
              }

              Browser.removeAllListeners();
            });
          } else if (paymentWindow && !paymentWindow.closed) {
            // Use popup window for web platforms
            paymentWindow.location.href = paymentData.payment_link;
            setError(null);

            let intervalId: number;
            let hasCheckedOnClose = false;

            const checkPaymentInterval = () => {
              intervalId = window.setInterval(async () => {
                if (paymentWindow && paymentWindow.closed && !hasCheckedOnClose) {
                  hasCheckedOnClose = true;
                  clearInterval(intervalId);

                  console.log('[PaymentChannelSelector] Payment window closed, checking payment status...');

                  // Set verifying state instead of processing
                  setProcessingState(prev => ({ ...prev, isVerifying: true }));
                  setError(null);

                  const status = await paymentMonitor.pollPaymentStatus(paymentId, 10);

                  if (status && status.status === 'completed') {
                    console.log('[PaymentChannelSelector] Payment completed after window close');
                    onPaymentSuccess({
                      payment_method: selectedChannel.channel_type,
                      payment_reference: paymentData.reference,
                      payment_id: paymentId,
                      status: 'completed',
                      amount: status.amount
                    });
                    setProcessingState(prev => ({ ...prev, isVerifying: false }));
                  } else if (status && status.status === 'failed') {
                    console.log('[PaymentChannelSelector] Payment failed after window close');
                    setProcessingState(prev => ({ ...prev, isVerifying: false }));
                    onPaymentError('Payment failed. Please try again.');
                    setError('Payment failed. Please try again.');
                  } else {
                    console.log('[PaymentChannelSelector] Payment still pending, monitoring continues...');
                    // Keep verifying state active - monitoring will continue in background
                  }
                }
              }, 500);
            };

            checkPaymentInterval();

            setTimeout(() => {
              if (intervalId) {
                clearInterval(intervalId);
              }
            }, 600000);
          } else {
            setError('Payment window was closed. Please try again.');
            onPaymentError('Payment window was closed. Please try again.');
          }
        } else if (selectedChannel.channel_type === 'usdt') {
          monitorPayment();
          setError('Please send USDT to the provided address. Your treats will be credited after confirmation.');
          setIsProcessing(false);
        } else {
          monitorPayment();
          setIsProcessing(false);
        }
      } else {
        if (paymentWindow && !paymentWindow.closed) {
          paymentWindow.close();
        }

        // Extract more detailed error message if available
        let errorMessage = 'Payment initialization failed';
        if (result.data && result.data.message) {
          errorMessage = result.data.message;
        } else if (result.data && result.data.details) {
          errorMessage = result.data.details;
        } else if (result.error) {
          errorMessage = result.error;
        }

        console.error('[PaymentChannelSelector] Payment error:', {
          result,
          errorMessage
        });

        onPaymentError(errorMessage);
        setError(errorMessage);
      }
    } catch (err) {
      if (paymentWindow && !paymentWindow.closed) {
        paymentWindow.close();
      }
      console.error('Error processing payment:', err);
      const errorMessage = err instanceof Error ? err.message : 'Payment processing failed';
      onPaymentError(errorMessage);
      setError(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  const getChannelIcon = (channelType: string) => {
    switch (channelType) {
      case 'paystack':
        return <CreditCard className="w-6 h-6" />;
      case 'flutterwave':
        return <CreditCard className="w-6 h-6" />;
      case 'usdt':
        return <Wallet className="w-6 h-6" />;
      case 'google_play':
        return <Smartphone className="w-6 h-6" />;
      default:
        return <DollarSign className="w-6 h-6" />;
    }
  };

  const getChannelDisplayName = (channel: PaymentChannel): string => {
    switch (channel.channel_type) {
      case 'paystack':
        return 'Paystack (Card/Bank)';
      case 'flutterwave':
        return 'Flutterwave (Card/Bank)';
      case 'usdt':
        return 'USDT (Crypto)';
      case 'google_play':
        return 'Google Play';
      default:
        return channel.channel_name;
    }
  };

  const getChannelDescription = (channelType: string): string => {
    switch (channelType) {
      case 'paystack':
        return 'Pay with debit card, bank transfer, or mobile money';
      case 'flutterwave':
        return 'Pay with debit card, bank transfer, or mobile money';
      case 'usdt':
        return 'Pay with USDT cryptocurrency';
      case 'google_play':
        return 'Billed through Google Play (required on Android)';
      default:
        return 'Secure payment processing';
    }
  };

  const hasOnlyGooglePlayChannel =
    paymentChannels.length === 1 && paymentChannels[0]?.channel_type === 'google_play';

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-center py-8 rounded-3xl border border-white/[0.07] bg-white/[0.03]">
          <div className="w-5 h-5 border-2 border-[#00ad74] border-t-transparent rounded-full animate-spin"></div>
          <p className="font-['Inter',sans-serif] text-white/60 text-sm ml-3">
            Loading payment options...
          </p>
        </div>
      </div>
    );
  }

  if (error && paymentChannels.length === 0) {
    return (
      <div className="space-y-4">
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-2xl">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <p className="font-['Inter',sans-serif] text-red-400 text-sm">{error}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 h-12 bg-white/[0.05] border border-white/[0.07] rounded-2xl font-['Inter',sans-serif] font-semibold text-white/60 active:bg-white/[0.08] transition-all duration-200"
          >
            Cancel
          </button>
          <button
            onClick={loadPaymentChannels}
            className="flex-1 h-12 bg-white rounded-2xl font-['Inter',sans-serif] font-black text-black active:scale-[0.98] transition-all duration-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (paymentChannels.length === 0) {
    return (
      <div className="space-y-4">
        <div className="p-6 border border-white/[0.07] bg-white/[0.03] rounded-3xl text-center">
          <div className="w-12 h-12 bg-white/[0.05] rounded-2xl flex items-center justify-center mx-auto mb-3">
            <CreditCard className="w-6 h-6 text-white/60" />
          </div>
          <h3 className="font-['Inter',sans-serif] font-semibold text-white text-base mb-2">
            No Payment Methods Available
          </h3>
          <p className="font-['Inter',sans-serif] text-white/70 text-sm">
            {Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
              ? 'Google Play Billing is not set up yet. Ask an admin to add and enable a Google Play payment channel with product IDs for each treat package.'
              : 'Payment methods are currently being set up. Please try again later.'}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="w-full h-12 bg-white rounded-2xl font-['Inter',sans-serif] font-black text-black active:scale-[0.98] transition-all duration-200"
        >
          Close
        </button>
      </div>
    );
  }

  // Show verifying state
  if (processingState.isVerifying) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col items-center justify-center py-12 rounded-3xl border border-white/[0.07] bg-white/[0.03]">
          <div className="w-14 h-14 border-4 border-[#00ad74] border-t-transparent rounded-full animate-spin mb-4"></div>
          <h3 className="font-['Inter',sans-serif] font-semibold text-white text-lg mb-2">
            Verifying Payment
          </h3>
          <p className="font-['Inter',sans-serif] text-white/70 text-sm text-center max-w-md">
            Please wait while we confirm your payment. This usually takes a few seconds...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Currency Selector */}
      <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-3">
          Payment Currency
        </p>
        <CurrencySelector
          selectedCurrency={currencyData.currency}
          onCurrencyChange={onCurrencyChange}
          detectedCountry={currencyData.country}
          isDetected={currencyData.detected}
        />
      </div>

      {!hasOnlyGooglePlayChannel && (
        <div className="rounded-3xl border border-white/[0.07] bg-white/[0.03] p-5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-white/30 font-['Inter',sans-serif] mb-3">
            Choose Payment Method
          </p>

          <div className="space-y-3">
            {paymentChannels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => setSelectedChannel(channel)}
                className={`w-full text-left rounded-2xl px-4 py-4 transition-all duration-200 border ${
                  selectedChannel?.id === channel.id
                    ? 'bg-[#00ad74]/10 border-[#00ad74]/20'
                    : 'bg-white/[0.04] border-white/[0.07] active:bg-white/[0.08]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      selectedChannel?.id === channel.id
                        ? 'bg-[#00ad74]/15 text-[#00ad74]'
                        : 'bg-white/[0.08] text-white/60'
                    }`}>
                      {channel.icon_url ? (
                        <img
                          src={channel.icon_url}
                          alt={channel.channel_name}
                          className="w-6 h-6 object-contain"
                        />
                      ) : (
                        getChannelIcon(channel.channel_type)
                      )}
                    </div>
                    <div>
                      <h4 className="font-['Inter',sans-serif] font-semibold text-white text-sm">
                        {getChannelDisplayName(channel)}
                      </h4>
                      <p className="font-['Inter',sans-serif] text-white/40 text-[11px]">
                        {getChannelDescription(channel.channel_type)}
                      </p>
                    </div>
                  </div>

                  {selectedChannel?.id === channel.id && (
                    <div className="w-5 h-5 bg-[#00ad74] rounded-full flex items-center justify-center">
                      <Check className="w-3 h-3 text-black" />
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <p className="font-['Inter',sans-serif] text-red-400 text-sm">{error}</p>
          </div>
        </div>
      )}

      {selectedChannel && (
        <div className="p-4 bg-white/[0.03] border border-white/[0.07] rounded-3xl">
          <h4 className="font-['Inter',sans-serif] font-medium text-white/80 text-sm mb-3">
            Payment Summary
          </h4>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="font-['Inter',sans-serif] text-white/70 text-sm">Amount:</span>
              <span className="font-['Inter',sans-serif] font-bold text-white text-lg">
                {formatCurrencyAmount(amount, currencyData.currency)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="font-['Inter',sans-serif] text-white/60 text-xs">Currency:</span>
              <span className="font-['Inter',sans-serif] text-white/60 text-xs">
                {currencyData.currency.code} - {currencyData.currency.name}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onCancel}
          disabled={isProcessing}
          className="flex-1 h-12 bg-white/[0.05] border border-white/[0.07] rounded-2xl font-['Inter',sans-serif] font-semibold text-white/60 active:bg-white/[0.08] transition-all duration-200 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handlePayment}
          disabled={!selectedChannel || isProcessing}
          className="flex-1 h-12 bg-white text-black disabled:opacity-40 disabled:cursor-not-allowed rounded-2xl font-['Inter',sans-serif] font-black transition-all duration-200 active:scale-[0.98]"
        >
          {isProcessing ? (
            <div className="flex items-center justify-center gap-2">
              <div className="w-4 h-4 border-2 border-black/70 border-t-transparent rounded-full animate-spin"></div>
              Processing...
            </div>
          ) : (
            `Pay ${formatCurrencyAmount(amount, currencyData.currency)}`
          )}
        </button>
      </div>
    </div>
  );
};
