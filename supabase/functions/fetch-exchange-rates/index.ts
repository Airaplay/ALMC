import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
    // Get API key from environment
    const apiKey = Deno.env.get("EXCHANGERATE_API_KEY");

    if (!apiKey) {
      throw new Error("EXCHANGERATE_API_KEY not configured in Supabase secrets");
    }

    console.log("Fetching exchange rates from API...");

    // Fetch latest rates from exchangerate-api.com
    // Using USD as base currency
    const apiUrl = `https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`;

    const response = await fetch(apiUrl);

    console.log(`API response status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API error response:", errorText);

      // Try to parse error details
      try {
        const errorData = JSON.parse(errorText);
        throw new Error(`API request failed: ${errorData['error-type'] || response.statusText}. ${errorData.message || ''}`);
      } catch {
        throw new Error(`API request failed: ${response.status} ${response.statusText}. Response: ${errorText.substring(0, 200)}`);
      }
    }

    const data: ExchangeRateAPIResponse = await response.json();

    console.log("API result:", data.result);

    if (data.result !== "success") {
      throw new Error(`API returned error result: ${data.result}. Please check your API key validity.`);
    }

    // Extract relevant currencies that we support
    const supportedCurrencies = [
      'NGN', 'GHS', 'KES', 'ZAR', 'EGP', // African currencies
      'GBP', 'EUR', // European currencies
      'USD', 'CAD', // North American currencies
      'AUD', 'NZD', // Oceania currencies
      'INR', 'PKR', // South Asian currencies
      'BRL', 'ARS', 'MXN', // Latin American currencies
      'JPY', 'CNY', 'SGD', // Asian currencies
    ];

    const rates: Record<string, number> = {};

    // Apply 6% reduction to all rates as a buffer against currency fluctuations
    const RATE_ADJUSTMENT = 0.94; // Subtract 6%

    for (const currency of supportedCurrencies) {
      if (data.conversion_rates[currency]) {
        // Apply 6% reduction to protect against currency volatility
        rates[currency] = data.conversion_rates[currency] * RATE_ADJUSTMENT;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        base_currency: data.base_code,
        rates,
        last_updated: data.time_last_update_utc,
        next_update: data.time_next_update_utc,
        total_currencies: Object.keys(rates).length,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Error fetching exchange rates:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to fetch exchange rates",
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
