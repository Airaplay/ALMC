import { useState, useEffect } from 'react';
import { Edit, Trash2, ArrowUp, ArrowDown, Eye, EyeOff, AlertTriangle, HelpCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

export const FaqManagementSection = (): JSX.Element => {
  const [faqs, setFaqs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingFaq, setEditingFaq] = useState<any | null>(null);
  const [formData, setFormData] = useState({
    question: '',
    answer: '',
    category: 'general',
    is_active: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [categories, setCategories] = useState<string[]>([]);

  const formatCategoryName = (category: string): string => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const getFilteredFaqs = () => {
    if (categoryFilter === 'all') {
      return faqs;
    }
    return faqs.filter(faq => faq.category === categoryFilter);
  };

  useEffect(() => {
    fetchFaqs();
  }, []);

  useEffect(() => {
    if (editingFaq) {
      setFormData({
        question: editingFaq.question,
        answer: editingFaq.answer,
        category: editingFaq.category,
        is_active: editingFaq.is_active,
      });
    } else {
      resetForm();
    }
  }, [editingFaq]);

  const fetchFaqs = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const { data, error } = await supabase
        .from('faqs')
        .select('*')
        .order('category')
        .order('order_index', { ascending: true });
      
      if (error) throw error;
      
      setFaqs(data || []);

      // Extract unique categories
      const uniqueCategories = Array.from(new Set(data?.map(faq => faq.category) || []));
      setCategories(uniqueCategories);
    } catch (err) {
      console.error('Error fetching FAQs:', err);
      setError('Failed to load FAQs');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      question: '',
      answer: '',
      category: 'general',
      is_active: true,
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: checked,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!formData.question.trim() || !formData.answer.trim()) {
      setError('Question and answer are required');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      if (editingFaq) {
        // Update existing FAQ
        const { error: updateError } = await supabase
          .from('faqs')
          .update({
            question: formData.question.trim(),
            answer: formData.answer.trim(),
            category: formData.category.trim().toLowerCase(),
            is_active: formData.is_active,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingFaq.id);
          
        if (updateError) throw updateError;
      } else {
        // Create new FAQ
        // Get the highest order_index for this category
        const categoryFaqs = faqs.filter(f => f.category === formData.category);
        const maxOrderIndex = categoryFaqs.length > 0 
          ? Math.max(...categoryFaqs.map(f => f.order_index)) 
          : -1;
          
        const { error: insertError } = await supabase
          .from('faqs')
          .insert({
            question: formData.question.trim(),
            answer: formData.answer.trim(),
            category: formData.category.trim().toLowerCase(),
            is_active: formData.is_active,
            order_index: maxOrderIndex + 1,
          });
          
        if (insertError) throw insertError;
      }
      
      // Refresh FAQs list
      await fetchFaqs();
      
      // Reset form
      setEditingFaq(null);
      resetForm();
    } catch (err) {
      console.error('Error saving FAQ:', err);
      setError(err instanceof Error ? err.message : 'Failed to save FAQ');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteFaq = async (faqId: string) => {
    if (!confirm('Are you sure you want to delete this FAQ?')) return;
    
    try {
      const { error } = await supabase
        .from('faqs')
        .delete()
        .eq('id', faqId);
        
      if (error) throw error;
      
      // Refresh FAQs list
      await fetchFaqs();
      
      // If we were editing this FAQ, reset the form
      if (editingFaq?.id === faqId) {
        setEditingFaq(null);
      }
    } catch (err) {
      console.error('Error deleting FAQ:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete FAQ');
    }
  };

  const handleToggleActive = async (faq: any) => {
    try {
      const { error } = await supabase
        .from('faqs')
        .update({ is_active: !faq.is_active })
        .eq('id', faq.id);
        
      if (error) throw error;
      
      // Refresh FAQs list
      await fetchFaqs();
    } catch (err) {
      console.error('Error toggling FAQ active state:', err);
      setError(err instanceof Error ? err.message : 'Failed to update FAQ');
    }
  };

  const handleMoveOrder = async (faqId: string, direction: 'up' | 'down') => {
    // Find the FAQ and its category peers
    const faq = faqs.find(f => f.id === faqId);
    if (!faq) return;
    
    const categoryFaqs = faqs.filter(f => f.category === faq.category)
      .sort((a, b) => a.order_index - b.order_index);
    
    const faqIndex = categoryFaqs.findIndex(f => f.id === faqId);
    if (faqIndex === -1) return;
    
    // Can't move first item up or last item down within its category
    if (
      (direction === 'up' && faqIndex === 0) || 
      (direction === 'down' && faqIndex === categoryFaqs.length - 1)
    ) {
      return;
    }
    
    const targetIndex = direction === 'up' ? faqIndex - 1 : faqIndex + 1;
    const targetFaq = categoryFaqs[targetIndex];
    
    try {
      // Swap order_index values
      const updates = [
        { id: faqId, order_index: targetFaq.order_index },
        { id: targetFaq.id, order_index: faq.order_index }
      ];
      
      // Update each FAQ
      for (const update of updates) {
        const { error } = await supabase
          .from('faqs')
          .update({ order_index: update.order_index })
          .eq('id', update.id);
          
        if (error) throw error;
      }
      
      // Refresh FAQs list
      await fetchFaqs();
    } catch (err) {
      console.error('Error reordering FAQs:', err);
      setError(err instanceof Error ? err.message : 'Failed to reorder FAQs');
    }
  };

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
          <HelpCircle className="w-4 h-4 text-blue-600" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 leading-tight">FAQ Management</h2>
          <p className="text-sm text-gray-400 mt-0.5">Create and manage frequently asked questions</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* FAQ Form */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4">
            {editingFaq ? 'Edit FAQ' : 'Add New FAQ'}
          </h3>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Question */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Question *
              </label>
              <input
                type="text"
                name="question"
                value={formData.question}
                onChange={handleInputChange}
                required
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                placeholder="e.g., How do I upload music?"
              />
            </div>

            {/* Answer */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Answer *
              </label>
              <textarea
                name="answer"
                value={formData.answer}
                onChange={handleInputChange}
                required
                rows={5}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605] resize-none"
                placeholder="Provide a detailed answer..."
              />
            </div>

            {/* Category */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Category
              </label>
              <div className="flex gap-2">
                <select
                  name="category"
                  value={formData.category}
                  onChange={handleInputChange}
                  className="flex-1 px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                >
                  <option value="general">General</option>
                  <option value="uploading">Uploading</option>
                  <option value="earnings">Earnings</option>
                  <option value="technical">Technical</option>
                  <option value="verification">Verification</option>
                  <option value="privacy">Privacy</option>
                  {/* Add any custom categories that exist but aren't in the default list */}
                  {categories
                    .filter(cat => !['general', 'uploading', 'earnings', 'technical', 'verification', 'privacy'].includes(cat))
                    .map(cat => (
                      <option key={cat} value={cat}>{formatCategoryName(cat)}</option>
                    ))
                  }
                </select>
                {/* Could add a custom category input here in the future */}
              </div>
            </div>

            {/* Active Status */}
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="is_active"
                name="is_active"
                checked={formData.is_active}
                onChange={handleCheckboxChange}
                className="w-4 h-4 rounded border-gray-300 bg-white text-[#309605] focus:ring-[#309605]/50"
              />
              <label htmlFor="is_active" className="text-gray-700 text-sm">
                Active (visible to users)
              </label>
            </div>

            {error && (
              <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setEditingFaq(null);
                  resetForm();
                }}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
              >
                {editingFaq ? 'Cancel' : 'Reset'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || !formData.question.trim() || !formData.answer.trim()}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-all duration-200"
              >
                {isSubmitting ? 'Saving...' : (editingFaq ? 'Update FAQ' : 'Add FAQ')}
              </button>
            </div>
          </form>
        </div>

        {/* FAQs List */}
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold text-gray-900">
              Current FAQs
            </h3>
            
            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-3 py-1 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-[#309605]"
            >
              <option value="all">All Categories</option>
              {categories.map(category => (
                <option key={category} value={category}>
                  {formatCategoryName(category)}
                </option>
              ))}
            </select>
          </div>
          
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingLogo variant="pulse" size={32} />
              <p className="ml-4 text-gray-700">Loading FAQs...</p>
            </div>
          ) : error && faqs.length === 0 ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{error}</p>
              <button
                onClick={fetchFaqs}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
              >
                Try Again
              </button>
            </div>
          ) : getFilteredFaqs().length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">
                {categoryFilter === 'all' 
                  ? 'No FAQs found. Create your first FAQ to help users.' 
                  : `No FAQs found in the "${formatCategoryName(categoryFilter)}" category.`}
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
              {getFilteredFaqs().map((faq) => (
                <div
                  key={faq.id}
                  className={`p-4 bg-white rounded-lg border ${
                    faq.is_active ? 'border-gray-200' : 'border-red-200'
                  } hover:bg-gray-50 transition-all duration-300 shadow`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-1">
                      <HelpCircle className="w-4 h-4 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-gray-900 text-base">
                        {faq.question}
                      </h4>
                      <p className="text-gray-700 text-sm mt-1 line-clamp-2">
                        {faq.answer}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          faq.is_active 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {faq.is_active ? 'Active' : 'Inactive'}
                        </span>
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                          {formatCategoryName(faq.category)}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <button
                        onClick={() => handleMoveOrder(faq.id, 'up')}
                        className="p-1 hover:bg-gray-100 rounded transition-colors duration-200"
                      >
                        <ArrowUp className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={() => handleMoveOrder(faq.id, 'down')}
                        className="p-1 hover:bg-gray-100 rounded transition-colors duration-200"
                      >
                        <ArrowDown className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(faq)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors duration-200"
                      >
                        {faq.is_active ? (
                          <EyeOff className="w-4 h-4 text-gray-600" />
                        ) : (
                          <Eye className="w-4 h-4 text-gray-600" />
                        )}
                      </button>
                      <button
                        onClick={() => setEditingFaq(faq)}
                        className="p-1 hover:bg-gray-100 rounded transition-colors duration-200"
                      >
                        <Edit className="w-4 h-4 text-gray-600" />
                      </button>
                      <button
                        onClick={() => handleDeleteFaq(faq.id)}
                        className="p-1 hover:bg-red-100 rounded transition-colors duration-200"
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};