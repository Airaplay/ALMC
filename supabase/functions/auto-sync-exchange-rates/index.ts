import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ExchangeRateAPIResponse {
  result: string;
  documentation: string;
  terms_of_use: string;
  time_last_update_unix: number;
  time_last_update_utc: string;
  time_next_update_unix: number;
  time_next_update_utc: string;
  base_code: string;
  conversion_rates: Record<string, number>;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("Auto-sync exchange rates started at:", new Date().toISOString());

    // Get API key from environment
    const apiKey = Deno.env.get("EXCHANGERATE_API_KEY");

    if (!apiKey) {
      throw new Error("EXCHANGERATE_API_KEY not configured");
    }

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase credentials not configured");
    }

    // Fetch latest rates from exchangerate-api.com
    const apiUrl = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`;
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data: ExchangeRateAPIResponse = await response.json();

    if (data.result !== "success") {
      throw new Error("API returned error result");
    }

    // Extract supported currencies
    const supportedCurrencies = [
      'NGN', 'GHS', 'KES', 'ZAR', 'EGP',
      'GBP', 'EUR',
      'USD', 'CAD',
      'AUD', 'NZD',
      'INR', 'PKR',
      'BRL', 'ARS', 'MXN',
      'JPY', 'CNY', 'SGD',
    ];

    // Apply 6% reduction to all rates
    const RATE_ADJUSTMENT = 0.94;

    // Map currency codes to country codes
    const currencyToCountry: Record<string, string> = {
      'NGN': 'NG', 'GHS': 'GH', 'KES': 'KE', 'ZAR': 'ZA', 'EGP': 'EG',
      'GBP': 'GB', 'EUR': 'DE',
      'USD': 'US', 'CAD': 'CA',
      'AUD': 'AU', 'NZD': 'NZ',
      'INR': 'IN', 'PKR': 'PK',
      'BRL': 'BR', 'ARS': 'AR', 'MXN': 'MX',
      'JPY': 'JP', 'CNY': 'CN', 'SGD': 'SG',
    };

    let updatedCount = 0;
    let errorCount = 0;
    const errors: string[] = [];

    // Update rates in database
    for (const currency of supportedCurrencies) {
      if (!data.conversion_rates[currency]) continue;

      const countryCode = currencyToCountry[currency];
      if (!countryCode) continue;

      const adjustedRate = data.conversion_rates[currency] * RATE_ADJUSTMENT;

      try {
        // Call update_withdrawal_exchange_rate function
        const updateResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/update_withdrawal_exchange_rate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': supabaseServiceKey,
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            p_country_code: countryCode,
            p_new_rate: adjustedRate,
            p_notes: `Auto-synced via exchangerate-api.com at ${new Date().toISOString()}`,
          }),
        });

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          throw new Error(`Failed to update ${currency}: ${errorText}`);
        }

        const result = await updateResponse.json();

        if (result.success) {
          updatedCount++;
          console.log(`✓ Updated ${currency} (${countryCode}): ${adjustedRate}`);
        } else {
          errorCount++;
          errors.push(`${currency}: ${result.error}`);
          console.error(`✗ Failed to update ${currency}:`, result.error);
        }
      } catch (err: any) {
        errorCount++;
        errors.push(`${currency}: ${err.message}`);
        console.error(`✗ Error updating ${currency}:`, err.message);
      }
    }

    const summary = {
      success: true,
      timestamp: new Date().toISOString(),
      api_last_update: data.time_last_update_utc,
      api_next_update: data.time_next_update_utc,
      currencies_processed: supportedCurrencies.length,
      updated_count: updatedCount,
      error_count: errorCount,
      errors: errors.length > 0 ? errors : undefined,
    };

    console.log("Auto-sync completed:", summary);

    return new Response(
      JSON.stringify(summary),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Auto-sync failed:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to auto-sync exchange rates",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
