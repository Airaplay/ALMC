import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { validatePaymentRequest, validateContentType } from "../_shared/validation.ts";
import { requireAuthenticatedCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

/**
 * Inbound payload. `configuration` is intentionally NOT accepted from the
 * client — provider secrets live only in `treat_payment_channels.configuration`
 * and are loaded here via the service-role client.
 *
 * Likewise, the buyer is always the authenticated caller; we never trust
 * `user_email` to identify the user (it's only used as the receipt address).
 */
interface PaymentRequest {
  channel_id: string;
  amount: number;
  package_id: string;
  user_email: string;
  currency: string;
  currency_symbol: string;
  currency_name: string;
  exchange_rate: number;
  detected_country?: string;
  detected_country_code?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  let requestData: PaymentRequest | null = null;

  try {
    const contentType = req.headers.get("content-type");
    if (!validateContentType(contentType)) {
      return new Response(
        JSON.stringify({ error: "Invalid content type" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Authenticate caller — never trust user identity from the request body.
    const auth = await requireAuthenticatedCaller(req, corsHeaders);
    if (!auth.ok) return auth.response;
    const { supabase, user, isServiceRole } = auth;

    requestData = await req.json();

    // Construct a validation payload that includes a placeholder `channel_type`
    // — the legacy validator rejects requests without it, but real channel
    // type/configuration is loaded from the database below.
    const validationPayload = { ...requestData, channel_type: 'paystack' };
    const validation = validatePaymentRequest(validationPayload);
    if (!validation.isValid) {
      const filteredErrors = validation.errors.filter((e) => e.field !== 'channel_type');
      if (filteredErrors.length > 0) {
        return new Response(
          JSON.stringify({ error: "Validation failed", details: filteredErrors }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const {
      channel_id,
      amount,
      package_id,
      user_email,
      currency,
      currency_symbol,
      currency_name,
      exchange_rate,
      detected_country,
      detected_country_code,
    } = requestData;

    // Load channel + provider secrets server-side. Reject disabled channels.
    const { data: channel, error: channelError } = await supabase
      .from("treat_payment_channels")
      .select("id, channel_type, is_enabled, configuration")
      .eq("id", channel_id)
      .eq("is_enabled", true)
      .maybeSingle();

    if (channelError || !channel) {
      return new Response(
        JSON.stringify({ error: "Payment channel not found or disabled" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const channelType = channel.channel_type as string;
    const configuration = channel.configuration as Record<string, unknown> | null;

    if (channelType === 'google_play') {
      return new Response(
        JSON.stringify({
          error: 'Google Play purchases use in-app billing, not the card checkout flow.',
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!configuration || typeof configuration !== 'object') {
      console.error("Channel has no configuration", { channel_id });
      return new Response(
        JSON.stringify({
          error: "Payment gateway not properly configured",
          message: "The payment system is currently being set up. Please try again later or contact support."
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const secretKey = (configuration as { secret_key?: string }).secret_key;
    if ((channelType === 'paystack' || channelType === 'flutterwave') && !secretKey) {
      console.error(`${channelType} secret key is missing`);
      return new Response(
        JSON.stringify({
          error: "Payment gateway not properly configured",
          message: "The payment system requires configuration. Please contact support."
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // The buyer is the caller. Service-role calls (server-to-server) may pass user_email.
    let buyerId: string;
    let buyerEmail: string;

    if (isServiceRole) {
      const { data: lookupUser, error: lookupError } = await supabase
        .from('users')
        .select('id, email')
        .eq('email', user_email)
        .maybeSingle();
      if (lookupError || !lookupUser) {
        return new Response(
          JSON.stringify({ error: "User not found" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      buyerId = lookupUser.id as string;
      buyerEmail = (lookupUser.email as string) ?? user_email;
    } else {
      buyerId = user.id;
      buyerEmail = user.email ?? user_email;
    }

    const amountUSD = exchange_rate > 0 ? amount / exchange_rate : amount;

    const premiumCurrencies = ['GBP', 'EUR'];
    const isPremiumCurrency = premiumCurrencies.includes(currency.toUpperCase());
    if (isPremiumCurrency && amountUSD < 1.00) {
      console.log(`[Premium Currency] ${currency} transaction allowed:`, {
        amount,
        currency,
        amountUSD,
        exchange_rate,
        buyer: buyerId,
        detected_country,
      });
    }

    const { data: paymentData, error: paymentError } = await supabase
      .from("treat_payments")
      .insert({
        user_id: buyerId,
        package_id,
        amount,
        currency: currency || "USD",
        currency_symbol: currency_symbol || "$",
        currency_name: currency_name || "US Dollar",
        exchange_rate: exchange_rate || 1,
        amount_usd: amountUSD,
        detected_country: detected_country || null,
        detected_country_code: detected_country_code || null,
        payment_method: channelType,
        status: "pending",
        payment_channel_id: channel_id,
      })
      .select()
      .single();

    if (paymentError) {
      console.error("Error creating payment record:", paymentError);
      return new Response(
        JSON.stringify({ error: "Failed to create payment record" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    let paymentResponse: Record<string, unknown> = {};

    switch (channelType) {
      case "paystack":
        paymentResponse = await processPaystackPayment(
          amount,
          buyerEmail,
          paymentData.id,
          configuration,
          currency
        );
        break;

      case "flutterwave":
        paymentResponse = await processFlutterwavePayment(
          amount,
          buyerEmail,
          paymentData.id,
          configuration,
          currency
        );
        break;

      case "usdt":
        paymentResponse = await processUSDTPayment(
          amount,
          paymentData.id,
          configuration,
          currency
        );
        break;

      default:
        return new Response(
          JSON.stringify({ error: "Unsupported payment channel" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
    }

    if ((paymentResponse as { reference?: string }).reference) {
      await supabase
        .from("treat_payments")
        .update({
          external_reference: (paymentResponse as { reference: string }).reference,
          payment_data: paymentResponse,
        })
        .eq("id", paymentData.id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_id: paymentData.id,
        ...paymentResponse,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Payment processing error:", error);

    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error("Error details:", {
      message: errorMessage,
      stack: errorStack,
      hasRequestData: requestData !== null,
    });

    return new Response(
      JSON.stringify({
        error: "Payment processing failed",
        message: errorMessage,
        details: errorMessage.includes("API key")
          ? "Payment gateway configuration error. Please contact support."
          : errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function processPaystackPayment(
  amount: number,
  email: string,
  paymentId: string,
  config: Record<string, unknown>,
  currency: string = "NGN"
) {
  const paystackAmount = Math.round(amount * 100);
  const reference = "treat_" + paymentId;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const callbackUrl = supabaseUrl + "/functions/v1/payment-webhook";

  const supportedCurrencies = ["NGN", "USD", "GHS", "ZAR", "KES"];
  const paystackCurrency = supportedCurrencies.includes(currency) ? currency : "NGN";

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + (config.secret_key as string),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      amount: paystackAmount,
      currency: paystackCurrency,
      reference,
      callback_url: callbackUrl,
      metadata: {
        payment_id: paymentId,
        channel: "paystack",
        original_currency: currency,
      },
    }),
  });

  const data = await response.json();
  console.log("Paystack API response:", JSON.stringify(data, null, 2));

  if (!response.ok || !data.status) {
    const errorMsg = data.message || `Paystack API error: ${response.status} ${response.statusText}`;
    console.error("Paystack error details:", {
      status: response.status,
      statusText: response.statusText,
      data,
      currency: paystackCurrency,
      amount: paystackAmount
    });
    throw new Error(errorMsg);
  }

  return {
    reference: data.data.reference,
    authorization_url: data.data.authorization_url,
    access_code: data.data.access_code,
  };
}

async function processFlutterwavePayment(
  amount: number,
  email: string,
  paymentId: string,
  config: Record<string, unknown>,
  currency: string = "USD"
) {
  const txRef = "treat_" + paymentId;

  const redirectUrl = `airaplay://payment/success?provider=flutterwave&reference=${txRef}`;

  const apiVersion = (config.api_version as string) || "v3";

  const flutterwaveSupportedCurrencies = [
    "NGN", "USD", "GHS", "KES", "UGX", "TZS", "ZAR",
    "XAF", "XOF", "GBP", "EUR", "RWF", "ZMW", "MWK",
    "AUD", "CAD", "BRL", "CNY", "INR", "JPY", "MXN", "SAR", "AED"
  ];

  let flutterwaveCurrency = currency;
  let flutterwaveAmount = amount;

  if (!flutterwaveSupportedCurrencies.includes(currency)) {
    console.log(`Currency ${currency} not supported by Flutterwave, defaulting to USD`);
    flutterwaveCurrency = "USD";
  }

  flutterwaveAmount = Math.round(flutterwaveAmount * 100) / 100;

  const headers: Record<string, string> = {
    "Authorization": "Bearer " + (config.secret_key as string),
    "Content-Type": "application/json",
  };

  if (config.encryption_key) {
    headers["X-Encryption-Key"] = config.encryption_key as string;
  }

  const payload = {
    tx_ref: txRef,
    amount: String(flutterwaveAmount),
    currency: flutterwaveCurrency,
    redirect_url: redirectUrl,
    payment_options: "card,banktransfer,ussd,mobilemoney",
    customer: {
      email,
      name: email.split('@')[0],
    },
    customizations: {
      title: "Airaplay Treats",
      description: "Purchase treats for Airaplay",
      logo: ""
    },
    meta: {
      payment_id: paymentId,
      channel: "flutterwave",
      api_version: apiVersion,
      original_currency: currency,
      original_amount: amount,
    },
  };

  console.log("Flutterwave payment request:", JSON.stringify(payload, null, 2));

  const response = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  console.log("Flutterwave API response:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    const errorMsg = `Flutterwave API error: ${response.status} ${response.statusText}`;
    console.error("Flutterwave HTTP error details:", {
      status: response.status,
      statusText: response.statusText,
      data,
      currency: flutterwaveCurrency,
      amount: flutterwaveAmount
    });
    throw new Error(data.message || errorMsg);
  }

  if (data.status !== "success" || !data.data) {
    const errorMsg = data.message || `Flutterwave ${apiVersion} initialization failed`;
    console.error("Flutterwave error:", {
      message: errorMsg,
      data,
      currency: flutterwaveCurrency,
      amount: flutterwaveAmount,
      requestPayload: payload
    });
    throw new Error(errorMsg);
  }

  if (!data.data.link) {
    console.error("No payment link in response:", data);
    throw new Error("Payment link not generated by Flutterwave. Please try again or use a different payment method.");
  }

  return {
    reference: txRef,
    payment_link: data.data.link,
    api_version: apiVersion,
  };
}

async function processUSDTPayment(
  amount: number,
  paymentId: string,
  config: Record<string, unknown>,
  currency: string = "USD"
) {
  const reference = "treat_usdt_" + paymentId;
  const network = config.network as string;
  const wallet = config.wallet_address as string;
  const instructions = `Send exactly ${amount} ${currency} equivalent in USDT to the wallet address above using ${network} network. Payment will be verified manually.`;

  return {
    reference,
    wallet_address: wallet,
    network,
    amount_usdt: amount,
    currency,
    instructions,
  };
}
