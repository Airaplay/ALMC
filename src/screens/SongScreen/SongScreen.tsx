import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useMusicPlayer } from '../../contexts/MusicPlayerContext';

export const SongScreen: React.FC = () => {
  const { songId } = useParams<{ songId: string }>();
  const navigate = useNavigate();
  const { playSong } = useMusicPlayer();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!songId) return;

    const loadAndPlaySong = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { data: song, error: songError } = await supabase
          .from('songs')
          .select(`
            *,
            users:user_id (
              id,
              display_name,
              avatar_url
            )
          `)
          .eq('id', songId)
          .maybeSingle();

        if (songError) throw songError;

        if (!song) {
          setError('Song not found');
          setTimeout(() => navigate('/', { replace: true }), 2000);
          return;
        }

        playSong(song, true, [song], 0, 'shared-link', null);

        setTimeout(() => navigate('/', { replace: true }), 500);
      } catch (err) {
        console.error('Error loading song:', err);
        setError('Failed to load song');
        setTimeout(() => navigate('/', { replace: true }), 2000);
      } finally {
        setIsLoading(false);
      }
    };

    loadAndPlaySong();
  }, [songId, playSong, navigate]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-[#0a0a0a] via-[#0d0d0d] to-[#111111] p-4">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">{error}</p>
          <p className="text-white/60 text-sm">Redirecting to home...</p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return <LoadingScreen variant="premium" message="Loading song..." />;
  }

  return null;
};
