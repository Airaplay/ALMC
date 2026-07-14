import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Music2, Heart, Sparkles, Play, PlayCircle } from 'lucide-react';
import { getMoodCategories, getSongsByMood, logMoodSelection } from '../../lib/moodAnalysisService';
import { supabase } from '../../lib/supabase';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';

interface MoodCategory {
  id: string;
  name: string;
  type: 'mood' | 'activity';
  description: string;
  icon: string;
  color: string;
}

interface Song {
  song_id: string;
  title: string;
  artist_id?: string;
  artist_name: string;
  cover_image_url?: string;
  audio_url: string;
  mood_score: number;
  play_count?: number;
}

export const MoodDiscoveryScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { playSong, isMiniPlayerVisible } = useMusicPlayer();
  const [activeTab, setActiveTab] = useState<'mood' | 'activity'>('mood');
  const [categories, setCategories] = useState<MoodCategory[]>([]);
  const [selectedMood, setSelectedMood] = useState<MoodCategory | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [isLoadingSongs, setIsLoadingSongs] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadMoodCategories();
    getCurrentUser();
  }, []);

  const getCurrentUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    setUserId(user?.id || null);
  };

  const loadMoodCategories = async () => {
    const data = await getMoodCategories();
    setCategories(data);
  };

  const handleMoodSelect = async (mood: MoodCategory) => {
    setSelectedMood(mood);
    setIsLoadingSongs(true);

    if (userId) {
      await logMoodSelection(userId, mood.id);
    }

    const moodSongs = await getSongsByMood(mood.name, 100);

    // Filter to one song per artist for variety
    const artistMap = new Map<string, Song>();
    for (const song of moodSongs) {
      if (!artistMap.has(song.artist_name)) {
        artistMap.set(song.artist_name, song);
      }
    }

    // Convert to array and shuffle for freshness
    const uniqueSongs = Array.from(artistMap.values());
    const shuffledSongs = uniqueSongs.sort(() => Math.random() - 0.5);

    setSongs(shuffledSongs);
    setIsLoadingSongs(false);
  };

  const handleBack = () => {
    if (selectedMood) {
      setSelectedMood(null);
      setSongs([]);
    } else {
      navigate(-1);
    }
  };

  const handlePlaySong = (song: Song) => {
    playSong(
      {
        id: song.song_id,
        title: song.title,
        artist: song.artist_name,
        artistId: song.artist_id,
        coverImageUrl: song.cover_image_url,
        audioUrl: song.audio_url,
        playCount: song.play_count,
      },
      songs.map((s) => ({
        id: s.song_id,
        title: s.title,
        artist: s.artist_name,
        artistId: s.artist_id,
        coverImageUrl: s.cover_image_url,
        audioUrl: s.audio_url,
        playCount: s.play_count,
      }))
    );
  };

  const handlePlayAll = () => {
    if (songs.length === 0) return;

    const formattedPlaylist = songs.map((song) => ({
      id: song.song_id,
      title: song.title,
      artist: song.artist_name,
      artistId: song.artist_id,
      coverImageUrl: song.cover_image_url || null,
      audioUrl: song.audio_url,
      playCount: song.play_count,
    }));

    playSong(
      formattedPlaylist[0],
      true,
      formattedPlaylist,
      0,
      `mood-${selectedMood?.name || 'discovery'}`,
      null
    );
  };

  const filteredCategories = categories.filter((cat) => cat.type === activeTab);

  // Calculate dynamic bottom padding based on mini player and ad banner visibility
  const calculateBottomPadding = () => {
    const navBarHeight = 64; // 4rem
    const miniPlayerHeight = 56; // approximate height
    const adBannerHeight = 50; // typical AdMob banner height
    const baseSpacing = 32; // 2rem extra spacing

    let totalPadding = navBarHeight + baseSpacing;

    if (isMiniPlayerVisible) {
      totalPadding += miniPlayerHeight;

      // Check if ad banner is active
      if (document.body.classList.contains('ad-banner-active')) {
        totalPadding += adBannerHeight;
      }
    }

    return totalPadding;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000]" style={{ paddingBottom: `${calculateBottomPadding()}px` }}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm border-b border-white/5">
        <div className="flex items-center gap-3 p-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-white/10 rounded-full transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex-1 min-w-0">
              <h1 className="font-['Inter',sans-serif] font-bold text-white text-xl truncate">
                {selectedMood ? selectedMood.name : 'Discover by Mood'}
              </h1>
              <p className="font-['Inter',sans-serif] text-white/60 text-xs truncate">
                {selectedMood
                  ? selectedMood.description
                  : 'Find music that matches your feelings'}
              </p>
            </div>
          </div>
          {selectedMood && songs.length > 0 && !isLoadingSongs && (
            <button
              onClick={handlePlayAll}
              className="p-2.5 bg-white hover:bg-white/90 backdrop-blur-sm rounded-full transition-all duration-200 active:scale-95 shadow-lg flex-shrink-0"
              title="Play All"
            >
              <PlayCircle className="w-5 h-5 text-[#309605]" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4">
        {!selectedMood ? (
          <>
            {/* Tabs */}
            <div className="flex gap-2 pt-6 pb-4">
              <button
                onClick={() => setActiveTab('mood')}
                className={`flex-1 py-3 px-4 rounded-xl font-['Inter',sans-serif] font-medium transition-all ${
                  activeTab === 'mood'
                    ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                <Heart className="w-4 h-4 inline-block mr-2" />
                Moods
              </button>
              <button
                onClick={() => setActiveTab('activity')}
                className={`flex-1 py-3 px-4 rounded-xl font-['Inter',sans-serif] font-medium transition-all ${
                  activeTab === 'activity'
                    ? 'bg-[#309605] text-white shadow-lg shadow-[#309605]/20'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                <Music2 className="w-4 h-4 inline-block mr-2" />
                Activities
              </button>
            </div>

            {/* Categories Grid */}
            <div className="grid grid-cols-2 gap-3 pb-6">
              {filteredCategories.map((category) => (
                <button
                  key={category.id}
                  onClick={() => handleMoodSelect(category)}
                  className="group relative bg-white/5 hover:bg-white/10 rounded-2xl p-6 transition-all active:scale-95 border border-white/10"
                  style={{
                    background: `linear-gradient(135deg, ${category.color}15 0%, transparent 100%)`,
                  }}
                >
                  <div className="text-center">
                    <div className="text-4xl mb-3">{category.icon}</div>
                    <h3 className="font-['Inter',sans-serif] font-bold text-white text-base mb-1">
                      {category.name}
                    </h3>
                    <p className="font-['Inter',sans-serif] text-white/60 text-xs line-clamp-2">
                      {category.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="pt-6 pb-6">
            {isLoadingSongs ? (
              <div className="flex flex-col items-center justify-center py-20">
                <div className="w-16 h-16 border-4 border-[#309605]/30 border-t-[#309605] rounded-full animate-spin mb-4"></div>
                <p className="font-['Inter',sans-serif] text-white/60 text-sm">
                  Finding songs for you...
                </p>
              </div>
            ) : songs.length > 0 ? (
              <div className="space-y-2">
                {songs.map((song) => (
                  <button
                    key={song.song_id}
                    onClick={() => handlePlaySong(song)}
                    className="w-full flex items-center gap-3 p-3 bg-white/5 hover:bg-white/10 rounded-xl transition-all active:scale-98 group"
                  >
                    <div className="w-14 h-14 bg-gradient-to-br from-[#309605]/20 to-[#3ba208]/20 rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                      {song.cover_image_url ? (
                        <img
                          src={song.cover_image_url}
                          alt={song.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Music2 className="w-6 h-6 text-[#309605]" />
                      )}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <h4 className="font-['Inter',sans-serif] font-semibold text-white text-sm truncate">
                        {song.title}
                      </h4>
                      <p className="font-['Inter',sans-serif] text-white/60 text-xs truncate">
                        {song.artist_name}
                      </p>
                    </div>
                    <div className="w-10 h-10 bg-white/10 rounded-full flex items-center justify-center">
                      <Play className="w-4 h-4 text-white fill-current" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20">
                <Music2 className="w-20 h-20 text-white/20 mb-4" />
                <p className="font-['Inter',sans-serif] text-white/80 text-center font-medium mb-2">
                  No songs found for this mood yet
                </p>
                <p className="font-['Inter',sans-serif] text-white/40 text-sm text-center">
                  We're analyzing songs daily.
                  <br />
                  Check back soon!
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
