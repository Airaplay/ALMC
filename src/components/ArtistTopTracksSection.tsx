import { useState, useEffect } from 'react';
import { Card, CardContent } from './ui/card';
import { ScrollArea, ScrollBar } from './ui/scroll-area';
import { getArtistTopContent, ContentItem } from '../lib/artistTopTracksService';
import { useNavigate } from 'react-router-dom';

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

interface ArtistTopTracksSectionProps {
  artistId: string;
  artistName: string;
  currentSongId: string;
  onSongSelect: (_song: Song) => void;
  /** Called when an album is clicked. If provided, use this instead of navigate (e.g. to close overlay first). */
  onAlbumSelect?: (albumId: string) => void;
}

export const ArtistTopTracksSection: React.FC<ArtistTopTracksSectionProps> = ({
  artistId,
  artistName,
  currentSongId,
  onSongSelect,
  onAlbumSelect
}) => {
  const navigate = useNavigate();
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeBlink, setActiveBlink] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadContent = async () => {
      setIsLoading(true);

      try {
        const topContent = await getArtistTopContent(artistId, currentSongId, 10);

        if (isMounted) {
          setContentItems(topContent);
        }
      } catch (err) {
        console.error('Error loading artist content:', err);
        if (isMounted) {
          setContentItems([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      isMounted = false;
    };
  }, [artistId, currentSongId]);

  const handleItemClick = (item: ContentItem) => {
    setActiveBlink(item.id);
    setTimeout(() => setActiveBlink(null), 600);

    if (item.type === 'album' && item.album) {
      if (onAlbumSelect) {
        onAlbumSelect(item.id);
      } else {
        navigate(`/album/${item.id}`);
      }
    } else if (item.type === 'song' && item.song) {
      onSongSelect(item.song);
    }
  };

  if (!isLoading && contentItems.length === 0) {
    return null;
  }

  return (
    <section className="w-full py-2 -mx-1 px-1">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-sans font-bold text-white text-lg tracking-tight">
          More from {artistName}
        </h2>
      </div>

      {isLoading ? (
        // Keep ScrollArea for consistent skeleton loading animation with horizontal scrolling
        <ScrollArea className="w-full">
          <div className="flex space-x-3 pb-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="w-[110px] flex-shrink-0 animate-pulse">
                <div className="bg-[#181818] rounded-xl overflow-hidden">
                  <div className="w-[110px] h-[110px] bg-[#282828]"></div>
                </div>
                <div className="mt-2.5">
                  <div className="h-3 bg-[#282828] rounded mb-1"></div>
                  <div className="h-2 bg-[#282828] rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
          {/* ScrollBar is implicitly handled by ScrollArea when content overflows */}
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      ) : (
        // Ensure the ScrollArea itself has a defined width and allows scrolling.
        // The inner div should allow its content to extend horizontally.
        <ScrollArea className="w-full">
          <div className="flex space-x-3 pb-4 w-max"> {/* Added w-max here */}
            {contentItems.map((item, index) => {
              const isAlbum = item.type === 'album';
              const coverImageUrl = isAlbum 
                ? (item.album?.coverImageUrl || item.coverImageUrl)
                : item.coverImageUrl;

              return (
                <Card
                  key={`${item.id}-${index}`}
                  className="w-[110px] flex-shrink-0 bg-transparent border-none shadow-none group cursor-pointer active:scale-95 transition-transform duration-150"
                  onClick={() => handleItemClick(item)}
                >
                  <CardContent className="p-0">
                    <div
                      className={`relative w-[110px] h-[110px] bg-cover bg-center rounded-xl overflow-hidden shadow-lg group-active:shadow-2xl transition-all duration-200 ${activeBlink === item.id ? 'blink-effect' : ''}`}
                    >
                      {coverImageUrl ? (
                        <img
                          src={coverImageUrl}
                          alt={item.title}
                          className="w-full h-full object-cover"
                          loading={index < 5 ? "eager" : "lazy"}
                          decoding="async"
                        />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#309605] to-[#3ba208] flex items-center justify-center">
                          <span className="text-white text-4xl font-bold">♪</span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/30 group-active:bg-black/20 transition-colors duration-200"></div>
                      {isAlbum && (
                        <div className="absolute top-1.5 right-1.5 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
                          <span className="font-[\'Inter\',sans-serif] font-semibold text-white text-[10px] leading-none tracking-tight">
                            Album
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="w-[110px] text-center mt-2.5">
                      <p className="font-[\'Inter\',sans-serif] font-bold text-left text-white/90 text-xs leading-tight group-active:text-white transition-colors duration-200 line-clamp-1">
                        {item.title}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {/* ScrollBar is implicitly handled by ScrollArea when content overflows */}
          <ScrollBar orientation="horizontal" className="opacity-0" />
        </ScrollArea>
      )}

      <style>{`
        @keyframes lightBlink {
          0%, 49% {
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
          }
          50%, 100% {
            box-shadow: 0 10px 25px -5px rgba(255, 255, 255, 0.15);
          }
        }

        .blink-effect {
          animation: lightBlink 0.6s ease-out;
        }
      `}</style>
    </section>
  );
};
