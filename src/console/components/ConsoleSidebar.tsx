import type { ReactNode } from 'react';
import { Users, LayoutDashboard, UserCog, Settings, LogOut, Menu, X, CalendarDays, BarChart3, DollarSign } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useOrganization } from '../contexts/OrganizationContext';
import { orgHasPermission, OrgPermission } from '../../lib/orgAccess';
import { almcRoutes } from '../../lib/almcRoutes';
import { consoleTheme } from '../consoleTheme';

export type ConsoleSection =
  | 'dashboard'
  | 'artists'
  | 'calendar'
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
  const { permissions } = useOrganization();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.permission || orgHasPermission(permissions, item.permission)
  );

  const sidebarContent = (
    <div className="flex h-full flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-3 border-b border-sidebar-border px-3 py-4">
        <img
          src="/airaplay-console-logo.png"
          alt="Airaplay"
          className="h-12 w-auto max-w-[196px] object-contain object-left dark:invert"
        />
        {isMobile && (
          <button
            type="button"
            onClick={onCloseSidebar}
            className="ml-auto rounded-full p-1.5 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-0.5 p-3">
        <p className="mb-2 px-3.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Workspace
        </p>
        {visibleItems.map(({ section, label, icon: Icon }) => (
          <button
            key={section}
            type="button"
            onClick={() => {
              onSectionChange(section);
              if (isMobile) onCloseSidebar();
            }}
            className={cn(
              'flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-sm transition-colors',
              activeSection === section ? consoleTheme.activeNav : consoleTheme.inactiveNav
            )}
          >
            <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-sidebar-border p-3">
        <a
          href={almcRoutes.consumerHome()}
          className="flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          ← Back to Airaplay
        </a>
        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            title="Sign out"
            aria-label="Sign out"
            className="flex w-full items-center gap-3 rounded-full px-3.5 py-2.5 text-sm text-sidebar-foreground hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
          >
            <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.75} />
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
          <div className="fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm" onClick={onCloseSidebar} aria-hidden />
        )}
        <div
          className={cn(
            'fixed inset-y-0 left-0 z-50 w-56 transform transition-transform',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {sidebarContent}
        </div>
      </>
    );
  }

  return <aside className="hidden w-52 shrink-0 lg:block">{sidebarContent}</aside>;
}

export function ConsoleMobileHeader({
  onOpenSidebar,
  title,
}: {
  onOpenSidebar: () => void;
  title: ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-3 border-b border-border/70 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] lg:hidden"
    >
      <button type="button" onClick={onOpenSidebar} className="rounded-full p-2 text-muted-foreground hover:bg-card hover:text-foreground">
        <Menu className="h-5 w-5" strokeWidth={1.75} />
      </button>
      <div className="min-w-0 flex-1">{title}</div>
    </div>
  );
}
