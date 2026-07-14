import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireRoleCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Email queue can be drained on-demand from admin pages, support actions, or
// scheduled jobs. Allow admin/manager (UI) and service-role (cron) callers.
const ALLOWED_ROLES = ['admin', 'manager'] as const;

interface EmailQueueItem {
  id: string;
  template_type: string;
  recipient_email: string;
  recipient_user_id: string | null;
  variables: Record<string, string>;
  attempts: number;
  max_attempts: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Authenticate caller before draining the email queue. Beyond admin UI
  // triggers, scheduled jobs (service role) are also allowed via requireRoleCaller.
  const auth = await requireRoleCaller(req, corsHeaders, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    console.log('Starting email queue processing...');

    // Recover rows left in "processing" after a timeout/crash so they can be retried.
    const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await supabase
      .from('email_queue')
      .update({ status: 'pending', updated_at: new Date().toISOString() })
      .eq('status', 'processing')
      .lt('updated_at', staleBefore);

    // Get pending emails from queue
    const { data: pendingEmails, error: fetchError } = await supabase
      .from('email_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())
      .lt('attempts', 3) // Max 3 attempts
      .order('scheduled_for', { ascending: true })
      .limit(20);

    if (fetchError) {
      console.error('Error fetching pending emails:', fetchError);
      throw fetchError;
    }

    if (!pendingEmails || pendingEmails.length === 0) {
      console.log('No pending emails in queue');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No pending emails',
          processed: 0,
          sent: 0,
          failed: 0
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Found ${pendingEmails.length} pending emails`);

    let sent = 0;
    let failed = 0;

    // Process each email
    for (const email of pendingEmails as EmailQueueItem[]) {
      console.log(`Processing email ${email.id} (attempt ${email.attempts + 1}/${email.max_attempts})`);

      // Mark as processing
      await supabase
        .from('email_queue')
        .update({
          status: 'processing',
          attempts: email.attempts + 1,
          updated_at: new Date().toISOString()
        })
        .eq('id', email.id);

      try {
        // Call send-email edge function
        const sendEmailUrl = `${supabaseUrl}/functions/v1/send-email`;

        const emailResponse = await fetch(sendEmailUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            template_type: email.template_type,
            recipient_email: email.recipient_email,
            recipient_user_id: email.recipient_user_id,
            variables: email.variables,
          }),
        });

        const emailResult = await emailResponse.json();

        if (emailResponse.ok) {
          // Mark as sent
          await supabase
            .from('email_queue')
            .update({
              status: 'sent',
              sent_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq('id', email.id);

          console.log(`Email ${email.id} sent successfully`);
          sent++;
        } else {
          // Mark as failed if max attempts reached
          const newStatus = email.attempts + 1 >= email.max_attempts ? 'failed' : 'pending';

          await supabase
            .from('email_queue')
            .update({
              status: newStatus,
              error_message: JSON.stringify(emailResult),
              updated_at: new Date().toISOString()
            })
            .eq('id', email.id);

          console.error(`Email ${email.id} failed:`, emailResult);
          failed++;
        }
      } catch (error) {
        console.error(`Error sending email ${email.id}:`, error);

        // Mark as failed if max attempts reached
        const newStatus = email.attempts + 1 >= email.max_attempts ? 'failed' : 'pending';

        await supabase
          .from('email_queue')
          .update({
            status: newStatus,
            error_message: error.message,
            updated_at: new Date().toISOString()
          })
          .eq('id', email.id);

        failed++;
      }
    }

    const result = {
      success: true,
      message: `Processed ${pendingEmails.length} emails`,
      processed: pendingEmails.length,
      sent,
      failed,
    };

    console.log('Email queue processing complete:', result);

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error processing email queue:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        details: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
