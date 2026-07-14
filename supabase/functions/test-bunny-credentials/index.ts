import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const BUNNY_STORAGE_ZONE = Deno.env.get("BUNNY_STORAGE_ZONE");
    const BUNNY_STORAGE_API_KEY = Deno.env.get("BUNNY_STORAGE_API_KEY");
    const BUNNY_CDN_HOSTNAME = Deno.env.get("BUNNY_CDN_HOSTNAME");
    const BUNNY_STORAGE_ENDPOINT = Deno.env.get("BUNNY_STORAGE_ENDPOINT") || "storage.bunnycdn.com";

    const diagnostics = {
      timestamp: new Date().toISOString(),
      configuration: {
        hasStorageZone: !!BUNNY_STORAGE_ZONE,
        storageZone: BUNNY_STORAGE_ZONE || "NOT SET",
        hasApiKey: !!BUNNY_STORAGE_API_KEY,
        apiKeyLength: BUNNY_STORAGE_API_KEY?.length || 0,
        apiKeyPrefix: BUNNY_STORAGE_API_KEY?.substring(0, 10) + "..." || "NOT SET",
        hasCdnHostname: !!BUNNY_CDN_HOSTNAME,
        cdnHostname: BUNNY_CDN_HOSTNAME || "NOT SET",
        storageEndpoint: BUNNY_STORAGE_ENDPOINT,
        hasCustomEndpoint: !!Deno.env.get("BUNNY_STORAGE_ENDPOINT"),
      },
      test: {
        status: "not_tested",
        message: "",
      },
    };

    if (!BUNNY_STORAGE_ZONE || !BUNNY_STORAGE_API_KEY || !BUNNY_CDN_HOSTNAME) {
      diagnostics.test.status = "failed";
      diagnostics.test.message = "Missing required environment variables";
      return new Response(JSON.stringify(diagnostics, null, 2), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Test connection by listing files in storage zone root
    const testUrl = `https://${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE}/`;
    
    console.log(`Testing connection to: ${testUrl}`);
    
    const testResponse = await fetch(testUrl, {
      method: "GET",
      headers: {
        "AccessKey": BUNNY_STORAGE_API_KEY,
        "Accept": "application/json",
      },
    });

    diagnostics.test = {
      status: testResponse.ok ? "success" : "failed",
      message: testResponse.ok
        ? "Successfully connected to Bunny Storage"
        : `Failed with status ${testResponse.status}: ${testResponse.statusText}`,
      httpStatus: testResponse.status,
      httpStatusText: testResponse.statusText,
      testUrl: testUrl,
    };

    if (!testResponse.ok) {
      const errorText = await testResponse.text();
      diagnostics.test.errorDetails = errorText.substring(0, 500);
      
      if (testResponse.status === 401) {
        diagnostics.test.recommendation = "The API key is invalid or expired. Please generate a new API key from your Bunny.net dashboard.";
      } else if (testResponse.status === 403) {
        diagnostics.test.recommendation = "The API key doesn't have permission to access this storage zone. Check the API key permissions.";
      } else if (testResponse.status === 404) {
        diagnostics.test.recommendation = "The storage zone name is incorrect. Verify the BUNNY_STORAGE_ZONE value matches your Bunny.net storage zone name.";
      }
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      }, null, 2),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
