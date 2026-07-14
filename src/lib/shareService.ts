import { Share } from '@capacitor/share';
import { Capacitor } from '@capacitor/core';

// Define the production origin for shareable links (exported for referral links, etc.)
export const PRODUCTION_ORIGIN = 'https://airaplay.com';

interface ShareOptions {
  title: string;
  text: string;
  url: string;
  dialogTitle?: string;
}

/**
 * Share service that works on both web and mobile platforms
 * Uses Capacitor Share plugin on native, falls back to Web Share API or clipboard
 */
export const shareContent = async (options: ShareOptions): Promise<void> => {
  const { title, text, url } = options;

  // Check if running on a native platform (Android/iOS)
  const isNative = Capacitor.getPlatform() !== 'web';

  try {
    if (isNative) {
      // Attempt to use Capacitor Share plugin first on native platforms
      try {
        await Share.share({
          title: title,
          text: text,
          url: url,
          dialogTitle: options.dialogTitle // Pass dialogTitle if provided
        });
        return; // Successfully shared via Capacitor
      } catch (error: any) {
        // If user cancels or sharing fails, log and fall through
        if (error?.code === 'ACTION_CANCELLED') {
          return; // User cancelled, do nothing.
        }
        // Fall through to clipboard if native share fails for other reasons
      }
    }

    // Fallback for web or if native sharing failed
    // Try Web Share API
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text, url });
        return; // Successfully shared via Web Share API
      } catch (error: any) {
        if (error?.name === 'AbortError') {
          return; // User cancelled, do nothing.
        }
        // Fall through to clipboard
      }
    }

    // Last resort: Copy to clipboard (no alert; share sheet is the primary flow)
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(url);
      } catch (error) {
        console.error('[ShareService] Clipboard write failed:', error);
        throw new Error('Unable to share content. Please try again.');
      }
    } else {
        throw new Error('Sharing is not supported on this device.');
    }
  } catch (error) {
    console.error('[ShareService] Share error:', error);
    throw error;
  }
};

/**
 * Share a song
 */
export const shareSong = async (
  songId: string,
  songTitle: string,
  artistName: string
): Promise<void> => {
  // Use server-rendered share landing page so social previews can show song cover artwork.
  const shareUrl = `${PRODUCTION_ORIGIN}/share/song/${songId}`;
  const shareText = `Check out "${songTitle}" by ${artistName} on Airaplay!`;

  await shareContent({
    title: songTitle,
    text: shareText,
    url: shareUrl,
    dialogTitle: 'Share Song'
  });
};

/**
 * Share an album
 */
export const shareAlbum = async (
  albumId: string,
  albumTitle: string,
  artistName: string
): Promise<void> => {
  const shareUrl = `${PRODUCTION_ORIGIN}/album/${albumId}`;
  const shareText = `Check out the album "${albumTitle}" by ${artistName} on Airaplay!`;

  await shareContent({
    title: `${albumTitle} by ${artistName}`,
    text: shareText,
    url: shareUrl,
    dialogTitle: 'Share Album'
  });
};

/**
 * Share a playlist
 */
export const sharePlaylist = async (
  playlistId: string,
  playlistTitle: string
): Promise<void> => {
  const shareUrl = `${PRODUCTION_ORIGIN}/playlist/${playlistId}`;
  const shareText = `Check out the playlist "${playlistTitle}" on Airaplay!`;

  await shareContent({
    title: playlistTitle,
    text: shareText,
    url: shareUrl,
    dialogTitle: 'Share Playlist'
  });
};

/**
 * Share a video
 */
export const shareVideo = async (
  videoId: string,
  videoTitle: string
): Promise<void> => {
  const shareUrl = `${PRODUCTION_ORIGIN}/video/${videoId}`;
  const shareText = `Watch "${videoTitle}" on Airaplay!`;

  await shareContent({
    title: videoTitle,
    text: shareText,
    url: shareUrl,
    dialogTitle: 'Share Video'
  });
};

/**
 * Share a user profile
 */
export const shareProfile = async (
  userId: string,
  userName: string
): Promise<void> => {
  const shareUrl = `${PRODUCTION_ORIGIN}/user/${userId}`;
  const shareText = `Check out ${userName}'s music profile on Airaplay!`;

  await shareContent({
    title: `${userName}'s Profile`,
    text: shareText,
    url: shareUrl,
    dialogTitle: 'Share Profile'
  });
};
