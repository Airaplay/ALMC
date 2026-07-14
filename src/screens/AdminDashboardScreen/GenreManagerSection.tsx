import { useState, useEffect } from 'react';
import { Upload, Trash2, RefreshCw, Image as ImageIcon, AlertCircle, Music } from 'lucide-react';
import { getAllGenres, uploadGenreImage, deleteGenreImage } from '../../lib/supabase';

interface Genre {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  image_path: string | null;
}

export const GenreManagerSection = () => {
  const [genres, setGenres] = useState<Genre[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingGenreId, setUploadingGenreId] = useState<string | null>(null);
  const [deletingGenreId, setDeletingGenreId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadGenres();
  }, []);

  const loadGenres = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const genresData = await getAllGenres();
      setGenres(genresData);
    } catch (err) {
      console.error('Error loading genres:', err);
      setError('Failed to load genres');
    } finally {
      setIsLoading(false);
    }
  };

  const handleImageUpload = async (genreId: string, file: File) => {
    setUploadingGenreId(genreId);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await uploadGenreImage(genreId, file);

      if (result.success) {
        setSuccessMessage(`Image uploaded successfully for ${genres.find(g => g.id === genreId)?.name}`);
        // Reload genres to get updated image URLs
        await loadGenres();

        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(result.error || 'Failed to upload image');
      }
    } catch (err) {
      console.error('Error uploading image:', err);
      setError('An unexpected error occurred while uploading the image');
    } finally {
      setUploadingGenreId(null);
    }
  };

  const handleImageDelete = async (genreId: string, genreName: string) => {
    if (!confirm(`Are you sure you want to delete the image for "${genreName}"?`)) {
      return;
    }

    setDeletingGenreId(genreId);
    setError(null);
    setSuccessMessage(null);

    try {
      const result = await deleteGenreImage(genreId);

      if (result.success) {
        setSuccessMessage(`Image deleted successfully for ${genreName}`);
        // Reload genres to reflect the deletion
        await loadGenres();

        // Clear success message after 3 seconds
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        setError(result.error || 'Failed to delete image');
      }
    } catch (err) {
      console.error('Error deleting image:', err);
      setError('An unexpected error occurred while deleting the image');
    } finally {
      setDeletingGenreId(null);
    }
  };

  const handleFileSelect = (genreId: string, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleImageUpload(genreId, file);
    }
    // Reset input so the same file can be selected again
    event.target.value = '';
  };

  const getPlaceholderImage = () => {
    return "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400";
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-[#309605] border-t-transparent rounded-full animate-spin"></div>
        <p className="font-['Inter',sans-serif] text-white/70 text-sm ml-3">Loading genres...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 min-h-full">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
            <Music className="w-4 h-4 text-green-600" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-gray-900 leading-tight">Genre Manager</h2>
            <p className="text-sm text-gray-400 mt-0.5">Manage music genres and their display settings</p>
          </div>
        </div>
        <button
          onClick={loadGenres}
          disabled={isLoading}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm font-['Inter',sans-serif] font-medium transition-all duration-200 active:scale-95 flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/20 border border-red-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="font-['Inter',sans-serif] text-red-400 text-sm">{error}</p>
        </div>
      )}

      {successMessage && (
        <div className="p-4 bg-green-500/20 border border-green-500/30 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
          <p className="font-['Inter',sans-serif] text-green-400 text-sm">{successMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {genres.map((genre) => (
          <div
            key={genre.id}
            className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl overflow-hidden hover:border-white/20 transition-all duration-200"
          >
            <div className="relative h-48 w-full bg-white/10">
              <img
                src={genre.image_url || getPlaceholderImage()}
                alt={genre.name}
                className="w-full h-full object-cover"
              />
              {!genre.image_url && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="text-center">
                    <ImageIcon className="w-12 h-12 text-white/60 mx-auto mb-2" />
                    <p className="font-['Inter',sans-serif] text-white/60 text-xs">No custom image</p>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 space-y-3">
              <div>
                <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg">
                  {genre.name}
                </h3>
                {genre.description && (
                  <p className="font-['Inter',sans-serif] text-white/60 text-sm mt-1 line-clamp-2">
                    {genre.description}
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <label
                  className={`flex-1 px-3 py-2 bg-[#309605] hover:bg-[#3ba208] rounded-lg text-white text-sm font-['Inter',sans-serif] font-medium transition-all duration-200 active:scale-95 flex items-center justify-center gap-2 ${
                    uploadingGenreId === genre.id ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                >
                  {uploadingGenreId === genre.id ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      {genre.image_url ? 'Replace' : 'Upload'}
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={(e) => handleFileSelect(genre.id, e)}
                    disabled={uploadingGenreId === genre.id}
                    className="hidden"
                  />
                </label>

                {genre.image_url && (
                  <button
                    onClick={() => handleImageDelete(genre.id, genre.name)}
                    disabled={deletingGenreId === genre.id}
                    className="px-3 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 rounded-lg text-red-400 text-sm font-['Inter',sans-serif] font-medium transition-all duration-200 active:scale-95 flex items-center justify-center gap-2"
                  >
                    {deletingGenreId === genre.id ? (
                      <div className="w-4 h-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin"></div>
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {genres.length === 0 && !isLoading && (
        <div className="text-center py-12">
          <ImageIcon className="w-16 h-16 text-white/40 mx-auto mb-4" />
          <h3 className="font-['Inter',sans-serif] font-bold text-white text-lg mb-2">No genres found</h3>
          <p className="font-['Inter',sans-serif] text-white/60 text-sm">
            Genres will appear here once they are created in the database
          </p>
        </div>
      )}
    </div>
  );
};
