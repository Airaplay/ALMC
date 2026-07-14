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
  console.log(`[RECONCILE-PAYMENTS] ${JSON.stringify(context)}`);
}

function logError(context: LogContext, error: any) {
  console.error(`[RECONCILE-PAYMENTS-ERROR] ${JSON.stringify({ ...context, error: error.message, stack: error.stack })}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authorization header required" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Verify user authentication and admin role
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired token" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify admin role
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (userError || !userData || userData.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const url = new URL(req.url);
    const paymentId = url.searchParams.get("payment_id");
    const verifyAll = url.searchParams.get("verify_all") === "true";

    logInfo({
      timestamp: new Date().toISOString(),
      step: "reconcile_start",
      details: { paymentId, verifyAll }
    });

    if (req.method === "GET") {
      const { data: stuckPayments, error: stuckError } = await supabase
        .from("stuck_pending_payments")
        .select("*")
        .limit(50);

      if (stuckError) {
        logError({
          timestamp: new Date().toISOString(),
          step: "fetch_stuck_payments_error"
        }, stuckError);

        return new Response(
          JSON.stringify({ error: "Failed to fetch stuck payments", details: stuckError.message }),
          {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          stuck_payments: stuckPayments || [],
          count: stuckPayments?.length || 0
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (req.method === "POST") {
      let paymentsToReconcile: any[] = [];

      if (paymentId) {
        const { data: payment, error: paymentError } = await supabase
          .from("treat_payments")
          .select("*, treat_payment_channels(*), treat_packages(*)")
          .eq("id", paymentId)
          .single();

        if (paymentError || !payment) {
          return new Response(
            JSON.stringify({ error: "Payment not found", details: paymentError?.message }),
            {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        paymentsToReconcile = [payment];
      } else if (verifyAll) {
        const { data: stuckPayments, error: stuckError } = await supabase
          .from("stuck_pending_payments")
          .select("payment_id")
          .limit(50);

        if (stuckError) {
          logError({
            timestamp: new Date().toISOString(),
            step: "fetch_stuck_payments_error"
          }, stuckError);

          return new Response(
            JSON.stringify({ error: "Failed to fetch stuck payments", details: stuckError.message }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        if (!stuckPayments || stuckPayments.length === 0) {
          return new Response(
            JSON.stringify({ success: true, message: "No stuck payments to reconcile", reconciled: 0 }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        const paymentIds = stuckPayments.map(p => p.payment_id);
        const { data: payments, error: paymentsError } = await supabase
          .from("treat_payments")
          .select("*, treat_payment_channels(*), treat_packages(*)")
          .in("id", paymentIds);

        if (paymentsError || !payments) {
          return new Response(
            JSON.stringify({ error: "Failed to fetch payment details", details: paymentsError?.message }),
            {
              status: 500,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        paymentsToReconcile = payments;
      } else {
        return new Response(
          JSON.stringify({ error: "Either payment_id or verify_all=true required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const results = {
        total: paymentsToReconcile.length,
        verified: 0,
        credited: 0,
        failed: 0,
        already_credited: 0,
        errors: [] as any[]
      };

      for (const payment of paymentsToReconcile) {
        try {
          const result = await reconcilePayment(supabase, payment);
          
          if (result.success) {
            if (result.already_credited) {
              results.already_credited++;
            } else {
              results.verified++;
              if (result.credited) {
                results.credited++;
              }
            }
          } else {
            results.failed++;
            results.errors.push({
              payment_id: payment.id,
              error: result.error
            });
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            payment_id: payment.id,
            error: error.message
          });
          logError({
            timestamp: new Date().toISOString(),
            paymentId: payment.id,
            step: "reconcile_payment_error"
          }, error);
        }
      }

      return new Response(
        JSON.stringify({
          success: true,
          results,
          message: `Reconciled ${results.total} payments. Verified: ${results.verified}, Credited: ${results.credited}, Already credited: ${results.already_credited}, Failed: ${results.failed}`
        }),
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
  } catch (error: any) {
    logError({
      timestamp: new Date().toISOString(),
      step: "reconcile_error"
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

async function reconcilePayment(supabase: any, payment: any): Promise<{
  success: boolean;
  verified?: boolean;
  credited?: boolean;
  already_credited?: boolean;
  error?: string;
}> {
  const paymentId = payment.id;

  logInfo({
    timestamp: new Date().toISOString(),
    paymentId,
    step: "reconcile_payment_start",
    details: { 
      status: payment.status,
      external_reference: payment.external_reference,
      channel_type: payment.treat_payment_channels?.channel_type
    }
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
      step: "payment_already_credited"
    });
    return { success: true, already_credited: true };
  }

  const channel = payment.treat_payment_channels;
  if (!channel) {
    return { success: false, error: "Payment channel not found" };
  }

  if (channel.channel_type !== "flutterwave") {
    return { success: false, error: `Payment channel type ${channel.channel_type} not supported for reconciliation` };
  }

  const externalRef = payment.external_reference || `treat_${paymentId}`;
  const secretKey = channel.configuration?.secret_key;

  if (!secretKey) {
    return { success: false, error: "Secret key not found in payment channel configuration" };
  }

  logInfo({
    timestamp: new Date().toISOString(),
    paymentId,
    step: "verifying_with_flutterwave",
    details: { external_reference: externalRef }
  });

  const verified = await verifyFlutterwavePayment(externalRef, secretKey);

  if (!verified) {
    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "payment_not_verified",
      details: { message: "Payment not verified with Flutterwave - may still be pending or failed" }
    });
    return { success: true, verified: false };
  }

  logInfo({
    timestamp: new Date().toISOString(),
    paymentId,
    step: "payment_verified_crediting",
    details: { message: "Payment verified with Flutterwave, crediting treats" }
  });

  const activationSuccess = await activateUserPackage(supabase, paymentId);

  if (activationSuccess) {
    await supabase
      .from("treat_payments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", paymentId);

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "payment_reconciled_and_credited"
    });

    return { success: true, verified: true, credited: true };
  } else {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "activation_failed_after_verification"
    }, new Error("Failed to activate package after verification"));

    return { success: false, error: "Failed to activate package after verification" };
  }
}

async function verifyFlutterwavePayment(transactionIdOrRef: string, secretKey: string): Promise<boolean> {
  try {
    logInfo({
      timestamp: new Date().toISOString(),
      step: "flutterwave_verification_start",
      details: { transactionIdOrRef }
    });

    let response = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionIdOrRef}/verify`, {
      headers: {
        "Authorization": `Bearer ${secretKey}`,
      },
    });

    let data = await response.json();

    logInfo({
      timestamp: new Date().toISOString(),
      step: "flutterwave_verification_first_attempt",
      details: { status: data.status, dataStatus: data.data?.status }
    });

    if (data.status !== "success") {
      const fullTxRef = transactionIdOrRef.startsWith("treat_")
        ? transactionIdOrRef
        : transactionIdOrRef;

      logInfo({
        timestamp: new Date().toISOString(),
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
        step: "flutterwave_verification_fallback_result",
        details: { status: data.status, dataStatus: data.data?.status }
      });
    }

    const isVerified = data.status === "success" && data.data && data.data.status === "successful";

    logInfo({
      timestamp: new Date().toISOString(),
      step: "flutterwave_verification_complete",
      details: { isVerified }
    });

    return isVerified;
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
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
      }, walletFetchError || new Error("Wallet not found"));
      throw new Error("Failed to fetch wallet");
    }

    const currentBalance = Number(walletData.balance) || 0;
    const newBalance = currentBalance + totalTreats;

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      userId,
      step: "creating_transaction",
      details: { currentBalance, newBalance, totalTreats }
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
          reconciled: true,
          credited_via: "reconciliation",
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
    return false;
  }
}
