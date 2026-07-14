import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ScreenLoader } from '@/components/ScreenLoader';
import { almcRoutes } from '@/lib/almcRoutes';

const ConsoleDashboardScreen = lazy(() => import('@/console/screens/ConsoleDashboardScreen'));
const ConsoleLoginScreen = lazy(() =>
  import('@/console/screens/ConsoleLoginScreen').then((m) => ({ default: m.ConsoleLoginScreen }))
);
const ConsoleOnboardingScreen = lazy(() =>
  import('@/console/screens/ConsoleOnboardingScreen').then((m) => ({ default: m.ConsoleOnboardingScreen }))
);
const ConsoleAcceptArtistScreen = lazy(() =>
  import('@/console/screens/ConsoleAcceptInvitationScreen').then((m) => ({ default: m.ConsoleAcceptArtistScreen }))
);
const ConsoleAcceptTeamScreen = lazy(() =>
  import('@/console/screens/ConsoleAcceptInvitationScreen').then((m) => ({ default: m.ConsoleAcceptTeamScreen }))
);

export default function AlmcApp() {
  return (
    <Suspense fallback={<ScreenLoader />}>
      <Routes>
        <Route path={almcRoutes.home} element={<ConsoleDashboardScreen />} />
        <Route path={almcRoutes.login} element={<ConsoleLoginScreen />} />
        <Route path={almcRoutes.onboarding} element={<ConsoleOnboardingScreen />} />
        <Route path={almcRoutes.acceptArtist} element={<ConsoleAcceptArtistScreen />} />
        <Route path={almcRoutes.acceptTeam} element={<ConsoleAcceptTeamScreen />} />
        <Route path="*" element={<Navigate to={almcRoutes.home} replace />} />
      </Routes>
    </Suspense>
  );
}
