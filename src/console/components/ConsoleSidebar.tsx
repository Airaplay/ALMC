import { Users, LayoutDashboard, Upload, UserCog, Settings, LogOut, Menu, X, Building2, CalendarDays, BarChart3, DollarSign } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOrganization } from '../contexts/OrganizationContext';
import { orgHasPermission, OrgPermission } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { consoleTheme } from '../consoleTheme';

export type ConsoleSection =
  | 'dashboard'
  | 'artists'
  | 'calendar'
  | 'content'
  | 'analytics'
  | 'revenue'
  | 'team'
  | 'settings';

interface ConsoleSidebarProps {
  activeSection: ConsoleSection;
  onSectionChange: (section: ConsoleSection) => void;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  isMobile: boolean;
  onSignOut?: () => void;
}

const NAV_ITEMS: Array<{
  section: ConsoleSection;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: OrgPermission;
}> = [
  { section: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'analytics.view' },
  { section: 'artists', label: 'Artists', icon: Users, permission: 'artists.view' },
  { section: 'calendar', label: 'Calendar', icon: CalendarDays, permission: 'content.view' },
  { section: 'content', label: 'Content', icon: Upload, permission: 'content.view' },
  { section: 'analytics', label: 'Analytics', icon: BarChart3, permission: 'analytics.view' },
  { section: 'revenue', label: 'Revenue', icon: DollarSign, permission: 'analytics.view' },
  { section: 'team', label: 'Team', icon: UserCog, permission: 'team.manage' },
  { section: 'settings', label: 'Settings', icon: Settings, permission: 'org.settings' },
];

export function ConsoleSidebar({
  activeSection,
  onSectionChange,
  sidebarOpen,
  onCloseSidebar,
  isMobile,
  onSignOut,
}: ConsoleSidebarProps) {
  const { organization, permissions } = useOrganization();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || orgHasPermission(permissions, item.permission)
  );

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
        {organization?.logo_url ? (
          <img src={organization.logo_url} alt="" className="h-9 w-9 rounded-lg object-cover" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/20 text-[#3ba208]">
            <Building2 className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-sidebar-accent-foreground">
            {organization?.name ?? 'Console'}
          </p>
          <p className="truncate text-xs capitalize text-sidebar-foreground">
            {organization?.type?.replace('_', ' ')}
          </p>
        </div>
        {isMobile && (
          <button type="button" onClick={onCloseSidebar} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
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
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              activeSection === section ? consoleTheme.activeNav : consoleTheme.inactiveNav
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-1 border-t border-sidebar-border p-3">
        <a
          href={almcRoutes.consumerHome()}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
        >
          ← Back to Airaplay
        </a>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Sign out
          </button>
        )}
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
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-64 transform transition-transform',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
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
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 lg:hidden">
      <button type="button" onClick={onOpenSidebar} className="text-muted-foreground hover:text-foreground">
        <Menu className="h-5 w-5" />
      </button>
      <h1 className="text-base font-semibold text-foreground">{title}</h1>
    </div>
  );
}
