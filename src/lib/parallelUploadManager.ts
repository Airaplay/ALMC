/**
 * Parallel Upload Manager with Retry Logic
 *
 * Handles bulk file uploads with:
 * - Concurrent upload control (max 3 files at once)
 * - Automatic retry on failure (up to 3 attempts)
 * - Progress tracking per file
 * - Error recovery
 */

export interface UploadTask {
  id: string;
  file: File;
  path: string;
  retries: number;
  status: 'pending' | 'uploading' | 'completed' | 'failed';
  progress: number;
  error?: string;
  result?: string; // URL of uploaded file
}

export interface UploadProgress {
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  currentlyUploading: number;
  overallProgress: number;
}

export interface ParallelUploadOptions {
  maxConcurrency?: number; // Max files to upload at once (default: 3)
  maxRetries?: number; // Max retry attempts per file (default: 3)
  retryDelay?: number; // Delay between retries in ms (default: 2000)
  onProgress?: (progress: UploadProgress) => void;
  onFileComplete?: (task: UploadTask) => void;
  onFileFailed?: (task: UploadTask) => void;
  uploadFunction: (file: File, path: string, onProgress?: (percent: number) => void) => Promise<string>;
}

export class ParallelUploadManager {
  private tasks: Map<string, UploadTask> = new Map();
  private options: Required<ParallelUploadOptions>;
  private activeUploads = 0;
  private completedCount = 0;
  private failedCount = 0;

  constructor(options: ParallelUploadOptions) {
    this.options = {
      maxConcurrency: options.maxConcurrency || 3,
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 2000,
      onProgress: options.onProgress || (() => {}),
      onFileComplete: options.onFileComplete || (() => {}),
      onFileFailed: options.onFileFailed || (() => {}),
      uploadFunction: options.uploadFunction,
    };
  }

  /**
   * Add files to the upload queue
   */
  addFiles(files: Array<{ file: File; path: string }>) {
    files.forEach(({ file, path }) => {
      const task: UploadTask = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
        file,
        path,
        retries: 0,
        status: 'pending',
        progress: 0,
      };
      this.tasks.set(task.id, task);
    });
  }

  /**
   * Start uploading all files with concurrency control
   */
  async uploadAll(): Promise<UploadTask[]> {
    const pendingTasks = Array.from(this.tasks.values()).filter(
      (task) => task.status === 'pending'
    );

    // Process tasks with concurrency control
    const results = await this.processWithConcurrency(pendingTasks);

    return results;
  }

  /**
   * Process tasks with concurrency limit
   */
  private async processWithConcurrency(tasks: UploadTask[]): Promise<UploadTask[]> {
    const results: UploadTask[] = [];
    const queue = [...tasks];

    while (queue.length > 0 || this.activeUploads > 0) {
      // Start new uploads up to max concurrency
      while (queue.length > 0 && this.activeUploads < this.options.maxConcurrency) {
        const task = queue.shift()!;
        this.activeUploads++;

        // Don't await here - let it run in parallel
        this.uploadTask(task).then((result) => {
          this.activeUploads--;
          results.push(result);
          this.emitProgress();
        });
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Upload a single task with retry logic
   */
  private async uploadTask(task: UploadTask): Promise<UploadTask> {
    while (task.retries <= this.options.maxRetries) {
      try {
        task.status = 'uploading';
        this.tasks.set(task.id, task);
        this.emitProgress();

        // Upload with progress tracking
        const result = await this.options.uploadFunction(
          task.file,
          task.path,
          (percent) => {
            task.progress = percent;
            this.tasks.set(task.id, task);
            this.emitProgress();
          }
        );

        // Success!
        task.status = 'completed';
        task.progress = 100;
        task.result = result;
        this.completedCount++;
        this.tasks.set(task.id, task);
        this.options.onFileComplete(task);
        this.emitProgress();

        return task;
      } catch (error) {
        task.retries++;
        task.error = error instanceof Error ? error.message : 'Unknown error';

        if (task.retries > this.options.maxRetries) {
          // Max retries reached, mark as failed
          task.status = 'failed';
          this.failedCount++;
          this.tasks.set(task.id, task);
          this.options.onFileFailed(task);
          this.emitProgress();

          console.error(`Upload failed for ${task.file.name} after ${this.options.maxRetries} retries:`, task.error);
          return task;
        }

        // Wait before retrying
        console.log(`Retrying upload for ${task.file.name} (attempt ${task.retries}/${this.options.maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, this.options.retryDelay));
      }
    }

    return task;
  }

  /**
   * Emit progress update
   */
  private emitProgress() {
    const totalFiles = this.tasks.size;
    const progress: UploadProgress = {
      totalFiles,
      completedFiles: this.completedCount,
      failedFiles: this.failedCount,
      currentlyUploading: this.activeUploads,
      overallProgress: totalFiles > 0
        ? Math.round((this.completedCount / totalFiles) * 100)
        : 0,
    };

    this.options.onProgress(progress);
  }

  /**
   * Get all completed uploads
   */
  getCompletedUploads(): UploadTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === 'completed'
    );
  }

  /**
   * Get all failed uploads
   */
  getFailedUploads(): UploadTask[] {
    return Array.from(this.tasks.values()).filter(
      (task) => task.status === 'failed'
    );
  }

  /**
   * Clear all tasks
   */
  clear() {
    this.tasks.clear();
    this.activeUploads = 0;
    this.completedCount = 0;
    this.failedCount = 0;
  }
}
