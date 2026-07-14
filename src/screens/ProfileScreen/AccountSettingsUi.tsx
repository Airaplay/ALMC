import { ReactNode } from 'react';
import {
  BarChart,
  Bell,
  ChevronRight,
  Clock,
  Coins,
  DollarSign,
  Gift,
  HelpCircle,
  LogOut,
  Shield,
  ShieldCheck,
  Star,
  Trash2,
  Trophy,
  User,
  type LucideIcon,
} from 'lucide-react';
import { ContributionScoreWidget } from '../../components/ContributionScoreWidget';
import { DataSaverToggle } from '../../components/DataSaverToggle';
import { cn } from '../../lib/utils';

export type AccountTabId = 'account' | 'privacy' | 'earnings' | 'analytics' | 'topfans';

interface AccountSettingsTabsProps {
  activeTab: AccountTabId;
  onTabChange: (tab: AccountTabId) => void;
  isCreator: boolean;
  sticky?: boolean;
}

const TAB_CONFIG: { id: AccountTabId; label: string; icon: LucideIcon; creatorOnly?: boolean }[] = [
  { id: 'account', label: 'Account', icon: User },
  { id: 'topfans', label: 'Top Fans', icon: Trophy },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'earnings', label: 'Earnings', icon: DollarSign },
  { id: 'analytics', label: 'Analytics', icon: BarChart, creatorOnly: true },
];

export function AccountSettingsTabs({
  activeTab,
  onTabChange,
  isCreator,
  sticky = false,
}: AccountSettingsTabsProps) {
  const tabs = TAB_CONFIG.filter((tab) => !tab.creatorOnly || isCreator);

  return (
    <nav
      className={cn(
        'mt-0 -mx-1',
        sticky && 'sticky top-[60px] z-20 bg-[#0a0a0a] pt-2 pb-1 -mx-5 px-5'
      )}
      aria-label="Account settings"
    >
      <div className="flex gap-0.5 border-b border-white/10 overflow-x-auto scrollbar-hide">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'relative flex-shrink-0 px-3 pb-3 text-xs sm:text-sm font-semibold transition-colors touch-manipulation whitespace-nowrap',
              activeTab === tab.id ? 'text-white' : 'text-white/45 hover:text-white/70'
            )}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-gradient-to-r from-[#00ad74] to-[#009c68]" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function SettingsSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {title && (
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 px-1">
          {title}
        </p>
      )}
      <div className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden divide-y divide-white/[0.06]">
        {children}
      </div>
    </section>
  );
}

interface SettingsMenuRowProps {
  icon: LucideIcon;
  label: string;
  description?: string;
  onClick?: () => void;
  iconClassName?: string;
  iconBgClassName?: string;
  labelClassName?: string;
  showChevron?: boolean;
  trailing?: ReactNode;
}

export function SettingsMenuRow({
  icon: Icon,
  label,
  description,
  onClick,
  iconClassName = 'text-white/80',
  iconBgClassName = 'bg-white/[0.08]',
  labelClassName = 'text-white',
  showChevron = true,
  trailing,
}: SettingsMenuRowProps) {
  const Comp = onClick ? 'button' : 'div';

  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors touch-manipulation',
        onClick && 'active:bg-white/[0.04] hover:bg-white/[0.03]'
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={cn(
            'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
            iconBgClassName
          )}
        >
          <Icon className={cn('w-[18px] h-[18px]', iconClassName)} />
        </div>
        <div className="min-w-0">
          <p className={cn('text-sm font-medium truncate', labelClassName)}>{label}</p>
          {description && (
            <p className="text-white/45 text-xs mt-0.5 leading-snug">{description}</p>
          )}
        </div>
      </div>
      {trailing ?? (showChevron && <ChevronRight className="w-4 h-4 text-white/30 flex-shrink-0" />)}
    </Comp>
  );
}

export function TreatWalletCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full relative rounded-2xl overflow-hidden bg-gradient-to-br from-amber-500/15 via-orange-500/10 to-transparent border border-amber-500/25 p-4 text-left active:scale-[0.99] transition-transform touch-manipulation group"
    >
      <div className="absolute top-0 right-0 w-28 h-28 bg-amber-500/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="relative flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-600/20 group-hover:scale-105 transition-transform flex-shrink-0">
            <Coins className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <h4 className="font-bold text-white text-sm">Treat Wallet</h4>
            <p className="text-white/55 text-xs mt-0.5">Manage treats, tips & promotions</p>
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-white/40 group-hover:translate-x-0.5 transition-transform flex-shrink-0" />
      </div>
    </button>
  );
}

interface AccountTabContentProps {
  activeTab: AccountTabId;
  isCreator: boolean;
  isListener: boolean;
  userId?: string;
  userRole?: string;
  artistProfileId?: string;
  onNavigate: (path: string) => void;
  onShowNotificationSettings: () => void;
  onShowPrivacySettings: () => void;
  onShowHelpSupport: () => void;
  onShowAccountDeletion: () => void;
  onShowArtistForm: () => void;
  onSignOut: () => void;
  topFansSlot: ReactNode;
  analyticsSlot: ReactNode;
  earningsSlot: ReactNode;
}

export function AccountTabContent({
  activeTab,
  isListener,
  onNavigate,
  onShowNotificationSettings,
  onShowPrivacySettings,
  onShowHelpSupport,
  onShowAccountDeletion,
  onShowArtistForm,
  onSignOut,
  topFansSlot,
  analyticsSlot,
  earningsSlot,
}: AccountTabContentProps) {
  if (activeTab === 'topfans') {
    return <div className="pt-2">{topFansSlot}</div>;
  }

  if (activeTab === 'analytics') {
    return <div className="pt-2">{analyticsSlot}</div>;
  }

  if (activeTab === 'earnings') {
    return <div className="pt-2 space-y-4">{earningsSlot}</div>;
  }

  if (activeTab === 'privacy') {
    return (
      <div className="pt-2 space-y-5">
        <SettingsSection title="Privacy">
          <SettingsMenuRow
            icon={Shield}
            label="Profile Visibility"
            description="Control who can see your profile"
            onClick={onShowPrivacySettings}
          />
        </SettingsSection>

        <DataSaverToggle />

        <SettingsSection title="Danger Zone">
          <SettingsMenuRow
            icon={Trash2}
            label="Delete Account"
            description="Request permanent account deletion"
            onClick={onShowAccountDeletion}
            iconClassName="text-red-300"
            iconBgClassName="bg-red-500/15"
            labelClassName="text-red-300"
          />
        </SettingsSection>
      </div>
    );
  }

  return (
    <div className="pt-2 space-y-5">
      <TreatWalletCard onClick={() => onNavigate('/treats')} />

      <SettingsSection title="Your Account">
        <SettingsMenuRow
          icon={User}
          label="Edit Information"
          onClick={() => onNavigate('/edit-profile')}
        />
        <SettingsMenuRow
          icon={Bell}
          label="Notifications"
          onClick={onShowNotificationSettings}
        />
      </SettingsSection>

      <SettingsSection title="Rewards">
        <SettingsMenuRow
          icon={Gift}
          label="Invite & Earn"
          description="Share your code and earn treats"
          onClick={() => onNavigate('/invite-earn')}
        />
      </SettingsSection>

      <SettingsSection title="Support">
        <SettingsMenuRow
          icon={HelpCircle}
          label="Help & Support"
          onClick={onShowHelpSupport}
        />
      </SettingsSection>

      <button
        type="button"
        onClick={onSignOut}
        className="w-full min-h-[48px] bg-red-500/10 hover:bg-red-500/15 border border-red-500/25 rounded-2xl font-semibold text-red-400 transition-all flex items-center justify-center gap-2 active:scale-[0.98] touch-manipulation"
      >
        <LogOut className="w-4 h-4" />
        Sign Out
      </button>

      {isListener && (
        <button
          type="button"
          onClick={onShowArtistForm}
          className="w-full min-h-[48px] bg-gradient-to-r from-[#00ad74] to-[#009c68] text-white rounded-2xl font-bold transition-all flex items-center justify-center gap-2 active:scale-[0.98] touch-manipulation shadow-lg shadow-[#00ad74]/20"
        >
          <Star className="w-4 h-4" />
          Become an Artiste
        </button>
      )}
    </div>
  );
}

export interface WithdrawalHistoryItem {
  id: string;
  amount: number | null;
  net_amount: number | null;
  currency_code: string | null;
  currency_symbol: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  requested_date: string | null;
  processed_date: string | null;
  payment_reference: string | null;
  method_type: 'usdt_wallet' | 'bank_account' | null;
}

interface EarningsTabPanelProps {
  totalEarnings: number;
  earningsWithdrawalMin: number;
  earningsStatusMessage: string | null;
  showEarningsPendingNote: boolean;
  userId?: string;
  withdrawalHistory: WithdrawalHistoryItem[];
  isLoadingWithdrawalHistory: boolean;
  onWithdraw: () => void;
  onEarningsConverted?: (payoutUsd: number) => void;
  formatWithdrawalAmount: (row: WithdrawalHistoryItem) => string;
  formatWithdrawalDate: (value: string | null) => string;
}

const withdrawalStatusStyles: Record<WithdrawalHistoryItem['status'], string> = {
  pending: 'text-amber-400 bg-amber-500/15',
  approved: 'text-sky-400 bg-sky-500/15',
  completed: 'text-[#5ee4b0] bg-[#00ad74]/15',
  rejected: 'text-red-400 bg-red-500/15',
};

export function EarningsTabPanel({
  totalEarnings,
  earningsWithdrawalMin,
  earningsStatusMessage,
  showEarningsPendingNote,
  userId,
  withdrawalHistory,
  isLoadingWithdrawalHistory,
  onWithdraw,
  onEarningsConverted,
  formatWithdrawalAmount,
  formatWithdrawalDate,
}: EarningsTabPanelProps) {
  const canWithdraw = totalEarnings >= earningsWithdrawalMin;

  return (
    <>
      <div className="relative rounded-2xl overflow-hidden border border-[#00ad74]/20 bg-gradient-to-br from-[#00ad74]/15 via-[#009c68]/10 to-transparent">
        <div className="absolute top-0 right-0 w-36 h-36 bg-[#00ad74]/8 rounded-full blur-3xl -translate-y-1/3 translate-x-1/3 pointer-events-none" />
        <div className="relative px-5 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#00ad74]/60 mb-1">
                Available Earnings
              </p>
              <p
                className="font-black text-[#00ad74] leading-none tabular-nums"
                style={{ fontSize: 'clamp(2rem, 10vw, 2.75rem)' }}
              >
                ${totalEarnings.toFixed(2)}
              </p>
              {earningsStatusMessage && (
                <p className="text-[11px] text-white/40 mt-2 leading-tight">{earningsStatusMessage}</p>
              )}
              {showEarningsPendingNote && (
                <p className="text-[11px] text-white/40 mt-2 leading-tight">
                  Earnings pending confirmation. Converted Treats and other balance can be withdrawn.
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2 pt-1 flex-shrink-0">
              <div className="flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-2.5 py-1">
                <ShieldCheck className="w-3 h-3 text-[#00ad74]/60" />
                <p className="text-[10px] text-white/50 font-medium">Min. ${earningsWithdrawalMin}</p>
              </div>
              <div className="flex items-center gap-1.5 rounded-full bg-white/[0.06] border border-white/10 px-2.5 py-1">
                <Clock className="w-3 h-3 text-[#00ad74]/60" />
                <p className="text-[10px] text-white/50 font-medium">1–3 days</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {userId && (
        <ContributionScoreWidget userId={userId} onConverted={onEarningsConverted} />
      )}

      <button
        type="button"
        onClick={onWithdraw}
        disabled={!canWithdraw}
        className="w-full min-h-[48px] bg-white hover:bg-white/90 disabled:opacity-40 disabled:cursor-not-allowed rounded-2xl font-bold text-black transition-all active:scale-[0.98] touch-manipulation"
      >
        Withdraw Earnings
      </button>

      <div className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/[0.06]">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/50">
            Withdrawal History
          </p>
          <p className="text-white/40 text-[11px] mt-1">Auto-deleted after 45 days</p>
        </div>
        <div className="p-3">
          {isLoadingWithdrawalHistory ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-white/[0.04] animate-pulse" />
              ))}
            </div>
          ) : withdrawalHistory.length === 0 ? (
            <p className="text-white/50 text-sm py-4 text-center">No withdrawal history yet.</p>
          ) : (
            <div className="space-y-2">
              {withdrawalHistory.map((row) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white text-sm font-semibold tabular-nums">
                        {formatWithdrawalAmount(row)}
                      </p>
                      <p className="text-white/45 text-[11px] mt-0.5">
                        {formatWithdrawalDate(row.requested_date)}
                        {row.method_type
                          ? ` · ${row.method_type === 'usdt_wallet' ? 'USDT Wallet' : 'Bank'}`
                          : ''}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <span
                        className={cn(
                          'inline-flex text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full',
                          withdrawalStatusStyles[row.status]
                        )}
                      >
                        {row.status}
                      </span>
                      {row.payment_reference && (
                        <p className="text-[10px] text-white/35 mt-1 max-w-[120px] truncate">
                          Ref: {row.payment_reference}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
