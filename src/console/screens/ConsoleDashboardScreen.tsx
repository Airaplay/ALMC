import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown } from 'lucide-react';
import { performCompleteLogout } from '../../lib/logoutService';
import { almcRoutes } from '../../lib/almcRoutes';
import { LoadingLogo } from '../../components/LoadingLogo';
import { OrganizationProvider, useOrganization } from '../contexts/OrganizationContext';
import {
  ConsoleSidebar,
  ConsoleMobileHeader,
  ConsoleSection,
} from '../components/ConsoleSidebar';
import { ArtistSwitcher } from '../components/ArtistSwitcher';
import { DashboardSection } from '../sections/DashboardSection';
import { ArtistsSection } from '../sections/ArtistsSection';
import { CalendarSection } from '../sections/CalendarSection';
import { AnalyticsSection } from '../sections/AnalyticsSection';
import { RevenueSection } from '../sections/RevenueSection';
import { TeamSection } from '../sections/TeamSection';
import { SettingsSection } from '../sections/SettingsSection';
import { OrgArtistItem } from '../../lib/orgAccess';
import { OrgContentUploadModal } from '../components/OrgContentUploadModal';
import { ConsoleThemeToggle } from '../components/ConsoleThemeToggle';
import { getConsoleGreetingParts } from '../utils/consoleGreeting';
import { useAlmcProtectedRoute } from '../hooks/useAlmcProtectedRoute';

function ConsoleDashboardContent(): JSX.Element {
  const navigate = useNavigate();
  const {
    organization,
    organizations,
    isLoading,
    error,
    setOrganizationId,
    hasPermission,
    selectedArtist,
  } = useOrganization();

  const [activeSection, setActiveSection] = useState<ConsoleSection>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  const [uploadArtist, setUploadArtist] = useState<OrgArtistItem | null>(null);
  const [showInviteArtist, setShowInviteArtist] = useState(false);
  const [analyticsFromArtists, setAnalyticsFromArtists] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const greeting = useMemo(
    () => getConsoleGreetingParts(organization?.name),
    [organization?.name]
  );

  const greetingBlock = (
    <div className="min-w-0">
      {greeting.hiLine && (
        <p className="truncate text-sm font-medium tracking-tight text-muted-foreground">
          {greeting.hiLine}
        </p>
      )}
      <h1 className="truncate text-3xl font-bold tracking-tight text-foreground lg:text-4xl">
        {greeting.timeGreeting}
      </h1>
    </div>
  );

  const greetingBlockMobile = (
    <div className="min-w-0">
      {greeting.hiLine && (
        <p className="truncate text-xs font-medium tracking-tight text-muted-foreground">
          {greeting.hiLine}
        </p>
      )}
      <h1 className="truncate text-xl font-bold tracking-tight text-foreground">
        {greeting.timeGreeting}
      </h1>
    </div>
  );

  const orgSwitcher = organizations.length > 1 && (
    <div className="relative min-w-0 max-w-full sm:max-w-[14rem]">
      <button
        type="button"
        onClick={() => setShowOrgMenu((v) => !v)}
        className="flex w-full max-w-full items-center gap-2 truncate rounded-full border border-border/70 bg-card px-3 py-2 text-sm shadow-[var(--almc-shadow-sm)] hover:bg-muted"
      >
        <span className="truncate">{organization?.name}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
      </button>
      {showOrgMenu && (
        <>
          <div
            className="fixed inset-0 z-40 lg:hidden"
            aria-hidden
            onClick={() => setShowOrgMenu(false)}
          />
          <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(16rem,50vh)] overflow-y-auto rounded-2xl border border-border/70 bg-card py-1 shadow-[var(--almc-shadow)] sm:right-0 sm:left-auto sm:w-56">
            {organizations.map((org) => (
              <button
                key={org.id}
                type="button"
                onClick={() => {
                  setOrganizationId(org.id);
                  setShowOrgMenu(false);
                }}
                className={`block w-full px-4 py-2.5 text-left text-sm hover:bg-muted ${
                  org.id === organization?.id
                    ? 'font-medium text-[var(--almc-lime-deep)]'
                    : 'text-secondary-foreground'
                }`}
              >
                {org.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const handleLogout = async () => {
    await performCompleteLogout();
    // Hard navigate so in-memory auth/org state cannot keep the console open.
    window.location.replace(almcRoutes.login);
  };

  const handleUploadArtist = useCallback((artist: OrgArtistItem) => {
    setUploadArtist(artist);
  }, []);

  const handleOpenUpload = useCallback(() => {
    if (selectedArtist) {
      setUploadArtist(selectedArtist);
      return;
    }
    setActiveSection('artists');
  }, [selectedArtist]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingLogo />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>
      </div>
    );
  }

  if (organizations.length === 0) {
    navigate(almcRoutes.onboarding, { replace: true });
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingLogo />
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return hasPermission('analytics.view') ? <DashboardSection /> : <p className="text-muted-foreground">Access denied</p>;
      case 'artists':
        return hasPermission('artists.view') ? (
          <ArtistsSection
            onUploadArtist={handleUploadArtist}
            initialShowInvite={showInviteArtist}
            onFocusArtist={() => setActiveSection('dashboard')}
            onOpenAnalytics={() => {
              setAnalyticsFromArtists(true);
              setActiveSection('analytics');
            }}
          />
        ) : (
          <p className="text-muted-foreground">Access denied</p>
        );
      case 'calendar':
        return hasPermission('content.view') ? (
          <CalendarSection onUpload={hasPermission('content.upload') ? handleOpenUpload : undefined} />
        ) : (
          <p className="text-muted-foreground">Access denied</p>
        );
      case 'analytics':
        return hasPermission('analytics.view') ? (
          <AnalyticsSection
            fromArtists={analyticsFromArtists}
            onBackToArtists={() => {
              setAnalyticsFromArtists(false);
              setActiveSection('artists');
            }}
          />
        ) : (
          <p className="text-muted-foreground">Access denied</p>
        );
      case 'revenue':
        return hasPermission('analytics.view') || hasPermission('org.manage') ? (
          <RevenueSection />
        ) : (
          <p className="text-muted-foreground">Access denied</p>
        );
      case 'team':
        return hasPermission('team.manage') ? <TeamSection /> : <p className="text-muted-foreground">Access denied</p>;
      case 'settings':
        return hasPermission('org.settings') ? <SettingsSection /> : <p className="text-muted-foreground">Access denied</p>;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <ConsoleSidebar
        activeSection={activeSection}
        onSectionChange={(s) => {
          setActiveSection(s);
          setShowInviteArtist(false);
          if (s !== 'analytics') setAnalyticsFromArtists(false);
          if (s === 'analytics') setAnalyticsFromArtists(false);
        }}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        isMobile={isMobile}
        onSignOut={handleLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-between border-b border-border/70 px-6 py-5 lg:flex">
          {greetingBlock}
          <div className="flex items-center gap-3">
            {orgSwitcher}
            <ArtistSwitcher
              onAddArtist={() => {
                setActiveSection('artists');
                setShowInviteArtist(true);
              }}
              onFocusArtist={() => setActiveSection('dashboard')}
            />
            <ConsoleThemeToggle compact />
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <ConsoleMobileHeader
          onOpenSidebar={() => setSidebarOpen(true)}
          title={greetingBlockMobile}
        />

        <div className="flex flex-col gap-2 border-b border-border px-4 py-2 lg:hidden">
          {orgSwitcher ? <div className="w-full">{orgSwitcher}</div> : null}
          <div className="flex items-center justify-end gap-2">
            <ArtistSwitcher
              onAddArtist={() => {
                setActiveSection('artists');
                setShowInviteArtist(true);
              }}
              onFocusArtist={() => setActiveSection('dashboard')}
            />
            <ConsoleThemeToggle compact />
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-lg p-2 text-muted-foreground hover:text-foreground"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </div>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">{renderSection()}</main>
      </div>

      {uploadArtist && organization && (
        <OrgContentUploadModal
          organizationId={organization.id}
          artist={uploadArtist}
          onClose={() => setUploadArtist(null)}
          onSuccess={() => setUploadArtist(null)}
        />
      )}
    </div>
  );
}

export function ConsoleDashboardScreen(): JSX.Element {
  const authChecked = useAlmcProtectedRoute();

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <LoadingLogo />
      </div>
    );
  }

  return (
    <OrganizationProvider>
      <ConsoleDashboardContent />
    </OrganizationProvider>
  );
}

export default ConsoleDashboardScreen;
