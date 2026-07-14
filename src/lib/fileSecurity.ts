/**
 * File Security Utilities
 * Provides secure file handling functions for uploads
 */

// Whitelist of allowed file extensions
export const ALLOWED_AUDIO_EXTENSIONS = ['mp3'];
export const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
export const ALLOWED_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'avi', 'mkv'];

// File size limits (in bytes)
export const FILE_SIZE_LIMITS = {
  image: 5 * 1024 * 1024,      // 5MB
  audio: 50 * 1024 * 1024,     // 50MB
  video: 500 * 1024 * 1024,    // 500MB
  thumbnail: 2 * 1024 * 1024,  // 2MB
};

// Allowed MIME types
export const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',
  'audio/mp3',
];

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

export const ALLOWED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];

/**
 * Sanitizes a filename to prevent path traversal and other attacks
 * @param filename Original filename
 * @returns Sanitized filename safe for use in file paths
 */
export function sanitizeFileName(filename: string): string {
  if (!filename || typeof filename !== 'string') {
    return 'file';
  }

  // Remove path traversal attempts
  let sanitized = filename
    .replace(/\.\./g, '')           // Remove .. 
    .replace(/\//g, '_')            // Replace / with _
    .replace(/\\/g, '_')            // Replace \ with _
    .replace(/[^\w.\-]/g, '_')      // Replace special chars with _
    .trim();

  // Limit length
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop();
    sanitized = sanitized.substring(0, 255 - (ext?.length || 0) - 1) + '.' + ext;
  }

  return sanitized || 'file';
}

/**
 * Validates and extracts file extension from filename
 * @param filename File name
 * @param allowedExtensions Array of allowed extensions (lowercase, without dot)
 * @returns Validated extension or null if invalid
 */
export function getValidatedExtension(
  filename: string,
  allowedExtensions: string[]
): string | null {
  if (!filename || typeof filename !== 'string') {
    return null;
  }

  // Extract extension
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) {
    return null;
  }

  const ext = parts.pop()?.trim();
  if (!ext) {
    return null;
  }

  // Remove any non-alphanumeric characters (security)
  const sanitized = ext.replace(/[^a-z0-9]/g, '');

  // Check against whitelist
  if (!allowedExtensions.includes(sanitized)) {
    return null;
  }

  return sanitized;
}

/**
 * Validates file type against MIME type whitelist
 * @param file File object
 * @param allowedTypes Array of allowed MIME types
 * @returns true if valid, false otherwise
 */
export function validateFileType(file: File, allowedTypes: string[]): boolean {
  if (!file || !file.type) {
    return false;
  }

  return allowedTypes.includes(file.type.toLowerCase());
}

/**
 * Validates file size against limit
 * @param file File object
 * @param maxSize Maximum size in bytes
 * @returns true if valid, false otherwise
 */
export function validateFileSize(file: File, maxSize: number): boolean {
  if (!file) {
    return false;
  }

  return file.size > 0 && file.size <= maxSize;
}

/**
 * Validates audio file
 * @param file File object
 * @returns Validation result with error message if invalid
 */
export function validateAudioFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file type
  if (!validateFileType(file, ALLOWED_AUDIO_TYPES)) {
    return { valid: false, error: 'Invalid audio file type. Only MP3 format is supported' };
  }

  // Check file extension
  const ext = getValidatedExtension(file.name, ALLOWED_AUDIO_EXTENSIONS);
  if (!ext) {
    return { valid: false, error: 'Invalid file extension. Only .mp3 files are allowed' };
  }

  // Check file size
  if (!validateFileSize(file, FILE_SIZE_LIMITS.audio)) {
    const maxSizeMB = FILE_SIZE_LIMITS.audio / (1024 * 1024);
    return { valid: false, error: `File size exceeds limit of ${maxSizeMB}MB` };
  }

  return { valid: true };
}

/**
 * Validates image file
 * @param file File object
 * @returns Validation result with error message if invalid
 */
export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file type
  if (!validateFileType(file, ALLOWED_IMAGE_TYPES)) {
    return { valid: false, error: 'Invalid image file type. Allowed: JPEG, PNG, WEBP, GIF' };
  }

  // Check file extension
  const ext = getValidatedExtension(file.name, ALLOWED_IMAGE_EXTENSIONS);
  if (!ext) {
    return { valid: false, error: 'Invalid file extension. Allowed: jpg, jpeg, png, webp, gif' };
  }

  // Check file size
  if (!validateFileSize(file, FILE_SIZE_LIMITS.image)) {
    const maxSizeMB = FILE_SIZE_LIMITS.image / (1024 * 1024);
    return { valid: false, error: `File size exceeds limit of ${maxSizeMB}MB` };
  }

  return { valid: true };
}

/**
 * Validates video file
 * @param file File object
 * @returns Validation result with error message if invalid
 */
export function validateVideoFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: 'No file provided' };
  }

  // Check file type
  if (!validateFileType(file, ALLOWED_VIDEO_TYPES)) {
    return { valid: false, error: 'Invalid video file type. Allowed: MP4, WEBM, MOV, AVI, MKV' };
  }

  // Check file extension
  const ext = getValidatedExtension(file.name, ALLOWED_VIDEO_EXTENSIONS);
  if (!ext) {
    return { valid: false, error: 'Invalid file extension. Allowed: mp4, webm, mov, avi, mkv' };
  }

  // Check file size
  if (!validateFileSize(file, FILE_SIZE_LIMITS.video)) {
    const maxSizeMB = FILE_SIZE_LIMITS.video / (1024 * 1024);
    return { valid: false, error: `File size exceeds limit of ${maxSizeMB}MB` };
  }

  return { valid: true };
}

/**
 * Creates a safe file path for uploads
 * @param userId User ID
 * @param folder Folder name (e.g., 'songs', 'covers', 'thumbnails')
 * @param filename Original filename
 * @param allowedExtensions Array of allowed extensions
 * @returns Safe file path or null if invalid
 */
export function createSafeFilePath(
  userId: string,
  folder: string,
  filename: string,
  allowedExtensions: string[]
): string | null {
  // Validate user ID (should be UUID)
  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    return null;
  }

  // Sanitize folder name
  const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '');

  // Sanitize filename
  const sanitizedFilename = sanitizeFileName(filename);

  // Validate extension
  const ext = getValidatedExtension(sanitizedFilename, allowedExtensions);
  if (!ext) {
    return null;
  }

  // Create safe path
  const timestamp = Date.now();
  const safePath = `${userId}/${safeFolder}/${timestamp}.${ext}`;

  return safePath;
}

