import { useState, useEffect } from 'react';
import {
  Bell,
  Send,
  Calendar,
  Globe,
  Users,
  User,
  Link as LinkIcon,
  Image,
  Trash2,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Search,
  Mail
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';
import { LoadingLogo } from '../../components/LoadingLogo';
import { EmailManagementTab } from './EmailManagementTab';

interface Announcement {
  id: string;
  title: string;
  message: string;
  link_url: string | null;
  embedded_media_url: string | null;
  target_type: 'all' | 'listener' | 'creator' | 'country';
  target_country_code: string | null;
  scheduled_at: string | null;
  sent_at: string | null;
  status: 'draft' | 'scheduled' | 'sent' | 'failed';
  created_at: string;
  created_by: string;
  admin_name: string | null;
  target_count: string; // Changed from number to string to handle bigint
}

export const AnnouncementsSection = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<'notifications' | 'emails'>('notifications');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [countries, setCountries] = useState<string[]>([]);
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    message: '',
    link_url: '',
    embedded_media_url: '',
    target_type: 'all' as 'all' | 'listener' | 'creator' | 'country',
    target_country_code: '',
    scheduled_at: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    fetchAnnouncements();
    fetchCountries();
  }, [statusFilter]);

  const fetchAnnouncements = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error } = await supabase.rpc('admin_get_announcements', {
        status_filter: statusFilter === 'all' ? null : statusFilter,
        limit_param: 100,
        offset_param: 0
      });

      if (error) throw error;
      
      setAnnouncements(data || []);
    } catch (err) {
      console.error('Error fetching announcements:', err);
      setError('Failed to load announcements');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCountries = async () => {
    try {
      // Get unique countries from users table
      const { data, error } = await supabase
        .from('users')
        .select('country')
        .not('country', 'is', null)
        .order('country');

      if (error) throw error;
      
      // Extract unique countries
      const uniqueCountries = Array.from(new Set(data.map(item => item.country).filter(Boolean)));
      setCountries(uniqueCountries);
    } catch (err) {
      console.error('Error fetching countries:', err);
      // Don't set error state to avoid blocking the UI
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    
    // Validate form
    if (!formData.title.trim()) {
      setFormError('Title is required');
      return;
    }
    
    if (!formData.message.trim()) {
      setFormError('Message is required');
      return;
    }
    
    if (formData.target_type === 'country' && !formData.target_country_code) {
      setFormError('Country is required when targeting by country');
      return;
    }
    
    setIsSubmitting(true);
    
    try {
      // Convert scheduled_at to ISO string if provided
      const scheduledAt = formData.scheduled_at 
        ? new Date(formData.scheduled_at).toISOString() 
        : null;
      
      // Call the admin_create_announcement function
      const { data, error } = await supabase.rpc('admin_create_announcement', {
        title_param: formData.title,
        message_param: formData.message,
        target_type_param: formData.target_type,
        target_country_code_param: formData.target_type === 'country' ? formData.target_country_code : null,
        link_url_param: formData.link_url || null,
        embedded_media_url_param: formData.embedded_media_url || null,
        scheduled_at_param: scheduledAt
      });

      if (error) throw error;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Reset form
      setFormData({
        title: '',
        message: '',
        link_url: '',
        embedded_media_url: '',
        target_type: 'all',
        target_country_code: '',
        scheduled_at: '',
      });
      
      setFormSuccess(data.message || 'Announcement created successfully');
      
      // Refresh announcements list
      fetchAnnouncements();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setFormSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error creating announcement:', err);
      setFormError(err instanceof Error ? err.message : 'Failed to create announcement');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!confirm('Are you sure you want to delete this announcement?')) return;
    
    setIsDeleting(id);
    
    try {
      const { data, error } = await supabase.rpc('admin_delete_announcement', {
        announcement_id_param: id
      });

      if (error) throw error;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Refresh announcements list
      fetchAnnouncements();
    } catch (err) {
      console.error('Error deleting announcement:', err);
      alert('Failed to delete announcement: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSendNow = async (id: string) => {
    if (!confirm('Are you sure you want to send this announcement now?')) return;
    
    setIsDeleting(id); // Reuse the isDeleting state for loading indicator
    
    try {
      const { data, error } = await supabase.rpc('admin_send_announcement', {
        announcement_id_param: id
      });

      if (error) throw error;
      
      if (data.error) {
        throw new Error(data.error);
      }
      
      // Refresh announcements list
      fetchAnnouncements();
    } catch (err) {
      console.error('Error sending announcement:', err);
      alert('Failed to send announcement: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsDeleting(null);
    }
  };

  const processScheduledAnnouncements = async () => {
    try {
      const { data, error } = await supabase.rpc('process_scheduled_announcements');

      if (error) throw error;
      
      // Refresh announcements list
      fetchAnnouncements();
      
      alert(`Processed ${data} scheduled announcement(s)`);
    } catch (err) {
      console.error('Error processing scheduled announcements:', err);
      alert('Failed to process scheduled announcements: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const formatDate = (dateString: string | null): string => {
    if (!dateString) return 'N/A';
    
    try {
      const date = new Date(dateString);
      return format(date, 'MMM d, yyyy h:mm a');
    } catch (err) {
      console.error('Error formatting date:', err);
      return 'Invalid date';
    }
  };

  const getTargetTypeLabel = (targetType: string, countryCode?: string | null): string => {
    switch (targetType) {
      case 'all': return 'All Users';
      case 'listener': return 'Listeners Only';
      case 'creator': return 'Artists Only';
      case 'country': return countryCode ? `Country: ${countryCode}` : 'Country';
      default: return targetType;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700 border-gray-200';
      case 'scheduled': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'sent': return 'bg-green-100 text-green-700 border-green-200';
      case 'failed': return 'bg-red-100 text-red-700 border-red-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getFilteredAnnouncements = () => {
    if (!searchQuery.trim()) return announcements;
    
    const query = searchQuery.toLowerCase();
    return announcements.filter(announcement => 
      announcement.title.toLowerCase().includes(query) ||
      announcement.message.toLowerCase().includes(query) ||
      (announcement.target_country_code && announcement.target_country_code.toLowerCase().includes(query))
    );
  };

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Bell className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Announcements & Emails</h2>
            <p className="text-sm text-gray-400 mt-0.5">Create platform announcements and manage email communications</p>
          </div>
        </div>

        <div>
          {activeTab === 'notifications' && (
            <button
              onClick={processScheduledAnnouncements}
              className="flex items-center gap-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors duration-200"
              title="Process scheduled announcements"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Process Scheduled</span>
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('notifications')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'notifications'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4" />
              Push Notifications
            </div>
          </button>
          <button
            onClick={() => setActiveTab('emails')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'emails'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Mail className="w-4 h-4" />
              Emails (ZeptoMail)
            </div>
          </button>
        </nav>
      </div>

      {/* Notifications Tab Content */}
      {activeTab === 'notifications' && (
      <div className="grid grid-cols-2 gap-6">
        {/* Create Announcement Form */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Create New Announcement
          </h3>
          
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Title */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Title *
              </label>
              <input
                type="text"
                name="title"
                value={formData.title}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Announcement title"
              />
            </div>

            {/* Message */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Message *
              </label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleInputChange}
                rows={4}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Announcement message"
              />
            </div>

            {/* Link URL */}
            <div>
              <label className="flex items-center gap-2 text-gray-700 text-sm font-medium mb-2">
                <LinkIcon className="w-4 h-4" />
                Link URL (Optional)
              </label>
              <input
                type="url"
                name="link_url"
                value={formData.link_url}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com"
              />
            </div>

            {/* Embedded Media URL */}
            <div>
              <label className="flex items-center gap-2 text-gray-700 text-sm font-medium mb-2">
                <Image className="w-4 h-4" />
                Embedded Media URL (Optional)
              </label>
              <input
                type="url"
                name="embedded_media_url"
                value={formData.embedded_media_url}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/image.jpg"
              />
            </div>

            {/* Target Type */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Target Audience *
              </label>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="target_type"
                    value="all"
                    checked={formData.target_type === 'all'}
                    onChange={handleInputChange}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border ${
                    formData.target_type === 'all' ? 'border-blue-500 bg-blue-500' : 'border-gray-400'
                  } mr-2 flex items-center justify-center`}>
                    {formData.target_type === 'all' && (
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-gray-600" />
                    <span className="text-sm">All Users</span>
                  </div>
                </label>
                
                <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="target_type"
                    value="listener"
                    checked={formData.target_type === 'listener'}
                    onChange={handleInputChange}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border ${
                    formData.target_type === 'listener' ? 'border-blue-500 bg-blue-500' : 'border-gray-400'
                  } mr-2 flex items-center justify-center`}>
                    {formData.target_type === 'listener' && (
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-600" />
                    <span className="text-sm">Listeners Only</span>
                  </div>
                </label>
                
                <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="target_type"
                    value="creator"
                    checked={formData.target_type === 'creator'}
                    onChange={handleInputChange}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border ${
                    formData.target_type === 'creator' ? 'border-blue-500 bg-blue-500' : 'border-gray-400'
                  } mr-2 flex items-center justify-center`}>
                    {formData.target_type === 'creator' && (
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-gray-600" />
                    <span className="text-sm">Artists Only</span>
                  </div>
                </label>
                
                <label className="flex items-center p-3 bg-white border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="target_type"
                    value="country"
                    checked={formData.target_type === 'country'}
                    onChange={handleInputChange}
                    className="sr-only"
                  />
                  <div className={`w-4 h-4 rounded-full border ${
                    formData.target_type === 'country' ? 'border-blue-500 bg-blue-500' : 'border-gray-400'
                  } mr-2 flex items-center justify-center`}>
                    {formData.target_type === 'country' && (
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Globe className="w-4 h-4 text-gray-600" />
                    <span className="text-sm">By Country</span>
                  </div>
                </label>
              </div>
              
              {/* Country Dropdown (only show if target_type is 'country') */}
              {formData.target_type === 'country' && (
                <div>
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Select Country *
                  </label>
                  <select
                    name="target_country_code"
                    value={formData.target_country_code}
                    onChange={handleInputChange}
                    className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required={formData.target_type === 'country'}
                  >
                    <option value="">Select a country</option>
                    {countries.map(country => (
                      <option key={country} value={country}>
                        {country}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Schedule */}
            <div>
              <label className="flex items-center gap-2 text-gray-700 text-sm font-medium mb-2">
                <Calendar className="w-4 h-4" />
                Schedule Delivery (Optional)
              </label>
              <input
                type="datetime-local"
                name="scheduled_at"
                value={formData.scheduled_at}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                Leave empty to send immediately
              </p>
            </div>

            {formError && (
              <div className="p-3 bg-red-100 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">{formError}</p>
              </div>
            )}

            {formSuccess && (
              <div className="p-3 bg-green-100 border border-green-200 rounded-lg">
                <p className="text-green-700 text-sm">{formSuccess}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <LoadingLogo variant="pulse" size={20} />
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  <span>{formData.scheduled_at ? 'Schedule Announcement' : 'Send Announcement'}</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Announcements List */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-600" />
            Announcements
          </h3>
          
          {/* Search and Filter */}
          <div className="flex flex-col md:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="text"
                placeholder="Search announcements..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="scheduled">Scheduled</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          
          {/* Announcements Table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              {null}
              <p className="ml-4 text-gray-700">Loading announcements...</p>
            </div>
          ) : error ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{error}</p>
              <button
                onClick={fetchAnnouncements}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
              >
                Try Again
              </button>
            </div>
          ) : getFilteredAnnouncements().length === 0 ? (
            <div className="p-6 bg-gray-100 rounded-lg text-center">
              <p className="text-gray-700">
                {searchQuery 
                  ? 'No announcements found matching your search' 
                  : statusFilter !== 'all' 
                    ? `No announcements with status "${statusFilter}"` 
                    : 'No announcements found'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-gray-100 text-left">
                    <th className="p-3 text-gray-700 font-medium">Title</th>
                    <th className="p-3 text-gray-700 font-medium">Target</th>
                    <th className="p-3 text-gray-700 font-medium">Status</th>
                    <th className="p-3 text-gray-700 font-medium">Date</th>
                    <th className="p-3 text-gray-700 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {getFilteredAnnouncements().map((announcement) => (
                    <tr key={announcement.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="p-3">
                        <div className="font-medium text-gray-900">{announcement.title}</div>
                        <div className="text-sm text-gray-600 truncate max-w-[200px]">{announcement.message}</div>
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-1">
                          {announcement.target_type === 'all' && <Users className="w-4 h-4 text-gray-600" />}
                          {announcement.target_type === 'listener' && <User className="w-4 h-4 text-gray-600" />}
                          {announcement.target_type === 'creator' && <User className="w-4 h-4 text-gray-600" />}
                          {announcement.target_type === 'country' && <Globe className="w-4 h-4 text-gray-600" />}
                          <span className="text-gray-700">
                            {getTargetTypeLabel(announcement.target_type, announcement.target_country_code)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          {announcement.target_count} recipients
                        </div>
                      </td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs border ${getStatusBadgeClass(announcement.status)}`}>
                          {announcement.status.charAt(0).toUpperCase() + announcement.status.slice(1)}
                        </span>
                      </td>
                      <td className="p-3">
                        {announcement.status === 'scheduled' ? (
                          <div className="flex items-center gap-1 text-blue-600">
                            <Calendar className="w-4 h-4" />
                            <span className="text-sm">{formatDate(announcement.scheduled_at)}</span>
                          </div>
                        ) : announcement.status === 'sent' ? (
                          <div className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-sm">{formatDate(announcement.sent_at)}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-gray-600">
                            <Calendar className="w-4 h-4" />
                            <span className="text-sm">{formatDate(announcement.created_at)}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          {announcement.status === 'scheduled' && (
                            <button
                              onClick={() => handleSendNow(announcement.id)}
                              disabled={isDeleting === announcement.id}
                              className="p-2 bg-blue-100 hover:bg-blue-200 rounded-lg text-blue-700 transition-colors duration-200 disabled:opacity-50"
                              title="Send Now"
                            >
                              {isDeleting === announcement.id ? (
                                <LoadingLogo variant="pulse" size={16} />
                              ) : (
                                <Send className="w-4 h-4" />
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteAnnouncement(announcement.id)}
                            disabled={isDeleting === announcement.id}
                            className="p-2 bg-red-100 hover:bg-red-200 rounded-lg text-red-700 transition-colors duration-200 disabled:opacity-50"
                            title="Delete"
                          >
                            {isDeleting === announcement.id ? (
                              <LoadingLogo variant="pulse" size={16} />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      )}

      {/* Emails Tab Content */}
      {activeTab === 'emails' && (
        <EmailManagementTab />
      )}
    </div>
  );
};