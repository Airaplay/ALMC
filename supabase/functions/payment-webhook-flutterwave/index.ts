import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

interface LogContext {
  timestamp: string;
  paymentId?: string;
  userId?: string;
  step: string;
  details?: any;
}

function logInfo(context: LogContext) {
  console.log(`[FLUTTERWAVE-WEBHOOK] ${JSON.stringify(context)}`);
}

function logError(context: LogContext, error: any) {
  console.error(`[FLUTTERWAVE-WEBHOOK-ERROR] ${JSON.stringify({ ...context, error: error.message, stack: error.stack })}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);

    logInfo({
      timestamp: new Date().toISOString(),
      step: "request_received",
      details: {
        method: req.method,
        path: url.pathname,
        query: url.search,
        headers: Object.fromEntries(req.headers.entries())
      }
    });

    if (req.method === "GET") {
      const txRef = url.searchParams.get("tx_ref");
      const status = url.searchParams.get("status");

      if (!txRef && !status) {
        logInfo({
          timestamp: new Date().toISOString(),
          step: "webhook_health_check",
          details: { url: req.url, userAgent: req.headers.get("user-agent") || "unknown" }
        });

        return new Response(
          JSON.stringify({
            status: "ok",
            message: "Flutterwave payment webhook endpoint is active",
            provider: "flutterwave",
            endpoint: "/functions/v1/payment-webhook-flutterwave",
            supported_methods: ["GET", "POST", "OPTIONS"],
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      logInfo({
        timestamp: new Date().toISOString(),
        step: "callback_received",
        details: { txRef, status, provider: "flutterwave", url: req.url }
      });

      if (txRef) {
        await handlePaymentCallback(supabase, txRef, status || "", "flutterwave");
      }

      const userAgent = req.headers.get("user-agent") || "";
      const isMobileApp = userAgent.includes("CapacitorHttp") || userAgent.includes("Airaplay");

      const frontendUrl = Deno.env.get("FRONTEND_URL") || Deno.env.get("APP_URL") || Deno.env.get("SUPABASE_URL")?.replace(/\/functions.*$/, "") || "https://vwcadgjaivvffxwgnkzy.supabase.co";

      const redirectUrl = isMobileApp
        ? (status === "successful" || status === "success"
            ? `airaplay://payment/success?provider=flutterwave&ref=${txRef}`
            : `airaplay://payment/failed?provider=flutterwave&ref=${txRef}`)
        : (status === "successful" || status === "success"
            ? `${frontendUrl}/?payment=success&provider=flutterwave&ref=${txRef}`
            : `${frontendUrl}/?payment=failed&provider=flutterwave&ref=${txRef}`);

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          "Location": redirectUrl,
        },
      });
    }

    if (req.method === "POST") {
      const verifHash = req.headers.get("verif-hash");
      const FLUTTERWAVE_SECRET_HASH = Deno.env.get("FLUTTERWAVE_SECRET_HASH");

      if (!verifHash) {
        logError({
          timestamp: new Date().toISOString(),
          step: "signature_missing",
          details: { provider: "flutterwave" }
        }, new Error("Missing webhook signature"));

        return new Response(
          JSON.stringify({ error: "Missing webhook signature" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!FLUTTERWAVE_SECRET_HASH) {
        logError({
          timestamp: new Date().toISOString(),
          step: "secret_hash_missing",
          details: { provider: "flutterwave" }
        }, new Error("Flutterwave secret hash not configured"));

        return new Response(
          JSON.stringify({ error: "Webhook configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Validate signature
      if (verifHash !== FLUTTERWAVE_SECRET_HASH) {
        logError({
          timestamp: new Date().toISOString(),
          step: "signature_validation_failed",
          details: {
            provider: "flutterwave",
            received_hash_prefix: verifHash.substring(0, 10) + "..."
          }
        }, new Error("Invalid webhook signature"));

        return new Response(
          JSON.stringify({ error: "Invalid webhook signature" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      logInfo({
        timestamp: new Date().toISOString(),
        step: "signature_verified",
        details: { provider: "flutterwave" }
      });

      let body;
      try {
        body = await req.json();
      } catch (jsonError) {
        logError({
          timestamp: new Date().toISOString(),
          step: "parse_json_error",
          details: { error: jsonError.message }
        }, jsonError);

        return new Response(
          JSON.stringify({ error: "Invalid JSON body", details: jsonError.message }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      logInfo({
        timestamp: new Date().toISOString(),
        step: "webhook_received",
        details: {
          provider: "flutterwave",
          event: body.event,
          url: req.url
        }
      });

      await handleFlutterwaveWebhook(supabase, body, verifHash);

      return new Response(
        JSON.stringify({ status: "success" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      step: "webhook_error"
    }, error);

    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function handlePaymentCallback(
  supabase: any,
  reference: string,
  status: string,
  provider: string
) {
  const paymentId = reference.replace("treat_", "").replace("usdt_", "");
  const newStatus = (status === "successful" || status === "success") ? "completed" : "failed";

  logInfo({
    timestamp: new Date().toISOString(),
    paymentId,
    step: "processing_callback",
    details: { reference, status: newStatus, provider }
  });

  try {
    const { data: paymentCheck } = await supabase
      .from("treat_payments")
      .select("id, status, user_id")
      .eq("id", paymentId)
      .maybeSingle();

    if (!paymentCheck) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "payment_not_found"
      }, new Error(`Payment not found for ID: ${paymentId}`));
      return;
    }

    if (paymentCheck.status === "completed") {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId: paymentCheck.user_id,
        step: "payment_already_completed",
        details: { message: "Skipping duplicate processing (idempotency check)" }
      });
      return;
    }

    if (newStatus === "completed") {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId: paymentCheck.user_id,
        step: "verifying_payment_with_provider",
        details: { provider }
      });

      const { data: payment } = await supabase
        .from("treat_payments")
        .select("payment_channel_id, external_reference")
        .eq("id", paymentId)
        .single();

      if (!payment) {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          step: "payment_details_not_found"
        }, new Error("Payment details not found"));
        return;
      }

      const { data: channel } = await supabase
        .from("treat_payment_channels")
        .select("configuration, channel_type")
        .eq("id", payment.payment_channel_id)
        .single();

      if (!channel) {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          step: "payment_channel_not_found"
        }, new Error("Payment channel not found"));
        return;
      }

      let verified = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!verified && attempts < maxAttempts) {
        attempts++;

        logInfo({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: paymentCheck.user_id,
          step: "verification_attempt",
          details: { attempt: attempts, maxAttempts }
        });

        verified = await verifyFlutterwavePayment(
          payment.external_reference || reference,
          channel.configuration.secret_key,
          paymentId
        );

        if (!verified && attempts < maxAttempts) {
          logInfo({
            timestamp: new Date().toISOString(),
            paymentId,
            userId: paymentCheck.user_id,
            step: "verification_retry_wait",
            details: { nextAttempt: attempts + 1, waitMs: 2000 }
          });
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      if (!verified) {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: paymentCheck.user_id,
          step: "payment_verification_failed_after_retries",
          details: { attempts }
        }, new Error("Payment verification failed with provider after retries"));
        return;
      }

      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId: paymentCheck.user_id,
        step: "payment_verified_via_callback",
        details: { message: "Payment verified. Marking as pending_credit. Treats will be credited via webhook." }
      });

      // DO NOT credit treats here - only mark as verified
      // Treats will be credited by the webhook (POST request)
      const { error } = await supabase
        .from("treat_payments")
        .update({
          status: "pending_credit",
          completed_at: new Date().toISOString(),
        })
        .eq("id", paymentId);

      if (error) {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          step: "update_payment_status_failed"
        }, error);
      } else {
        logInfo({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: paymentCheck.user_id,
          step: "payment_marked_verified_awaiting_webhook",
          details: { message: "Payment verified and marked as pending_credit. Webhook will credit treats." }
        });
      }
    } else if (newStatus === "failed") {
      const { error } = await supabase
        .from("treat_payments")
        .update({
          status: "failed",
          completed_at: null,
        })
        .eq("id", paymentId);

      if (error) {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          step: "update_payment_status_failed"
        }, error);
      }

      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId: paymentCheck.user_id,
        step: "logging_failed_payment"
      });
      await logFailedPayment(supabase, paymentId);
    }
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "callback_processing_error"
    }, error);
  }
}

async function handleFlutterwaveWebhook(supabase: any, body: any, verifHash?: string | null) {
  if (!body || !body.event) {
    logError({
      timestamp: new Date().toISOString(),
      step: "flutterwave_invalid_payload",
      details: { body: JSON.stringify(body).substring(0, 500) }
    }, new Error("Invalid Flutterwave webhook payload: missing event"));
    return;
  }

  logInfo({
    timestamp: new Date().toISOString(),
    step: "flutterwave_webhook_received",
    details: { event: body.event, has_data: !!body.data }
  });

  if (body.event === "charge.completed") {
    if (!body.data || !body.data.tx_ref) {
      logError({
        timestamp: new Date().toISOString(),
        step: "flutterwave_missing_tx_ref",
        details: { body: JSON.stringify(body).substring(0, 500) }
      }, new Error("Flutterwave webhook missing tx_ref in data"));
      return;
    }

    const reference = body.data.tx_ref;

    if (!reference.startsWith("treat_")) {
      logError({
        timestamp: new Date().toISOString(),
        step: "flutterwave_invalid_reference_format",
        details: { reference }
      }, new Error(`Invalid reference format: ${reference}. Expected format: treat_<payment_id>`));
      return;
    }

    const paymentId = reference.replace("treat_", "");

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "flutterwave_webhook_processing",
      details: {
        reference,
        transaction_id: body.data.id,
        status: body.data.status
      }
    });

    const { data: payment, error: paymentError } = await supabase
      .from("treat_payments")
      .select("payment_channel_id, status, user_id")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "payment_not_found",
        details: { error: paymentError?.message }
      }, new Error(`Payment not found for ID: ${paymentId}`));
      return;
    }

    if (payment.status === "completed") {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "payment_already_completed",
        details: { message: "Skipping duplicate processing (idempotency check)" }
      });
      return;
    }

    const { data: channel, error: channelError } = await supabase
      .from("treat_payment_channels")
      .select("configuration, channel_type")
      .eq("id", payment.payment_channel_id)
      .single();

    if (channelError || !channel) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "payment_channel_not_found",
        details: { error: channelError?.message }
      }, new Error("Payment channel not found"));
      return;
    }

    const transactionId = body.data.id || body.data.flw_ref;
    if (!transactionId) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "flutterwave_missing_transaction_id",
        details: { body_data: body.data }
      }, new Error("Flutterwave webhook missing transaction ID"));
      return;
    }

    const verified = await verifyFlutterwavePayment(
      transactionId,
      channel.configuration.secret_key,
      paymentId
    );

    if (verified) {
      const activationSuccess = await activateUserPackage(supabase, paymentId);

      if (activationSuccess) {
        await supabase
          .from("treat_payments")
          .update({
            status: "completed",
            completed_at: new Date().toISOString(),
            payment_data: body.data,
          })
          .eq("id", paymentId);

        logInfo({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: payment.user_id,
          step: "flutterwave_payment_completed_and_credited"
        });
      } else {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: payment.user_id,
          step: "flutterwave_activation_failed"
        }, new Error("Failed to activate package, payment remains pending"));
      }
    } else {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId: payment.user_id,
        step: "flutterwave_verification_failed"
      }, new Error("Flutterwave payment verification failed"));
    }
  } else {
    logInfo({
      timestamp: new Date().toISOString(),
      step: "flutterwave_unhandled_event",
      details: { event: body.event, message: "Event type not handled, ignoring webhook" }
    });
  }
}

async function verifyFlutterwavePayment(
  transactionIdOrRef: string,
  secretKey: string,
  paymentId: string
): Promise<boolean> {
  try {
    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "flutterwave_verification_start",
      details: { transactionIdOrRef, isNumeric: /^\d+$/.test(transactionIdOrRef) }
    });

    let response = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionIdOrRef}/verify`, {
      headers: {
        "Authorization": `Bearer ${secretKey}`,
      },
    });

    let data = await response.json();

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "flutterwave_verification_first_attempt",
      details: {
        status: data.status,
        dataStatus: data.data?.status,
        message: data.message
      }
    });

    if (data.status !== "success") {
      const fullTxRef = transactionIdOrRef.startsWith("treat_")
        ? transactionIdOrRef
        : `treat_${paymentId}`;

      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "flutterwave_verification_fallback",
        details: { fullTxRef }
      });

      response = await fetch(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${fullTxRef}`, {
        headers: {
          "Authorization": `Bearer ${secretKey}`,
        },
      });
      data = await response.json();

      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "flutterwave_verification_fallback_result",
        details: {
          status: data.status,
          dataStatus: data.data?.status,
          message: data.message
        }
      });
    }

    const isVerified = data.status === "success" && data.data && data.data.status === "successful";

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "flutterwave_verification_complete",
      details: { isVerified }
    });

    return isVerified;
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "flutterwave_verification_error"
    }, error);
    return false;
  }
}

async function activateUserPackage(supabase: any, paymentId: string): Promise<boolean> {
  let userId: string | undefined;

  try {
    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "activate_package_start"
    });

    const { data: existingTransaction } = await supabase
      .from("treat_transactions")
      .select("id")
      .eq("payment_reference", paymentId)
      .eq("status", "completed")
      .maybeSingle();

    if (existingTransaction) {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "transaction_already_exists",
        details: { message: "Package already activated (idempotency check)", transactionId: existingTransaction.id }
      });
      return true;
    }

    const { data: payment, error: paymentError } = await supabase
      .from("treat_payments")
      .select("user_id, package_id, amount, payment_method")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "fetch_payment_failed"
      }, paymentError || new Error("Payment is null"));
      throw new Error("Failed to fetch payment details");
    }

    userId = payment.user_id;

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "payment_details_fetched",
      details: { packageId: payment.package_id }
    });

    const { data: packageData, error: packageError } = await supabase
      .from("treat_packages")
      .select("treats, bonus, name")
      .eq("id", payment.package_id)
      .single();

    if (packageError || !packageData) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "fetch_package_failed"
      }, packageError || new Error("Package is null"));
      throw new Error("Failed to fetch package details");
    }

    const totalTreats = Number(packageData.treats) + Number(packageData.bonus);

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "package_details_fetched",
      details: {
        treats: packageData.treats,
        bonus: packageData.bonus,
        totalTreats,
        packageName: packageData.name
      }
    });

    const { error: walletInsertError } = await supabase
      .from("treat_wallets")
      .insert({
        user_id: payment.user_id,
        balance: 0,
        purchased_balance: 0,
        earned_balance: 0,
        total_purchased: 0,
        total_spent: 0,
        total_earned: 0,
        total_withdrawn: 0,
      })
      .select()
      .maybeSingle();

    if (walletInsertError && walletInsertError.code !== '23505') {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "wallet_insert_error",
        details: { code: walletInsertError.code, message: walletInsertError.message }
      }, walletInsertError);
      throw new Error(`Failed to create wallet: ${walletInsertError.message}`);
    }

    if (walletInsertError?.code === '23505') {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "wallet_already_exists"
      });
    } else {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "wallet_created"
      });
    }

    const { data: walletData, error: walletFetchError } = await supabase
      .from("treat_wallets")
      .select("balance, purchased_balance, total_purchased")
      .eq("user_id", payment.user_id)
      .single();

    if (walletFetchError || !walletData) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "fetch_wallet_failed"
      }, walletFetchError || new Error("Wallet not found after insert"));
      throw new Error("Failed to fetch wallet");
    }

    const currentBalance = Number(walletData.balance) || 0;
    const newBalance = currentBalance + totalTreats;

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "creating_transaction",
      details: {
        currentBalance,
        newBalance,
        totalTreats
      }
    });

    const { data: transactionData, error: transactionError } = await supabase
      .from("treat_transactions")
      .insert({
        user_id: payment.user_id,
        transaction_type: "purchase",
        amount: totalTreats,
        balance_before: currentBalance,
        balance_after: newBalance,
        description: `Purchased ${packageData.treats} treats${packageData.bonus > 0 ? ` + ${packageData.bonus} bonus treats` : ''}`,
        payment_method: payment.payment_method || "flutterwave",
        payment_reference: paymentId,
        status: "completed",
        metadata: {
          payment_id: paymentId,
          package_id: payment.package_id,
          package_name: packageData.name,
          base_treats: packageData.treats,
          bonus_treats: packageData.bonus,
          price_paid: payment.amount,
          timestamp: new Date().toISOString(),
          credited_via: "webhook",
        },
      })
      .select("id")
      .single();

    if (transactionError) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "create_transaction_failed",
        details: { code: transactionError.code, message: transactionError.message }
      }, transactionError);
      throw new Error(`Failed to create transaction record: ${transactionError.message}`);
    }

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "transaction_created",
      details: { transactionId: transactionData?.id }
    });

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "package_activation_complete",
      details: {
        treatsCredited: totalTreats,
        previousBalance: currentBalance,
        newBalance,
        transactionId: transactionData?.id,
        success: true
      }
    });

    return true;
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "activate_package_error"
    }, error);

    await logFailedActivation(supabase, paymentId, userId, error);
    return false;
  }
}

async function logFailedActivation(supabase: any, paymentId: string, userId: string | undefined, error: any) {
  try {
    await supabase
      .from("payment_alerts")
      .insert({
        alert_type: "failed_activation",
        severity: "critical",
        payment_id: paymentId,
        user_id: userId || null,
        title: `Failed Activation: Payment ${paymentId.substring(0, 8)}...`,
        description: `Failed to activate package for payment. Error: ${error.message}`,
        metadata: {
          payment_id: paymentId,
          user_id: userId,
          error_message: error.message,
          error_stack: error.stack,
          timestamp: new Date().toISOString(),
          requires_manual_review: true,
        },
        status: "pending"
      });

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "failed_activation_alert_created"
    });
  } catch (alertError) {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "failed_to_create_alert"
    }, alertError);
  }
}

async function logFailedPayment(supabase: any, paymentId: string) {
  try {
    const { data: payment, error: paymentError } = await supabase
      .from("treat_payments")
      .select("user_id, package_id, amount")
      .eq("id", paymentId)
      .single();

    if (paymentError || !payment) {
      return;
    }

    const { data: packageData } = await supabase
      .from("treat_packages")
      .select("treats, bonus")
      .eq("id", payment.package_id)
      .single();

    if (!packageData) {
      return;
    }

    await supabase
      .from("treat_transactions")
      .insert({
        user_id: payment.user_id,
        transaction_type: "purchase",
        amount: 0,
        balance_before: 0,
        balance_after: 0,
        description: `Payment failed for ${packageData.treats} treats package`,
        payment_method: payment.payment_method || "online",
        payment_reference: paymentId,
        status: "failed",
        metadata: {
          payment_id: paymentId,
          package_id: payment.package_id,
          attempted_amount: Number(packageData.treats) + Number(packageData.bonus),
          price_attempted: payment.amount,
          timestamp: new Date().toISOString(),
        },
      });

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId: payment.user_id,
      step: "failed_payment_logged"
    });
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "log_failed_payment_error"
    }, error);
  }
}
