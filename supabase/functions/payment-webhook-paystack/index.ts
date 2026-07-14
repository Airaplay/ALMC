import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  console.log(`[PAYSTACK-WEBHOOK] ${JSON.stringify(context)}`);
}

function logError(context: LogContext, error: any) {
  console.error(`[PAYSTACK-WEBHOOK-ERROR] ${JSON.stringify({ ...context, error: error.message, stack: error.stack })}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const url = new URL(req.url);
    
    // Log the incoming request for debugging
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
      const reference = url.searchParams.get("reference");
      const status = url.searchParams.get("status");
      
      // Health check endpoint for webhook validation
      if (!reference && !status) {
        logInfo({
          timestamp: new Date().toISOString(),
          step: "webhook_health_check",
          details: { url: req.url, userAgent: req.headers.get("user-agent") || "unknown" }
        });

        return new Response(
          JSON.stringify({
            status: "ok",
            message: "Paystack payment webhook endpoint is active",
            provider: "paystack",
            endpoint: "/functions/v1/payment-webhook-paystack",
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
        details: { reference, status, provider: "paystack", url: req.url }
      });

      if (reference) {
        await handlePaymentCallback(supabase, reference, status || "", "paystack");
      }

      const appUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/functions.*$/, "") || "";
      const redirectUrl = status === "successful" || status === "success"
        ? `${appUrl}?payment=success&ref=${reference}`
        : `${appUrl}?payment=failed&ref=${reference}`;

      return new Response(null, {
        status: 302,
        headers: {
          ...corsHeaders,
          "Location": redirectUrl,
        },
      });
    }

    if (req.method === "POST") {
      // Get the raw body for signature verification
      const rawBody = await req.text();

      // Verify webhook signature
      const signature = req.headers.get("x-paystack-signature");
      const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");

      if (!signature) {
        logError({
          timestamp: new Date().toISOString(),
          step: "signature_missing",
          details: { provider: "paystack" }
        }, new Error("Missing webhook signature"));

        return new Response(
          JSON.stringify({ error: "Missing webhook signature" }),
          {
            status: 401,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (!PAYSTACK_SECRET_KEY) {
        logError({
          timestamp: new Date().toISOString(),
          step: "secret_key_missing",
          details: { provider: "paystack" }
        }, new Error("Paystack secret key not configured"));

        return new Response(
          JSON.stringify({ error: "Webhook configuration error" }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Compute HMAC SHA512 hash
      const encoder = new TextEncoder();
      const keyData = encoder.encode(PAYSTACK_SECRET_KEY);
      const messageData = encoder.encode(rawBody);

      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "HMAC", hash: "SHA-512" },
        false,
        ["sign"]
      );

      const hashBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const computedHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      if (computedHash !== signature) {
        logError({
          timestamp: new Date().toISOString(),
          step: "signature_validation_failed",
          details: {
            provider: "paystack",
            expected: computedHash.substring(0, 10) + "...",
            received: signature.substring(0, 10) + "..."
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
        details: { provider: "paystack" }
      });

      let body;
      try {
        body = JSON.parse(rawBody);
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
          provider: "paystack",
          event: body.event,
          url: req.url
        }
      });

      await handlePaystackWebhook(supabase, body);

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

      // Retry verification up to 2 times to prevent stuck payments
      let verified = false;
      let attempts = 0;
      const maxAttempts = 2;
      
      while (!verified && attempts < maxAttempts) {
        attempts++;
        
        logInfo({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: paymentCheck.user_id,
          step: "verification_attempt",
          details: { attempt: attempts, maxAttempts }
        });
        
        verified = await verifyPaystackPayment(payment.external_reference || reference, channel.configuration.secret_key);
        
        if (!verified && attempts < maxAttempts) {
          // Wait 2 seconds before retry
          logInfo({
            timestamp: new Date().toISOString(),
            paymentId,
            userId: paymentCheck.user_id,
            step: "verification_retry_wait",
            details: { nextAttempt: attempts + 1 }
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
        step: "payment_verified_attempting_activation"
      });

      const activationSuccess = await activateUserPackage(supabase, paymentId);

      if (activationSuccess) {
        const { error } = await supabase
          .from("treat_payments")
          .update({
            status: "completed",
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
            step: "payment_completed_and_credited",
            details: { message: "Payment verified, marked as completed and treats credited successfully" }
          });
        }
      } else {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          userId: paymentCheck.user_id,
          step: "activation_failed_payment_pending"
        }, new Error("Package activation failed, payment status remains pending for manual review"));
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

async function handlePaystackWebhook(supabase: any, body: any) {
  if (body.event === "charge.success") {
    const reference = body.data.reference;
    const paymentId = reference.replace("treat_", "");

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "paystack_webhook_processing"
    });

    const { data: payment } = await supabase
      .from("treat_payments")
      .select("payment_channel_id, status")
      .eq("id", paymentId)
      .single();

    if (!payment) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "payment_not_found"
      }, new Error("Payment not found"));
      return;
    }

    if (payment.status === "completed") {
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "payment_already_completed"
      });
      return;
    }

    const { data: channel } = await supabase
      .from("treat_payment_channels")
      .select("configuration")
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

    const verified = await verifyPaystackPayment(reference, channel.configuration.secret_key);

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
          step: "paystack_payment_completed_and_credited"
        });
      } else {
        logError({
          timestamp: new Date().toISOString(),
          paymentId,
          step: "paystack_activation_failed"
        }, new Error("Failed to activate package, payment remains pending"));
      }
    }
  }
}

async function verifyPaystackPayment(reference: string, secretKey: string): Promise<boolean> {
  try {
    const response = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        "Authorization": `Bearer ${secretKey}`,
      },
    });

    const data = await response.json();
    return data.status && data.data.status === "success";
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      step: "paystack_verification_error"
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
        details: { message: "Package already activated (idempotency check)" }
      });
      return true;
    }

    const { data: payment, error: paymentError } = await supabase
      .from("treat_payments")
      .select("user_id, package_id, amount")
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

    const { data: packageData, error: packageError } = await supabase
      .from("treat_packages")
      .select("treats, bonus")
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
      logInfo({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "wallet_insert_info",
        details: { message: walletInsertError.message }
      });
    }

    const { data: walletData, error: walletFetchError } = await supabase
      .from("treat_wallets")
      .select("balance, purchased_balance, total_purchased")
      .eq("user_id", payment.user_id)
      .single();

    if (walletFetchError) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "fetch_wallet_failed"
      }, walletFetchError);
      throw new Error("Failed to fetch wallet");
    }

    const currentBalance = Number(walletData.balance) || 0;
    const newBalance = currentBalance + totalTreats;

    const { error: transactionError } = await supabase
      .from("treat_transactions")
      .insert({
        user_id: payment.user_id,
        transaction_type: "purchase",
        amount: totalTreats,
        balance_before: currentBalance,
        balance_after: newBalance,
        description: `Purchased ${packageData.treats} treats${packageData.bonus > 0 ? ` + ${packageData.bonus} bonus treats` : ''}`,
        payment_method: payment.payment_method || "online",
        payment_reference: paymentId,
        status: "completed",
        metadata: {
          payment_id: paymentId,
          package_id: payment.package_id,
          base_treats: packageData.treats,
          bonus_treats: packageData.bonus,
          price_paid: payment.amount,
          timestamp: new Date().toISOString(),
        },
      });

    if (transactionError) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "create_transaction_failed"
      }, transactionError);
      throw new Error("Failed to create transaction record");
    }

    // CRITICAL: Update wallet balance after transaction is created
    const { error: walletUpdateError } = await supabase
      .from("treat_wallets")
      .update({
        balance: newBalance,
        purchased_balance: (Number(walletData.purchased_balance) || 0) + totalTreats,
        total_purchased: (Number(walletData.total_purchased) || 0) + totalTreats,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", payment.user_id);

    if (walletUpdateError) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        userId,
        step: "update_wallet_balance_failed"
      }, walletUpdateError);
      throw new Error("Failed to update wallet balance");
    }

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "wallet_balance_updated",
      details: {
        previousBalance: currentBalance,
        newBalance: newBalance,
        treatsAdded: totalTreats
      }
    });

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "package_activation_complete",
      details: {
        treatsCredited: totalTreats,
        newBalance,
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

    await logFailedActivation(supabase, paymentId, error);
    return false;
  }
}

async function logFailedActivation(supabase: any, paymentId: string, error: any) {
  try {
    await supabase
      .from("treat_transactions")
      .insert({
        user_id: "00000000-0000-0000-0000-000000000000",
        transaction_type: "purchase",
        amount: 0,
        balance_before: 0,
        balance_after: 0,
        description: `FAILED ACTIVATION - Payment ${paymentId}`,
        payment_method: "system",
        payment_reference: paymentId,
        status: "failed",
        metadata: {
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
          requires_manual_review: true,
        },
      });
  } catch (logError) {
    console.error("Failed to log activation error:", logError);
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

