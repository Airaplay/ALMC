import { Capacitor } from '@capacitor/core';

let initialized = false;

/**
 * Native-only tweaks for smooth scrolling and keyboard interaction on Android WebView.
 * Safe to call multiple times; runs once per app session.
 */
export async function initNativeMobilePerf(): Promise<void> {
  if (initialized || !Capacitor.isNativePlatform()) return;
  initialized = true;

  if (Capacitor.getPlatform() === 'android') {
    document.documentElement.classList.add('is-android');
  }

  try {
    const { Keyboard } = await import('@capacitor/keyboard');

    const setKeyboardInset = (height: number) => {
      document.documentElement.style.setProperty('--keyboard-height', `${height}px`);
      document.body.classList.toggle('keyboard-open', height > 0);
    };

    await Keyboard.addListener('keyboardWillShow', (info) => {
      setKeyboardInset(info.keyboardHeight);
    });
    await Keyboard.addListener('keyboardDidShow', (info) => {
      setKeyboardInset(info.keyboardHeight);
    });
    await Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardInset(0);
    });
    await Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardInset(0);
    });
  } catch {
    // Keyboard plugin unavailable — layout still works via adjustResize.
  }
}
