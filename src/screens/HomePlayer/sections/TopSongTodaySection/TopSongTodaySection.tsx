import { useMemo } from "react";
import { useHomeScreenData } from "../../../../contexts/HomeScreenDataContext";

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

interface TopSongTodaySectionProps {
  onOpenMusicPlayer: (song: Song, playlist?: Song[], context?: string) => void;
}

export const TopSongTodaySection = ({ onOpenMusicPlayer }: TopSongTodaySectionProps): JSX.Element | null => {
  const { data } = useHomeScreenData();

  const songs = useMemo(() => {
    const base = (data?.trendingSongs ?? []).slice(0, 10);
    return base
      .map((song: any) => ({
        id: song.id,
        title: song.title,
        artist:
          song.artist ||
          song.artists?.artist_profiles?.[0]?.stage_name ||
          song.artists?.artist_profiles?.[0]?.users?.display_name ||
          song.artists?.name ||
          "Unknown Artist",
        artistId: song.artist_user_id || song.artists?.artist_profiles?.[0]?.user_id || null,
        coverImageUrl: song.cover_image_url ?? null,
        audioUrl: song.audio_url ?? null,
        duration: song.duration_seconds ?? 0,
        playCount: song.play_count ?? 0,
      }))
      .filter((song: Song) => Boolean(song.audioUrl));
  }, [data?.trendingSongs]);

  const top = songs[0];
  if (!top) return null;

  return (
    <section className="w-full px-6 py-2">
      <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight mb-4">
        Top Song Today
      </h2>
      <button
        type="button"
        onClick={() => onOpenMusicPlayer(top, songs, "Top Song Today")}
        className="w-full rounded-2xl overflow-hidden border border-white/10 bg-white/[0.03] text-left"
      >
        <img
          src={top.coverImageUrl || "https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=400"}
          alt={top.title}
          className="w-full h-44 object-cover"
        />
        <div className="p-4">
          <p className="text-white font-semibold text-base line-clamp-1">{top.title}</p>
          <p className="text-white/65 text-sm line-clamp-1">{top.artist}</p>
        </div>
      </button>
    </section>
  );
};
