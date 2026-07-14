import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User, Session, AuthChangeEvent } from '@supabase/supabase-js';
import { supabase, refreshSessionIfNeeded } from '../lib/supabase';
import { performCompleteLogout } from '../lib/logoutService';
import { getBestEffortUserAgent, getOrCreateDeviceId } from '../lib/deviceId';

interface AuthState {
  user: User | null;
  session: Session | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  displayName: string | null;
}

/** Full-screen loader after interactive login, then dismiss (navigate to Home is handled in AuthModal). */
const POST_LOGIN_OVERLAY_MS = 900;

interface AuthContextType extends AuthState {
  signOut: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  /** True while the post-login full-screen loader is visible. */
  postLoginTransitionActive: boolean;
  /** Show loader for a fixed duration; call before closing the auth modal on successful sign-in. */
  startPostLoginTransition: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const INITIAL_STATE: AuthState = {
  user: null,
  session: null,
  isAuthenticated: false,
  isLoading: true,
  isInitialized: false,
  displayName: null,
};

/** Survives AuthProvider remount (Strict Mode, etc.) so first paint matches last known session. */
type AuthSnapshot = Pick<AuthState, 'user' | 'session' | 'isAuthenticated' | 'displayName'>;
let lastAuthSnapshot: AuthSnapshot | null = null;

// Survives AuthProvider remount (e.g. React Strict Mode, OAuth redirect). Prevents showing
// the full-page auth skeleton again after login when the provider remounts.
let hasInitializedOnce = false;

type SignupBonusClaimResponse = {
  ok?: boolean;
  status?: string;
};

const signupBonusClaimInFlightByUser = new Set<string>();
const signupBonusClaimCompletedByUser = new Set<string>();
const SIGNUP_BONUS_TERMINAL_STATUSES = new Set([
  'granted',
  'already_claimed',
]);

function isSignupBonusClaimResponse(value: unknown): value is SignupBonusClaimResponse {
  return typeof value === 'object' && value !== null;
}

async function claimSignupBonusBestEffort(userId: string): Promise<void> {
  if (
    signupBonusClaimCompletedByUser.has(userId) ||
    signupBonusClaimInFlightByUser.has(userId)
  ) {
    return;
  }

  signupBonusClaimInFlightByUser.add(userId);

  try {
    await supabase.rpc('ensure_my_treat_wallet');

    const { data, error } = await supabase.rpc('claim_signup_bonus');

    if (error) {
      return;
    }

    const status = isSignupBonusClaimResponse(data) ? data.status : undefined;
    if (status && SIGNUP_BONUS_TERMINAL_STATUSES.has(status)) {
      signupBonusClaimCompletedByUser.add(userId);
    }
  } catch {
    // Best-effort only: missing migrations, RPC mismatches, or network errors
    // must never affect login, refresh, or auth state.
  } finally {
    signupBonusClaimInFlightByUser.delete(userId);
  }
}

type RegisterDeviceResponse = {
  ok?: boolean;
  status?: string;
};

const deviceRegisterInFlightByUser = new Set<string>();
const deviceRegisterCompletedByUser = new Set<string>();

function isRegisterDeviceResponse(value: unknown): value is RegisterDeviceResponse {
  return typeof value === 'object' && value !== null;
}

/** Best-effort device fingerprint for referral milestone anti-farming (server-side only). */
async function registerUserDeviceBestEffort(userId: string): Promise<void> {
  if (
    deviceRegisterCompletedByUser.has(userId) ||
    deviceRegisterInFlightByUser.has(userId)
  ) {
    return;
  }

  const deviceId = getOrCreateDeviceId();
  if (!deviceId) return;

  deviceRegisterInFlightByUser.add(userId);

  try {
    const { data, error } = await supabase.rpc('register_user_device', {
      p_device_id: deviceId,
      p_user_agent: getBestEffortUserAgent(),
    });

    if (error) return;

    if (isRegisterDeviceResponse(data) && data.ok === true) {
      deviceRegisterCompletedByUser.add(userId);
    }
  } catch {
    // Best-effort only: missing migration/RPC must not affect auth.
  } finally {
    deviceRegisterInFlightByUser.delete(userId);
  }
}

function deriveImmediateDisplayName(user: User | null): string | null {
  if (!user) return null;

  const metadata = user.user_metadata ?? {};
  const immediateName =
    metadata.display_name ??
    metadata.username ??
    metadata.preferred_username ??
    metadata.full_name ??
    metadata.name ??
    null;

  if (typeof immediateName === 'string' && immediateName.trim().length > 0) {
    return immediateName.trim();
  }

  const email = user.email?.trim();
  if (email && email.includes('@')) {
    const localPart = email.split('@')[0]?.trim();
    if (localPart) return localPart;
  }

  return null;
}

function buildInitialAuthState(): AuthState {
  if (!hasInitializedOnce) {
    return INITIAL_STATE;
  }
  if (lastAuthSnapshot) {
    return {
      ...lastAuthSnapshot,
      isLoading: false,
      isInitialized: true,
    };
  }
  return {
    ...INITIAL_STATE,
    isLoading: false,
    isInitialized: true,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(buildInitialAuthState);
  const [postLoginTransitionActive, setPostLoginTransitionActive] = useState(false);
  const mountedRef = useRef(true);
  const initializingRef = useRef(false);
  const loaderRemovedRef = useRef(false);
  const postLoginOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPostLoginOverlay = useCallback(() => {
    if (postLoginOverlayTimerRef.current) {
      clearTimeout(postLoginOverlayTimerRef.current);
      postLoginOverlayTimerRef.current = null;
    }
    setPostLoginTransitionActive(false);
  }, []);

  const startPostLoginTransition = useCallback(() => {
    if (postLoginOverlayTimerRef.current) {
      clearTimeout(postLoginOverlayTimerRef.current);
      postLoginOverlayTimerRef.current = null;
    }
    setPostLoginTransitionActive(true);
    postLoginOverlayTimerRef.current = setTimeout(() => {
      postLoginOverlayTimerRef.current = null;
      if (mountedRef.current) {
        setPostLoginTransitionActive(false);
      }
    }, POST_LOGIN_OVERLAY_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (postLoginOverlayTimerRef.current) {
        clearTimeout(postLoginOverlayTimerRef.current);
      }
    };
  }, []);

  const safeSetState = useCallback((updater: Partial<AuthState> | ((prev: AuthState) => AuthState)) => {
    if (mountedRef.current) {
      setState(prev => typeof updater === 'function' ? updater(prev) : { ...prev, ...updater });
    }
  }, []);

  const removeInitialLoader = useCallback(() => {
    if (typeof window !== 'undefined' && !loaderRemovedRef.current) {
      const loader = document.getElementById("initial-loader");
      if (loader) {
        loaderRemovedRef.current = true;
        loader.style.opacity = "0";
        loader.style.transition = "opacity 0.3s ease-out";
        setTimeout(() => {
          loader.remove();
          // Add loaded class to app root
          const appElement = document.getElementById("app");
          if (appElement) {
            appElement.classList.add("app-loaded");
          }
        }, 300);
      }
    }
  }, []);

  const updateAuthState = useCallback(async (session: Session | null) => {
    const user = session?.user ?? null;

    // Set auth state immediately so UI shows logged-in without a loading flash (e.g. after login)
    const displayNameFallback = deriveImmediateDisplayName(user);
    hasInitializedOnce = true;
    lastAuthSnapshot = {
      user,
      session,
      isAuthenticated: !!user,
      displayName: displayNameFallback,
    };
    safeSetState({
      user,
      session,
      isAuthenticated: !!user,
      isLoading: false,
      isInitialized: true,
      displayName: displayNameFallback,
    });
    removeInitialLoader();

    // Fetch canonical display_name from DB in background and update only displayName
    if (user?.id) {
      try {
        const { data } = await supabase
          .from('users')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle();
        const displayName = data?.display_name || null;
        if (displayName !== displayNameFallback) {
          safeSetState({ displayName });
          lastAuthSnapshot = lastAuthSnapshot
            ? { ...lastAuthSnapshot, displayName }
            : { user, session, isAuthenticated: !!user, displayName };
        }
      } catch (error) {
        console.error('[AuthContext] Error fetching display name:', error);
      }

      // Best-effort side effects after auth is settled — must never block UI.
      void claimSignupBonusBestEffort(user.id);
      void registerUserDeviceBestEffort(user.id);
    }
  }, [safeSetState, removeInitialLoader]);

  const initializeAuth = useCallback(async () => {
    if (initializingRef.current) return;
    initializingRef.current = true;

    try {
      safeSetState({ isLoading: true });

      await refreshSessionIfNeeded();

      const { data: { session }, error } = await supabase.auth.getSession();

      if (error) {
        console.error('[AuthContext] Error getting initial session:', error);
        if (error.message?.includes('Invalid Refresh Token') ||
            error.message?.includes('refresh_token_not_found')) {
          updateAuthState(null);
        } else {
          hasInitializedOnce = true;
          lastAuthSnapshot = {
            user: null,
            session: null,
            isAuthenticated: false,
            displayName: null,
          };
          safeSetState({ isLoading: false, isInitialized: true });
          removeInitialLoader();
        }
        return;
      }

      if (session?.user) {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError || !user) {
          console.warn('[AuthContext] Session exists but user validation failed');
          updateAuthState(null);
          return;
        }
        updateAuthState(session);
      } else {
        updateAuthState(null);
      }
    } catch (error) {
      console.error('[AuthContext] Error during initialization:', error);
      hasInitializedOnce = true;
      lastAuthSnapshot = {
        user: null,
        session: null,
        isAuthenticated: false,
        displayName: null,
      };
      safeSetState({ isLoading: false, isInitialized: true });
      removeInitialLoader();
    } finally {
      initializingRef.current = false;
    }
  }, [safeSetState, updateAuthState, removeInitialLoader]);

  useEffect(() => {
    mountedRef.current = true;
    initializeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        // Skip INITIAL_SESSION event since we handle it in initializeAuth
        if (event === 'INITIAL_SESSION') {
          return;
        }
        // Skip TOKEN_REFRESHED during init to avoid double state update
        if (event === 'TOKEN_REFRESHED' && initializingRef.current) {
          return;
        }

        switch (event) {
          case 'SIGNED_IN':
          case 'TOKEN_REFRESHED':
          case 'USER_UPDATED':
            if (session) {
              updateAuthState(session);
            }
            break;

          case 'SIGNED_OUT':
            clearPostLoginOverlay();
            lastAuthSnapshot = {
              user: null,
              session: null,
              isAuthenticated: false,
              displayName: null,
            };
            safeSetState({
              user: null,
              session: null,
              isAuthenticated: false,
              isLoading: false,
              isInitialized: true,
              displayName: null,
            });
            // Remove loader if still present
            removeInitialLoader();
            break;

          default:
            break;
        }
      }
    );

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [initializeAuth, updateAuthState, safeSetState, removeInitialLoader, clearPostLoginOverlay]);

  const signOut = useCallback(async () => {
    clearPostLoginOverlay();
    // Optimistic sign-out: performCompleteLogout clears caches/IndexedDB and can take
    // noticeable time. Update React auth immediately so the UI is not still "logged in"
    // until that work finishes (onAuthStateChange SIGNED_OUT fires late, after signOut).
    lastAuthSnapshot = {
      user: null,
      session: null,
      isAuthenticated: false,
      displayName: null,
    };
    safeSetState({
      user: null,
      session: null,
      isAuthenticated: false,
      isLoading: false,
      isInitialized: true,
      displayName: null,
    });

    try {
      const { success, error } = await performCompleteLogout();

      if (!success) {
        console.error('[AuthContext] Sign out error:', error);
      }
    } catch (error) {
      console.error('[AuthContext] Sign out failed:', error);
    }
  }, [safeSetState, clearPostLoginOverlay]);

  const refreshAuth = useCallback(async () => {
    try {
      const refreshed = await refreshSessionIfNeeded();
      if (!refreshed) {
        console.warn('[AuthContext] Session refresh failed');
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        updateAuthState(session);
      }
    } catch (error) {
      console.error('[AuthContext] Error refreshing auth:', error);
    }
  }, [updateAuthState]);

  const contextValue: AuthContextType = {
    ...state,
    signOut,
    refreshAuth,
    postLoginTransitionActive,
    startPostLoginTransition,
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function useUser(): User | null {
  const { user } = useAuth();
  return user;
}

export function useSession(): Session | null {
  const { session } = useAuth();
  return session;
}

export function useIsAuthenticated(): boolean {
  const { isAuthenticated, isInitialized } = useAuth();
  return isInitialized && isAuthenticated;
}
