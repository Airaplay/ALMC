import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, Eye, EyeOff, Search, X, Calendar, Music, Clock, Globe, Layers } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';

interface CuratedMix {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  song_ids: string[];
  target_country: string | null;
  target_genres: string[];
  is_visible: boolean;
  scheduled_visibility_date: string | null;
  total_duration: number;
  play_count: number;
  created_at: string;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  cover_image_url: string | null;
  audio_url: string | null;
}

export const MixManagerSection = (): JSX.Element => {
  const [mixes, setMixes] = useState<CuratedMix[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingMix, setEditingMix] = useState<CuratedMix | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    description: '',
    cover_image_url: '',
    target_country: '',
    target_genres: [] as string[],
    is_visible: false,
    scheduled_visibility_date: ''
  });

  const [coverImageFile, setCoverImageFile] = useState<File | null>(null);
  const [coverImagePreview, setCoverImagePreview] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const [songSearch, setSongSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [selectedSongs, setSelectedSongs] = useState<Song[]>([]);

  useEffect(() => {
    loadMixes();
  }, []);

  const loadMixes = async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('curated_mixes')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMixes(data || []);
    } catch (error) {
      console.error('Error loading mixes:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const searchSongs = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          cover_image_url,
          audio_url,
          artists!inner(name)
        `)
        .ilike('title', `%${query}%`)
        .limit(20);

      if (error) throw error;

      const formatted = data?.map(song => ({
        id: song.id,
        title: song.title,
        artist: (song.artists as any)?.name || 'Unknown Artist',
        duration_seconds: song.duration_seconds || 0,
        cover_image_url: song.cover_image_url,
        audio_url: song.audio_url
      })) || [];

      setSearchResults(formatted);
    } catch (error) {
      console.error('Error searching songs:', error);
      setSearchResults([]);
    }
  };

  const handleAddSong = (song: Song) => {
    if (!selectedSongs.find(s => s.id === song.id)) {
      setSelectedSongs([...selectedSongs, song]);
    }
    setSongSearch('');
    setSearchResults([]);
  };

  const handleRemoveSong = (songId: string) => {
    setSelectedSongs(selectedSongs.filter(s => s.id !== songId));
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getTotalDuration = (): number => {
    return selectedSongs.reduce((total, song) => total + song.duration_seconds, 0);
  };

  const handleCoverImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }

      if (!file.type.startsWith('image/')) {
        alert('Please select a valid image file');
        return;
      }

      setCoverImageFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setCoverImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const uploadCoverImage = async (): Promise<string | null> => {
    if (!coverImageFile) return formData.cover_image_url || null;

    try {
      setIsUploadingImage(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { validateImageFile, getValidatedExtension, sanitizeFileName, ALLOWED_IMAGE_EXTENSIONS } = await import('../../lib/fileSecurity');
      const validation = validateImageFile(coverImageFile);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid cover image file');
      }
      const fileExt = getValidatedExtension(coverImageFile.name, ALLOWED_IMAGE_EXTENSIONS);
      if (!fileExt) {
        throw new Error('Invalid file extension. Allowed: jpg, jpeg, png, webp, gif');
      }
      const sanitizedFileName = sanitizeFileName(coverImageFile.name);
      const fileName = `mix-cover-${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `${user.id}/mixes/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('thumbnails')
        .upload(filePath, coverImageFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('thumbnails')
        .getPublicUrl(filePath);

      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw new Error('Failed to upload cover image');
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (selectedSongs.length === 0) {
      alert('Please add at least one song to the mix');
      return;
    }

    try {
      let coverImageUrl: string | null = formData.cover_image_url || null;

      if (coverImageFile) {
        coverImageUrl = await uploadCoverImage();
      }

      const mixData = {
        title: formData.title,
        description: formData.description || null,
        cover_image_url: coverImageUrl || null,
        song_ids: selectedSongs.map(s => s.id),
        target_country: formData.target_country || null,
        target_genres: formData.target_genres.length > 0 ? formData.target_genres : [],
        is_visible: formData.is_visible,
        scheduled_visibility_date: formData.scheduled_visibility_date || null,
        created_by: (await supabase.auth.getUser()).data.user?.id
      };

      if (editingMix) {
        const { error } = await supabase
          .from('curated_mixes')
          .update(mixData)
          .eq('id', editingMix.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('curated_mixes')
          .insert([mixData]);

        if (error) throw error;
      }

      await loadMixes();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving mix:', error);
      alert('Failed to save mix');
    }
  };

  const handleEdit = async (mix: CuratedMix) => {
    setEditingMix(mix);
    setFormData({
      title: mix.title,
      description: mix.description || '',
      cover_image_url: mix.cover_image_url || '',
      target_country: mix.target_country || '',
      target_genres: mix.target_genres || [],
      is_visible: mix.is_visible,
      scheduled_visibility_date: mix.scheduled_visibility_date || ''
    });

    setCoverImagePreview(mix.cover_image_url);
    setCoverImageFile(null);

    const { data } = await supabase.rpc('get_mix_with_song_details', { mix_id: mix.id });
    if (data?.songs) {
      const formattedSongs = data.songs.map((song: any) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        duration_seconds: song.duration || 0,
        cover_image_url: song.cover_url || null,
        audio_url: song.audio_url || null
      }));
      setSelectedSongs(formattedSongs);
    }

    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this mix?')) return;

    try {
      const { error } = await supabase
        .from('curated_mixes')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await loadMixes();
    } catch (error) {
      console.error('Error deleting mix:', error);
      alert('Failed to delete mix');
    }
  };

  const toggleVisibility = async (mix: CuratedMix) => {
    try {
      const { error } = await supabase
        .from('curated_mixes')
        .update({ is_visible: !mix.is_visible })
        .eq('id', mix.id);

      if (error) throw error;
      await loadMixes();
    } catch (error) {
      console.error('Error toggling visibility:', error);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingMix(null);
    setFormData({
      title: '',
      description: '',
      cover_image_url: '',
      target_country: '',
      target_genres: [],
      is_visible: false,
      scheduled_visibility_date: ''
    });
    setSelectedSongs([]);
    setSongSearch('');
    setSearchResults([]);
    setCoverImageFile(null);
    setCoverImagePreview(null);
    setIsUploadingImage(false);
  };

  const filteredMixes = mixes.filter(mix =>
    mix.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <Layers className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Mix Manager</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage curated music mixes for the home screen</p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center px-4 py-2 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors"
        >
          <Plus className="w-5 h-5 mr-2" />
          Create Mix
        </button>
      </div>

      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center border border-gray-300 rounded-lg px-3 py-2">
          <Search className="w-5 h-5 text-gray-400 mr-2" />
          <input
            type="text"
            placeholder="Search mixes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 outline-none text-gray-700"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <LoadingLogo variant="pulse" size={32} />
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto scrollbar-hide">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-3 text-sm font-semibold text-gray-700">Mix</th>
                  <th className="text-left px-6 py-3 text-sm font-semibold text-gray-700">Songs</th>
                  <th className="text-left px-6 py-3 text-sm font-semibold text-gray-700">Duration</th>
                  <th className="text-left px-6 py-3 text-sm font-semibold text-gray-700">Target</th>
                  <th className="text-left px-6 py-3 text-sm font-semibold text-gray-700">Plays</th>
                  <th className="text-left px-6 py-3 text-sm font-semibold text-gray-700">Status</th>
                  <th className="text-right px-6 py-3 text-sm font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredMixes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
                      No mixes found
                    </td>
                  </tr>
                ) : (
                  filteredMixes.map((mix) => (
                    <tr key={mix.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center">
                          {mix.cover_image_url ? (
                            <img
                              src={mix.cover_image_url}
                              alt={mix.title}
                              className="w-12 h-12 rounded-lg object-cover mr-3"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded-lg bg-gray-200 flex items-center justify-center mr-3">
                              <Music className="w-6 h-6 text-gray-400" />
                            </div>
                          )}
                          <div>
                            <p className="font-medium text-gray-900">{mix.title}</p>
                            {mix.description && (
                              <p className="text-sm text-gray-500 truncate max-w-xs">{mix.description}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {mix.song_ids.length} songs
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {formatDuration(mix.total_duration)}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          {mix.target_country ? (
                            <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                              <Globe className="w-3 h-3 mr-1" />
                              {mix.target_country}
                            </span>
                          ) : (
                            <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700">
                              <Globe className="w-3 h-3 mr-1" />
                              Global
                            </span>
                          )}
                          {mix.target_genres.length > 0 && (
                            <span className="text-xs text-gray-500">
                              {mix.target_genres.length} genres
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-gray-700">
                        {mix.play_count.toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        {mix.is_visible ? (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                            Visible
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                            Hidden
                          </span>
                        )}
                        {mix.scheduled_visibility_date && (
                          <div className="flex items-center text-xs text-gray-500 mt-1">
                            <Calendar className="w-3 h-3 mr-1" />
                            {new Date(mix.scheduled_visibility_date).toLocaleDateString()}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => toggleVisibility(mix)}
                            className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title={mix.is_visible ? 'Hide' : 'Show'}
                          >
                            {mix.is_visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                          <button
                            onClick={() => handleEdit(mix)}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(mix.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">
                {editingMix ? 'Edit Mix' : 'Create New Mix'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-600" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mix Title *
                </label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  placeholder="e.g., Chill Vibes, Workout Mix"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  placeholder="Brief description of this mix"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Cover Image
                </label>
                <div className="space-y-3">
                  {coverImagePreview && (
                    <div className="relative w-32 h-32 rounded-lg overflow-hidden border-2 border-gray-200">
                      <img
                        src={coverImagePreview}
                        alt="Cover preview"
                        className="w-full h-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setCoverImageFile(null);
                          setCoverImagePreview(null);
                          setFormData({ ...formData, cover_image_url: '' });
                        }}
                        className="absolute top-1 right-1 p-1 bg-red-500 text-white rounded-full hover:bg-red-600 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    <label className="flex-1 cursor-pointer">
                      <div className="flex items-center justify-center px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg hover:border-[#309605] transition-colors">
                        <div className="text-center">
                          <p className="text-sm text-gray-600">Click to upload cover image</p>
                          <p className="text-xs text-gray-400 mt-1">PNG, JPG up to 5MB</p>
                        </div>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleCoverImageChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Country
                  </label>
                  <input
                    type="text"
                    value={formData.target_country}
                    onChange={(e) => setFormData({ ...formData, target_country: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                    placeholder="e.g., NG (Leave empty for global)"
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave empty to target all countries</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Target Genres (comma separated)
                  </label>
                  <input
                    type="text"
                    value={formData.target_genres.join(', ')}
                    onChange={(e) => setFormData({
                      ...formData,
                      target_genres: e.target.value.split(',').map(g => g.trim()).filter(Boolean)
                    })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                    placeholder="e.g., Afrobeat, Hip Hop"
                  />
                  <p className="text-xs text-gray-500 mt-1">Leave empty to target all genres</p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_visible}
                    onChange={(e) => setFormData({ ...formData, is_visible: e.target.checked })}
                    className="w-4 h-4 text-[#309605] border-gray-300 rounded focus:ring-[#309605]"
                  />
                  <span className="ml-2 text-sm text-gray-700">Visible to users</span>
                </label>

                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Scheduled Visibility Date (Optional)
                  </label>
                  <input
                    type="datetime-local"
                    value={formData.scheduled_visibility_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_visibility_date: e.target.value })}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#309605] focus:border-transparent"
                  />
                </div>
              </div>

              <div className="border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-semibold text-gray-900">Songs</h4>
                  {selectedSongs.length > 0 && (
                    <div className="flex items-center text-sm text-gray-600">
                      <Clock className="w-4 h-4 mr-1" />
                      Total: {formatDuration(getTotalDuration())}
                    </div>
                  )}
                </div>

                <div className="mb-4">
                  <div className="relative">
                    <div className="flex items-center border border-gray-300 rounded-lg px-3 py-2">
                      <Search className="w-5 h-5 text-gray-400 mr-2" />
                      <input
                        type="text"
                        placeholder="Search songs to add..."
                        value={songSearch}
                        onChange={(e) => {
                          setSongSearch(e.target.value);
                          searchSongs(e.target.value);
                        }}
                        className="flex-1 outline-none text-gray-700"
                      />
                    </div>

                    {searchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-2 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto">
                        {searchResults.map((song) => (
                          <button
                            key={song.id}
                            type="button"
                            onClick={() => handleAddSong(song)}
                            className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                          >
                            {song.cover_image_url ? (
                              <img
                                src={song.cover_image_url}
                                alt={song.title}
                                className="w-10 h-10 rounded object-cover mr-3"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center mr-3">
                                <Music className="w-5 h-5 text-gray-400" />
                              </div>
                            )}
                            <div className="flex-1">
                              <p className="font-medium text-gray-900">{song.title}</p>
                              <p className="text-sm text-gray-500">{song.artist}</p>
                            </div>
                            <span className="text-sm text-gray-500">
                              {formatDuration(song.duration_seconds)}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {selectedSongs.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <Music className="w-12 h-12 mx-auto mb-2 text-gray-300" />
                    <p>No songs added yet. Search and add songs above.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedSongs.map((song, index) => (
                      <div
                        key={song.id}
                        className="flex items-center p-3 bg-gray-50 rounded-lg"
                      >
                        <span className="text-sm text-gray-500 mr-3 w-6">{index + 1}</span>
                        {song.cover_image_url ? (
                          <img
                            src={song.cover_image_url}
                            alt={song.title}
                            className="w-10 h-10 rounded object-cover mr-3"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded bg-gray-200 flex items-center justify-center mr-3">
                            <Music className="w-5 h-5 text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{song.title}</p>
                          <p className="text-sm text-gray-500">{song.artist}</p>
                        </div>
                        <span className="text-sm text-gray-500 mr-4">
                          {formatDuration(song.duration_seconds)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveSong(song.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUploadingImage}
                  className="px-6 py-2 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {isUploadingImage && (
                    <LoadingLogo variant="pulse" size={16} />
                  )}
                  {editingMix ? 'Update Mix' : 'Create Mix'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
