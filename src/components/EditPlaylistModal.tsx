import React, { useState, useEffect } from 'react';
import { X, Music, Search, Plus, Trash2, Image as ImageIcon, GripVertical } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { sanitizeForFilter } from '../lib/filterSecurity';

interface EditPlaylistModalProps {
  playlistId: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface Song {
  id: string;
  title: string;
  artist_name: string;
  duration_seconds: number;
  cover_image_url: string | null;
}

interface PlaylistSong extends Song {
  playlist_song_id: string;
  position: number;
}

interface ArtistWithProfiles {
  id: string;
  name: string;
  artist_profiles?: { user_id: string }[];
}

export const EditPlaylistModal: React.FC<EditPlaylistModalProps> = ({
  playlistId,
  onClose,
  onSuccess,
}) => {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
  });
  const [originalCoverUrl, setOriginalCoverUrl] = useState<string | null>(null);
  const [selectedCoverFile, setSelectedCoverFile] = useState<File | null>(null);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [playlistSongs, setPlaylistSongs] = useState<PlaylistSong[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedSongId, setDraggedSongId] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (coverPreviewUrl && coverPreviewUrl !== originalCoverUrl && coverPreviewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadPlaylistData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        searchSongs(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

  const loadPlaylistData = async () => {
    setIsLoading(true);
    try {
      const { data: playlist, error: playlistError } = await supabase
        .from('playlists')
        .select('*')
        .eq('id', playlistId)
        .single();

      if (playlistError) {
        throw new Error(`Failed to load playlist: ${playlistError.message}`);
      }

      setFormData({
        title: playlist.title || '',
        description: playlist.description || '',
      });

      if (playlist.cover_image_url) {
        setOriginalCoverUrl(playlist.cover_image_url);
        setCoverPreviewUrl(playlist.cover_image_url);
      }

      const { data: songs, error: songsError } = await supabase
        .from('playlist_songs')
        .select(`
          id,
          position,
          songs:song_id (
            id,
            title,
            duration_seconds,
            cover_image_url,
            artists:artist_id (id, name)
          )
        `)
        .eq('playlist_id', playlistId)
        .order('position');

      if (songsError) {
        console.error('Error fetching playlist songs:', songsError);
      } else if (songs) {
        const formattedSongs = songs.map(item => {
          const song = item.songs as unknown as {
            id: string;
            title: string;
            duration_seconds: number;
            cover_image_url: string | null;
            artists?: ArtistWithProfiles | null;
          };

          return {
            playlist_song_id: item.id,
            position: item.position,
            id: song.id,
            title: song.title,
            artist_name: song.artists?.name || 'Unknown Artist',
            duration_seconds: song.duration_seconds || 0,
            cover_image_url: song.cover_image_url
          };
        });

        formattedSongs.sort((a, b) => a.position - b.position);
        setPlaylistSongs(formattedSongs);
      }
    } catch (err) {
      console.error('Error loading playlist data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load playlist data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        setError('Please select a valid image file (JPEG, PNG, or WebP)');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setError('Cover art image size must be less than 5MB');
        return;
      }

      setSelectedCoverFile(file);
      setError(null);
      if (coverPreviewUrl && coverPreviewUrl !== originalCoverUrl) {
        URL.revokeObjectURL(coverPreviewUrl);
      }
      setCoverPreviewUrl(URL.createObjectURL(file));
    }
  };

  const removeCoverFile = () => {
    setSelectedCoverFile(null);
    if (coverPreviewUrl && coverPreviewUrl !== originalCoverUrl) {
      URL.revokeObjectURL(coverPreviewUrl);
    }
    setCoverPreviewUrl(originalCoverUrl);
    const fileInput = document.getElementById('playlist-cover-upload') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
  };

  const searchSongs = async (query: string) => {
    if (!query.trim()) return;

    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          cover_image_url,
          artist:artist_id(name)
        `)
        .ilike('title', `%${sanitizeForFilter(query?.trim() || '')}%`)
        .limit(10);

      if (error) {
        console.error('Error searching songs:', error);
        return;
      }

      if (!data) {
        setSearchResults([]);
        return;
      }

      const existingSongIds = playlistSongs.map(song => song.id);

      const formattedResults = data
        .filter(song => !existingSongIds.includes(song.id))
        .map(song => {
          const artist = song.artist as unknown as ArtistWithProfiles;
          return {
            id: song.id,
            title: song.title,
            artist_name: artist?.name || 'Unknown Artist',
            duration_seconds: song.duration_seconds || 0,
            cover_image_url: song.cover_image_url
          };
        });

      setSearchResults(formattedResults);
    } catch (error) {
      console.error('Error in song search:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const addSongToPlaylist = async (song: Song) => {
    try {
      const nextPosition = playlistSongs.length > 0
        ? Math.max(...playlistSongs.map(s => s.position)) + 1
        : 0;

      const { data, error } = await supabase
        .from('playlist_songs')
        .insert({
          playlist_id: playlistId,
          song_id: song.id,
          position: nextPosition
        })
        .select()
        .single();

      if (error) {
        console.error('Error adding song to playlist:', error);
        return;
      }

      const newPlaylistSong: PlaylistSong = {
        ...song,
        playlist_song_id: data.id,
        position: nextPosition
      };

      setPlaylistSongs(prev => [...prev, newPlaylistSong]);

      setSearchQuery('');
      setSearchResults([]);
    } catch (err) {
      console.error('Error adding song to playlist:', err);
    }
  };

  const removeSongFromPlaylist = async (playlistSongId: string) => {
    try {
      const { error } = await supabase
        .from('playlist_songs')
        .delete()
        .eq('id', playlistSongId);

      if (error) {
        console.error('Error removing song from playlist:', error);
        return;
      }

      setPlaylistSongs(prev => prev.filter(song => song.playlist_song_id !== playlistSongId));
    } catch (err) {
      console.error('Error removing song from playlist:', err);
    }
  };

  const handleDragStart = (songId: string) => {
    setIsDragging(true);
    setDraggedSongId(songId);
  };

  const handleDragOver = (e: React.DragEvent, targetSongId: string) => {
    e.preventDefault();
    if (draggedSongId === targetSongId) return;

    const draggedSongIndex = playlistSongs.findIndex(s => s.playlist_song_id === draggedSongId);
    const targetSongIndex = playlistSongs.findIndex(s => s.playlist_song_id === targetSongId);

    if (draggedSongIndex < 0 || targetSongIndex < 0) return;

    const newSongs = [...playlistSongs];
    const [draggedSong] = newSongs.splice(draggedSongIndex, 1);
    newSongs.splice(targetSongIndex, 0, draggedSong);

    const updatedSongs = newSongs.map((song, index) => ({
      ...song,
      position: index
    }));

    setPlaylistSongs(updatedSongs);
  };

  const handleDragEnd = async () => {
    setIsDragging(false);
    setDraggedSongId(null);

    try {
      const updates = playlistSongs.map(song => ({
        id: song.playlist_song_id,
        position: song.position
      }));

      for (const update of updates) {
        const { error } = await supabase
          .from('playlist_songs')
          .update({ position: update.position })
          .eq('id', update.id);

        if (error) {
          console.error('Error updating song position:', error);
        }
      }
    } catch (err) {
      console.error('Error updating song positions:', err);
    }
  };

  const uploadCoverFile = async (userId: string): Promise<{ url: string; storagePath: string } | null> => {
    if (!selectedCoverFile) return null;

    try {
      const fileExt = selectedCoverFile.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${userId}/playlists/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('covers')
        .upload(filePath, selectedCoverFile, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        throw new Error(uploadError.message || 'Upload failed');
      }

      const { data: { publicUrl } } = supabase.storage
        .from('covers')
        .getPublicUrl(filePath);

      console.log('Playlist cover uploaded successfully to Supabase Storage:', publicUrl);
      return {
        url: publicUrl,
        storagePath: filePath
      };
    } catch (err) {
      console.error('Error uploading playlist cover:', err);
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.title.trim()) {
      setError('Playlist title is required');
      return;
    }

    setIsSubmitting(true);

    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw new Error('Authentication session expired. Please sign in again.');
      }
      const userId = session.user.id;

      let coverData = null;
      if (selectedCoverFile) {
        coverData = await uploadCoverFile(userId);
      }

      const { error: updateError } = await supabase
        .from('playlists')
        .update({
          title: formData.title.trim(),
          description: formData.description.trim() || null,
          cover_image_url: coverData ? coverData.url : originalCoverUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', playlistId);

      if (updateError) {
        throw new Error(`Failed to update playlist: ${updateError.message}`);
      }

      if (coverPreviewUrl && coverPreviewUrl !== originalCoverUrl) {
        URL.revokeObjectURL(coverPreviewUrl);
      }

      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error updating playlist:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-center justify-center">
        <div className="w-full max-w-lg bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] rounded-3xl p-8 border border-white/10 shadow-2xl">
          <div className="flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-[#309605] border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm text-white/70 ml-3">Loading playlist...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[110] flex items-end sm:items-center justify-center">
      <div className="w-full max-w-lg bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] rounded-t-3xl sm:rounded-3xl max-h-[95vh] overflow-y-auto border-t border-white/10 sm:border shadow-2xl">
        <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm px-6 py-4 border-b border-white/10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold text-white">Edit Playlist</h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-full transition-all"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-white/80" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 pb-24 space-y-6">
          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Playlist Title *
            </label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              required
              className="w-full h-12 px-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all"
              placeholder="e.g., My Workout Mix"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Description (Optional)
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              rows={3}
              className="w-full px-4 py-3 bg-white/10 backdrop-blur-sm border border-white/20 rounded-xl text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all resize-none"
              placeholder="Tell us about your playlist..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-white/80 mb-2">
              Playlist Cover (Optional)
            </label>

            {coverPreviewUrl ? (
              <div className="relative">
                <div className="w-full h-48 rounded-xl overflow-hidden bg-white/5">
                  <img
                    src={coverPreviewUrl}
                    alt="Playlist cover preview"
                    className="w-full h-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  onClick={removeCoverFile}
                  className="absolute top-3 right-3 w-10 h-10 bg-red-500 hover:bg-red-600 rounded-full flex items-center justify-center transition-all shadow-lg"
                  aria-label="Remove cover"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp"
                  onChange={handleCoverFileChange}
                  className="hidden"
                  id="playlist-cover-upload"
                />
                <label
                  htmlFor="playlist-cover-upload"
                  className="flex flex-col items-center justify-center w-full h-32 bg-white/5 border-2 border-dashed border-white/20 hover:border-white/40 rounded-xl cursor-pointer transition-all group"
                >
                  <ImageIcon className="w-8 h-8 text-white/60 group-hover:text-white/80 mb-2 transition-colors" />
                  <p className="text-sm font-medium text-white/80">Upload Cover Image</p>
                  <p className="text-xs text-white/60 mt-1">JPEG, PNG, WebP (max 5MB)</p>
                </label>
              </div>
            )}
          </div>

          <div className="pt-2">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-semibold text-white">
                Playlist Songs ({playlistSongs.length})
              </h3>
              {playlistSongs.length > 0 && (
                <p className="text-xs text-white/60">Drag to reorder</p>
              )}
            </div>

            {playlistSongs.length === 0 ? (
              <div className="p-4 bg-white/5 rounded-lg text-center mb-4">
                <p className="text-sm text-white/70">No songs in this playlist yet</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-60 overflow-y-auto p-2 bg-white/5 rounded-xl mb-4">
                {playlistSongs.map((song) => (
                  <div
                    key={song.playlist_song_id}
                    className={`flex items-center justify-between p-2 rounded-lg transition-all group cursor-move ${
                      isDragging && draggedSongId === song.playlist_song_id
                        ? 'opacity-50 bg-white/20'
                        : 'hover:bg-white/10'
                    }`}
                    draggable
                    onDragStart={() => handleDragStart(song.playlist_song_id)}
                    onDragOver={(e) => handleDragOver(e, song.playlist_song_id)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <GripVertical className="w-4 h-4 text-white/40 flex-shrink-0" />
                      <div className="w-6 h-6 rounded-full bg-[#309605]/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs text-[#309605] font-medium">{song.position + 1}</span>
                      </div>
                      <div className="w-8 h-8 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden">
                        {song.cover_image_url ? (
                          <img
                            src={song.cover_image_url}
                            alt={song.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-4 h-4 text-white/60" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{song.title}</p>
                        <p className="text-xs text-white/60 truncate">{song.artist_name}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/60">{formatDuration(song.duration_seconds)}</span>
                      <button
                        type="button"
                        onClick={() => removeSongFromPlaylist(song.playlist_song_id)}
                        className="w-8 h-8 rounded-full hover:bg-red-500/20 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                        aria-label="Remove song"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div>
              <h4 className="text-sm font-medium text-white/80 mb-2">
                Add More Songs
              </h4>

              <div className="relative mb-4">
                <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" />
                <input
                  type="text"
                  placeholder="Search for songs to add..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full h-12 pl-12 pr-4 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-[#309605]/50 focus:border-[#309605]/50 transition-all"
                />
              </div>

              {isSearching && (
                <div className="flex items-center justify-center py-4">
                  <div className="w-5 h-5 border-2 border-[#309605] border-t-transparent rounded-full animate-spin"></div>
                  <p className="text-sm text-white/70 ml-3">Searching...</p>
                </div>
              )}

              {searchResults.length > 0 && (
                <div className="max-h-60 overflow-y-auto mb-4 space-y-1 p-2 bg-white/5 rounded-xl">
                  {searchResults.map((song) => (
                    <div
                      key={song.id}
                      onClick={() => addSongToPlaylist(song)}
                      className="flex items-center justify-between p-3 hover:bg-white/10 rounded-lg transition-all cursor-pointer group"
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-white/10 flex-shrink-0 overflow-hidden">
                          {song.cover_image_url ? (
                            <img
                              src={song.cover_image_url}
                              alt={song.title}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music className="w-5 h-5 text-white/40" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-white truncate">{song.title}</p>
                          <p className="text-xs text-white/60 truncate">{song.artist_name}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-white/60">{formatDuration(song.duration_seconds)}</span>
                        <div className="w-8 h-8 rounded-full bg-[#309605]/20 group-hover:bg-[#309605]/30 flex items-center justify-center transition-all">
                          <Plus className="w-4 h-4 text-[#309605]" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {searchQuery.length >= 2 && searchResults.length === 0 && !isSearching && (
                <div className="p-4 bg-white/5 rounded-lg text-center mb-4">
                  <p className="text-sm text-white/70">No songs found matching &quot;{searchQuery}&quot;</p>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-xl">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-12 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl font-medium text-white transition-all"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !formData.title.trim()}
              className="flex-1 h-12 bg-gradient-to-r from-[#309605] to-[#3ba208] hover:from-[#3ba208] hover:to-[#309605] disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium text-white transition-all shadow-lg"
            >
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
