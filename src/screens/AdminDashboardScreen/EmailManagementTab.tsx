import { useState, useEffect } from 'react';
import {
  Mail,
  Send,
  Edit,
  Eye,
  Plus,
  AlertTriangle,
  CheckCircle,
  Clock,
  Settings,
  Save,
  X,
  RefreshCw,
  Newspaper,
  Bookmark,
  Trash2,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { verifyAdminRole } from '../../lib/adminVerification';
import { LoadingLogo } from '../../components/LoadingLogo';
import { HtmlEmailEditor } from '../../components/HtmlEmailEditor';
import {
  validateImageFile,
  getValidatedExtension,
  sanitizeFileName,
  ALLOWED_IMAGE_EXTENSIONS,
} from '../../lib/fileSecurity';
import { enforceBlackEmailHeaderBackground } from '../../lib/emailHeaderStyle';
import { parseMarketingEmailList } from '../../lib/parseMarketingEmailList';

interface EmailTemplate {
  id: string;
  template_type: string;
  subject: string;
  html_content: string;
  variables: string[];
  is_active: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

interface EmailLog {
  id: string;
  template_type: string;
  recipient_email: string;
  subject: string;
  status: string;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

interface ZeptoMailConfig {
  id: string;
  api_token: string;
  from_email: string;
  from_name: string;
  bounce_address: string | null;
  is_active: boolean;
}

type MarketingAudience = 'all' | 'listener' | 'creator' | 'custom';

interface MarketingEmailDraft {
  id: string;
  name: string;
  title: string;
  html_content: string;
  audience: MarketingAudience;
  custom_emails_raw: string;
  unsubscribe_url: string;
  updated_at: string;
}

const DEFAULT_NEWSLETTER_DRAFT = {
  title: '',
  html: '<p></p>',
  unsubscribe_url: 'https://airaplay.com/unsubscribe',
  audience: 'all' as MarketingAudience,
  customEmailsRaw: '',
};

export const EmailManagementTab = (): JSX.Element => {
  const [activeSubTab, setActiveSubTab] = useState<'templates' | 'logs' | 'config'>('templates');
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [emailLogs, setEmailLogs] = useState<EmailLog[]>([]);
  const [config, setConfig] = useState<ZeptoMailConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Template editing state
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [isEditingTemplate, setIsEditingTemplate] = useState(false);
  const [isPreviewingTemplate, setIsPreviewingTemplate] = useState(false);
  const [templateFormData, setTemplateFormData] = useState({
    subject: '',
    html_content: ''
  });

  // Config editing state
  const [isEditingConfig, setIsEditingConfig] = useState(false);
  const [configFormData, setConfigFormData] = useState({
    api_token: '',
    from_email: '',
    from_name: '',
    bounce_address: ''
  });

  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Test email state
  const [isTestEmailOpen, setIsTestEmailOpen] = useState(false);
  const [testEmailData, setTestEmailData] = useState({
    recipient_email: '',
    template_type: 'welcome'
  });
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Email queue processing state
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);
  const [queueResult, setQueueResult] = useState<{ processed: number; sent: number; failed: number } | null>(null);

  // Weekly report queueing state
  const [isWeeklyReportOpen, setIsWeeklyReportOpen] = useState(false);
  /** Last completed Fri–Thu week in UTC (same window the Friday cron uses). */
  const [weeklyReportRange, setWeeklyReportRange] = useState(() => {
    const now = new Date();
    const y = now.getUTCFullYear();
    const mo = now.getUTCMonth();
    const d = now.getUTCDate();
    const todayUtc = new Date(Date.UTC(y, mo, d));
    const dow = todayUtc.getUTCDay(); // 0 Sun … 5 Fri … 6 Sat
    const daysFromThisWeekThursday = (dow + 7 - 4) % 7;
    const end = new Date(todayUtc);
    end.setUTCDate(end.getUTCDate() - daysFromThisWeekThursday);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    const toDateInput = (dt: Date) =>
      `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
    return { start_date: toDateInput(start), end_date: toDateInput(end) };
  });
  const [isQueueingWeeklyReports, setIsQueueingWeeklyReports] = useState(false);
  const [weeklyReportResult, setWeeklyReportResult] = useState<{ queued: number; date_range?: string } | null>(null);

  const [isNewsletterComposerOpen, setIsNewsletterComposerOpen] = useState(false);
  const [newsletterDraft, setNewsletterDraft] = useState({ ...DEFAULT_NEWSLETTER_DRAFT });
  const [activeMarketingDraftId, setActiveMarketingDraftId] = useState<string | null>(null);
  const [marketingSavedDrafts, setMarketingSavedDrafts] = useState<MarketingEmailDraft[]>([]);
  const [isSavingMarketingDraft, setIsSavingMarketingDraft] = useState(false);
  const [marketingDraftMessage, setMarketingDraftMessage] = useState<string | null>(null);
  const [isQueueingNewsletter, setIsQueueingNewsletter] = useState(false);
  const [newsletterQueueResult, setNewsletterQueueResult] = useState<{
    queued: number;
    skippedInvalid?: number;
    cappedAtMax?: boolean;
  } | null>(null);
  const [newsletterComposeTab, setNewsletterComposeTab] = useState<'compose' | 'preview'>('compose');

  useEffect(() => {
    fetchData();
  }, [activeSubTab]);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      if (activeSubTab === 'templates') {
        await fetchTemplates();
      } else if (activeSubTab === 'logs') {
        await fetchEmailLogs();
      } else if (activeSubTab === 'config') {
        await fetchConfig();
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchTemplates = async () => {
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .order('template_type');

    if (error) throw error;
    setTemplates(data || []);
  };

  const fetchEmailLogs = async () => {
    const { data, error } = await supabase
      .from('email_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    setEmailLogs(data || []);
  };

  const fetchConfig = async () => {
    const { data, error } = await supabase
      .from('zeptomail_config')
      .select('*')
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    setConfig(data);
    if (data) {
      setConfigFormData({
        api_token: data.api_token,
        from_email: data.from_email,
        from_name: data.from_name,
        bounce_address: data.bounce_address || ''
      });
    }
  };

  const getSampleVariables = (templateType: string): Record<string, string> => {
    const samples: Record<string, Record<string, string>> = {
      welcome: {
        user_name: 'John Doe',
        user_email: 'john.doe@example.com',
        app_url: 'https://airaplay.com'
      },
      purchase_treat: {
        user_name: 'John Doe',
        amount: '1000',
        transaction_id: 'TXN123456789',
        payment_method: 'Paystack',
        date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      },
      approved_withdrawal: {
        user_name: 'John Doe',
        amount: '5000.00',
        currency: 'NGN',
        payment_method: 'Bank Transfer',
        account_details: '**** **** **** 1234'
      },
      completed_withdrawal: {
        user_name: 'John Doe',
        transaction_id: 'WD-20260327-0001',
        amount: '245.00',
        currency: 'USD',
        currency_symbol: '$',
        payment_method: 'Bank Transfer',
        account_details: 'John Doe • ****1234',
        payment_reference: 'BANK-REF-12345',
        completed_at: new Date().toLocaleString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      },
      creator_approved: {
        user_name: 'John Doe',
        user_email: 'john.doe@example.com',
        app_url: 'https://airaplay.com'
      },
      promotion_active: {
        user_name: 'John Doe',
        content_title: 'My New Track',
        section: 'Trending',
        duration: '7',
        treats_spent: '500'
      },
      newsletter: {
        user_name: 'John Doe',
        newsletter_title: 'This week on Airaplay',
        newsletter_content:
          '<p><strong>Trending</strong><br>Check out the hottest tracks this week!</p>' +
          '<p><strong>New releases</strong><br>Fresh music from your favorite artists.</p>' +
          '<p><strong>Featured artists</strong><br>Discover talented new creators.</p>',
        unsubscribe_url: 'https://airaplay.com/unsubscribe'
      },
      weekly_report: {
        user_name: 'Artist Name',
        date_range: 'Jan 1 - Jan 7, 2026',
        streams_count: '1,234',
        earnings_week: '$42.50',
        stream_earnings: '$128.00',
        treat_earnings: '3,500 Treats',
        top_song: 'Amazing Song Title'
      },
      support_ticket_received: {
        user_name: 'John Doe',
        user_email: 'john.doe@example.com',
        ticket_number: 'AIR-20260514-001234',
        ticket_subject: 'Unable to withdraw earnings',
        ticket_category: 'Payment',
        ticket_status: 'Pending'
      },
      support_ticket_reply: {
        user_name: 'John Doe',
        user_email: 'john.doe@example.com',
        ticket_number: 'AIR-20260514-001234',
        ticket_subject: 'Unable to withdraw earnings',
        reply_message: 'Thanks for contacting Airaplay support. We checked your account and your withdrawal is now being reviewed.'
      }
    };
    return samples[templateType] || {};
  };

  const handleRunEmailQueue = async () => {
    try {
      setIsProcessingQueue(true);
      setQueueResult(null);
      setError(null);

      const { data, error } = await supabase.functions.invoke('process-email-queue', {
        method: 'POST',
        body: { ignore_scheduled_for: true },
      });

      if (error) {
        console.error('Error running email queue:', error);
        setError(error.message || 'Failed to run email queue');
        return;
      }

      const processed = data?.processed ?? 0;
      const sent = data?.sent ?? 0;
      const failed = data?.failed ?? 0;
      setQueueResult({ processed, sent, failed });

      // Refresh logs so admin can see the latest sends/failures.
      await fetchEmailLogs();
    } catch (err: any) {
      console.error('Error running email queue:', err);
      setError(err?.message || 'Failed to run email queue');
    } finally {
      setIsProcessingQueue(false);
      // Auto-clear queue result after a short delay
      setTimeout(() => setQueueResult(null), 6000);
    }
  };

  const handleQueueWeeklyReports = async () => {
    setIsQueueingWeeklyReports(true);
    setWeeklyReportResult(null);
    setError(null);
    try {
      const start = weeklyReportRange.start_date;
      const end = weeklyReportRange.end_date;
      if (!start || !end) throw new Error('Please select a start and end date.');

      const { data, error } = await supabase.rpc('admin_queue_weekly_creator_reports', {
        p_start_date: start,
        p_end_date: end,
      });

      if (error) throw error;
      const queued = (data as any)?.queued ?? 0;
      const date_range = (data as any)?.date_range;
      setWeeklyReportResult({ queued, date_range });

      // Optional: refresh logs so admin can see sends after running queue
      await fetchEmailLogs();
    } catch (err: any) {
      setError(err?.message || 'Failed to queue weekly reports');
    } finally {
      setIsQueueingWeeklyReports(false);
    }
  };

  const handlePreviewTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setIsPreviewingTemplate(true);
  };

  const handleEditTemplate = (template: EmailTemplate) => {
    setSelectedTemplate(template);
    setTemplateFormData({
      subject: template.subject,
      html_content: template.html_content
    });
    setIsEditingTemplate(true);
  };

  const replaceEmailPlaceholders = (html: string, vars: Record<string, string>): string => {
    let out = html;
    for (const [key, value] of Object.entries(vars)) {
      const ph = `{{${key}}}`;
      out = out.split(ph).join(value);
    }
    return out;
  };

  const buildNewsletterDraftPreviewHtml = (): string => {
    const tpl = templates.find((t) => t.template_type === 'newsletter');
    if (!tpl) {
      return '<p class="p-4 text-gray-600">Load templates first, then open the composer again.</p>';
    }
    let html = enforceBlackEmailHeaderBackground(tpl.html_content);
    const vars: Record<string, string> = {
      user_name: 'Jamie Listener',
      newsletter_title: newsletterDraft.title.trim() || 'Your newsletter title',
      newsletter_content:
        newsletterDraft.html.trim() || '<p>Your issue content will appear here.</p>',
      unsubscribe_url: newsletterDraft.unsubscribe_url.trim() || 'https://airaplay.com/unsubscribe',
    };
    return replaceEmailPlaceholders(html, vars);
  };

  const fetchMarketingSavedDrafts = async () => {
    const { data, error: fetchError } = await supabase
      .from('marketing_email_drafts')
      .select('id, name, title, html_content, audience, custom_emails_raw, unsubscribe_url, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (fetchError) {
      console.error('Failed to load marketing drafts:', fetchError);
      return;
    }
    setMarketingSavedDrafts((data as MarketingEmailDraft[]) ?? []);
  };

  const handleOpenNewsletterComposer = () => {
    setNewsletterQueueResult(null);
    setError(null);
    setMarketingDraftMessage(null);
    setActiveMarketingDraftId(null);
    setNewsletterDraft({ ...DEFAULT_NEWSLETTER_DRAFT });
    setNewsletterComposeTab('compose');
    setIsNewsletterComposerOpen(true);
    void fetchMarketingSavedDrafts();
  };

  const handleNewMarketingDraft = () => {
    setActiveMarketingDraftId(null);
    setNewsletterDraft({ ...DEFAULT_NEWSLETTER_DRAFT });
    setNewsletterQueueResult(null);
    setMarketingDraftMessage(null);
    setError(null);
  };

  const handleLoadMarketingDraft = (draftId: string) => {
    if (!draftId) {
      handleNewMarketingDraft();
      return;
    }
    const draft = marketingSavedDrafts.find((d) => d.id === draftId);
    if (!draft) return;
    setActiveMarketingDraftId(draft.id);
    setNewsletterDraft({
      title: draft.title,
      html: draft.html_content || '<p></p>',
      unsubscribe_url: draft.unsubscribe_url || DEFAULT_NEWSLETTER_DRAFT.unsubscribe_url,
      audience: draft.audience,
      customEmailsRaw: draft.custom_emails_raw || '',
    });
    setNewsletterQueueResult(null);
    setMarketingDraftMessage(`Loaded “${draft.name}”.`);
    setError(null);
  };

  const handleSaveMarketingDraft = async () => {
    setMarketingDraftMessage(null);
    setError(null);

    const gate = await verifyAdminRole();
    if (!gate.isManager) {
      setError(gate.error || 'Only admins or managers can save drafts.');
      return;
    }

    if (!newsletterDraft.title.trim()) {
      setError('Add a subject before saving a draft.');
      return;
    }
    if (!newsletterDraft.html.trim() || newsletterDraft.html.trim() === '<p></p>') {
      setError('Add message content before saving a draft.');
      return;
    }

    const existing = activeMarketingDraftId
      ? marketingSavedDrafts.find((d) => d.id === activeMarketingDraftId)
      : null;
    const defaultName = newsletterDraft.title.trim().slice(0, 80) || 'Marketing draft';
    const nameInput = window.prompt('Draft name', existing?.name || defaultName);
    if (nameInput === null) return;
    const name = nameInput.trim() || defaultName;

    setIsSavingMarketingDraft(true);
    try {
      const payload = {
        name,
        title: newsletterDraft.title.trim(),
        html_content: newsletterDraft.html,
        audience: newsletterDraft.audience,
        custom_emails_raw: newsletterDraft.customEmailsRaw,
        unsubscribe_url: newsletterDraft.unsubscribe_url.trim() || DEFAULT_NEWSLETTER_DRAFT.unsubscribe_url,
        updated_at: new Date().toISOString(),
      };

      if (activeMarketingDraftId) {
        const { error: updateError } = await supabase
          .from('marketing_email_drafts')
          .update(payload)
          .eq('id', activeMarketingDraftId);
        if (updateError) throw updateError;
        setMarketingDraftMessage(`Draft “${name}” saved.`);
      } else {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error('Sign in required to save drafts');

        const { data: inserted, error: insertError } = await supabase
          .from('marketing_email_drafts')
          .insert({ ...payload, created_by: userData.user.id })
          .select('id')
          .single();
        if (insertError) throw insertError;
        setActiveMarketingDraftId(inserted.id);
        setMarketingDraftMessage(`Draft “${name}” saved.`);
      }

      await fetchMarketingSavedDrafts();
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : err instanceof Error
            ? err.message
            : 'Failed to save draft';
      setError(msg);
    } finally {
      setIsSavingMarketingDraft(false);
    }
  };

  const handleDeleteMarketingDraft = async () => {
    if (!activeMarketingDraftId) return;
    const draft = marketingSavedDrafts.find((d) => d.id === activeMarketingDraftId);
    if (!draft) return;
    if (!window.confirm(`Delete saved draft “${draft.name}”?`)) return;

    setIsSavingMarketingDraft(true);
    try {
      const { error: deleteError } = await supabase
        .from('marketing_email_drafts')
        .delete()
        .eq('id', activeMarketingDraftId);
      if (deleteError) throw deleteError;
      handleNewMarketingDraft();
      setMarketingDraftMessage('Draft deleted.');
      await fetchMarketingSavedDrafts();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete draft');
    } finally {
      setIsSavingMarketingDraft(false);
    }
  };

  const parsedCustomEmails = parseMarketingEmailList(newsletterDraft.customEmailsRaw);

  const handleQueueNewsletterBroadcast = async () => {
    setError(null);
    setNewsletterQueueResult(null);

    const gate = await verifyAdminRole();
    if (!gate.isManager) {
      setError(gate.error || 'Only admins or managers can queue marketing emails.');
      return;
    }

    if (!newsletterDraft.title.trim()) {
      setError('Add a subject line.');
      return;
    }
    if (!newsletterDraft.html.trim() || newsletterDraft.html.trim() === '<p></p>') {
      setError('Add email body content (HTML).');
      return;
    }

    if (newsletterDraft.audience === 'custom') {
      if (parsedCustomEmails.valid.length === 0) {
        setError('Paste at least one valid email address (one per line or comma-separated).');
        return;
      }
      if (parsedCustomEmails.valid.length > 5000) {
        setError('Maximum 5,000 addresses per send. Split into multiple batches.');
        return;
      }
    }

    setIsQueueingNewsletter(true);
    try {
      if (newsletterDraft.audience === 'custom') {
        const { data, error: rpcError } = await supabase.rpc('admin_queue_marketing_email_list', {
          p_emails: parsedCustomEmails.valid,
          p_newsletter_title: newsletterDraft.title.trim(),
          p_newsletter_content: newsletterDraft.html,
          p_unsubscribe_url: newsletterDraft.unsubscribe_url.trim() || null,
        });

        if (rpcError) throw rpcError;
        const queued = (data as { queued?: number; max_per_request?: number })?.queued ?? 0;
        const skipped = (data as { skipped_invalid?: number })?.skipped_invalid ?? 0;
        const maxPerRequest = (data as { max_per_request?: number })?.max_per_request ?? 5000;
        setNewsletterQueueResult({
          queued,
          skippedInvalid: skipped,
          cappedAtMax: queued >= maxPerRequest && parsedCustomEmails.valid.length > maxPerRequest,
        });
      } else {
        const { data, error: rpcError } = await supabase.rpc('admin_queue_newsletter_broadcast', {
          p_newsletter_title: newsletterDraft.title.trim(),
          p_newsletter_content: newsletterDraft.html,
          p_unsubscribe_url: newsletterDraft.unsubscribe_url.trim() || null,
          p_audience: newsletterDraft.audience,
        });

        if (rpcError) throw rpcError;
        const queued = (data as { queued?: number })?.queued ?? 0;
        setNewsletterQueueResult({ queued });
      }
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'message' in err
          ? String((err as { message?: string }).message)
          : err instanceof Error
            ? err.message
            : 'Failed to queue marketing emails';
      setError(msg || 'Failed to queue marketing emails');
    } finally {
      setIsQueueingNewsletter(false);
    }
  };

  const getPreviewContent = (template: EmailTemplate): { subject: string; html: string } => {
    const sampleVars = getSampleVariables(template.template_type);
    let subject = template.subject;
    let html = enforceBlackEmailHeaderBackground(template.html_content);

    subject = replaceEmailPlaceholders(subject, sampleVars as Record<string, string>);
    html = replaceEmailPlaceholders(html, sampleVars as Record<string, string>);

    return { subject, html };
  };

  const uploadTemplateImage = async (file: File): Promise<string> => {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) throw new Error('You must be signed in to upload images.');

    const validation = validateImageFile(file);
    if (!validation.valid) throw new Error(validation.error ?? 'Invalid image');

    const ext = getValidatedExtension(file.name, ALLOWED_IMAGE_EXTENSIONS);
    if (!ext) throw new Error('Allowed: jpg, jpeg, png, webp, gif');

    const base = sanitizeFileName(file.name).replace(/\.[^.]+$/, '') || 'image';
    const path = `${user.id}/email/templates-${Date.now()}-${base}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('thumbnails').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });

    if (uploadError) {
      throw new Error((uploadError as { message?: string }).message ?? 'Upload failed');
    }

    const { data } = supabase.storage.from('thumbnails').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSaveTemplate = async () => {
    if (!selectedTemplate) return;

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      const { error } = await supabase
        .from('email_templates')
        .update({
          subject: templateFormData.subject,
          html_content: enforceBlackEmailHeaderBackground(templateFormData.html_content),
          updated_at: new Date().toISOString()
        })
        .eq('id', selectedTemplate.id);

      if (error) throw error;

      setSaveSuccess('Template updated successfully');
      setIsEditingTemplate(false);
      setSelectedTemplate(null);
      fetchTemplates();

      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err) {
      console.error('Error saving template:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveConfig = async () => {
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      if (config) {
        // Update existing config
        const { error } = await supabase
          .from('zeptomail_config')
          .update({
            api_token: configFormData.api_token,
            from_email: configFormData.from_email,
            from_name: configFormData.from_name,
            bounce_address: configFormData.bounce_address || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', config.id);

        if (error) throw error;
      } else {
        // Create new config
        const { error } = await supabase
          .from('zeptomail_config')
          .insert({
            api_token: configFormData.api_token,
            from_email: configFormData.from_email,
            from_name: configFormData.from_name,
            bounce_address: configFormData.bounce_address || null,
            is_active: true
          });

        if (error) throw error;
      }

      setSaveSuccess('Configuration saved successfully');
      setIsEditingConfig(false);
      fetchConfig();

      setTimeout(() => setSaveSuccess(null), 3000);
    } catch (err) {
      console.error('Error saving config:', err);
      setSaveError(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailData.recipient_email || !testEmailData.template_type) {
      setTestResult({ success: false, message: 'Please enter recipient email and select template' });
      return;
    }

    setIsSendingTest(true);
    setTestResult(null);

    try {
      // Get sample variables for the template
      const sampleVars = getSampleVariables(testEmailData.template_type);

      // Call the send-email edge function
      const { data, error } = await supabase.functions.invoke('send-email', {
        body: {
          template_type: testEmailData.template_type,
          recipient_email: testEmailData.recipient_email,
          variables: sampleVars
        }
      });

      if (error) throw error;

      if (data.error) {
        throw new Error(data.error);
      }

      setTestResult({
        success: true,
        message: `Test email sent successfully to ${testEmailData.recipient_email}`
      });

      // Refresh email logs
      if (activeSubTab === 'logs') {
        fetchEmailLogs();
      }

      // Reset form after 3 seconds
      setTimeout(() => {
        setTestEmailData({
          recipient_email: '',
          template_type: 'welcome'
        });
        setTestResult(null);
      }, 3000);
    } catch (err) {
      console.error('Error sending test email:', err);
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to send test email'
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const getTemplateTypeName = (type: string): string => {
    const names: Record<string, string> = {
      welcome: 'Welcome Email',
      purchase_treat: 'Treat Purchase',
      approved_withdrawal: 'Withdrawal Approved',
      completed_withdrawal: 'Withdrawal Receipt (Paid)',
      creator_approved: 'Creator Approved',
      promotion_active: 'Promotion Activated',
      newsletter: 'Weekly Newsletter',
      weekly_report: 'Creator Weekly Report'
    };
    return names[type] || type;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, { class: string; label: string }> = {
      pending: { class: 'bg-yellow-100 text-yellow-700 border-yellow-200', label: 'Pending' },
      sent: { class: 'bg-green-100 text-green-700 border-green-200', label: 'Sent' },
      failed: { class: 'bg-red-100 text-red-700 border-red-200', label: 'Failed' },
      bounced: { class: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Bounced' }
    };
    return badges[status] || badges.pending;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="space-y-6">
      {/* Sub-tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveSubTab('templates')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === 'templates'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Email Templates
            </div>
          </button>
          <button
            onClick={() => setActiveSubTab('logs')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === 'logs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Email Logs
            </div>
          </button>
          <button
            onClick={() => setActiveSubTab('config')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeSubTab === 'config'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              ZeptoMail Config
            </div>
          </button>
        </nav>
      </div>

      {/* Success/Error Messages */}
      {(saveSuccess || saveError) && (
        <div className={`p-4 rounded-lg ${
          saveError ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'
        }`}>
          <p className={`${
            saveError ? 'text-red-700' : 'text-green-700'
          }`}>
            {saveError || saveSuccess}
          </p>
        </div>
      )}

      {/* Email Templates Tab */}
      {activeSubTab === 'templates' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900">Email Templates</h3>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsWeeklyReportOpen(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
                title="Queue Creator Weekly Reports for all creators"
              >
                <Mail className="w-4 h-4" />
                Queue Weekly Reports
              </button>
              <button
                onClick={handleOpenNewsletterComposer}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-2"
                title="Send marketing emails via ZeptoMail (app users or custom list)"
              >
                <Newspaper className="w-4 h-4" />
                Marketing broadcast
              </button>
              <button
                onClick={() => setIsTestEmailOpen(true)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2"
              >
                <Send className="w-4 h-4" />
                Send Test Email
              </button>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingLogo variant="pulse" size={32} />
              <p className="ml-4 text-gray-700">Loading templates...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{error}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((template) => (
                <div key={template.id} className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <h4 className="text-lg font-medium text-gray-900">
                        {getTemplateTypeName(template.template_type)}
                      </h4>
                      <p className="text-sm text-gray-600 mt-1">{template.subject}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <span className={`px-2 py-1 rounded text-xs ${
                          template.is_active
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}>
                          {template.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span className="text-xs text-gray-500">Version {template.version}</span>
                        <span className="text-xs text-gray-500">
                          Variables: {template.variables.join(', ')}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handlePreviewTemplate(template)}
                        className="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg flex items-center gap-2"
                      >
                        <Eye className="w-4 h-4" />
                        Preview
                      </button>
                      <button
                        onClick={() => handleEditTemplate(template)}
                        className="px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg flex items-center gap-2"
                      >
                        <Edit className="w-4 h-4" />
                        Edit
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Email Logs Tab */}
      {activeSubTab === 'logs' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900">Email Logs</h3>
            <button
              onClick={handleRunEmailQueue}
              disabled={isProcessingQueue}
              className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              title="Process pending emails now"
            >
              {isProcessingQueue ? (
                <>
                  <LoadingLogo variant="pulse" size={16} />
                  Running...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Run email queue now
                </>
              )}
            </button>
          </div>

          {queueResult && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-700 text-sm">
                Queue run complete: processed {queueResult.processed}, sent {queueResult.sent}, failed {queueResult.failed}.
              </p>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingLogo variant="pulse" size={32} />
              <p className="ml-4 text-gray-700">Loading logs...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{error}</p>
            </div>
          ) : emailLogs.length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">No email logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-3 text-gray-700 font-medium">Type</th>
                    <th className="p-3 text-gray-700 font-medium">Recipient</th>
                    <th className="p-3 text-gray-700 font-medium">Subject</th>
                    <th className="p-3 text-gray-700 font-medium">Status</th>
                    <th className="p-3 text-gray-700 font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {emailLogs.map((log) => {
                    const statusBadge = getStatusBadge(log.status);
                    return (
                      <tr key={log.id} className="border-b border-gray-200 hover:bg-gray-50">
                        <td className="p-3 text-gray-900">
                          {getTemplateTypeName(log.template_type)}
                        </td>
                        <td className="p-3 text-gray-900">{log.recipient_email}</td>
                        <td className="p-3 text-gray-900">{log.subject}</td>
                        <td className="p-3">
                          <span className={`px-2 py-1 rounded-full text-xs border ${statusBadge.class}`}>
                            {statusBadge.label}
                          </span>
                          {log.error_message && (
                            <p className="text-xs text-red-600 mt-1">{log.error_message}</p>
                          )}
                        </td>
                        <td className="p-3 text-gray-700 text-sm">
                          {log.sent_at ? formatDate(log.sent_at) : formatDate(log.created_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ZeptoMail Config Tab */}
      {activeSubTab === 'config' && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900">ZeptoMail Configuration</h3>
            {!isEditingConfig && (
              <button
                onClick={() => setIsEditingConfig(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
              >
                <Edit className="w-4 h-4" />
                Edit Config
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingLogo variant="pulse" size={32} />
              <p className="ml-4 text-gray-700">Loading configuration...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{error}</p>
            </div>
          ) : isEditingConfig ? (
            <div className="space-y-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  API Token *
                </label>
                <input
                  type="password"
                  value={configFormData.api_token}
                  onChange={(e) => setConfigFormData({ ...configFormData, api_token: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Your ZeptoMail API token"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Get your API token from <a href="https://www.zeptomail.zoho.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">ZeptoMail Dashboard</a>
                </p>
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  From Email *
                </label>
                <input
                  type="email"
                  value={configFormData.from_email}
                  onChange={(e) => setConfigFormData({ ...configFormData, from_email: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="noreply@yourdomain.com"
                />
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  From Name *
                </label>
                <input
                  type="text"
                  value={configFormData.from_name}
                  onChange={(e) => setConfigFormData({ ...configFormData, from_name: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Airaplay"
                />
              </div>

              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Bounce Address (Optional)
                </label>
                <input
                  type="email"
                  value={configFormData.bounce_address}
                  onChange={(e) => setConfigFormData({ ...configFormData, bounce_address: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="bounce@yourdomain.com"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setIsEditingConfig(false)}
                  className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveConfig}
                  disabled={isSaving || !configFormData.api_token || !configFormData.from_email || !configFormData.from_name}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <LoadingLogo variant="pulse" size={16} />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4" />
                      Save Configuration
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : config ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="text-green-700">ZeptoMail is configured and active</span>
                </div>
                <button
                  onClick={() => setIsTestEmailOpen(true)}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg flex items-center gap-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  Test Connection
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">From Email</p>
                  <p className="text-gray-900 font-medium">{config.from_email}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">From Name</p>
                  <p className="text-gray-900 font-medium">{config.from_name}</p>
                </div>
                {config.bounce_address && (
                  <div>
                    <p className="text-sm text-gray-500">Bounce Address</p>
                    <p className="text-gray-900 font-medium">{config.bounce_address}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-yellow-600 mx-auto mb-2" />
              <p className="text-yellow-700 mb-4">ZeptoMail is not configured</p>
              <button
                onClick={() => setIsEditingConfig(true)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 mx-auto"
              >
                <Plus className="w-4 h-4" />
                Configure Now
              </button>
            </div>
          )}
        </div>
      )}

      {/* Template Edit Modal */}
      {isEditingTemplate && selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">
                  Edit {getTemplateTypeName(selectedTemplate.template_type)}
                </h3>
                <button
                  onClick={() => {
                    setIsEditingTemplate(false);
                    setSelectedTemplate(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={templateFormData.subject}
                    onChange={(e) => setTemplateFormData({ ...templateFormData, subject: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    HTML Content
                  </label>
                  <HtmlEmailEditor
                    value={templateFormData.html_content}
                    disabled={isSaving}
                    onUploadImage={uploadTemplateImage}
                    onChange={(nextHtml) => setTemplateFormData({ ...templateFormData, html_content: nextHtml })}
                  />
                  <p className="mt-2 text-xs text-gray-500">
                    Available variables: {selectedTemplate.variables.map(v => `{{${v}}}`).join(', ')}
                  </p>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setIsEditingTemplate(false);
                      setSelectedTemplate(null);
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveTemplate}
                    disabled={isSaving}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {isSaving ? (
                      <>
                        <LoadingLogo variant="pulse" size={16} />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Save Template
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Template Preview Modal */}
      {isPreviewingTemplate && selectedTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-5xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">
                    Preview: {getTemplateTypeName(selectedTemplate.template_type)}
                  </h3>
                  <p className="text-sm text-gray-500 mt-1">
                    This preview uses sample data to show how the email will appear to recipients
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsPreviewingTemplate(false);
                    setSelectedTemplate(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Email Subject */}
                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                  <p className="text-xs font-medium text-gray-500 mb-1">Subject:</p>
                  <p className="text-gray-900 font-medium">
                    {getPreviewContent(selectedTemplate).subject}
                  </p>
                </div>

                {/* Sample Variables Used */}
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <p className="text-xs font-medium text-blue-700 mb-2">Sample Data Used:</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(getSampleVariables(selectedTemplate.template_type)).map(([key, value]) => (
                      <div key={key} className="text-xs">
                        <span className="font-mono text-blue-600">{'{{' + key + '}}'}</span>
                        <span className="text-gray-600"> = </span>
                        <span className="text-gray-900">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Email Body Preview */}
                <div className="border border-gray-300 rounded-lg overflow-hidden">
                  <div className="bg-gray-100 px-4 py-2 border-b border-gray-300">
                    <p className="text-xs font-medium text-gray-700">Email Body:</p>
                  </div>
                  <div className="bg-white p-6 max-h-[500px] overflow-y-auto">
                    <iframe
                      srcDoc={getPreviewContent(selectedTemplate).html}
                      className="w-full min-h-[500px] border-0"
                      title="Email Preview"
                      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => {
                      setIsPreviewingTemplate(false);
                      setSelectedTemplate(null);
                    }}
                    className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg"
                  >
                    Close Preview
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Test Email Modal */}
      {isTestEmailOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">Send Test Email</h3>
                <button
                  onClick={() => {
                    setIsTestEmailOpen(false);
                    setTestResult(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                Send a test email to verify your ZeptoMail configuration. The email will use sample data.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Email Template
                  </label>
                  <select
                    value={testEmailData.template_type}
                    onChange={(e) => setTestEmailData({ ...testEmailData, template_type: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                  >
                    <option value="welcome">Welcome Email</option>
                    <option value="purchase_treat">Treat Purchase</option>
                    <option value="approved_withdrawal">Withdrawal Approved</option>
                    <option value="newsletter">Weekly Newsletter</option>
                    <option value="weekly_report">Creator Weekly Report</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Recipient Email *
                  </label>
                  <input
                    type="email"
                    value={testEmailData.recipient_email}
                    onChange={(e) => setTestEmailData({ ...testEmailData, recipient_email: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500"
                    placeholder="test@example.com"
                  />
                </div>

                {testResult && (
                  <div className={`p-4 rounded-lg border ${
                    testResult.success
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      {testResult.success ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-red-600" />
                      )}
                      <p className={`text-sm ${
                        testResult.success ? 'text-green-700' : 'text-red-700'
                      }`}>
                        {testResult.message}
                      </p>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => {
                      setIsTestEmailOpen(false);
                      setTestResult(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSendTestEmail}
                    disabled={isSendingTest || !testEmailData.recipient_email}
                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSendingTest ? (
                      <>
                        <LoadingLogo variant="pulse" size={16} />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send Test
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Newsletter compose (Gmail-style: To / Subject / message + Preview tab) */}
      {isNewsletterComposerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="newsletter-compose-title"
            className="flex max-h-[92vh] w-full max-w-[720px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl ring-1 ring-black/[0.06]"
          >
            <header className="flex shrink-0 items-center justify-between border-b border-[#e8eaed] bg-[#f6f8fc] px-3 py-2.5 sm:px-4">
              <h2 id="newsletter-compose-title" className="text-[15px] font-medium text-[#202124]">
                Marketing broadcast
              </h2>
              <button
                type="button"
                onClick={() => {
                  setIsNewsletterComposerOpen(false);
                  setNewsletterQueueResult(null);
                }}
                className="rounded-full p-2 text-gray-500 hover:bg-gray-200/80"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#e8eaed] bg-[#fafafa] px-3 py-2 sm:px-4">
              <label htmlFor="marketing-saved-draft" className="text-xs font-medium text-[#5f6368]">
                Saved drafts
              </label>
              <select
                id="marketing-saved-draft"
                value={activeMarketingDraftId ?? ''}
                onChange={(e) => handleLoadMarketingDraft(e.target.value)}
                disabled={isQueueingNewsletter || isSavingMarketingDraft}
                className="min-w-[140px] max-w-[220px] flex-1 rounded border border-[#dadce0] bg-white px-2 py-1.5 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8] disabled:opacity-50"
              >
                <option value="">New message…</option>
                {marketingSavedDrafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleNewMarketingDraft}
                disabled={isQueueingNewsletter || isSavingMarketingDraft}
                className="rounded-md px-2 py-1.5 text-xs font-medium text-[#1a73e8] hover:bg-blue-50 disabled:opacity-50"
              >
                New
              </button>
              {activeMarketingDraftId && (
                <button
                  type="button"
                  onClick={handleDeleteMarketingDraft}
                  disabled={isQueueingNewsletter || isSavingMarketingDraft}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  title="Delete saved draft"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </button>
              )}
              {marketingDraftMessage && (
                <span className="text-xs text-green-700">{marketingDraftMessage}</span>
              )}
            </div>

            <div className="flex shrink-0 gap-6 border-b border-[#e8eaed] px-3 sm:px-4">
              <button
                type="button"
                onClick={() => setNewsletterComposeTab('compose')}
                className={`border-b-2 pb-2.5 pt-2 text-sm font-medium -mb-px transition-colors ${
                  newsletterComposeTab === 'compose'
                    ? 'border-[#1a73e8] text-[#1a73e8]'
                    : 'border-transparent text-[#5f6368] hover:text-[#202124]'
                }`}
              >
                Compose
              </button>
              <button
                type="button"
                onClick={() => setNewsletterComposeTab('preview')}
                className={`border-b-2 pb-2.5 pt-2 text-sm font-medium -mb-px transition-colors ${
                  newsletterComposeTab === 'preview'
                    ? 'border-[#1a73e8] text-[#1a73e8]'
                    : 'border-transparent text-[#5f6368] hover:text-[#202124]'
                }`}
              >
                Preview
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {newsletterComposeTab === 'compose' ? (
                <>
                  <div className="flex min-h-[48px] items-stretch border-b border-[#e8eaed]">
                    <span className="flex w-14 shrink-0 items-center pl-3 text-right text-[13px] text-[#5f6368] sm:w-[72px] sm:pl-4">
                      To
                    </span>
                    <select
                      value={newsletterDraft.audience}
                      onChange={(e) =>
                        setNewsletterDraft((d) => ({
                          ...d,
                          audience: e.target.value as 'all' | 'listener' | 'creator' | 'custom',
                        }))
                      }
                      disabled={isQueueingNewsletter}
                      className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent py-3 pr-3 text-[15px] text-[#202124] focus:outline-none focus:ring-0 disabled:opacity-50"
                    >
                      <option value="all">All app users with email</option>
                      <option value="listener">Listeners only</option>
                      <option value="creator">Creators only</option>
                      <option value="custom">Custom email list (paste or import)</option>
                    </select>
                  </div>

                  {newsletterDraft.audience === 'custom' && (
                    <div className="border-b border-[#e8eaed] px-3 py-3 sm:px-4">
                      <label htmlFor="marketing-email-list" className="mb-1.5 block text-xs font-medium text-[#5f6368]">
                        Email addresses (one per line, or comma / semicolon separated)
                      </label>
                      <textarea
                        id="marketing-email-list"
                        value={newsletterDraft.customEmailsRaw}
                        onChange={(e) =>
                          setNewsletterDraft((d) => ({ ...d, customEmailsRaw: e.target.value }))
                        }
                        disabled={isQueueingNewsletter}
                        rows={8}
                        spellCheck={false}
                        className="w-full resize-y rounded border border-[#dadce0] bg-white px-3 py-2 font-mono text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8] disabled:opacity-50"
                        placeholder={'user1@example.com\nuser2@example.com'}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-[#5f6368]">
                        <span>
                          {parsedCustomEmails.valid.length} valid
                          {parsedCustomEmails.invalid.length > 0
                            ? ` · ${parsedCustomEmails.invalid.length} invalid (skipped when queuing)`
                            : ''}
                        </span>
                        <label className="cursor-pointer text-[#1a73e8] hover:underline">
                          Import .txt / .csv
                          <input
                            type="file"
                            accept=".txt,.csv,text/plain,text/csv"
                            className="sr-only"
                            disabled={isQueueingNewsletter}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = () => {
                                const text = typeof reader.result === 'string' ? reader.result : '';
                                setNewsletterDraft((d) => ({
                                  ...d,
                                  customEmailsRaw: d.customEmailsRaw
                                    ? `${d.customEmailsRaw}\n${text}`
                                    : text,
                                }));
                              };
                              reader.readAsText(file);
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="flex min-h-[48px] items-stretch border-b border-[#e8eaed]">
                    <span className="flex w-14 shrink-0 items-center pl-3 text-right text-[13px] text-[#5f6368] sm:w-[72px] sm:pl-4">
                      Subject
                    </span>
                    <input
                      type="text"
                      value={newsletterDraft.title}
                      onChange={(e) => setNewsletterDraft((d) => ({ ...d, title: e.target.value }))}
                      disabled={isQueueingNewsletter}
                      className="min-w-0 flex-1 border-0 bg-transparent py-3 pr-3 text-[15px] text-[#202124] placeholder:text-[#80868b] focus:outline-none focus:ring-0 disabled:opacity-50"
                      placeholder="Email subject"
                      autoComplete="off"
                    />
                  </div>

                  <details className="border-b border-[#e8eaed] [&_summary::-webkit-details-marker]:hidden">
                    <summary className="cursor-pointer list-none py-2.5 pl-3 text-[13px] text-[#1a73e8] hover:underline sm:pl-[84px]">
                      Sending options
                    </summary>
                    <div className="space-y-1.5 px-3 pb-3 sm:pl-[84px] sm:pr-4">
                      <label htmlFor="newsletter-unsub-url" className="block text-xs text-[#5f6368]">
                        Unsubscribe link (footer in each email)
                      </label>
                      <input
                        id="newsletter-unsub-url"
                        type="url"
                        value={newsletterDraft.unsubscribe_url}
                        onChange={(e) => setNewsletterDraft((d) => ({ ...d, unsubscribe_url: e.target.value }))}
                        disabled={isQueueingNewsletter}
                        className="w-full rounded border border-[#dadce0] bg-white px-3 py-2 text-sm text-[#202124] focus:border-[#1a73e8] focus:outline-none focus:ring-1 focus:ring-[#1a73e8] disabled:opacity-50"
                        placeholder="https://airaplay.com/unsubscribe"
                      />
                    </div>
                  </details>

                  <p className="border-b border-[#e8eaed] bg-[#fafafa] px-3 py-2 text-xs leading-relaxed text-[#5f6368] sm:px-4">
                    Uses your ZeptoMail config and the Weekly Newsletter template. Toolbar: insert a CTA button, Google Play badge, App Store badge, or both. Queue adds one send per recipient; click Run email queue (20 per run) until the batch is delivered. Max 5,000 addresses per queue.
                  </p>

                  <div className="flex min-h-[min(52vh,420px)] flex-1 flex-col px-2 pb-2 pt-2 sm:px-3">
                    <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-[#5f6368]">
                      Message
                    </div>
                    <div className="flex min-h-[280px] flex-1 flex-col sm:min-h-[320px]">
                      <HtmlEmailEditor
                        layout="compose"
                        quickInserts
                        value={newsletterDraft.html}
                        disabled={isQueueingNewsletter}
                        onUploadImage={uploadTemplateImage}
                        onChange={(nextHtml) => setNewsletterDraft((d) => ({ ...d, html: nextHtml }))}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex flex-col bg-[#f8f9fa] p-3 sm:p-4">
                  <p className="mb-2 text-xs text-[#5f6368]">
                    Renders with your saved Weekly Newsletter template (header, mint body, footer).
                  </p>
                  <iframe
                    title="Newsletter preview"
                    className="min-h-[min(60vh,480px)] w-full flex-1 rounded border border-[#dadce0] bg-white shadow-sm"
                    sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                    srcDoc={buildNewsletterDraftPreviewHtml()}
                  />
                </div>
              )}

              {newsletterQueueResult && (
                <div className="mx-3 mb-3 rounded border border-green-200 bg-green-50 px-3 py-2.5 sm:mx-4">
                  <p className="text-sm text-green-800">
                    Queued {newsletterQueueResult.queued} message(s).
                    {newsletterQueueResult.skippedInvalid != null && newsletterQueueResult.skippedInvalid > 0
                      ? ` Skipped ${newsletterQueueResult.skippedInvalid} invalid address(es).`
                      : ''}
                    {newsletterQueueResult.cappedAtMax
                      ? ' List was capped at 5,000 per batch — queue again for the remainder.'
                      : ''}{' '}
                    Use Run email queue to send via ZeptoMail (20 per click; repeat until the queue is empty).
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleSaveMarketingDraft()}
                    disabled={isSavingMarketingDraft || isQueueingNewsletter}
                    className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-green-900 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingMarketingDraft ? (
                      <>
                        <LoadingLogo variant="pulse" size={14} />
                        Saving…
                      </>
                    ) : (
                      <>
                        <Bookmark className="h-3.5 w-3.5" />
                        Save as draft for later
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-[#e8eaed] bg-[#f6f8fc] px-3 py-2.5 sm:px-4">
              <button
                type="button"
                onClick={() => {
                  setIsNewsletterComposerOpen(false);
                  setNewsletterQueueResult(null);
                }}
                className="rounded-md px-3 py-2 text-sm font-medium text-[#5f6368] hover:bg-gray-200/70"
              >
                Discard
              </button>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveMarketingDraft()}
                  disabled={isSavingMarketingDraft || isQueueingNewsletter}
                  className="inline-flex items-center gap-2 rounded-md border border-[#dadce0] bg-white px-3 py-2 text-sm font-medium text-[#3c4043] shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                  title="Save subject, body, and audience to reuse later"
                >
                  {isSavingMarketingDraft ? (
                    <>
                      <LoadingLogo variant="pulse" size={16} />
                      Saving…
                    </>
                  ) : (
                    <>
                      <Bookmark className="h-4 w-4" />
                      Save draft
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleRunEmailQueue}
                  disabled={isProcessingQueue}
                  className="inline-flex items-center gap-2 rounded-md border border-[#dadce0] bg-white px-3 py-2 text-sm font-medium text-[#3c4043] shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessingQueue ? (
                    <>
                      <LoadingLogo variant="pulse" size={16} />
                      Running…
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      Run email queue
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleQueueNewsletterBroadcast}
                  disabled={isQueueingNewsletter}
                  className="inline-flex items-center gap-2 rounded-md bg-[#1a73e8] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#1557b0] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isQueueingNewsletter ? (
                    <>
                      <LoadingLogo variant="pulse" size={16} />
                      Queueing…
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Queue
                    </>
                  )}
                </button>
              </div>
            </footer>
          </div>
        </div>
      )}

      {isWeeklyReportOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">Queue Creator Weekly Reports</h3>
                <button
                  onClick={() => {
                    setIsWeeklyReportOpen(false);
                    setWeeklyReportResult(null);
                  }}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>

              <p className="text-sm text-gray-600 mb-4">
                This will enqueue one <span className="font-mono">weekly_report</span> email per creator, then you can run the email queue to deliver them.
                The week is seven UTC calendar days, Friday through Thursday (the next Friday starts the next week). Defaults match that window. A database job also queues the same window every Friday at 10:15 UTC.
              </p>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-2">Start date</label>
                    <input
                      type="date"
                      value={weeklyReportRange.start_date}
                      onChange={(e) => setWeeklyReportRange((prev) => ({ ...prev, start_date: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-gray-700 text-sm font-medium mb-2">End date</label>
                    <input
                      type="date"
                      value={weeklyReportRange.end_date}
                      onChange={(e) => setWeeklyReportRange((prev) => ({ ...prev, end_date: e.target.value }))}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {weeklyReportResult && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-green-700 text-sm">
                      Queued {weeklyReportResult.queued} report(s){weeklyReportResult.date_range ? ` for ${weeklyReportResult.date_range}` : ''}.
                    </p>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      setIsWeeklyReportOpen(false);
                      setWeeklyReportResult(null);
                    }}
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Close
                  </button>
                  <button
                    onClick={handleQueueWeeklyReports}
                    disabled={isQueueingWeeklyReports}
                    className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isQueueingWeeklyReports ? (
                      <>
                        <LoadingLogo variant="pulse" size={16} />
                        Queueing...
                      </>
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        Queue Reports
                      </>
                    )}
                  </button>
                </div>

                <button
                  onClick={handleRunEmailQueue}
                  disabled={isProcessingQueue}
                  className="w-full px-4 py-2 bg-[#309605] hover:bg-[#3ba208] text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  title="Process pending emails now"
                >
                  {isProcessingQueue ? (
                    <>
                      <LoadingLogo variant="pulse" size={16} />
                      Running queue...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4" />
                      Run email queue now
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
