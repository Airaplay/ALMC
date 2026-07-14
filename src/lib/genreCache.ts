interface GenreSongsCache {
  songs: any[];
  genreData: any;
  timestamp: number;
}

const genreCache = new Map<string, GenreSongsCache>();
const CACHE_TTL = 5 * 60 * 1000;

export const getCachedGenreSongs = (genreId: string): GenreSongsCache | null => {
  const cached = genreCache.get(genreId);

  if (!cached) return null;

  if (Date.now() - cached.timestamp > CACHE_TTL) {
    genreCache.delete(genreId);
    return null;
  }

  return cached;
};

export const setCachedGenreSongs = (genreId: string, songs: any[], genreData: any): void => {
  genreCache.set(genreId, {
    songs,
    genreData,
    timestamp: Date.now()
  });
};

export const clearGenreCache = (): void => {
  genreCache.clear();
};
