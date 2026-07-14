import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { enforceBlackEmailHeaderBackground } from "../_shared/emailHeaderStyle.ts";
import { requireRoleCaller } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Roles permitted to send transactional/marketing email through this function.
// Service-role callers (process-email-queue, scheduled jobs) are also accepted by requireRoleCaller.
const ALLOWED_ROLES = ['admin', 'manager'] as const;

interface SendEmailRequest {
  template_type:
    | 'welcome'
    | 'purchase_treat'
    | 'approved_withdrawal'
    | 'completed_withdrawal'
    | 'creator_approved'
    | 'promotion_active'
    | 'newsletter'
    | 'weekly_report'
    | 'support_ticket_received'
    | 'support_ticket_reply';
  recipient_email: string;
  recipient_user_id?: string;
  variables: Record<string, string>;
}

const SUPPORT_EMAIL = 'support@airaplay.com';
const SUPPORT_NAME = 'Airaplay Support';

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  // Authenticate caller. Email sending uses the project's transactional
  // provider credentials, so it must be gated to admins or trusted server-to-server callers.
  const auth = await requireRoleCaller(req, corsHeaders, ALLOWED_ROLES);
  if (!auth.ok) return auth.response;
  const { supabase } = auth;

  try {
    // Parse request body
    const body: SendEmailRequest = await req.json();
    const { template_type, recipient_email, recipient_user_id, variables } = body;

    // Validate request
    if (!template_type || !recipient_email || !variables) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get ZeptoMail configuration
    const { data: config, error: configError } = await supabase
      .from('zeptomail_config')
      .select('*')
      .eq('is_active', true)
      .single();

    if (configError || !config) {
      console.error('Failed to get ZeptoMail config:', configError);
      return new Response(
        JSON.stringify({ error: 'Email service not configured' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Get email template
    const { data: template, error: templateError } = await supabase
      .from('email_templates')
      .select('*')
      .eq('template_type', template_type)
      .eq('is_active', true)
      .single();

    if (templateError || !template) {
      console.error('Failed to get email template:', templateError);
      return new Response(
        JSON.stringify({ error: 'Email template not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Replace variables in subject and content (split/join avoids regex + `$` replacement quirks in long HTML)
    let subject = template.subject;
    let htmlContent = enforceBlackEmailHeaderBackground(template.html_content);
    const isSupportEmail =
      template_type === 'support_ticket_received' ||
      template_type === 'support_ticket_reply';
    const fromAddress = isSupportEmail ? SUPPORT_EMAIL : config.from_email;
    const fromName = isSupportEmail ? SUPPORT_NAME : config.from_name;

    for (const [key, raw] of Object.entries(variables)) {
      const placeholder = `{{${key}}}`;
      const value = raw == null ? '' : String(raw);
      subject = subject.split(placeholder).join(value);
      htmlContent = htmlContent.split(placeholder).join(value);
    }

    // Marketing broadcasts pass the composed headline as newsletter_title.
    if (template_type === 'newsletter') {
      const title = variables.newsletter_title?.trim();
      if (title) subject = title;
    }

    // Send email via ZeptoMail API
    const zeptomailResponse = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: {
        'Authorization': config.api_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: {
          address: fromAddress,
          name: fromName,
        },
        to: [
          {
            email_address: {
              address: recipient_email,
            },
          },
        ],
        subject: subject,
        htmlbody: htmlContent,
        ...(isSupportEmail && {
          reply_to: [
            {
              address: SUPPORT_EMAIL,
              name: SUPPORT_NAME,
            },
          ],
        }),
        ...(config.bounce_address && { bounce_address: config.bounce_address }),
      }),
    });

    const zeptomailData = await zeptomailResponse.json();

    // Log email
    const emailLog = {
      template_type,
      recipient_email,
      recipient_user_id: recipient_user_id || null,
      subject,
      html_content: htmlContent,
      status: zeptomailResponse.ok ? 'sent' : 'failed',
      provider_message_id: zeptomailData.message_id || null,
      error_message: zeptomailResponse.ok ? null : JSON.stringify(zeptomailData),
      metadata: { variables, from_email: fromAddress, from_name: fromName },
      sent_at: zeptomailResponse.ok ? new Date().toISOString() : null,
    };

    const { error: logError } = await supabase
      .from('email_logs')
      .insert(emailLog);

    if (logError) {
      console.error('Failed to log email:', logError);
    }

    if (!zeptomailResponse.ok) {
      return new Response(
        JSON.stringify({
          error: 'Failed to send email',
          details: zeptomailData,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Email sent successfully',
        message_id: zeptomailData.message_id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error sending email:', error);
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
