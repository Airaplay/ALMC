import { useState, useEffect } from 'react';
import { Play } from 'lucide-react';
import { Skeleton } from './ui/skeleton';
import { getSimilarSongsForDisplay } from '../lib/songRecommendationsService';

interface Song {
  id: string;
  title: string;
  artist: string;
  artistId?: string | null;
  coverImageUrl?: string | null;
  audioUrl?: string | null;
  duration?: number;
  playCount?: number;
}

interface SimilarSongsSectionProps {
  currentSong: Song;
  onSongSelect: (_song: Song) => void;
}

export const SimilarSongsSection: React.FC<SimilarSongsSectionProps> = ({
  currentSong,
  onSongSelect
}) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const loadSimilarSongs = async () => {
      setIsLoading(true);

      try {
        const similar = await getSimilarSongsForDisplay(currentSong, 6);

        if (isMounted) {
          setSongs(similar);
        }
      } catch (err) {
        console.error('Error loading similar songs:', err);
        if (isMounted) {
          setSongs([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadSimilarSongs();

    return () => {
      isMounted = false;
    };
  }, [currentSong.id]);

  if (!isLoading && songs.length === 0) {
    return null;
  }

  return (
    <div className="w-full mb-0">
      <div className="flex items-center justify-between mb-3 px-0">
        <h3 className="font-sans font-semibold text-white text-base">
          Similar to this song
        </h3>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton variant="rectangular" className="w-full aspect-square rounded-lg bg-secondary mb-2" />
              <Skeleton variant="text" className="h-3 w-full rounded bg-secondary mb-1" />
              <Skeleton variant="text" className="h-2 w-3/4 rounded bg-secondary" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {songs.map((song) => (
            <button
              key={song.id}
              onClick={() => onSongSelect(song)}
              className="group cursor-pointer text-left"
            >
              <div className="relative w-full aspect-square rounded-xl overflow-hidden mb-2 bg-secondary shadow-lg">
                {song.coverImageUrl ? (
                  <img
                    src={song.coverImageUrl}
                    alt={song.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center">
                    <span className="text-primary-foreground text-2xl font-bold">♪</span>
                  </div>
                )}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors duration-300 flex items-center justify-center">
                  <Play className="w-8 h-8 text-primary-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-300" fill="currentColor" />
                </div>
              </div>

              <div className="text-left">
                <h4 className="text-xs font-semibold text-white line-clamp-2 mb-0.5 leading-tight">
                  {song.title}
                </h4>
                <p className="text-[10px] text-white/60 truncate">
                  {song.artist}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
