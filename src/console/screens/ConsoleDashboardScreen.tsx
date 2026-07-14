import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
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
import { ContentSection } from '../sections/ContentSection';
import { TeamSection } from '../sections/TeamSection';
import { SettingsSection } from '../sections/SettingsSection';
import { OrgArtistItem } from '../../lib/orgAccess';
import { OrgContentUploadModal } from '../components/OrgContentUploadModal';

const SECTION_TITLES: Record<ConsoleSection, string> = {
  dashboard: 'Dashboard',
  artists: 'Artists',
  content: 'Content',
  team: 'Team',
  settings: 'Settings',
};

function ConsoleDashboardContent(): JSX.Element {
  const navigate = useNavigate();
  const {
    organization,
    organizations,
    isLoading,
    error,
    setOrganizationId,
    hasPermission,
  } = useOrganization();

  const [activeSection, setActiveSection] = useState<ConsoleSection>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
  const [showOrgMenu, setShowOrgMenu] = useState(false);
  const [uploadArtist, setUploadArtist] = useState<OrgArtistItem | null>(null);
  const [showInviteArtist, setShowInviteArtist] = useState(false);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleLogout = async () => {
    await performCompleteLogout();
    navigate(almcRoutes.login, { replace: true });
  };

  const handleUploadArtist = useCallback((artist: OrgArtistItem) => {
    setUploadArtist(artist);
  }, []);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <LoadingLogo />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b] p-4">
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-red-300">{error}</div>
      </div>
    );
  }

  if (organizations.length === 0) {
    navigate(almcRoutes.onboarding, { replace: true });
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <LoadingLogo />
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'dashboard':
        return hasPermission('analytics.view') ? <DashboardSection /> : <p className="text-white/50">Access denied</p>;
      case 'artists':
        return hasPermission('artists.view') ? (
          <ArtistsSection onUploadArtist={handleUploadArtist} initialShowInvite={showInviteArtist} />
        ) : (
          <p className="text-white/50">Access denied</p>
        );
      case 'content':
        return <ContentSection />;
      case 'team':
        return hasPermission('team.manage') ? <TeamSection /> : <p className="text-white/50">Access denied</p>;
      case 'settings':
        return hasPermission('org.settings') ? <SettingsSection /> : <p className="text-white/50">Access denied</p>;
      default:
        return null;
    }
  };

  return (
    <div className="flex min-h-screen bg-[#0a0a0b] text-white">
      <ConsoleSidebar
        activeSection={activeSection}
        onSectionChange={(s) => {
          setActiveSection(s);
          setShowInviteArtist(false);
        }}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        isMobile={isMobile}
        onSignOut={handleLogout}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="hidden items-center justify-between border-b border-white/10 px-6 py-4 lg:flex">
          <h1 className="text-lg font-semibold">{SECTION_TITLES[activeSection]}</h1>
          <div className="flex items-center gap-3">
            {organizations.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowOrgMenu((v) => !v)}
                  className="flex items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
                >
                  {organization?.name}
                  <ChevronDown className="h-4 w-4 text-white/50" />
                </button>
                {showOrgMenu && (
                  <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl border border-white/10 bg-[#141416] py-1 shadow-xl">
                    {organizations.map((org) => (
                      <button
                        key={org.id}
                        type="button"
                        onClick={() => {
                          setOrganizationId(org.id);
                          setShowOrgMenu(false);
                        }}
                        className={`block w-full px-4 py-2 text-left text-sm hover:bg-white/5 ${
                          org.id === organization?.id ? 'text-[#FF3366]' : 'text-white/80'
                        }`}
                      >
                        {org.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <ArtistSwitcher
              onAddArtist={() => {
                setActiveSection('artists');
                setShowInviteArtist(true);
              }}
            />
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-xl p-2 text-white/50 hover:bg-white/5 hover:text-white"
              title="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        </header>

        <ConsoleMobileHeader
          onOpenSidebar={() => setSidebarOpen(true)}
          title={SECTION_TITLES[activeSection]}
        />

        <div className="flex items-center justify-end gap-2 border-b border-white/10 px-4 py-2 lg:hidden">
          <ArtistSwitcher
            onAddArtist={() => {
              setActiveSection('artists');
              setShowInviteArtist(true);
            }}
          />
          <button type="button" onClick={handleLogout} className="rounded-lg p-2 text-white/50">
            <LogOut className="h-5 w-5" />
          </button>
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
  const navigate = useNavigate();
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        navigate(almcRoutes.login, { replace: true });
      } else {
        setAuthChecked(true);
      }
    });
  }, [navigate]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
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
