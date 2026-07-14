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
    const BUNNY_STORAGE_ENDPOINT = Deno.env.get("BUNNY_STORAGE_ENDPOINT") || "storage.bunnycdn.com";

    const results = {
      timestamp: new Date().toISOString(),
      configuration: {
        storageZone: BUNNY_STORAGE_ZONE,
        storageEndpoint: BUNNY_STORAGE_ENDPOINT,
        apiKeyLength: BUNNY_STORAGE_API_KEY?.length || 0,
        apiKeyFirst10: BUNNY_STORAGE_API_KEY?.substring(0, 10) || "NOT SET",
        apiKeyLast4: BUNNY_STORAGE_API_KEY?.substring(BUNNY_STORAGE_API_KEY.length - 4) || "NOT SET",
      },
      tests: [] as any[],
    };

    if (!BUNNY_STORAGE_ZONE || !BUNNY_STORAGE_API_KEY) {
      return new Response(JSON.stringify({
        error: "Missing configuration",
        ...results
      }, null, 2), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Test 1: GET request to list files (most common)
    const test1Url = `https://${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE}/`;
    try {
      const response = await fetch(test1Url, {
        method: "GET",
        headers: {
          "AccessKey": BUNNY_STORAGE_API_KEY,
        },
      });
      results.tests.push({
        name: "GET with AccessKey header",
        url: test1Url,
        method: "GET",
        headers: { "AccessKey": "[REDACTED]" },
        status: response.status,
        statusText: response.statusText,
        success: response.ok,
        body: response.ok ? "Success" : await response.text().then(t => t.substring(0, 200)),
      });
    } catch (err) {
      results.tests.push({
        name: "GET with AccessKey header",
        url: test1Url,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // Test 2: GET with Authorization header (alternative method)
    try {
      const response = await fetch(test1Url, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${BUNNY_STORAGE_API_KEY}`,
        },
      });
      results.tests.push({
        name: "GET with Authorization Bearer header",
        url: test1Url,
        method: "GET",
        headers: { "Authorization": "Bearer [REDACTED]" },
        status: response.status,
        statusText: response.statusText,
        success: response.ok,
        body: response.ok ? "Success" : await response.text().then(t => t.substring(0, 200)),
      });
    } catch (err) {
      results.tests.push({
        name: "GET with Authorization Bearer header",
        url: test1Url,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // Test 3: Try with zone in path different format
    const test3Url = `https://${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE}`;
    try {
      const response = await fetch(test3Url, {
        method: "GET",
        headers: {
          "AccessKey": BUNNY_STORAGE_API_KEY,
        },
      });
      results.tests.push({
        name: "GET without trailing slash",
        url: test3Url,
        method: "GET",
        status: response.status,
        statusText: response.statusText,
        success: response.ok,
        body: response.ok ? "Success" : await response.text().then(t => t.substring(0, 200)),
      });
    } catch (err) {
      results.tests.push({
        name: "GET without trailing slash",
        url: test3Url,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // Test 4: Try a simple test file upload
    const testFileName = `test-${Date.now()}.txt`;
    const testFileContent = "Test file from Supabase Edge Function";
    const uploadUrl = `https://${BUNNY_STORAGE_ENDPOINT}/${BUNNY_STORAGE_ZONE}/${testFileName}`;
    try {
      const response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "AccessKey": BUNNY_STORAGE_API_KEY,
          "Content-Type": "text/plain",
        },
        body: testFileContent,
      });
      results.tests.push({
        name: "PUT test file upload",
        url: uploadUrl,
        method: "PUT",
        status: response.status,
        statusText: response.statusText,
        success: response.ok,
        body: response.ok ? "Upload successful" : await response.text().then(t => t.substring(0, 200)),
      });

      // If upload succeeded, try to delete it
      if (response.ok) {
        const deleteResponse = await fetch(uploadUrl, {
          method: "DELETE",
          headers: {
            "AccessKey": BUNNY_STORAGE_API_KEY,
          },
        });
        results.tests.push({
          name: "DELETE test file cleanup",
          url: uploadUrl,
          method: "DELETE",
          status: deleteResponse.status,
          statusText: deleteResponse.statusText,
          success: deleteResponse.ok,
        });
      }
    } catch (err) {
      results.tests.push({
        name: "PUT test file upload",
        url: uploadUrl,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }

    // Summary
    const successfulTests = results.tests.filter(t => t.success).length;
    const totalTests = results.tests.length;

    return new Response(JSON.stringify({
      ...results,
      summary: {
        total: totalTests,
        successful: successfulTests,
        failed: totalTests - successfulTests,
        overallStatus: successfulTests > 0 ? "SOME_SUCCESS" : "ALL_FAILED",
        recommendation: successfulTests === 0 
          ? "The API key appears to be completely invalid. Please verify you copied the correct Storage Zone Password from Bunny.net Dashboard > Storage > Your Zone > FTP & API Access > Password"
          : successfulTests < totalTests
          ? "Some authentication methods work. The standard method should be sufficient."
          : "All tests passed! Your configuration is correct.",
      },
    }, null, 2), {
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
