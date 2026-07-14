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
  step: string;
  details?: any;
}

function logInfo(context: LogContext) {
  console.log(`[AUTO-RECONCILE] ${JSON.stringify(context)}`);
}

function logError(context: LogContext, error: any) {
  console.error(`[AUTO-RECONCILE-ERROR] ${JSON.stringify({ ...context, error: error.message, stack: error.stack })}`);
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

    logInfo({
      timestamp: new Date().toISOString(),
      step: "auto_reconcile_start"
    });

    // Find pending payments older than 5 minutes
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    
    const { data: pendingPayments, error: fetchError } = await supabase
      .from("treat_payments")
      .select(`
        id,
        status,
        external_reference,
        created_at,
        payment_channel_id,
        treat_payment_channels!inner(
          channel_type,
          configuration
        )
      `)
      .eq("status", "pending")
      .lt("created_at", fiveMinutesAgo)
      .limit(50);

    if (fetchError) {
      logError({
        timestamp: new Date().toISOString(),
        step: "fetch_error",
        details: { error: fetchError.message }
      }, fetchError);
      
      return new Response(
        JSON.stringify({ error: "Failed to fetch pending payments", details: fetchError.message }),
        { 
          status: 500, 
          headers: { ...corsHeaders, "Content-Type": "application/json" } 
        }
      );
    }

    if (!pendingPayments || pendingPayments.length === 0) {
      logInfo({
        timestamp: new Date().toISOString(),
        step: "no_pending_payments",
        details: { message: "No pending payments to reconcile" }
      });
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No pending payments to reconcile", 
          processed: 0 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    logInfo({
      timestamp: new Date().toISOString(),
      step: "found_pending_payments",
      details: { count: pendingPayments.length }
    });

    const results = {
      total: pendingPayments.length,
      verified: 0,
      credited: 0,
      failed: 0,
      already_credited: 0,
      skipped: 0,
    };

    // Process each payment
    for (const payment of pendingPayments) {
      try {
        const channel = payment.treat_payment_channels;
        if (!channel) {
          results.skipped++;
          continue;
        }

        // Skip USDT (requires manual verification)
        if (channel.channel_type === "usdt") {
          results.skipped++;
          continue;
        }

        logInfo({
          timestamp: new Date().toISOString(),
          paymentId: payment.id,
          step: "processing_payment",
          details: { channel_type: channel.channel_type }
        });

        // Check if already credited
        const { data: existingTransaction } = await supabase
          .from("treat_transactions")
          .select("id")
          .eq("payment_reference", payment.id)
          .eq("status", "completed")
          .maybeSingle();

        if (existingTransaction) {
          // Already credited, update payment status
          logInfo({
            timestamp: new Date().toISOString(),
            paymentId: payment.id,
            step: "already_credited_updating_status"
          });
          
          await supabase
            .from("treat_payments")
            .update({ 
              status: "completed", 
              completed_at: new Date().toISOString() 
            })
            .eq("id", payment.id);
          
          results.already_credited++;
          continue;
        }

        // Verify with payment provider
        const externalRef = payment.external_reference || `treat_${payment.id}`;
        const secretKey = channel.configuration?.secret_key;

        if (!secretKey) {
          logError({
            timestamp: new Date().toISOString(),
            paymentId: payment.id,
            step: "missing_secret_key"
          }, new Error("Secret key not found in payment channel configuration"));
          results.failed++;
          continue;
        }

        logInfo({
          timestamp: new Date().toISOString(),
          paymentId: payment.id,
          step: "verifying_with_provider",
          details: { external_reference: externalRef, channel_type: channel.channel_type }
        });

        let verified = false;
        if (channel.channel_type === "flutterwave") {
          verified = await verifyFlutterwavePayment(externalRef, secretKey);
        } else if (channel.channel_type === "paystack") {
          verified = await verifyPaystackPayment(externalRef, secretKey);
        }

        if (verified) {
          logInfo({
            timestamp: new Date().toISOString(),
            paymentId: payment.id,
            step: "payment_verified_crediting"
          });
          
          results.verified++;
          
          // Credit treats
          const activationSuccess = await activateUserPackage(supabase, payment.id);
          
          if (activationSuccess) {
            await supabase
              .from("treat_payments")
              .update({
                status: "completed",
                completed_at: new Date().toISOString(),
              })
              .eq("id", payment.id);
            
            logInfo({
              timestamp: new Date().toISOString(),
              paymentId: payment.id,
              step: "payment_credited_successfully"
            });
            
            results.credited++;
          } else {
            logError({
              timestamp: new Date().toISOString(),
              paymentId: payment.id,
              step: "activation_failed"
            }, new Error("Failed to activate package after verification"));
            results.failed++;
          }
        } else {
          logInfo({
            timestamp: new Date().toISOString(),
            paymentId: payment.id,
            step: "payment_not_verified",
            details: { message: "Payment not verified with provider - may still be pending or failed" }
          });
          results.failed++;
        }
      } catch (error: any) {
        logError({
          timestamp: new Date().toISOString(),
          paymentId: payment.id,
          step: "reconcile_error"
        }, error);
        results.failed++;
      }
    }

    logInfo({
      timestamp: new Date().toISOString(),
      step: "auto_reconcile_complete",
      details: results
    });

    return new Response(
      JSON.stringify({
        success: true,
        results,
        message: `Processed ${results.total} payments. Verified: ${results.verified}, Credited: ${results.credited}, Already credited: ${results.already_credited}, Failed: ${results.failed}, Skipped: ${results.skipped}`
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    logError({
      timestamp: new Date().toISOString(),
      step: "auto_reconcile_error"
    }, error);
    
    return new Response(
      JSON.stringify({ 
        error: "Internal server error", 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});

async function verifyFlutterwavePayment(ref: string, secretKey: string): Promise<boolean> {
  try {
    const cleanRef = ref.replace("treat_", "");
    
    // Try verify by reference first
    let response = await fetch(
      `https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${cleanRef}`,
      {
        headers: { "Authorization": `Bearer ${secretKey}` },
      }
    );
    
    let data = await response.json();
    
    // If that fails, try by transaction ID
    if (data.status !== "success" && ref !== cleanRef) {
      response = await fetch(
        `https://api.flutterwave.com/v3/transactions/${ref}/verify`,
        {
          headers: { "Authorization": `Bearer ${secretKey}` },
        }
      );
      data = await response.json();
    }
    
    return data.status === "success" && data.data?.status === "successful";
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      step: "flutterwave_verification_error"
    }, error);
    return false;
  }
}

async function verifyPaystackPayment(ref: string, secretKey: string): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.paystack.co/transaction/verify/${ref}`,
      {
        headers: { "Authorization": `Bearer ${secretKey}` },
      }
    );
    
    const data = await response.json();
    return data.status && data.data?.status === "success";
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      step: "paystack_verification_error"
    }, error);
    return false;
  }
}

async function activateUserPackage(supabase: any, paymentId: string): Promise<boolean> {
  try {
    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "activate_package_start"
    });

    // Check if already activated
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
        step: "already_activated"
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
      }, paymentError || new Error("Payment not found"));
      return false;
    }

    const { data: packageData, error: packageError } = await supabase
      .from("treat_packages")
      .select("treats, bonus")
      .eq("id", payment.package_id)
      .single();

    if (packageError || !packageData) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "fetch_package_failed"
      }, packageError || new Error("Package not found"));
      return false;
    }

    const totalTreats = Number(packageData.treats) + Number(packageData.bonus);

    // Ensure wallet exists
    await supabase
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

    const { data: walletData, error: walletError } = await supabase
      .from("treat_wallets")
      .select("balance, purchased_balance, total_purchased")
      .eq("user_id", payment.user_id)
      .single();

    if (walletError || !walletData) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "fetch_wallet_failed"
      }, walletError || new Error("Wallet not found"));
      return false;
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
          auto_reconciled: true,
        },
      });

    if (transactionError) {
      logError({
        timestamp: new Date().toISOString(),
        paymentId,
        step: "create_transaction_failed"
      }, transactionError);
      return false;
    }

    /* treat_wallets is updated only by trigger_update_treat_wallet on INSERT.
       Updating the wallet here as well doubled purchases and balances. */

    logInfo({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "package_activated_successfully",
      details: { totalTreats, newBalance }
    });

    return true;
  } catch (error) {
    logError({
      timestamp: new Date().toISOString(),
      paymentId,
      step: "activate_package_error"
    }, error);
    return false;
  }
}

