interface MoodCache {
  categories: any[];
  timestamp: number;
}

let moodCategoriesCache: MoodCache | null = null;
const CACHE_TTL = 10 * 60 * 1000;

export const getCachedMoodCategories = (): any[] | null => {
  if (!moodCategoriesCache) return null;

  if (Date.now() - moodCategoriesCache.timestamp > CACHE_TTL) {
    moodCategoriesCache = null;
    return null;
  }

  return moodCategoriesCache.categories;
};

export const setCachedMoodCategories = (categories: any[]): void => {
  moodCategoriesCache = {
    categories,
    timestamp: Date.now()
  };
};

export const clearMoodCache = (): void => {
  moodCategoriesCache = null;
};
