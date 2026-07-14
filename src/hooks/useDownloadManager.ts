import { useState, useEffect } from 'react';
import { downloadManager, DownloadedSong, DownloadProgress } from '../lib/downloadManager';

export const useDownloadManager = () => {
  const [downloadedSongs, setDownloadedSongs] = useState<DownloadedSong[]>([]);
  const [activeDownloads, setActiveDownloads] = useState<Map<string, DownloadProgress>>(new Map());
  const [isInitialized, setIsInitialized] = useState(false);

  // Cleanup effect
  useEffect(() => {
    return () => {
      // Cleanup download manager on unmount
      downloadManager.cleanup();
    };
  }, []);

  useEffect(() => {
    // Wait for download manager to initialize before loading downloads
    const initializeAndLoad = async () => {
      // Give the download manager time to initialize IndexedDB
      await new Promise(resolve => setTimeout(resolve, 100));
      loadDownloads();
      setIsInitialized(true);
    };

    initializeAndLoad();
  }, []);

  const loadDownloads = () => {
    console.log('📋 Loading downloads into UI...');
    const songs = downloadManager.getDownloadedSongs();
    console.log(`Found ${songs.length} downloads in download manager`);
    songs.forEach(song => {
      console.log(`- ${song.title} (${song.id}): ${song.localPath}`);
    });
    setDownloadedSongs(songs);
  };

  const downloadSong = async (songData: {
    id: string;
    title: string;
    artist: string;
    album?: string;
    duration: string;
    audioUrl: string;
    coverImageUrl?: string;
  }) => {
    try {
      await downloadManager.downloadSong(songData, (progress) => {
        setActiveDownloads(prev => new Map(prev.set(songData.id, progress)));
        
        if (progress.status === 'completed' || progress.status === 'failed') {
          setActiveDownloads(prev => {
            const newMap = new Map(prev);
            newMap.delete(songData.id);
            return newMap;
          });
          
          if (progress.status === 'completed') {
            loadDownloads();
          }
        }
      });
    } catch (error) {
      setActiveDownloads(prev => {
        const newMap = new Map(prev);
        newMap.delete(songData.id);
        return newMap;
      });
      throw error;
    }
  };

  const deleteSong = async (downloadId: string) => {
    const success = await downloadManager.deleteDownload(downloadId);
    if (success) {
      loadDownloads();
    }
    return success;
  };

  const clearAllDownloads = async () => {
    await downloadManager.clearAllDownloads();
    setDownloadedSongs([]);
    setActiveDownloads(new Map());
    console.log('Download manager state cleared');
  };

  const isDownloaded = (songId: string) => {
    return downloadManager.isDownloaded(songId);
  };

  const getDownloadProgress = (songId: string) => {
    return activeDownloads.get(songId) || null;
  };

  const getTotalSize = () => {
    return downloadManager.getTotalDownloadSize();
  };

  const formatFileSize = (bytes: number) => {
    return downloadManager.formatFileSize(bytes);
  };

  return {
    downloadedSongs,
    activeDownloads: Array.from(activeDownloads.values()),
    downloadSong,
    deleteSong,
    clearAllDownloads,
    isDownloaded,
    getDownloadProgress,
    getTotalSize,
    formatFileSize,
    loadDownloads,
  };
};