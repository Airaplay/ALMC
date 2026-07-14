class FavoritesCache {
  private readonly STORAGE_KEY = 'airaplay_favorites';
  private readonly TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  private memoryCache: {
    songs: Set<string>;
    albums: Set<string>;
    videos: Set<string>;
    timestamp: number;
  };

  constructor() {
    this.memoryCache = {
      songs: new Set(),
      albums: new Set(),
      videos: new Set(),
      timestamp: Date.now()
    };
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Date.now() - parsed.timestamp < this.TTL) {
          this.memoryCache = {
            songs: new Set(parsed.songs || []),
            albums: new Set(parsed.albums || []),
            videos: new Set(parsed.videos || []),
            timestamp: parsed.timestamp
          };
        }
      }
    } catch (error) {
      console.error('Error loading favorites cache:', error);
    }
  }

  private saveToStorage(): void {
    try {
      if (!this.memoryCache) return;

      const toStore = {
        songs: Array.from(this.memoryCache.songs),
        albums: Array.from(this.memoryCache.albums),
        videos: Array.from(this.memoryCache.videos),
        timestamp: Date.now()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(toStore));
    } catch (error) {
      console.error('Error saving favorites cache:', error);
    }
  }

  isSongFavorited(songId: string): boolean {
    return this.memoryCache.songs.has(songId);
  }

  isAlbumFavorited(albumId: string): boolean {
    return this.memoryCache.albums.has(albumId);
  }

  isVideoFavorited(videoId: string): boolean {
    return this.memoryCache.videos.has(videoId);
  }

  setSongFavorited(songId: string, favorited: boolean): void {
    if (favorited) {
      this.memoryCache.songs.add(songId);
    } else {
      this.memoryCache.songs.delete(songId);
    }
    this.memoryCache.timestamp = Date.now();
    this.saveToStorage();
  }

  setAlbumFavorited(albumId: string, favorited: boolean): void {
    if (favorited) {
      this.memoryCache.albums.add(albumId);
    } else {
      this.memoryCache.albums.delete(albumId);
    }
    this.memoryCache.timestamp = Date.now();
    this.saveToStorage();
  }

  setVideoFavorited(videoId: string, favorited: boolean): void {
    if (favorited) {
      this.memoryCache.videos.add(videoId);
    } else {
      this.memoryCache.videos.delete(videoId);
    }
    this.memoryCache.timestamp = Date.now();
    this.saveToStorage();
  }

  updateFromServer(data: {
    songs?: string[];
    albums?: string[];
    videos?: string[];
  }): void {
    this.memoryCache = {
      songs: new Set(data.songs || []),
      albums: new Set(data.albums || []),
      videos: new Set(data.videos || []),
      timestamp: Date.now()
    };
    this.saveToStorage();
  }

  getSongFavorites(): string[] {
    return Array.from(this.memoryCache.songs);
  }

  getAlbumFavorites(): string[] {
    return Array.from(this.memoryCache.albums);
  }

  getVideoFavorites(): string[] {
    return Array.from(this.memoryCache.videos);
  }

  getAllFavoritesMap(): { songs: Record<string, boolean>; albums: Record<string, boolean>; videos: Record<string, boolean> } {
    const songsMap: Record<string, boolean> = {};
    const albumsMap: Record<string, boolean> = {};
    const videosMap: Record<string, boolean> = {};

    this.memoryCache.songs.forEach(id => songsMap[id] = true);
    this.memoryCache.albums.forEach(id => albumsMap[id] = true);
    this.memoryCache.videos.forEach(id => videosMap[id] = true);

    return { songs: songsMap, albums: albumsMap, videos: videosMap };
  }

  clear(): void {
    this.memoryCache = {
      songs: new Set(),
      albums: new Set(),
      videos: new Set(),
      timestamp: Date.now()
    };
    try {
      localStorage.removeItem(this.STORAGE_KEY);
    } catch (error) {
      console.error('Error clearing favorites cache:', error);
    }
  }

  invalidate(): void {
    this.clear();
  }
}

export const favoritesCache = new FavoritesCache();
