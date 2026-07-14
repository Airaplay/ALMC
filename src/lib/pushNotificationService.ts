import { Capacitor } from '@capacitor/core';

import type { PushNotificationsPlugin } from '@capacitor/push-notifications';

import { supabase } from './supabase';

import { isAppTarget } from './buildTarget';



const ANDROID_CHANNEL_ID = 'airaplay_default';



let initialized = false;

let listenersAttached = false;

let currentUserId: string | null = null;

let lastRegisteredToken: string | null = null;

let navigateHandler: ((path: string) => void) | null = null;

let pushModule: PushNotificationsPlugin | null = null;

let pushUnavailable = false;

let registrationInFlight: Promise<void> | null = null;



function isNativePushSupported(): boolean {

  return isAppTarget() && Capacitor.isNativePlatform() && !pushUnavailable;

}



// IMPORTANT: never resolve a Promise directly with the Capacitor plugin proxy.
// Async functions call Promise.resolve(value), which probes value.then — the plugin
// proxy turns that into a native call ("PushNotifications.then() is not implemented").
// Returning a plain wrapper object avoids that thenable probe.
interface PushModuleBox {
  plugin: PushNotificationsPlugin;
}

async function getPushModule(): Promise<PushModuleBox | null> {

  if (pushUnavailable) return null;

  if (pushModule) return { plugin: pushModule };



  try {

    const mod = await import('@capacitor/push-notifications');

    pushModule = mod.PushNotifications;

    return { plugin: pushModule };

  } catch (error) {

    pushUnavailable = true;

    console.warn('[push] Push Notifications plugin unavailable:', error);

    return null;

  }

}



function resolveNavigationPath(data?: Record<string, string>): string {

  const raw = data?.click_action || data?.path || '/notifications';

  return raw.startsWith('/') ? raw : `/${raw}`;

}



async function waitUntilAppIsActive(): Promise<void> {

  if (!Capacitor.isNativePlatform()) return;



  try {

    const { App } = await import('@capacitor/app');

    const state = await App.getState();

    if (state.isActive) return;



    await new Promise<void>((resolve) => {

      let settled = false;

      const finish = () => {

        if (settled) return;

        settled = true;

        void handle.then((h) => h.remove());

        resolve();

      };



      const handle = App.addListener('appStateChange', ({ isActive }) => {

        if (isActive) finish();

      });



      window.setTimeout(finish, 4000);

    });

  } catch (error) {

    console.warn('[push] Could not wait for foreground app state:', error);

  }

}



async function saveToken(token: string, platform: string): Promise<void> {

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return;



  const { error } = await supabase.rpc('upsert_push_device_token', {

    p_token: token,

    p_platform: platform,

  });



  if (error) {

    console.error('[push] Failed to save device token:', error);

    throw error;

  }



  lastRegisteredToken = token;

}



async function ensureAndroidChannel(push: PushNotificationsPlugin): Promise<void> {

  if (Capacitor.getPlatform() !== 'android') return;



  try {

    await push.createChannel({

      id: ANDROID_CHANNEL_ID,

      name: 'Airaplay',

      description: 'General app notifications',

      importance: 4,

      sound: 'default',

      visibility: 1,

      vibration: true,

    });

  } catch (error) {

    console.warn('[push] createChannel failed (may already exist):', error);

  }

}



async function attachListeners(push: PushNotificationsPlugin): Promise<void> {

  if (listenersAttached) return;

  listenersAttached = true;



  await push.addListener('registration', async (event) => {

    if (!currentUserId || !event.value) return;



    try {

      await saveToken(event.value, Capacitor.getPlatform());

      console.log('[push] Device token registered');

    } catch {

      // logged in saveToken

    }

  });



  await push.addListener('registrationError', (error) => {

    console.error('[push] Registration error:', error);

  });



  await push.addListener('pushNotificationReceived', (notification) => {

    console.log('[push] Notification received in foreground:', notification.title);

  });



  await push.addListener('pushNotificationActionPerformed', (action) => {

    const path = resolveNavigationPath(action.notification.data as Record<string, string> | undefined);

    if (navigateHandler) {

      navigateHandler(path);

    } else if (typeof window !== 'undefined') {

      window.location.href = path;

    }

  });

}



/** Show the OS notification permission dialog when still undecided (Android 13+ / iOS). */

async function ensureNotificationPermission(push: PushNotificationsPlugin): Promise<boolean> {

  try {

    await waitUntilAppIsActive();



    const current = await push.checkPermissions();

    console.log('[push] checkPermissions:', current.receive);



    if (current.receive === 'granted') {

      return true;

    }



    if (current.receive === 'denied') {

      console.warn('[push] Notifications blocked in system settings');

      return false;

    }



    const result = await push.requestPermissions();

    console.log('[push] requestPermissions:', result.receive);



    if (result.receive === 'granted') {

      return true;

    }



    const after = await push.checkPermissions();

    return after.receive === 'granted';

  } catch (error) {

    console.error('[push] Permission request failed:', error);

    return false;

  }

}



async function registerWithFcm(push: PushNotificationsPlugin): Promise<void> {

  await push.register();

}



async function isPushEnabledInProfile(userId: string): Promise<boolean> {

  try {

    const { data: settings, error } = await supabase

      .from('users')

      .select('push_notifications')

      .eq('id', userId)

      .maybeSingle();



    if (error) {

      console.warn('[push] Could not read push_notifications; defaulting to enabled:', error.message);

      return true;

    }



    return settings?.push_notifications !== false;

  } catch (error) {

    console.warn('[push] push_notifications lookup failed; defaulting to enabled:', error);

    return true;

  }

}



async function registerForUserInternal(userId: string): Promise<void> {

  if (!isNativePushSupported()) return;



  try {

    await initializeInternal();

    const box = await getPushModule();

    if (!box) return;

    const push = box.plugin;



    currentUserId = userId;



    const permissionGranted = await ensureNotificationPermission(push);

    if (!permissionGranted) {

      return;

    }



    const pushEnabled = await isPushEnabledInProfile(userId);

    if (!pushEnabled) {

      await deactivateTokensInternal();

      return;

    }



    await registerWithFcm(push);



    if (lastRegisteredToken) {

      try {

        await saveToken(lastRegisteredToken, Capacitor.getPlatform());

      } catch {

        // logged in saveToken

      }

    }

  } catch (error) {

    console.error('[push] registerForUser failed:', error);

  }

}



async function initializeInternal(): Promise<void> {

  if (!isNativePushSupported() || initialized) return;



  const box = await getPushModule();

  if (!box) return;

  const push = box.plugin;



  initialized = true;

  await attachListeners(push);

  await ensureAndroidChannel(push);

}



async function deactivateTokensInternal(): Promise<void> {

  if (!isNativePushSupported()) return;



  const { data: { session } } = await supabase.auth.getSession();

  if (!session) return;



  const { error } = await supabase.rpc('deactivate_push_device_tokens');

  if (error) {

    console.error('[push] Failed to deactivate tokens:', error);

  }

  lastRegisteredToken = null;

}



export const pushNotificationService = {

  setNavigationHandler(handler: (path: string) => void): void {

    navigateHandler = handler;

  },



  async initialize(): Promise<void> {

    try {

      await initializeInternal();

    } catch (error) {

      console.error('[push] initialize failed:', error);

      pushUnavailable = true;

    }

  },



  async registerForUser(userId: string): Promise<void> {

    if (!userId) return;

    if (registrationInFlight) {

      await registrationInFlight;

      return;

    }



    registrationInFlight = registerForUserInternal(userId).finally(() => {

      registrationInFlight = null;

    });

    await registrationInFlight;

  },



  async deactivateTokens(): Promise<void> {

    await deactivateTokensInternal();

  },



  async unregister(): Promise<void> {

    currentUserId = null;

    lastRegisteredToken = null;

    await deactivateTokensInternal();

  },



  async onPushPreferenceChanged(enabled: boolean, userId?: string | null): Promise<void> {

    if (!isNativePushSupported()) return;



    if (!enabled) {

      await deactivateTokensInternal();

      return;

    }



    const uid = userId ?? currentUserId;

    if (uid) {

      await this.registerForUser(uid);

    }

  },

};


