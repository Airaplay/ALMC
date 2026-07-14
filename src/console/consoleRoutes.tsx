import { BUILD_TARGET } from '@/lib/buildTarget';
import { lazy } from 'react';

export const ConsoleDashboardScreen =
  BUILD_TARGET === 'web' ? lazy(() => import('@/console/screens/ConsoleDashboardScreen')) : null;

export const ConsoleLoginScreen =
  BUILD_TARGET === 'web'
    ? lazy(() =>
        import('@/console/screens/ConsoleLoginScreen').then((m) => ({ default: m.ConsoleLoginScreen }))
      )
    : null;

export const ConsoleOnboardingScreen =
  BUILD_TARGET === 'web'
    ? lazy(() =>
        import('@/console/screens/ConsoleOnboardingScreen').then((m) => ({
          default: m.ConsoleOnboardingScreen,
        }))
      )
    : null;

export const ConsoleAcceptArtistScreen =
  BUILD_TARGET === 'web'
    ? lazy(() =>
        import('@/console/screens/ConsoleAcceptInvitationScreen').then((m) => ({
          default: m.ConsoleAcceptArtistScreen,
        }))
      )
    : null;

export const ConsoleAcceptTeamScreen =
  BUILD_TARGET === 'web'
    ? lazy(() =>
        import('@/console/screens/ConsoleAcceptInvitationScreen').then((m) => ({
          default: m.ConsoleAcceptTeamScreen,
        }))
      )
    : null;
