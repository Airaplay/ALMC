export interface CompressionOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  audioBitrate?: number;
  videoBitrate?: number;
}

export interface CompressionResult {
  file: File;
  originalSize: number;
  compressedSize: number;
  compressionRatio: number;
  compressionTime: number;
}

export class MediaCompression {
  static async compressImage(
    file: File,
    options: CompressionOptions = {}
  ): Promise<CompressionResult> {
    const startTime = performance.now();
    const originalSize = file.size;
    const quality = options.quality ?? 0.85;
    const maxWidth = options.maxWidth ?? 1920;
    const maxHeight = options.maxHeight ?? 1920;

    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        try {
          URL.revokeObjectURL(objectUrl);

          let width = img.width;
          let height = img.height;

          if (width > maxWidth || height > maxHeight) {
            const aspectRatio = width / height;
            if (width > height) {
              width = maxWidth;
              height = Math.round(width / aspectRatio);
            } else {
              height = maxHeight;
              width = Math.round(height * aspectRatio);
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Could not get canvas context');
          }

          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error('Failed to compress image'));
                return;
              }

              const compressedFile = new File(
                [blob],
                file.name.replace(/\.[^.]+$/, '.jpg'),
                {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                }
              );

              const compressionTime = performance.now() - startTime;

              resolve({
                file: compressedFile,
                originalSize,
                compressedSize: compressedFile.size,
                compressionRatio: originalSize / compressedFile.size,
                compressionTime,
              });
            },
            'image/jpeg',
            quality
          );
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load image'));
      };

      img.src = objectUrl;
    });
  }

  static async compressAudio(
    file: File,
    _options: CompressionOptions = {}
  ): Promise<CompressionResult> {
    const startTime = performance.now();
    const originalSize = file.size;

    console.log('Audio compression: Skipping browser-based audio compression.');
    console.log('Audio files (MP3, AAC, etc.) are already compressed. Uploading original file.');

    const compressionTime = performance.now() - startTime;

    return {
      file,
      originalSize,
      compressedSize: file.size,
      compressionRatio: 1,
      compressionTime,
    };
  }

  static async compressVideo(
    file: File,
    _options: CompressionOptions = {}
  ): Promise<CompressionResult> {
    const startTime = performance.now();
    const originalSize = file.size;

    console.log('Video compression: Browser-based video compression is limited.');
    console.log('Returning original file. For production, consider server-side compression.');

    const compressionTime = performance.now() - startTime;

    return {
      file,
      originalSize,
      compressedSize: file.size,
      compressionRatio: 1,
      compressionTime,
    };
  }

  static async compressMedia(
    file: File,
    options: CompressionOptions = {}
  ): Promise<CompressionResult> {
    const fileType = file.type.split('/')[0];

    switch (fileType) {
      case 'image':
        return await this.compressImage(file, options);
      case 'audio':
        return await this.compressAudio(file, options);
      case 'video':
        return await this.compressVideo(file, options);
      default:
        throw new Error(`Unsupported file type: ${file.type}`);
    }
  }

  static formatSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  static formatCompressionStats(result: CompressionResult): string {
    const savings = result.originalSize - result.compressedSize;
    const savingsPercent = ((savings / result.originalSize) * 100).toFixed(1);
    return `Compressed from ${this.formatSize(result.originalSize)} to ${this.formatSize(result.compressedSize)} (${savingsPercent}% reduction)`;
  }
}
