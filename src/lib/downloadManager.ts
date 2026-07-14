// Download Manager for offline music functionality
export interface DownloadedSong {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: string;
  audioUrl: string;
  coverImageUrl?: string;
  fileSize: number;
  downloadedAt: Date;
  localPath: string;
  songId: string; // Reference to the original song in database
}

export interface DownloadProgress {
  songId: string;
  progress: number; // 0-100
  status: 'downloading' | 'completed' | 'failed' | 'paused';
}

const DB_NAME = 'OfflineMusicDB';
const DB_VERSION = 1;
const AUDIO_STORE = 'audioFiles';
const METADATA_STORE = 'downloadMetadata';

class DownloadManager {
  private downloads: Map<string, DownloadedSong> = new Map();
  private activeDownloads: Map<string, DownloadProgress> = new Map();
  private progressCallbacks: Map<string, (progress: DownloadProgress) => void> = new Map();
  private storageKey = 'downloaded_songs';
  private db: IDBDatabase | null = null;
  private blobURLCache: Map<string, string> = new Map();

  constructor() {
    this.initDB().then(() => {
      this.loadDownloadsFromStorage();
    });
  }

  // Initialize IndexedDB
  private async initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create audio files store
        if (!db.objectStoreNames.contains(AUDIO_STORE)) {
          db.createObjectStore(AUDIO_STORE, { keyPath: 'id' });
        }

        // Create metadata store
        if (!db.objectStoreNames.contains(METADATA_STORE)) {
          db.createObjectStore(METADATA_STORE, { keyPath: 'id' });
        }
      };
    });
  }

  // Load downloads from IndexedDB
  private async loadDownloadsFromStorage() {
    if (!this.db) {
      console.error('IndexedDB not initialized');
      return;
    }

    console.log('📥 Loading downloads from IndexedDB...');

    try {
      const transaction = this.db.transaction([METADATA_STORE], 'readonly');
      const store = transaction.objectStore(METADATA_STORE);
      const request = store.getAll();

      request.onsuccess = async () => {
        const metadata = request.result;
        console.log(`Found ${metadata.length} downloads in IndexedDB`);

        for (const meta of metadata) {
          console.log(`Processing download: ${meta.id} (${meta.title})`);

          // Get the blob from IndexedDB and create a fresh blob URL
          const blobURL = await this.getBlobURL(meta.id);
          if (blobURL) {
            const download = {
              ...meta,
              downloadedAt: new Date(meta.downloadedAt),
              localPath: blobURL
            };
            this.downloads.set(meta.id, download);
            console.log(`✅ Successfully loaded: ${meta.title} with blob URL: ${blobURL}`);
          } else {
            console.error(`❌ Failed to create blob URL for: ${meta.title}`);
          }
        }

        console.log(`📦 Total downloads loaded: ${this.downloads.size}`);
      };

      request.onerror = () => {
        console.error('Error loading downloads from IndexedDB:', request.error);
      };
    } catch (error) {
      console.error('Error loading downloads from storage:', error);
    }
  }

  // Get or create blob URL for a download
  private async getBlobURL(downloadId: string): Promise<string | null> {
    // Check cache first
    if (this.blobURLCache.has(downloadId)) {
      const cachedURL = this.blobURLCache.get(downloadId)!;
      console.log(`Using cached blob URL for ${downloadId}:`, cachedURL);
      return cachedURL;
    }

    if (!this.db) {
      console.error('IndexedDB not initialized when trying to get blob URL');
      return null;
    }

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([AUDIO_STORE], 'readonly');
      const store = transaction.objectStore(AUDIO_STORE);
      const request = store.get(downloadId);

      request.onsuccess = () => {
        if (request.result && request.result.blob) {
          console.log(`Creating new blob URL for ${downloadId}, blob size:`, request.result.blob.size);
          const blobURL = URL.createObjectURL(request.result.blob);
          this.blobURLCache.set(downloadId, blobURL);
          console.log(`Created blob URL: ${blobURL}`);
          resolve(blobURL);
        } else {
          console.error(`No blob found in IndexedDB for ${downloadId}`);
          resolve(null);
        }
      };

      request.onerror = () => {
        console.error('Error getting blob from IndexedDB:', request.error);
        resolve(null);
      };
    });
  }

  // Save audio blob and metadata to IndexedDB
  private async saveToIndexedDB(downloadId: string, blob: Blob, metadata: any): Promise<void> {
    if (!this.db) {
      throw new Error('IndexedDB not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([AUDIO_STORE, METADATA_STORE], 'readwrite');

      // Save audio blob
      const audioStore = transaction.objectStore(AUDIO_STORE);
      audioStore.put({ id: downloadId, blob });

      // Save metadata
      const metaStore = transaction.objectStore(METADATA_STORE);
      metaStore.put({ ...metadata, id: downloadId });

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Delete from IndexedDB
  private async deleteFromIndexedDB(downloadId: string): Promise<void> {
    if (!this.db) {
      throw new Error('IndexedDB not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([AUDIO_STORE, METADATA_STORE], 'readwrite');

      // Delete audio blob
      const audioStore = transaction.objectStore(AUDIO_STORE);
      audioStore.delete(downloadId);

      // Delete metadata
      const metaStore = transaction.objectStore(METADATA_STORE);
      metaStore.delete(downloadId);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  // Check if a song is downloaded
  isDownloaded(songId: string): boolean {
    return Array.from(this.downloads.values()).some(download => download.songId === songId);
  }

  // Get download progress for a song
  getDownloadProgress(songId: string): DownloadProgress | null {
    return this.activeDownloads.get(songId) || null;
  }

  // Get all downloaded songs
  getDownloadedSongs(): DownloadedSong[] {
    return Array.from(this.downloads.values()).sort(
      (a, b) => b.downloadedAt.getTime() - a.downloadedAt.getTime()
    );
  }

  // Get downloaded song by ID
  getDownloadedSong(downloadId: string): DownloadedSong | null {
    return this.downloads.get(downloadId) || null;
  }

  // Get downloaded song by original song ID
  getDownloadedSongBySongId(songId: string): DownloadedSong | null {
    return Array.from(this.downloads.values()).find(download => download.songId === songId) || null;
  }

  // Download a song
  async downloadSong(
    songData: {
      id: string;
      title: string;
      artist: string;
      album?: string;
      duration: string;
      audioUrl: string;
      coverImageUrl?: string;
    },
    onProgress?: (progress: DownloadProgress) => void
  ): Promise<DownloadedSong> {
    const downloadId = `download_${songData.id}_${Date.now()}`;
    
    // Check if already downloaded
    if (this.isDownloaded(songData.id)) {
      throw new Error('Song is already downloaded');
    }

    // Check if currently downloading
    if (this.activeDownloads.has(songData.id)) {
      throw new Error('Song is currently being downloaded');
    }

    // Initialize download progress
    const progress: DownloadProgress = {
      songId: songData.id,
      progress: 0,
      status: 'downloading'
    };

    this.activeDownloads.set(songData.id, progress);
    if (onProgress) {
      this.progressCallbacks.set(songData.id, onProgress);
    }

    try {
      // Simulate download process (in a real app, this would download the actual file)
      const audioBlob = await this.downloadFile(songData.audioUrl, (progressPercent) => {
        progress.progress = progressPercent;
        const callback = this.progressCallbacks.get(songData.id);
        if (callback) {
          callback({ ...progress });
        }
      });

      // Create local URL for the downloaded file
      const localPath = URL.createObjectURL(audioBlob);

      // Create downloaded song object
      const downloadedSong: DownloadedSong = {
        id: downloadId,
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        duration: songData.duration,
        audioUrl: songData.audioUrl,
        coverImageUrl: songData.coverImageUrl,
        fileSize: audioBlob.size,
        downloadedAt: new Date(),
        localPath: localPath,
        songId: songData.id
      };

      // Mark as completed
      progress.status = 'completed';
      progress.progress = 100;
      const callback = this.progressCallbacks.get(songData.id);
      if (callback) {
        callback({ ...progress });
      }

      // Store the blob URL in cache
      this.blobURLCache.set(downloadId, localPath);

      // Store the download in memory
      this.downloads.set(downloadId, downloadedSong);

      // Save to IndexedDB
      const metadata = {
        title: songData.title,
        artist: songData.artist,
        album: songData.album,
        duration: songData.duration,
        audioUrl: songData.audioUrl,
        coverImageUrl: songData.coverImageUrl,
        fileSize: audioBlob.size,
        downloadedAt: new Date().toISOString(),
        songId: songData.id
      };

      await this.saveToIndexedDB(downloadId, audioBlob, metadata);

      // Clean up
      this.activeDownloads.delete(songData.id);
      this.progressCallbacks.delete(songData.id);

      return downloadedSong;
    } catch (error) {
      // Mark as failed
      progress.status = 'failed';
      const callback = this.progressCallbacks.get(songData.id);
      if (callback) {
        callback({ ...progress });
      }

      // Clean up
      this.activeDownloads.delete(songData.id);
      this.progressCallbacks.delete(songData.id);

      throw error;
    }
  }

  // Download file with progress tracking
  private async downloadFile(
    url: string, 
    onProgress: (progress: number) => void
  ): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      
      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const progress = Math.round((event.loaded / event.total) * 100);
          onProgress(progress);
        }
      };
      
      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(xhr.response);
        } else {
          reject(new Error(`Download failed with status: ${xhr.status}`));
        }
      };
      
      xhr.onerror = () => {
        reject(new Error('Download failed'));
      };
      
      xhr.send();
    });
  }

  // Delete a downloaded song
  async deleteDownload(downloadId: string): Promise<boolean> {
    const download = this.downloads.get(downloadId);
    if (!download) {
      return false;
    }

    try {
      // Revoke the local URL to free up memory
      if (download.localPath.startsWith('blob:')) {
        URL.revokeObjectURL(download.localPath);
      }

      // Remove from blob URL cache
      this.blobURLCache.delete(downloadId);

      // Remove from memory
      this.downloads.delete(downloadId);

      // Remove from IndexedDB
      await this.deleteFromIndexedDB(downloadId);

      return true;
    } catch (error) {
      console.error('Error deleting download:', error);
      return false;
    }
  }

  // Get total size of all downloads
  getTotalDownloadSize(): number {
    return Array.from(this.downloads.values()).reduce(
      (total, download) => total + download.fileSize, 
      0
    );
  }

  // Format file size
  formatFileSize(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }

  // Clear all downloads
  async clearAllDownloads(): Promise<void> {
    // Revoke all blob URLs
    this.downloads.forEach(download => {
      if (download.localPath.startsWith('blob:')) {
        URL.revokeObjectURL(download.localPath);
      }
    });

    // Clear memory
    this.downloads.clear();
    this.activeDownloads.clear();
    this.progressCallbacks.clear();
    this.blobURLCache.clear();

    // Clear IndexedDB
    if (this.db) {
      const transaction = this.db.transaction([AUDIO_STORE, METADATA_STORE], 'readwrite');
      transaction.objectStore(AUDIO_STORE).clear();
      transaction.objectStore(METADATA_STORE).clear();
    }

    console.log('All downloads cleared from storage and memory');
  }

  // Refresh blob URL for a download (useful if it becomes invalid)
  async refreshBlobURL(downloadId: string): Promise<string | null> {
    // Remove from cache to force recreation
    this.blobURLCache.delete(downloadId);

    // Get fresh blob URL
    const newBlobURL = await this.getBlobURL(downloadId);

    // Update in memory
    const download = this.downloads.get(downloadId);
    if (download && newBlobURL) {
      download.localPath = newBlobURL;
      this.downloads.set(downloadId, download);
    }

    return newBlobURL;
  }

  // Cleanup method for when the manager is no longer needed
  cleanup(): void {
    // Revoke all blob URLs to prevent memory leaks
    this.downloads.forEach(download => {
      if (download.localPath.startsWith('blob:')) {
        URL.revokeObjectURL(download.localPath);
      }
    });

    // Clear blob URL cache
    this.blobURLCache.forEach(url => URL.revokeObjectURL(url));
    this.blobURLCache.clear();
  }
}

// Export singleton instance
export const downloadManager = new DownloadManager();