/**
 * Audio Debugger Utility
 *
 * This utility helps debug audio playback issues with Bunny CDN.
 *
 * Usage in browser console:
 * import('./audioDebugger.js').then(m => m.testAudioUrl('https://your-audio-url.mp3'))
 */

interface AudioTestResult {
  url: string;
  success: boolean;
  error?: string;
  details: {
    urlValid: boolean;
    corsTest: string;
    audioElementTest: string;
    fetchTest: string;
    fileSize?: number;
    contentType?: string;
    audioLoadable: boolean;
  };
}

export async function testAudioUrl(audioUrl: string): Promise<AudioTestResult> {
  console.log('🔍 Testing audio URL:', audioUrl);

  const result: AudioTestResult = {
    url: audioUrl,
    success: false,
    details: {
      urlValid: false,
      corsTest: 'pending',
      audioElementTest: 'pending',
      fetchTest: 'pending',
      audioLoadable: false
    }
  };

  try {
    // Test 1: URL validity
    console.log('Test 1: Checking URL validity...');
    const url = new URL(audioUrl);
    result.details.urlValid = true;
    console.log('✅ URL is valid:', url.href);
  } catch (e) {
    result.details.urlValid = false;
    result.error = 'Invalid URL format';
    console.error('❌ Invalid URL');
    return result;
  }

  // Test 2: Fetch test with CORS
  console.log('Test 2: Testing fetch with CORS...');
  try {
    const response = await fetch(audioUrl, { method: 'HEAD' });
    if (response.ok) {
      result.details.fetchTest = 'success';
      result.details.contentType = response.headers.get('content-type') || 'unknown';
      result.details.fileSize = parseInt(response.headers.get('content-length') || '0');
      console.log('✅ Fetch test passed');
      console.log('  Content-Type:', result.details.contentType);
      console.log('  File Size:', result.details.fileSize, 'bytes');

      // Check CORS headers
      const corsHeaders = {
        'access-control-allow-origin': response.headers.get('access-control-allow-origin'),
        'access-control-allow-methods': response.headers.get('access-control-allow-methods'),
        'access-control-allow-headers': response.headers.get('access-control-allow-headers')
      };
      console.log('  CORS Headers:', corsHeaders);

      if (corsHeaders['access-control-allow-origin']) {
        result.details.corsTest = 'success';
        console.log('✅ CORS is properly configured');
      } else {
        result.details.corsTest = 'missing';
        console.warn('⚠️  CORS headers not found - may cause playback issues');
      }
    } else {
      result.details.fetchTest = `failed (${response.status})`;
      console.error('❌ Fetch failed with status:', response.status);
    }
  } catch (e) {
    result.details.fetchTest = `error: ${e instanceof Error ? e.message : 'unknown'}`;
    console.error('❌ Fetch test error:', e);
  }

  // Test 3: Audio element test
  console.log('Test 3: Testing HTML Audio element...');
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'none';

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        result.details.audioElementTest = 'timeout';
        console.warn('⚠️  Audio element test timed out');
        resolve(result);
      }
    }, 10000);

    audio.addEventListener('loadedmetadata', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        result.details.audioElementTest = 'success';
        result.details.audioLoadable = true;
        result.success = true;
        console.log('✅ Audio element can load the file');
        console.log('  Duration:', audio.duration, 'seconds');
        resolve(result);
      }
    });

    audio.addEventListener('error', (e) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        const target = e.target as HTMLAudioElement;
        const mediaError = target.error;

        let errorMessage = 'Unknown error';
        if (mediaError) {
          switch (mediaError.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              errorMessage = 'Audio loading was aborted';
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              errorMessage = 'Network error while loading audio';
              break;
            case MediaError.MEDIA_ERR_DECODE:
              errorMessage = 'Audio file is corrupted or unsupported';
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              errorMessage = 'Audio format not supported or CORS blocked';
              break;
          }
        }

        result.details.audioElementTest = `error: ${errorMessage}`;
        result.error = errorMessage;
        console.error('❌ Audio element error:', errorMessage);
        resolve(result);
      }
    });

    audio.src = audioUrl;
    audio.load(); // Explicitly load to test since preload is 'none'
  });
}

export function testMultipleAudioUrls(urls: string[]): Promise<AudioTestResult[]> {
  return Promise.all(urls.map(url => testAudioUrl(url)));
}

// Make it available globally for console testing
if (typeof window !== 'undefined') {
  (window as any).testAudioUrl = testAudioUrl;
  (window as any).testMultipleAudioUrls = testMultipleAudioUrls;
  console.log('🎵 Audio debugger loaded! Use window.testAudioUrl("url") to test an audio URL');
}
