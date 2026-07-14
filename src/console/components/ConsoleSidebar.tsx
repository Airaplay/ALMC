import { Users, LayoutDashboard, Upload, UserCog, Settings, LogOut, Menu, X, ChevronDown, Building2 } from 'lucide-react';
import { useOrganization } from '../contexts/OrganizationContext';
import { orgHasPermission, OrgPermission } from '../../lib/orgAccess';

export type ConsoleSection = 'dashboard' | 'artists' | 'content' | 'team' | 'settings';

interface ConsoleSidebarProps {
  activeSection: ConsoleSection;
  onSectionChange: (section: ConsoleSection) => void;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  isMobile: boolean;
}

const NAV_ITEMS: Array<{
  section: ConsoleSection;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: OrgPermission;
}> = [
  { section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'analytics.view' },
  { section: 'artists', label: 'Artists', icon: Users, permission: 'artists.view' },
  { section: 'content', label: 'Content', icon: Upload, permission: 'content.view' },
  { section: 'team', label: 'Team', icon: UserCog, permission: 'team.manage' },
  { section: 'settings', label: 'Settings', icon: Settings, permission: 'org.settings' },
];

export function ConsoleSidebar({
  activeSection,
  onSectionChange,
  sidebarOpen,
  onCloseSidebar,
  isMobile,
}: ConsoleSidebarProps) {
  const { organization, permissions } = useOrganization();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || orgHasPermission(permissions, item.permission)
  );

  const sidebarContent = (
    <div className="flex h-full flex-col bg-[#0f0f11] border-r border-white/10">
      <div className="flex items-center gap-3 px-5 py-5 border-b border-white/10">
        {organization?.logo_url ? (
          <img src={organization.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#FF3366]/20 text-[#FF3366]">
            <Building2 className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">{organization?.name ?? 'Console'}</p>
          <p className="truncate text-xs text-white/50 capitalize">{organization?.type?.replace('_', ' ')}</p>
        </div>
        {isMobile && (
          <button type="button" onClick={onCloseSidebar} className="text-white/60 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {visibleItems.map(({ section, label, icon: Icon }) => (
          <button
            key={section}
            type="button"
            onClick={() => {
              onSectionChange(section);
              if (isMobile) onCloseSidebar();
            }}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              activeSection === section
                ? 'bg-[#FF3366]/15 text-[#FF3366]'
                : 'text-white/70 hover:bg-white/5 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="border-t border-white/10 p-3">
        <a
          href="/"
          className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/60 hover:bg-white/5 hover:text-white"
        >
          ← Back to Airaplay
        </a>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <>
        {sidebarOpen && (
          <div className="fixed inset-0 z-40 bg-black/60" onClick={onCloseSidebar} aria-hidden />
        )}
        <div
          className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarContent}
        </div>
      </>
    );
  }

  return <aside className="hidden w-60 shrink-0 lg:block">{sidebarContent}</aside>;
}

export function ConsoleMobileHeader({
  onOpenSidebar,
  title,
}: {
  onOpenSidebar: () => void;
  title: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3 lg:hidden">
      <button type="button" onClick={onOpenSidebar} className="text-white/70 hover:text-white">
        <Menu className="h-5 w-5" />
      </button>
      <h1 className="text-base font-semibold text-white">{title}</h1>
    </div>
  );
}

export { LogOut, ChevronDown };
