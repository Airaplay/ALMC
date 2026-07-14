import { useState, useEffect } from 'react';
import {
  Image,
  Plus,
  Edit,
  Trash2,
  X,
  Upload,
  Link as LinkIcon,
  Eye, 
  AlertTriangle,
  RefreshCw,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface Banner {
  id: string;
  title: string | null;
  subtitle: string;
  image_url: string;
  gradient_from: string;
  gradient_to: string;
  url: string | null;
  order_index: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const FeatureBannerSection = (): JSX.Element => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [formData, setFormData] = useState({
    title: '',
    subtitle: '',
    url: '',
    gradient_from: 'from-blue-600',
    gradient_to: 'to-purple-600',
    is_active: true
  });

  // Cleanup effect for blob URLs
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    fetchBanners();
  }, []);

  useEffect(() => {
    if (editingBanner) {
      setFormData({
        title: editingBanner.title || '',
        subtitle: editingBanner.subtitle || '',
        url: editingBanner.url || '',
        gradient_from: editingBanner.gradient_from || 'from-blue-600',
        gradient_to: editingBanner.gradient_to || 'to-purple-600',
        is_active: editingBanner.is_active
      });
      setPreviewUrl(editingBanner.image_url);
      setSelectedFile(null);
    } else {
      resetForm();
    }
  }, [editingBanner]);

  const fetchBanners = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error } = await supabase
        .from('banners')
        .select('*')
        .order('order_index', { ascending: true });

      if (error) throw error;
      
      setBanners(data || []);
    } catch (err) {
      console.error('Error fetching banners:', err);
      setError('Failed to load banners');
    } finally {
      setIsLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      title: '',
      subtitle: '',
      url: '',
      gradient_from: 'from-blue-600',
      gradient_to: 'to-purple-600',
      is_active: true
    });
    setSelectedFile(null);
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    
    // Reset file input
    const fileInput = document.getElementById('banner-image-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setError('Please select a valid image file (JPEG, PNG, or WebP)');
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setError('Image size must be less than 10MB');
        return;
      }

      setSelectedFile(file);
      setError(null);

      // Clean up previous preview URL
      if (previewUrl && previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(previewUrl);
      }

      // Create preview URL
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }
  };

  const removeSelectedFile = () => {
    setSelectedFile(null);
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    
    // If editing, keep the original image URL
    if (editingBanner) {
      setPreviewUrl(editingBanner.image_url);
    } else {
      setPreviewUrl(null);
    }
    
    // Reset file input
    const fileInput = document.getElementById('banner-image-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const uploadBannerImage = async (userId: string): Promise<string | null> => {
    if (!selectedFile) {
      // If editing and no new file selected, return existing URL
      if (editingBanner) {
        return editingBanner.image_url;
      }
      return null;
    }

    try {
      const { validateImageFile, getValidatedExtension, sanitizeFileName, ALLOWED_IMAGE_EXTENSIONS } = await import('../../lib/fileSecurity');
      const validation = validateImageFile(selectedFile);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid banner image file');
      }
      const fileExt = getValidatedExtension(selectedFile.name, ALLOWED_IMAGE_EXTENSIONS);
      if (!fileExt) {
        throw new Error('Invalid file extension. Allowed: jpg, jpeg, png, webp, gif');
      }
      const sanitizedFileName = sanitizeFileName(selectedFile.name);
      const fileName = `${userId}/banners/banner-${Date.now()}.${fileExt}`;

      const { data: _uploadData, error: uploadError } = await supabase.storage
        .from('banners')
        .upload(fileName, selectedFile, {
          cacheControl: '3600',
          upsert: false,
          duplex: 'half'
        });

      if (uploadError) {
        throw new Error(`Upload failed: ${uploadError.message}`);
      }

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('banners')
        .getPublicUrl(fileName);

      return publicUrl;
    } catch (err) {
      console.error('Error uploading banner image:', err);
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    // Validation

    if (!selectedFile && !editingBanner) {
      setError('Banner image is required');
      return;
    }

    // Validate URL if provided
    if (formData.url && formData.url.trim()) {
      try {
        new URL(formData.url);
      } catch {
        setError('Please enter a valid URL');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      // Verify authentication
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError || !session) {
        throw new Error('Authentication session expired. Please sign in again.');
      }

      const userId = session.user.id;

      // Upload image
      const imageUrl = await uploadBannerImage(userId);
      
      if (!imageUrl) {
        throw new Error('Failed to upload banner image');
      }

      if (editingBanner) {
        // Update existing banner
        const { error: updateError } = await supabase
          .from('banners')
          .update({
            title: formData.title.trim() || null,
            subtitle: formData.subtitle.trim(),
            image_url: imageUrl,
            gradient_from: formData.gradient_from,
            gradient_to: formData.gradient_to,
            url: formData.url.trim() || null,
            is_active: formData.is_active,
            updated_at: new Date().toISOString()
          })
          .eq('id', editingBanner.id);

        if (updateError) {
          throw new Error(`Failed to update banner: ${updateError.message}`);
        }

        setSuccess('Banner updated successfully');
      } else {
        // Create new banner
        // Get the next order index
        const maxOrderIndex = banners.length > 0 
          ? Math.max(...banners.map(b => b.order_index)) 
          : -1;

        const { error: insertError } = await supabase
          .from('banners')
          .insert({
            title: formData.title.trim() || null,
            subtitle: formData.subtitle.trim(),
            image_url: imageUrl,
            gradient_from: formData.gradient_from,
            gradient_to: formData.gradient_to,
            url: formData.url.trim() || null,
            order_index: maxOrderIndex + 1,
            is_active: formData.is_active
          });

        if (insertError) {
          throw new Error(`Failed to create banner: ${insertError.message}`);
        }

        setSuccess('Banner created successfully');
      }

      // Reset form and refresh banners
      setShowForm(false);
      setEditingBanner(null);
      resetForm();
      await fetchBanners();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error saving banner:', err);
      setError(err instanceof Error ? err.message : 'Failed to save banner');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteBanner = async (bannerId: string) => {
    if (!confirm('Are you sure you want to delete this banner? This action cannot be undone.')) {
      return;
    }

    try {
      setIsDeleting(bannerId);
      setError(null);
      setSuccess(null);

      const { error } = await supabase
        .from('banners')
        .delete()
        .eq('id', bannerId);

      if (error) {
        throw new Error(`Failed to delete banner: ${error.message}`);
      }

      setSuccess('Banner deleted successfully');
      
      // Refresh banners
      await fetchBanners();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error deleting banner:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete banner');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleToggleActive = async (banner: Banner) => {
    try {
      const { error } = await supabase
        .from('banners')
        .update({ 
          is_active: !banner.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', banner.id);

      if (error) {
        throw new Error(`Failed to update banner status: ${error.message}`);
      }

      // Update local state
      setBanners(banners.map(b => 
        b.id === banner.id 
          ? { ...b, is_active: !banner.is_active } 
          : b
      ));
      
      setSuccess(`Banner ${!banner.is_active ? 'activated' : 'deactivated'} successfully`);
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
    } catch (err) {
      console.error('Error toggling banner status:', err);
      setError(err instanceof Error ? err.message : 'Failed to update banner status');
    }
  };

  const handleMoveOrder = async (bannerId: string, direction: 'up' | 'down') => {
    const bannerIndex = banners.findIndex(b => b.id === bannerId);
    if (bannerIndex === -1) return;
    
    // Can't move first item up or last item down
    if (
      (direction === 'up' && bannerIndex === 0) || 
      (direction === 'down' && bannerIndex === banners.length - 1)
    ) {
      return;
    }
    
    const targetIndex = direction === 'up' ? bannerIndex - 1 : bannerIndex + 1;
    const banner = banners[bannerIndex];
    const targetBanner = banners[targetIndex];
    
    try {
      // Swap order_index values
      const updates = [
        { id: bannerId, order_index: targetBanner.order_index },
        { id: targetBanner.id, order_index: banner.order_index }
      ];
      
      // Update each banner
      for (const update of updates) {
        const { error } = await supabase
          .from('banners')
          .update({ 
            order_index: update.order_index,
            updated_at: new Date().toISOString()
          })
          .eq('id', update.id);
          
        if (error) throw error;
      }
      
      // Refresh banners list
      await fetchBanners();
    } catch (err) {
      console.error('Error reordering banners:', err);
      setError('Failed to reorder banners');
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatFileSize = (bytes: number): string => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const gradientOptions = [
    { value: 'from-blue-600', label: 'Blue', preview: 'bg-gradient-to-r from-blue-600 to-blue-800' },
    { value: 'from-purple-600', label: 'Purple', preview: 'bg-gradient-to-r from-purple-600 to-purple-800' },
    { value: 'from-green-600', label: 'Green', preview: 'bg-gradient-to-r from-green-600 to-green-800' },
    { value: 'from-red-600', label: 'Red', preview: 'bg-gradient-to-r from-red-600 to-red-800' },
    { value: 'from-yellow-600', label: 'Yellow', preview: 'bg-gradient-to-r from-yellow-600 to-yellow-800' },
    { value: 'from-pink-600', label: 'Pink', preview: 'bg-gradient-to-r from-pink-600 to-pink-800' },
    { value: 'from-indigo-600', label: 'Indigo', preview: 'bg-gradient-to-r from-indigo-600 to-indigo-800' },
    { value: 'from-teal-600', label: 'Teal', preview: 'bg-gradient-to-r from-teal-600 to-teal-800' }
  ];

  const toOptions = [
    { value: 'to-blue-800', label: 'Blue Dark' },
    { value: 'to-purple-800', label: 'Purple Dark' },
    { value: 'to-green-800', label: 'Green Dark' },
    { value: 'to-red-800', label: 'Red Dark' },
    { value: 'to-yellow-800', label: 'Yellow Dark' },
    { value: 'to-pink-800', label: 'Pink Dark' },
    { value: 'to-indigo-800', label: 'Indigo Dark' },
    { value: 'to-teal-800', label: 'Teal Dark' }
  ];

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
            <Image className="w-4 h-4 text-blue-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Feature Banner Management</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage promotional banners shown to users on the home screen</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={fetchBanners}
            className="p-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700"
            title="Refresh"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
          
          {!showForm && !editingBanner && (
            <button
              onClick={() => setShowForm(true)}
              className="px-4 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Banner
            </button>
          )}
        </div>
      </div>

      {/* Success/Error Messages */}
      {(success || error) && (
        <div className={`p-4 rounded-lg ${
          error ? 'bg-red-100 border border-red-200' : 'bg-green-100 border border-green-200'
        }`}>
          <p className={`${
            error ? 'text-red-700' : 'text-green-700'
          }`}>
            {error || success}
          </p>
        </div>
      )}

      {/* Banner Form */}
      {(showForm || editingBanner) && (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-gray-900">
              {editingBanner ? 'Edit Banner' : 'Create New Banner'}
            </h3>
            <button
              onClick={() => {
                setShowForm(false);
                setEditingBanner(null);
                resetForm();
                setError(null);
              }}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors duration-200"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Image Upload */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Banner Image *
              </label>
              
              {previewUrl ? (
                <div className="space-y-4">
                  <div className="relative">
                    <div className="w-full h-48 rounded-xl overflow-hidden bg-gray-100">
                      <img
                        src={previewUrl}
                        alt="Banner preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={removeSelectedFile}
                      className="absolute top-2 right-2 w-8 h-8 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors duration-200"
                    >
                      <X className="w-4 h-4 text-white" />
                    </button>
                  </div>
                  {selectedFile && (
                    <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                      <Image className="w-5 h-5 text-green-600" />
                      <div>
                        <p className="font-medium text-gray-900">{selectedFile.name}</p>
                        <p className="text-gray-600 text-sm">{formatFileSize(selectedFile.size)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleFileChange}
                    className="hidden"
                    id="banner-image-upload"
                  />
                  <label
                    htmlFor="banner-image-upload"
                    className="flex flex-col items-center justify-center w-full h-48 bg-gray-100 border-2 border-dashed border-gray-300 hover:border-gray-400 rounded-xl cursor-pointer transition-all duration-200 group"
                  >
                    <Upload className="w-12 h-12 text-gray-500 group-hover:text-gray-600 mb-4" />
                    <p className="font-medium text-gray-700 text-base text-center">
                      Upload Banner Image
                    </p>
                    <p className="text-gray-500 text-sm text-center mt-2">
                      JPEG, PNG, WebP (max 10MB)<br />
                      Recommended: 1200x400px
                    </p>
                  </label>
                </div>
              )}
            </div>

            {/* Title and Subtitle */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Title (Optional)
                </label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  placeholder="e.g., New Feature"
                />
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Subtitle
                </label>
                <input
                  type="text"
                  name="subtitle"
                  value={formData.subtitle}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                  placeholder="e.g., Discover amazing music"
                />
              </div>
            </div>

            {/* URL */}
            <div>
              <label className="flex items-center gap-2 text-gray-700 text-sm font-medium mb-2">
                <LinkIcon className="w-4 h-4" />
                Link URL (Optional)
              </label>
              <input
                type="url"
                name="url"
                value={formData.url}
                onChange={handleInputChange}
                className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                placeholder="https://example.com"
              />
              <p className="mt-1 text-xs text-gray-500">
                Optional link when users tap the banner
              </p>
            </div>

            {/* Gradient Colors */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Gradient From
                </label>
                <select
                  name="gradient_from"
                  value={formData.gradient_from}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                >
                  {gradientOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-gray-700 text-sm font-medium mb-2">
                  Gradient To
                </label>
                <select
                  name="gradient_to"
                  value={formData.gradient_to}
                  onChange={handleInputChange}
                  className="w-full px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#309605]"
                >
                  {toOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Gradient Preview */}
            <div>
              <label className="block text-gray-700 text-sm font-medium mb-2">
                Gradient Preview
              </label>
              <div className={`w-full h-16 rounded-lg bg-gradient-to-r ${formData.gradient_from} ${formData.gradient_to} flex items-center justify-center`}>
                <p className="text-white font-medium">Sample Gradient</p>
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

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setEditingBanner(null);
                  resetForm();
                  setError(null);
                }}
                className="flex-1 px-4 py-2 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg text-gray-700 transition-all duration-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || (!selectedFile && !editingBanner)}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white transition-all duration-200"
              >
                {isSubmitting ? 'Saving...' : (editingBanner ? 'Update Banner' : 'Create Banner')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Banners List */}
      {!showForm && !editingBanner && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-xl font-semibold text-gray-900">Current Banners</h3>
            <p className="text-gray-600 text-sm mt-1">
              Manage banners that appear in the Hero section on the Home screen
            </p>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <LoadingLogo variant="pulse" size={32} />
              <p className="ml-4 text-gray-700">Loading banners...</p>
            </div>
          ) : error && banners.length === 0 ? (
            <div className="p-6 bg-red-100 border border-red-200 rounded-lg text-center m-6">
              <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
              <p className="text-red-700">{error}</p>
              <button
                onClick={fetchBanners}
                className="mt-4 px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg"
              >
                Try Again
              </button>
            </div>
          ) : banners.length === 0 ? (
            <div className="p-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Image className="w-8 h-8 text-gray-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Banners Found</h3>
              <p className="text-gray-700 mb-6">
                Create your first banner to showcase featured content on the Home screen.
              </p>
              <button
                onClick={() => setShowForm(true)}
                className="px-6 py-3 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white inline-flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Create First Banner
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {banners.map((banner, index) => {
                const isBeingDeleted = isDeleting === banner.id;
                
                return (
                  <div key={banner.id} className="p-6 hover:bg-gray-50 transition-colors duration-200">
                    <div className="flex items-start gap-6">
                      {/* Banner Preview */}
                      <div className="relative w-48 h-32 rounded-lg overflow-hidden shadow-lg flex-shrink-0">
                        <img
                          src={banner.image_url}
                          alt={banner.subtitle}
                          className="w-full h-full object-cover"
                        />
                        <div className={`absolute inset-0 bg-gradient-to-r ${banner.gradient_from} ${banner.gradient_to} opacity-80`}></div>
                        <div className="absolute inset-0 flex flex-col justify-center px-4">
                          {banner.title && (
                            <p className="font-semibold text-white text-sm mb-1 line-clamp-1">
                              {banner.title}
                            </p>
                          )}
                          {banner.subtitle && (
                            <p className="font-bold text-white text-base line-clamp-2">
                              {banner.subtitle}
                            </p>
                          )}
                        </div>
                        
                        {/* Status Badge */}
                        <div className="absolute top-2 right-2">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            banner.is_active 
                              ? 'bg-green-500 text-white' 
                              : 'bg-red-500 text-white'
                          }`}>
                            {banner.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>

                      {/* Banner Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-gray-900 text-lg mb-1">
                              {banner.title || 'Untitled Banner'}
                            </h4>
                            {banner.subtitle && (
                              <p className="text-gray-700 mb-2">
                                {banner.subtitle}
                              </p>
                            )}
                            
                            {banner.url && (
                              <div className="flex items-center gap-2 mb-2">
                                <LinkIcon className="w-4 h-4 text-blue-600" />
                                <a 
                                  href={banner.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 text-sm truncate max-w-xs"
                                >
                                  {banner.url}
                                </a>
                              </div>
                            )}
                            
                            <div className="flex items-center gap-4 text-gray-500 text-sm">
                              <span>Order: #{banner.order_index + 1}</span>
                              <span>•</span>
                              <span>Created: {formatDate(banner.created_at)}</span>
                              {banner.updated_at !== banner.created_at && (
                                <>
                                  <span>•</span>
                                  <span>Updated: {formatDate(banner.updated_at)}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-2 ml-4">
                            {/* Move Order Buttons */}
                            <div className="flex flex-col gap-1">
                              <button
                                onClick={() => handleMoveOrder(banner.id, 'up')}
                                disabled={index === 0}
                                className="p-1 hover:bg-gray-100 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Move Up"
                              >
                                <ArrowUp className="w-4 h-4 text-gray-600" />
                              </button>
                              <button
                                onClick={() => handleMoveOrder(banner.id, 'down')}
                                disabled={index === banners.length - 1}
                                className="p-1 hover:bg-gray-100 rounded transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Move Down"
                              >
                                <ArrowDown className="w-4 h-4 text-gray-600" />
                              </button>
                            </div>
                            
                            {/* Toggle Active */}
                            <button
                              onClick={() => handleToggleActive(banner)}
                              className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
                              title={banner.is_active ? 'Deactivate' : 'Activate'}
                            >
                              {banner.is_active ? (
                                <Eye className="w-5 h-5 text-green-600" />
                              ) : (
                                <Eye className="w-5 h-5 text-gray-400" />
                              )}
                            </button>
                            
                            {/* Edit Button */}
                            <button
                              onClick={() => setEditingBanner(banner)}
                              className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
                              title="Edit Banner"
                            >
                              <Edit className="w-5 h-5 text-blue-600" />
                            </button>
                            
                            {/* Delete Button */}
                            <button
                              onClick={() => handleDeleteBanner(banner.id)}
                              disabled={isBeingDeleted}
                              className="p-2 hover:bg-red-100 rounded-lg transition-colors duration-200 disabled:opacity-50"
                              title="Delete Banner"
                            >
                              {isBeingDeleted ? (
                                <LoadingLogo variant="pulse" size={20} />
                              ) : (
                                <Trash2 className="w-5 h-5 text-red-600" />
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};