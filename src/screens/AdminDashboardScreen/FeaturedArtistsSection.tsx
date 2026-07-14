import { useState, useEffect } from 'react';
import { Plus, Trash2, RefreshCw, Star, TrendingUp, Users, Calendar, MapPin, Search, Music, Globe, X, Flame } from 'lucide-react';
import { supabase, getManualTrendingSongs, addManualTrendingSong, removeManualTrendingSong, getManualBlowingUpSongs, addManualBlowingUpSong, removeManualBlowingUpSong } from '../../lib/supabase';
import { sanitizeForFilter } from '../../lib/filterSecurity';
import { format } from 'date-fns';

interface FeaturedArtist {
  id: string;
  artist_id: string;
  user_id: string;
  region: string;
  featured_start_date: string;
  featured_end_date: string;
  status: 'active' | 'scheduled' | 'expired';
  weekly_growth_percentage: number;
  total_likes_last_week: number;
  avg_completion_rate: number;
  last_upload_date: string | null;
  auto_selected: boolean;
  priority_order: number;
  artist_name?: string;
  artist_image?: string | null;
  artist_verified?: boolean;
}

interface Artist {
  id: string;
  name: string;
  image_url: string | null;
  verified: boolean;
  user_id: string;
  country: string | null;
}

interface Song {
  id: string;
  title: string;
  artist: string;
  duration_seconds: number;
  cover_image_url: string | null;
  audio_url: string | null;
}

interface ManualTrendingSong {
  id: string;
  song_id: string;
  trending_type: 'global_trending' | 'trending_near_you';
  country_code: string | null;
  display_order: number;
  is_active: boolean;
  added_at: string;
  notes: string | null;
  songs: Song & {
    artists: {
      id: string;
      name: string;
      artist_profiles: Array<{
        id: string;
        user_id: string;
        stage_name: string;
        users: {
          display_name: string;
        };
      }>;
    };
  };
}

type TabType = 'featured_artists' | 'global_trending' | 'trending_near_you' | 'blowing_up';

export const FeaturedArtistsSection = (): JSX.Element => {
  const [activeTab, setActiveTab] = useState<TabType>('featured_artists');
  
  // Featured Artists state
  const [featuredArtists, setFeaturedArtists] = useState<FeaturedArtist[]>([]);
  const [availableArtists, setAvailableArtists] = useState<Artist[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedArtist, setSelectedArtist] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('global');
  const [startDate, setStartDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState<string>(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterRegion, setFilterRegion] = useState<string>('all');

  // Trending Songs state
  const [manualTrendingSongs, setManualTrendingSongs] = useState<ManualTrendingSong[]>([]);
  const [isLoadingTrending, setIsLoadingTrending] = useState(false);
  const [songSearch, setSongSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [selectedCountry, setSelectedCountry] = useState<string>('NG'); // Default country for trending_near_you
  const [isSearching, setIsSearching] = useState(false);
  const [searchDebounceTimer, setSearchDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Blowing Up Songs state
  const [manualBlowingUpSongs, setManualBlowingUpSongs] = useState<ManualTrendingSong[]>([]);
  const [isLoadingBlowingUp, setIsLoadingBlowingUp] = useState(false);
  const [blowingUpSongSearch, setBlowingUpSongSearch] = useState('');
  const [blowingUpSearchResults, setBlowingUpSearchResults] = useState<Song[]>([]);
  const [isSearchingBlowingUp, setIsSearchingBlowingUp] = useState(false);
  const [blowingUpSearchDebounceTimer, setBlowingUpSearchDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activeTab === 'featured_artists') {
      fetchFeaturedArtists();
      fetchAvailableArtists();
    } else if (activeTab === 'blowing_up') {
      fetchManualBlowingUpSongs();
    } else {
      fetchManualTrendingSongs();
    }
  }, [activeTab]);

  // Featured Artists functions
  const fetchFeaturedArtists = async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('featured_artists')
        .select(`
          *,
          artists:artist_id (
            id,
            name,
            image_url,
            verified
          )
        `)
        .order('priority_order', { ascending: true });

      if (filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }

      if (filterRegion !== 'all') {
        query = query.eq('region', filterRegion);
      }

      const { data, error } = await query;

      if (error) throw error;

      const processed = data.map((fa: any) => ({
        ...fa,
        artist_name: fa.artists?.name || 'Unknown',
        artist_image: fa.artists?.image_url,
        artist_verified: fa.artists?.verified || false
      }));

      setFeaturedArtists(processed);
    } catch (err) {
      console.error('Error fetching featured artists:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchAvailableArtists = async () => {
    try {
      const { data, error } = await supabase
        .from('artists')
        .select(`
          id,
          name,
          image_url,
          verified,
          artist_profiles!inner (
            user_id,
            country
          )
        `)
        .order('name', { ascending: true });

      if (error) throw error;

      const processed = data.map((artist: any) => ({
        id: artist.id,
        name: artist.name,
        image_url: artist.image_url,
        verified: artist.verified,
        user_id: artist.artist_profiles[0]?.user_id,
        country: artist.artist_profiles[0]?.country || null
      }));

      setAvailableArtists(processed);
    } catch (err) {
      console.error('Error fetching artists:', err);
    }
  };

  const handleAddFeaturedArtist = async () => {
    if (!selectedArtist) {
      alert('Please select an artiste');
      return;
    }

    const artist = availableArtists.find(a => a.id === selectedArtist);
    if (!artist) return;

    try {
      const { error } = await supabase
        .from('featured_artists')
        .insert({
          artist_id: selectedArtist,
          user_id: artist.user_id,
          region: selectedRegion,
          featured_start_date: new Date(startDate).toISOString(),
          featured_end_date: new Date(endDate).toISOString(),
          status: new Date(startDate) > new Date() ? 'scheduled' : 'active',
          auto_selected: false,
          priority_order: featuredArtists.length
        });

      if (error) throw error;

      alert('Featured artiste added successfully!');
      setIsAdding(false);
      setSelectedArtist('');
      fetchFeaturedArtists();
    } catch (err) {
      console.error('Error adding featured artist:', err);
      alert('Failed to add featured artiste');
    }
  };

  const handleRemoveFeaturedArtist = async (id: string) => {
    if (!confirm('Are you sure you want to remove this featured artiste?')) return;

    try {
      const { error } = await supabase
        .from('featured_artists')
        .delete()
        .eq('id', id);

      if (error) throw error;

      alert('Featured artiste removed successfully!');
      fetchFeaturedArtists();
    } catch (err) {
      console.error('Error removing featured artist:', err);
      alert('Failed to remove featured artiste');
    }
  };

  const handleRunAutoSelection = async () => {
    if (
      !confirm(
        'This replaces auto-selected featured artistes with eligible artistes from Section Thresholds (Featured Artists). Manual picks are kept. Continue?'
      )
    ) {
      return;
    }

    setIsRefreshing(true);
    try {
      const { data, error } = await supabase.rpc('update_featured_artists_weekly');

      if (error) {
        console.error('update_featured_artists_weekly:', error);
        throw new Error(
          `${error.message}\n\nDeploy docs/sql/update_featured_artists_weekly.sql in Supabase SQL Editor if this function is missing.`
        );
      }

      const inserted =
        data && typeof data === 'object' && 'inserted' in data
          ? Number((data as { inserted?: number }).inserted)
          : null;
      const message =
        data && typeof data === 'object' && 'message' in data
          ? String((data as { message?: string }).message)
          : null;

      if (message && data && typeof data === 'object' && (data as { ok?: boolean }).ok === false) {
        alert(message);
      } else if (inserted === 0) {
        alert(
          'Auto-selection finished but added 0 artistes. Lower min plays/likes in Section Thresholds → Featured Artists, or ensure artistes have enough activity in the time window.'
        );
      } else {
        alert(
          inserted != null
            ? `Auto-selection added ${inserted} artiste(s).`
            : 'Auto-selection completed successfully!'
        );
      }
      fetchFeaturedArtists();
    } catch (err) {
      console.error('Error running auto-selection:', err);
      alert(err instanceof Error ? err.message : 'Failed to run auto-selection');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from('featured_artists')
        .update({ status: newStatus })
        .eq('id', id);

      if (error) throw error;

      fetchFeaturedArtists();
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Failed to update status');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'scheduled':
        return 'bg-blue-100 text-blue-800';
      case 'expired':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Trending Songs functions
  const fetchManualTrendingSongs = async () => {
    setIsLoadingTrending(true);
    try {
      const trendingType = activeTab === 'global_trending' ? 'global_trending' : 'trending_near_you';
      const countryCode = activeTab === 'trending_near_you' ? selectedCountry : undefined;
      const data = await getManualTrendingSongs(trendingType, countryCode);
      setManualTrendingSongs(data);
    } catch (err) {
      console.error('Error fetching manual trending songs:', err);
    } finally {
      setIsLoadingTrending(false);
    }
  };

  const searchSongs = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      // First, search by song title
      const { data: titleData, error: titleError } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          cover_image_url,
          audio_url,
          artist_id,
          artists:artist_id(
            id,
            name,
            artist_profiles(
              id,
              user_id,
              stage_name,
              users:user_id(display_name)
            )
          )
        `)
        .ilike('title', `%${sanitizeForFilter(query?.trim() || '')}%`)
        .not('audio_url', 'is', null)
        .limit(20);

      if (titleError) {
        console.error('Error searching by title:', titleError);
      }

      // Also search by artist name - search artists table first
      let artistFiltered: any[] = [];
      try {
        const { data: matchingArtists, error: artistSearchError } = await supabase
          .from('artists')
          .select('id, name')
          .ilike('name', `%${sanitizeForFilter(query?.trim() || '')}%`)
          .limit(10);

        if (artistSearchError) {
          console.error('Error searching artists:', artistSearchError);
        } else if (matchingArtists && matchingArtists.length > 0) {
          const artistIds = matchingArtists.map(a => a.id);
          const { data: artistSongsData, error: artistSongsError } = await supabase
            .from('songs')
            .select(`
              id,
              title,
              duration_seconds,
              cover_image_url,
              audio_url,
              artist_id,
              artists:artist_id(
                id,
                name,
                artist_profiles(
                  id,
                  user_id,
                  stage_name,
                  users:user_id(display_name)
                )
              )
            `)
            .in('artist_id', artistIds)
            .not('audio_url', 'is', null)
            .limit(20);

          if (artistSongsError) {
            console.error('Error fetching songs by artist:', artistSongsError);
          } else {
            artistFiltered = artistSongsData || [];
          }
        }
      } catch (artistSearchErr) {
        console.error('Error in artist search:', artistSearchErr);
      }

      // Combine and remove duplicates
      const allSongs = [...(titleData || []), ...artistFiltered];
      const uniqueSongs = Array.from(
        new Map(allSongs.map((song: any) => [song.id, song])).values()
      ).slice(0, 20);

      const formatted = uniqueSongs.map((song: any) => {
        let artistName = 'Unknown Artiste';
        if (song.artists?.name) {
          artistName = song.artists.name;
        } else if (song.artists?.artist_profiles?.[0]?.stage_name) {
          artistName = song.artists.artist_profiles[0].stage_name;
        } else if (song.artists?.artist_profiles?.[0]?.users?.display_name) {
          artistName = song.artists.artist_profiles[0].users.display_name;
        }

        return {
          id: song.id,
          title: song.title,
          artist: artistName,
          duration_seconds: song.duration_seconds || 0,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url
        };
      });

      setSearchResults(formatted);
      
      if (formatted.length === 0 && query.length >= 2) {
        console.log('No songs found for query:', query);
        console.log('Title search result:', titleData?.length || 0, 'songs');
        console.log('Artist search result:', artistFiltered.length, 'songs');
      }
      
      if (titleError) {
        console.error('Title search failed:', titleError);
      }
    } catch (error) {
      console.error('Error searching songs:', error);
      setSearchResults([]);
      alert('Error searching songs. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddTrendingSong = async (song: Song) => {
    const trendingType = activeTab === 'global_trending' ? 'global_trending' : 'trending_near_you';
    const countryCode = activeTab === 'trending_near_you' ? selectedCountry : undefined;

    // Check if song already exists
    const exists = manualTrendingSongs.some(mts => mts.song_id === song.id && mts.is_active);
    if (exists) {
      alert('This song is already in the trending list');
      return;
    }

    try {
      const result = await addManualTrendingSong(song.id, trendingType, countryCode);
      if (result.success) {
        alert('Song added to trending list successfully!');
        setSongSearch('');
        setSearchResults([]);
        // Clear debounce timer if exists
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
        }
        fetchManualTrendingSongs();
      } else {
        const errorMsg = result.error || 'Unknown error';
        const details = result.details;
        console.error('Failed to add song:', errorMsg);
        console.error('Error details:', details);
        
        // Build a more helpful error message
        let fullErrorMsg = `Failed to add song to trending list:\n\n${errorMsg}`;
        
        if (details?.instructions) {
          fullErrorMsg += `\n\n${details.instructions}`;
        }
        
        if (details?.migrationFile) {
          fullErrorMsg += `\n\nMigration file: ${details.migrationFile}`;
        }
        
        if (details?.tableExists === false) {
          fullErrorMsg += '\n\nAction required: Apply the migration to your Supabase database.';
        } else if (details?.columnsExist === false && details?.tableExists === true) {
          fullErrorMsg += '\n\nAction required: Refresh schema cache or restart PostgREST service in Supabase dashboard.';
        }
        
        fullErrorMsg += '\n\nCheck browser console for detailed error information.';
        
        alert(fullErrorMsg);
      }
    } catch (error: any) {
      console.error('Error adding trending song:', error);
      alert(`An error occurred while adding the song: ${error?.message || 'Unknown error'}\n\nCheck console for details.`);
    }
  };

  const handleRemoveTrendingSong = async (id: string) => {
    if (!confirm('Are you sure you want to remove this song from the trending list?')) return;

    const success = await removeManualTrendingSong(id);
    if (success) {
      alert('Song removed from trending list successfully!');
      fetchManualTrendingSongs();
    } else {
      alert('Failed to remove song from trending list');
    }
  };

  const formatDuration = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getArtistName = (song: ManualTrendingSong['songs']) => {
    if (song.artists?.name) return song.artists.name;
    if (song.artists?.artist_profiles?.[0]?.stage_name) return song.artists.artist_profiles[0].stage_name;
    if (song.artists?.artist_profiles?.[0]?.users?.display_name) return song.artists.artist_profiles[0].users.display_name;
    return 'Unknown Artiste';
  };

  // Blowing Up Songs functions
  const fetchManualBlowingUpSongs = async () => {
    setIsLoadingBlowingUp(true);
    try {
      const data = await getManualBlowingUpSongs();
      setManualBlowingUpSongs(data);
    } catch (err) {
      console.error('Error fetching manual blowing up songs:', err);
    } finally {
      setIsLoadingBlowingUp(false);
    }
  };

  const searchBlowingUpSongs = async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setBlowingUpSearchResults([]);
      return;
    }

    setIsSearchingBlowingUp(true);
    try {
      // First, search by song title
      const { data: titleData, error: titleError } = await supabase
        .from('songs')
        .select(`
          id,
          title,
          duration_seconds,
          cover_image_url,
          audio_url,
          artist_id,
          artists:artist_id(
            id,
            name,
            artist_profiles(
              id,
              user_id,
              stage_name,
              users:user_id(display_name)
            )
          )
        `)
        .ilike('title', `%${sanitizeForFilter(query?.trim() || '')}%`)
        .not('audio_url', 'is', null)
        .limit(20);

      if (titleError) {
        console.error('Error searching by title:', titleError);
      }

      // Also search by artist name
      let artistFiltered: any[] = [];
      try {
        const { data: matchingArtists, error: artistSearchError } = await supabase
          .from('artists')
          .select('id, name')
          .ilike('name', `%${sanitizeForFilter(query?.trim() || '')}%`)
          .limit(10);

        if (artistSearchError) {
          console.error('Error searching artists:', artistSearchError);
        } else if (matchingArtists && matchingArtists.length > 0) {
          const artistIds = matchingArtists.map(a => a.id);
          const { data: artistSongsData, error: artistSongsError } = await supabase
            .from('songs')
            .select(`
              id,
              title,
              duration_seconds,
              cover_image_url,
              audio_url,
              artist_id,
              artists:artist_id(
                id,
                name,
                artist_profiles(
                  id,
                  user_id,
                  stage_name,
                  users:user_id(display_name)
                )
              )
            `)
            .in('artist_id', artistIds)
            .not('audio_url', 'is', null)
            .limit(20);

          if (artistSongsError) {
            console.error('Error fetching songs by artist:', artistSongsError);
          } else {
            artistFiltered = artistSongsData || [];
          }
        }
      } catch (artistSearchErr) {
        console.error('Error in artist search:', artistSearchErr);
      }

      // Combine and remove duplicates
      const allSongs = [...(titleData || []), ...artistFiltered];
      const uniqueSongs = Array.from(
        new Map(allSongs.map((song: any) => [song.id, song])).values()
      ).slice(0, 20);

      const formatted = uniqueSongs.map((song: any) => {
        let artistName = 'Unknown Artiste';
        if (song.artists?.name) {
          artistName = song.artists.name;
        } else if (song.artists?.artist_profiles?.[0]?.stage_name) {
          artistName = song.artists.artist_profiles[0].stage_name;
        } else if (song.artists?.artist_profiles?.[0]?.users?.display_name) {
          artistName = song.artists.artist_profiles[0].users.display_name;
        }

        return {
          id: song.id,
          title: song.title,
          artist: artistName,
          duration_seconds: song.duration_seconds || 0,
          cover_image_url: song.cover_image_url,
          audio_url: song.audio_url
        };
      });

      setBlowingUpSearchResults(formatted);
    } catch (error) {
      console.error('Error searching songs:', error);
      setBlowingUpSearchResults([]);
    } finally {
      setIsSearchingBlowingUp(false);
    }
  };

  useEffect(() => {
    if (blowingUpSearchDebounceTimer) {
      clearTimeout(blowingUpSearchDebounceTimer);
    }

    if (blowingUpSongSearch.length >= 2) {
      const timer = setTimeout(() => {
        searchBlowingUpSongs(blowingUpSongSearch);
      }, 300);
      setBlowingUpSearchDebounceTimer(timer);
    } else {
      setBlowingUpSearchResults([]);
    }

    return () => {
      if (blowingUpSearchDebounceTimer) {
        clearTimeout(blowingUpSearchDebounceTimer);
      }
    };
  }, [blowingUpSongSearch]);

  const handleAddBlowingUpSong = async (song: Song) => {
    // Check if song already exists
    const exists = manualBlowingUpSongs.some(mbs => mbs.song_id === song.id && mbs.is_active);
    if (exists) {
      alert('This song is already in the blowing up list');
      return;
    }

    try {
      console.log('Adding song to blowing up list:', song);
      const result = await addManualBlowingUpSong(song.id);
      console.log('Add result:', result);
      
      if (result.success) {
        alert('Song added to blowing up list successfully!');
        setBlowingUpSongSearch('');
        setBlowingUpSearchResults([]);
        if (blowingUpSearchDebounceTimer) {
          clearTimeout(blowingUpSearchDebounceTimer);
        }
        fetchManualBlowingUpSongs();
      } else {
        const errorMsg = result.error || 'Unknown error';
        const detailsMsg = result.details ? `\n\nDetails: ${JSON.stringify(result.details, null, 2)}` : '';
        console.error('Failed to add song:', result);
        alert(`Failed to add song: ${errorMsg}${detailsMsg}`);
      }
    } catch (error: any) {
      console.error('Error adding blowing up song:', error);
      const errorDetails = error?.details ? `\n\nDetails: ${JSON.stringify(error.details, null, 2)}` : '';
      alert(`An error occurred: ${error?.message || 'Unknown error'}${errorDetails}`);
    }
  };

  const handleRemoveBlowingUpSong = async (id: string) => {
    if (!confirm('Are you sure you want to remove this song from the blowing up list?')) return;

    const success = await removeManualBlowingUpSong(id);
    if (success) {
      alert('Song removed from blowing up list successfully!');
      fetchManualBlowingUpSongs();
    } else {
      alert('Failed to remove song from blowing up list');
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Trending & Featured Management</h2>
        <p className="text-sm text-gray-600 mt-1">
          Manage featured artists and manually curated trending songs
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex space-x-8">
          <button
            onClick={() => setActiveTab('featured_artists')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'featured_artists'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4" />
              Featured Artistes
            </div>
          </button>
          <button
            onClick={() => setActiveTab('global_trending')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'global_trending'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4" />
              Global Trending
            </div>
          </button>
          <button
            onClick={() => setActiveTab('trending_near_you')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'trending_near_you'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              Trending Near You
            </div>
          </button>
          <button
            onClick={() => setActiveTab('blowing_up')}
            className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
              activeTab === 'blowing_up'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4" />
              Blowing Up
            </div>
          </button>
        </nav>
      </div>

      {/* Featured Artistes Tab */}
      {activeTab === 'featured_artists' && (
        <>
          <div className="flex items-center justify-between mb-6">
            <div className="flex gap-3">
              <button
                onClick={handleRunAutoSelection}
                disabled={isRefreshing}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400"
              >
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                Auto-Select Eligible Artistes
              </button>
              <button
                onClick={() => setIsAdding(!isAdding)}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Featured Artiste
              </button>
            </div>
          </div>

          {isAdding && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Featured Artiste</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select Artiste
                  </label>
                  <select
                    value={selectedArtist}
                    onChange={(e) => setSelectedArtist(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="">Choose an artiste...</option>
                    {availableArtists.map((artist) => (
                      <option key={artist.id} value={artist.id}>
                        {artist.name} {artist.verified ? '✓' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Region
                  </label>
                  <select
                    value={selectedRegion}
                    onChange={(e) => setSelectedRegion(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  >
                    <option value="global">Global</option>
                    <option value="US">United States</option>
                    <option value="UK">United Kingdom</option>
                    <option value="CA">Canada</option>
                    <option value="NG">Nigeria</option>
                    <option value="GH">Ghana</option>
                    <option value="KE">Kenya</option>
                    <option value="ZA">South Africa</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleAddFeaturedArtist}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Add Artiste
                </button>
                <button
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="mb-4 flex gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Status</label>
              <select
                value={filterStatus}
                onChange={(e) => {
                  setFilterStatus(e.target.value);
                  fetchFeaturedArtists();
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="scheduled">Scheduled</option>
                <option value="expired">Expired</option>
              </select>
            </div>

            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Region</label>
              <select
                value={filterRegion}
                onChange={(e) => {
                  setFilterRegion(e.target.value);
                  fetchFeaturedArtists();
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="all">All Regions</option>
                <option value="global">Global</option>
                <option value="US">United States</option>
                <option value="UK">United Kingdom</option>
                <option value="CA">Canada</option>
                <option value="NG">Nigeria</option>
                <option value="GH">Ghana</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
              <p className="ml-3 text-gray-600">Loading featured artistes...</p>
            </div>
          ) : featuredArtists.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg">
              <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p className="text-gray-600">No featured artistes found</p>
              <p className="text-sm text-gray-500 mt-1">
                {filterStatus !== 'all' || filterRegion !== 'all'
                  ? 'Try adjusting your filters or add a new featured artiste'
                  : 'Add a featured artiste or run auto-selection'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto scrollbar-hide">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Artiste
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Region
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Period
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Metrics
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {featuredArtists.map((artist) => (
                    <tr key={artist.id} className="hover:bg-gray-50">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full overflow-hidden bg-gray-200 flex-shrink-0">
                            {artist.artist_image ? (
                              <img
                                src={artist.artist_image}
                                alt={artist.artist_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Users className="w-6 h-6 text-gray-400 m-2" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-gray-900">{artist.artist_name}</p>
                              {artist.artist_verified && (
                                <Star className="w-4 h-4 text-blue-600 fill-blue-600" />
                              )}
                            </div>
                            <p className="text-xs text-gray-500">Priority: {artist.priority_order}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1">
                          <MapPin className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-900">{artist.region}</span>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <select
                          value={artist.status}
                          onChange={(e) => handleUpdateStatus(artist.id, e.target.value)}
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusColor(artist.status)}`}
                        >
                          <option value="active">Active</option>
                          <option value="scheduled">Scheduled</option>
                          <option value="expired">Expired</option>
                        </select>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-1 text-xs text-gray-600">
                          <Calendar className="w-3 h-3" />
                          <div>
                            <p>{format(new Date(artist.featured_start_date), 'MMM d, yyyy')}</p>
                            <p className="text-gray-400">to</p>
                            <p>{format(new Date(artist.featured_end_date), 'MMM d, yyyy')}</p>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center gap-1">
                            <TrendingUp className="w-3 h-3 text-green-600" />
                            <span className="text-gray-600">Growth:</span>
                            <span className="font-medium text-green-600">
                              {artist.weekly_growth_percentage.toFixed(1)}%
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-600">Likes:</span>
                            <span className="font-medium">{artist.total_likes_last_week}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-600">Completion:</span>
                            <span className="font-medium">{artist.avg_completion_rate.toFixed(1)}%</span>
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-4">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${
                            artist.auto_selected
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-purple-100 text-purple-800'
                          }`}
                        >
                          {artist.auto_selected ? 'Auto' : 'Manual'}
                        </span>
                      </td>

                      <td className="px-4 py-4 text-right">
                        <button
                          onClick={() => handleRemoveFeaturedArtist(artist.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2">Auto-Selection Criteria</h4>
            <ul className="text-sm text-blue-800 space-y-1">
              <li>Uses <strong>Section Thresholds → Featured Artists</strong> (min plays, min likes, time window)</li>
              <li>Replaces previous auto-selected rows; manual picks are not removed</li>
              <li>Requires <code className="text-xs">update_featured_artists_weekly</code> in Supabase (see docs/sql/update_featured_artists_weekly.sql)</li>
              <li>Regional artistes shown first to users from their region on home</li>
            </ul>
          </div>
        </>
      )}

      {/* Global Trending Tab */}
      {activeTab === 'global_trending' && (
        <>
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                Manually add songs to the Global Trending section. These songs will appear alongside auto-trending songs.
              </p>
            </div>

            {/* Song Search */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search and Add Songs
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by song title or artiste name (min 2 characters)..."
                    value={songSearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSongSearch(value);
                      
                      // Clear previous timer
                      if (searchDebounceTimer) {
                        clearTimeout(searchDebounceTimer);
                      }
                      
                      // If input is cleared, clear results immediately
                      if (!value.trim()) {
                        setSearchResults([]);
                        return;
                      }
                      
                      // Debounce search for better performance
                      const timer = setTimeout(() => {
                        if (value.trim().length >= 2) {
                          searchSongs(value.trim());
                        } else {
                          setSearchResults([]);
                        }
                      }, 300);
                      
                      setSearchDebounceTimer(timer);
                    }}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  {isSearching && (
                    <div className="absolute right-10 top-1/2 transform -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin"></div>
                    </div>
                  )}
                  {songSearch && !isSearching && (
                    <button
                      onClick={() => {
                        setSongSearch('');
                        setSearchResults([]);
                        if (searchDebounceTimer) {
                          clearTimeout(searchDebounceTimer);
                        }
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Search Results */}
              {searchResults.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg bg-white max-h-60 overflow-y-auto">
                  {searchResults.map((song) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 cursor-pointer"
                      onClick={() => handleAddTrendingSong(song)}
                    >
                      <div className="w-12 h-12 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                        {song.cover_image_url ? (
                          <img src={song.cover_image_url} alt={song.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{song.title}</p>
                        <p className="text-sm text-gray-600 truncate">{song.artist}</p>
                      </div>
                      <div className="text-sm text-gray-500">{formatDuration(song.duration_seconds)}</div>
                      <button className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors">
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Manual Trending Songs List */}
            {isLoadingTrending ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
                <p className="ml-3 text-gray-600">Loading trending songs...</p>
              </div>
            ) : manualTrendingSongs.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <Music className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No manually added trending songs</p>
                <p className="text-sm text-gray-500 mt-1">Search and add songs to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-900">Manually Added Songs ({manualTrendingSongs.length})</h3>
                {manualTrendingSongs.map((mts) => (
                  <div
                    key={mts.id}
                    className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <div className="w-16 h-16 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                      {mts.songs.cover_image_url ? (
                        <img
                          src={mts.songs.cover_image_url}
                          alt={mts.songs.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music className="w-8 h-8 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{mts.songs.title}</p>
                      <p className="text-sm text-gray-600">{getArtistName(mts.songs)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Added {format(new Date(mts.added_at), 'MMM d, yyyy')} • Order: {mts.display_order}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveTrendingSong(mts.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Trending Near You Tab */}
      {activeTab === 'trending_near_you' && (
        <>
          <div className="mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-600">
                Manually add songs to the Trending Near You section. These songs will appear alongside auto-trending songs for the selected country.
              </p>
            </div>

            {/* Country Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Country
              </label>
              <select
                value={selectedCountry}
                onChange={(e) => {
                  setSelectedCountry(e.target.value);
                  fetchManualTrendingSongs();
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                <option value="NG">Nigeria</option>
                <option value="GH">Ghana</option>
                <option value="KE">Kenya</option>
                <option value="ZA">South Africa</option>
                <option value="US">United States</option>
                <option value="GB">United Kingdom</option>
                <option value="CA">Canada</option>
                <option value="JM">Jamaica</option>
                <option value="TZ">Tanzania</option>
                <option value="UG">Uganda</option>
                <option value="RW">Rwanda</option>
                <option value="ET">Ethiopia</option>
              </select>
            </div>

            {/* Song Search */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search and Add Songs
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by song title or artiste name (min 2 characters)..."
                    value={songSearch}
                    onChange={(e) => {
                      const value = e.target.value;
                      setSongSearch(value);
                      
                      // Clear previous timer
                      if (searchDebounceTimer) {
                        clearTimeout(searchDebounceTimer);
                      }
                      
                      // If input is cleared, clear results immediately
                      if (!value.trim()) {
                        setSearchResults([]);
                        return;
                      }
                      
                      // Debounce search for better performance
                      const timer = setTimeout(() => {
                        if (value.trim().length >= 2) {
                          searchSongs(value.trim());
                        } else {
                          setSearchResults([]);
                        }
                      }, 300);
                      
                      setSearchDebounceTimer(timer);
                    }}
                    className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                  {isSearching && (
                    <div className="absolute right-10 top-1/2 transform -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-green-600 rounded-full animate-spin"></div>
                    </div>
                  )}
                  {songSearch && !isSearching && (
                    <button
                      onClick={() => {
                        setSongSearch('');
                        setSearchResults([]);
                        if (searchDebounceTimer) {
                          clearTimeout(searchDebounceTimer);
                        }
                      }}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Search Results */}
              {isSearching && searchResults.length === 0 && songSearch.length >= 2 && (
                <div className="mt-2 p-4 text-center text-gray-500 text-sm">
                  Searching...
                </div>
              )}
              {!isSearching && searchResults.length === 0 && songSearch.length >= 2 && (
                <div className="mt-2 p-4 text-center text-gray-500 text-sm">
                  No songs found. Try a different search term.
                </div>
              )}
              {searchResults.length > 0 && (
                <div className="mt-2 border border-gray-200 rounded-lg bg-white max-h-60 overflow-y-auto">
                  {searchResults.map((song) => (
                    <div
                      key={song.id}
                      className="flex items-center gap-3 p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 cursor-pointer"
                      onClick={() => handleAddTrendingSong(song)}
                    >
                      <div className="w-12 h-12 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                        {song.cover_image_url ? (
                          <img src={song.cover_image_url} alt={song.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{song.title}</p>
                        <p className="text-sm text-gray-600 truncate">{song.artist}</p>
                      </div>
                      <div className="text-sm text-gray-500">{formatDuration(song.duration_seconds)}</div>
                      <button className="px-3 py-1 bg-green-600 text-white text-sm rounded hover:bg-green-700 transition-colors">
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Manual Trending Songs List */}
            {isLoadingTrending ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
                <p className="ml-3 text-gray-600">Loading trending songs...</p>
              </div>
            ) : manualTrendingSongs.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <Music className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No manually added trending songs for {selectedCountry}</p>
                <p className="text-sm text-gray-500 mt-1">Search and add songs to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-900">
                  Manually Added Songs for {selectedCountry} ({manualTrendingSongs.length})
                </h3>
                {manualTrendingSongs.map((mts) => (
                  <div
                    key={mts.id}
                    className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                  >
                    <div className="w-16 h-16 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                      {mts.songs.cover_image_url ? (
                        <img
                          src={mts.songs.cover_image_url}
                          alt={mts.songs.title}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Music className="w-8 h-8 text-gray-400" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{mts.songs.title}</p>
                      <p className="text-sm text-gray-600">{getArtistName(mts.songs)}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Added {format(new Date(mts.added_at), 'MMM d, yyyy')} • Order: {mts.display_order}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveTrendingSong(mts.id)}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Blowing Up Tab */}
      {activeTab === 'blowing_up' && (
        <>
          <div className="mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Manage Blowing Up Songs</h3>
            <p className="text-sm text-gray-600 mb-4">
              Manually add songs to the "Tracks Blowing Up Right Now" section. Manual entries will appear alongside auto-calculated songs based on play counts.
            </p>

            {/* Song Search */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Search and Add Songs
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                  <input
                    type="text"
                    placeholder="Search by song title or artiste name (min 2 characters)..."
                    value={blowingUpSongSearch}
                    onChange={(e) => {
                      setBlowingUpSongSearch(e.target.value);
                    }}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                  />
                </div>
              </div>

              {/* Search Results */}
              {isSearchingBlowingUp && (
                <div className="mt-2 text-sm text-gray-500">Searching...</div>
              )}

              {blowingUpSearchResults.length > 0 && (
                <div className="mt-4 border border-gray-200 rounded-lg max-h-64 overflow-y-auto">
                  {blowingUpSearchResults.map((song) => {
                    const isAlreadyAdded = manualBlowingUpSongs.some(
                      mbs => mbs.song_id === song.id && mbs.is_active
                    );
                    return (
                      <div
                        key={song.id}
                        className={`p-3 border-b border-gray-100 last:border-b-0 flex items-center justify-between ${
                          isAlreadyAdded ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1">
                          <div className="w-12 h-12 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                            {song.cover_image_url ? (
                              <img
                                src={song.cover_image_url}
                                alt={song.title}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Music className="w-6 h-6 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-gray-900 truncate">{song.title}</p>
                            <p className="text-sm text-gray-600 truncate">{song.artist}</p>
                            {song.duration_seconds > 0 && (
                              <p className="text-xs text-gray-500">{formatDuration(song.duration_seconds)}</p>
                            )}
                          </div>
                        </div>
                        <button
                          onClick={() => handleAddBlowingUpSong(song)}
                          disabled={isAlreadyAdded}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isAlreadyAdded
                              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                              : 'bg-green-600 text-white hover:bg-green-700'
                          }`}
                        >
                          {isAlreadyAdded ? 'Already Added' : 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {blowingUpSongSearch.length >= 2 && !isSearchingBlowingUp && blowingUpSearchResults.length === 0 && (
                <div className="mt-2 text-sm text-gray-500">No songs found</div>
              )}
            </div>
          </div>

          {/* Current Blowing Up Songs List */}
          <div className="mt-6">
            <h4 className="text-md font-semibold text-gray-900 mb-4">Current Blowing Up Songs ({manualBlowingUpSongs.length})</h4>
            {isLoadingBlowingUp ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin"></div>
                <p className="ml-3 text-gray-600">Loading songs...</p>
              </div>
            ) : manualBlowingUpSongs.length === 0 ? (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <Music className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No songs in blowing up list</p>
                <p className="text-sm text-gray-500 mt-1">Search and add songs above</p>
              </div>
            ) : (
              <div className="space-y-3">
                {manualBlowingUpSongs.map((item) => {
                  const song = item.songs;
                  if (!song) return null;
                  
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition-colors"
                    >
                      <div className="w-16 h-16 rounded overflow-hidden bg-gray-200 flex-shrink-0">
                        {song.cover_image_url ? (
                          <img
                            src={song.cover_image_url}
                            alt={song.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Music className="w-8 h-8 text-gray-400" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{song.title}</p>
                        <p className="text-sm text-gray-600">{getArtistName(song)}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          Added {format(new Date(item.added_at), 'MMM d, yyyy')} • Order: {item.display_order}
                        </p>
                        {item.notes && (
                          <p className="text-xs text-gray-400 mt-1">{item.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={() => handleRemoveBlowingUpSong(item.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
