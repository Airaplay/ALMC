import React, { useState, useEffect } from 'react';
import { X, HelpCircle, Mail, ChevronDown, ChevronUp, MessageCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface HelpSupportModalProps {
  onClose: () => void;
}

interface FAQ {
  id: string;
  question: string;
  answer: string;
  category: string;
  order_index: number;
}

export const HelpSupportModal: React.FC<HelpSupportModalProps> = ({
  onClose,
}) => {
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFAQ, setExpandedFAQ] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [showContactForm, setShowContactForm] = useState(false);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState('general');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submittedTicketNumber, setSubmittedTicketNumber] = useState<string | null>(null);

  useEffect(() => {
    fetchFAQs();
  }, []);

  const fetchFAQs = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: faqError } = await supabase.rpc('get_faqs_by_category');

      if (faqError) {
        throw new Error(`Failed to fetch FAQs: ${faqError.message}`);
      }

      setFaqs(data || []);
    } catch (err) {
      console.error('Error fetching FAQs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load FAQs');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleFAQ = (faqId: string) => {
    setExpandedFAQ(expandedFAQ === faqId ? null : faqId);
  };

  const getCategories = () => {
    const categories = Array.from(new Set(faqs.map(faq => faq.category)));
    return ['all', ...categories];
  };

  const getFilteredFAQs = () => {
    if (activeCategory === 'all') return faqs;
    return faqs.filter(faq => faq.category === activeCategory);
  };

  const formatCategoryName = (category: string): string => {
    if (category === 'all') return 'All';
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  // Confirmation email is enqueued by the create_support_ticket RPC and delivered
  // by the scheduled email-queue drain. We deliberately do NOT call
  // `process-email-queue` here — that endpoint is admin-only, and exposing it to
  // unauthenticated/regular users would let any caller flush the entire queue.

  const handleSubmitTicket = async () => {
    if (!subject.trim() || !message.trim()) {
      setError('Please fill in all fields');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const { data, error: submitError } = await supabase.rpc('create_support_ticket', {
        p_subject: subject.trim(),
        p_message: message.trim(),
        p_category: category
      });

      if (submitError) throw submitError;

      const result = data as { ticket_number?: string } | null;
      setSubmittedTicketNumber(result?.ticket_number || null);
      setSubmitSuccess(true);
      setSubject('');
      setMessage('');
      setCategory('general');

      setTimeout(() => {
        setSubmitSuccess(false);
        setSubmittedTicketNumber(null);
        setShowContactForm(false);
      }, 3000);
    } catch (err: any) {
      console.error('Error submitting ticket:', err);
      setError(err.message || 'Failed to submit support ticket');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] rounded-3xl border border-white/10 shadow-2xl">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm p-5 border-b border-white/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-blue-500/20 rounded-xl flex items-center justify-center">
                <HelpCircle className="w-6 h-6 text-blue-400" />
              </div>
              <h2 className="font-bold text-white text-xl">
                Help & Support
              </h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-all"
            >
              <X className="w-6 h-6 text-white/80" />
            </button>
          </div>
        </div>

        <div className="p-5 pb-24 space-y-6">
          {/* Contact Support Card */}
          <div className="rounded-2xl overflow-hidden bg-white/5 border border-white/10 p-5">
            {!showContactForm ? (
              <>
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center shadow-xl">
                    <Mail className="w-7 h-7 text-black" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-bold text-white text-base mb-1">
                      Need Help?
                    </h3>
                    <p className="text-white/80 text-sm">
                      Submit a support ticket
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowContactForm(true)}
                  className="w-full h-12 bg-white hover:bg-white/90 rounded-xl font-medium text-black transition-all duration-200 shadow-lg flex items-center justify-center gap-2"
                >
                  <MessageCircle className="w-5 h-5" />
                  Contact Support
                </button>
                <p className="text-white/60 text-xs text-center mt-3">
                  We&apos;ll respond within 24 hours
                </p>
              </>
            ) : (
              <div className="space-y-4">
                <h3 className="font-bold text-white text-base">Submit Support Ticket</h3>

                {submitSuccess && (
                  <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg">
                    <p className="text-green-400 text-sm">
                      Support ticket submitted successfully!
                      {submittedTicketNumber ? ` Ticket number: ${submittedTicketNumber}.` : ''}
                      {' '}Check your email for the confirmation.
                    </p>
                  </div>
                )}

                {error && (
                  <div className="p-3 bg-red-500/20 border border-red-500/30 rounded-lg">
                    <p className="text-red-400 text-sm">{error}</p>
                  </div>
                )}

                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  >
                    <option value="general" className="bg-gray-900">General</option>
                    <option value="account" className="bg-gray-900">Account</option>
                    <option value="payment" className="bg-gray-900">Payment</option>
                    <option value="technical" className="bg-gray-900">Technical</option>
                    <option value="content" className="bg-gray-900">Content</option>
                  </select>
                </div>

                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                    placeholder="Brief description of your issue"
                  />
                </div>

                <div>
                  <label className="block text-white/80 text-sm font-medium mb-2">Message</label>
                  <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-xl text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                    placeholder="Please describe your issue in detail..."
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowContactForm(false);
                      setError(null);
                      setSubject('');
                      setMessage('');
                      setSubmittedTicketNumber(null);
                    }}
                    className="flex-1 h-11 bg-white/10 hover:bg-white/20 rounded-xl font-medium text-white transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitTicket}
                    disabled={isSubmitting || submitSuccess}
                    className="flex-1 h-11 bg-white hover:bg-white/90 rounded-xl font-medium text-black transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? 'Submitting...' : submitSuccess ? 'Submitted!' : 'Submit'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* FAQ Section */}
          <div>
            <h3 className="font-bold text-white text-base mb-4">
              Frequently Asked Questions
            </h3>

            {/* Category Filter */}
            {getCategories().length > 1 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {getCategories().map((category) => (
                  <button
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    className={`px-3 py-1.5 rounded-full transition-all duration-200 font-medium text-xs ${
                      activeCategory === category
                        ? 'bg-white text-black'
                        : 'bg-white/10 text-white/80 hover:bg-white/20'
                    }`}
                  >
                    {formatCategoryName(category)}
                  </button>
                ))}
              </div>
            )}

            {/* FAQ Content */}
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-[#309605] border-t-transparent rounded-full animate-spin mb-3"></div>
                <p className="text-white/70 text-sm">
                  Loading FAQs...
                </p>
              </div>
            ) : error ? (
              <div className="rounded-xl bg-red-500/20 border border-red-500/30 p-6 text-center">
                <p className="text-red-400 text-sm mb-4">
                  {error}
                </p>
                <button
                  onClick={fetchFAQs}
                  className="px-6 py-2 bg-red-600 hover:bg-red-700 rounded-xl font-medium text-white transition-all duration-200"
                >
                  Try Again
                </button>
              </div>
            ) : getFilteredFAQs().length === 0 ? (
              <div className="rounded-xl bg-white/5 border border-white/10 p-8 text-center">
                <div className="w-16 h-16 bg-white/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <HelpCircle className="w-8 h-8 text-white/60" />
                </div>
                <h4 className="font-semibold text-white text-base mb-2">
                  No FAQs Available
                </h4>
                <p className="text-white/70 text-sm">
                  {activeCategory === 'all'
                    ? 'No frequently asked questions are available at the moment.'
                    : `No FAQs found for the ${formatCategoryName(activeCategory)} category.`
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {getFilteredFAQs().map((faq) => (
                  <div
                    key={faq.id}
                    className="rounded-xl bg-white/5 border border-white/10 overflow-hidden hover:bg-white/10 transition-all duration-300"
                  >
                    <button
                      onClick={() => toggleFAQ(faq.id)}
                      className="w-full p-4 text-left flex items-center justify-between hover:bg-white/5 transition-all"
                    >
                      <h4 className="font-medium text-white text-sm pr-4 flex-1">
                        {faq.question}
                      </h4>
                      {expandedFAQ === faq.id ? (
                        <ChevronUp className="w-5 h-5 text-white/60 flex-shrink-0" />
                      ) : (
                        <ChevronDown className="w-5 h-5 text-white/60 flex-shrink-0" />
                      )}
                    </button>
                    {expandedFAQ === faq.id && (
                      <div className="px-4 pb-4 border-t border-white/10">
                        <p className="text-white/80 text-sm leading-relaxed pt-4">
                          {faq.answer}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Additional Resources */}
          <div className="rounded-xl bg-white/5 border border-white/10 p-5">
            <h4 className="font-semibold text-white text-sm mb-4">
              Additional Resources
            </h4>
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 bg-[#309605] rounded-full mt-2 flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-white/90 text-sm font-medium mb-0.5">
                    Community Guidelines
                  </p>
                  <p className="text-white/60 text-xs">
                    Learn about our community standards and content policies
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 bg-[#309605] rounded-full mt-2 flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-white/90 text-sm font-medium mb-0.5">
                    Artist Resources
                  </p>
                  <p className="text-white/60 text-xs">
                    Tips and best practices for growing your music career
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 bg-[#309605] rounded-full mt-2 flex-shrink-0"></div>
                <div className="flex-1">
                  <p className="text-white/90 text-sm font-medium mb-0.5">
                    Technical Support
                  </p>
                  <p className="text-white/60 text-xs">
                    Troubleshooting guides for common technical issues
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};