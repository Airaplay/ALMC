import { ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { BadgeCheck, Camera, ExternalLink, LogOut, Pencil } from 'lucide-react';
import { safeHrefUrl } from '../../lib/sanitizeHtml';
import { cn } from '../../lib/utils';
import { ProfileHeroSkeletonCore } from '../PublicProfileScreen/ProfileSkeletons';
import { ProfileHeroHeader } from '../PublicProfileScreen/ProfileHeroHeader';
import {
  formatProfileCount,
  getProfileAvatarSrc,
  getProfileHeroSrc,
  getSocialIcon,
  PROFILE_AVATAR_IMAGE_CLASS,
  PROFILE_HERO_HEADER_BTN_CLASS,
  PROFILE_HERO_HEADER_BTN_DANGER_CLASS,
  PROFILE_HERO_HEADER_GRID_BACK,
  PROFILE_HERO_HEADER_ICON_CLASS,
  PROFILE_HERO_HEADER_ICON_STROKE,
  PROFILE_HERO_HEIGHT,
  PROFILE_HERO_IMAGE_CLASS,
  PROFILE_SAFE_AREA_STYLE,
} from '../PublicProfileScreen/profileUiUtils';

const BIO_COLLAPSED_MAX_HEIGHT = '5.75rem';

export interface AccountProfileHeroProps {
  displayName: string;
  displayInitial: string;
  username?: string | null;
  avatarUrl?: string | null;
  heroUrl?: string | null;
  bio?: string | null;
  countryLabel?: string | null;
  role?: string | null;
  isCreator: boolean;
  isVerified: boolean;
  verifiedBadgeUrl?: string | null;
  followerCount: number;
  followingCount: number;
  socialLinks: Array<{ id: string; platform: string; url: string }>;
  isLoadingUserProfile: boolean;
  isLoadingCounts: boolean;
  isLoadingArtistData: boolean;
  isSigningOut: boolean;
  headerProgress: number;
  bioExpanded: boolean;
  onBioExpandedChange: (expanded: boolean) => void;
  onBack: () => void;
  onSignOut: () => void;
  onEditProfile: () => void;
  onEditAvatar?: () => void;
  isAvatarUploading?: boolean;
  onViewPublicProfile: () => void;
  onHeroError?: () => void;
  canEditHero?: boolean;
  onEditHero?: () => void;
  isHeroUploading?: boolean;
  tabsSlot?: ReactNode;
}

export function AccountProfileHero({
  displayName,
  displayInitial,
  username,
  avatarUrl,
  heroUrl,
  bio,
  countryLabel,
  role,
  isCreator,
  isVerified,
  verifiedBadgeUrl,
  followerCount,
  followingCount,
  socialLinks,
  isLoadingUserProfile,
  isLoadingCounts,
  isLoadingArtistData,
  isSigningOut,
  headerProgress,
  bioExpanded,
  onBioExpandedChange,
  onBack,
  onSignOut,
  onEditProfile,
  onEditAvatar,
  isAvatarUploading = false,
  onViewPublicProfile,
  onHeroError,
  canEditHero = false,
  onEditHero,
  isHeroUploading = false,
  tabsSlot,
}: AccountProfileHeroProps) {
  const trimmedBio = bio?.trim() || '';
  const bioRef = useRef<HTMLParagraphElement>(null);
  const [showBioToggle, setShowBioToggle] = useState(false);

  useLayoutEffect(() => {
    const el = bioRef.current;
    if (!el || !trimmedBio) {
      setShowBioToggle(false);
      return;
    }
    if (bioExpanded) return;

    const measure = () => {
      setShowBioToggle(el.scrollHeight > el.clientHeight + 2);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [trimmedBio, bioExpanded]);

  const roleLabel =
    role === 'creator'
      ? 'Creator'
      : role === 'admin'
        ? 'Admin'
        : role === 'listener'
          ? 'Listener'
          : role
            ? role.charAt(0).toUpperCase() + role.slice(1)
            : null;

  return (
    <>
      <style>{PROFILE_SAFE_AREA_STYLE}</style>

      <ProfileHeroHeader
        progress={headerProgress}
        title={isSigningOut ? 'Signing out…' : displayName}
        gridTemplateColumns={`${PROFILE_HERO_HEADER_GRID_BACK} 1fr auto`}
        onBack={onBack}
        trailing={
          <>
            {canEditHero && onEditHero && (
              <button
                type="button"
                onClick={onEditHero}
                disabled={isHeroUploading}
                aria-label="Change cover photo"
                className={cn(
                  PROFILE_HERO_HEADER_BTN_CLASS,
                  headerProgress > 0.35 && 'bg-white/[0.07] border-white/[0.1] shadow-none hover:bg-white/[0.11]'
                )}
              >
                <Camera className={PROFILE_HERO_HEADER_ICON_CLASS} strokeWidth={PROFILE_HERO_HEADER_ICON_STROKE} />
              </button>
            )}
            <button
              type="button"
              onClick={onSignOut}
            aria-label="Sign out"
            className={cn(
              PROFILE_HERO_HEADER_BTN_CLASS,
              PROFILE_HERO_HEADER_BTN_DANGER_CLASS,
              headerProgress > 0.35 && 'shadow-none hover:bg-red-500/18'
            )}
          >
            <LogOut className={PROFILE_HERO_HEADER_ICON_CLASS} strokeWidth={PROFILE_HERO_HEADER_ICON_STROKE} />
          </button>
          </>
        }
      />

      <section className="relative">
        <div
          className="relative overflow-hidden"
          style={{ height: PROFILE_HERO_HEIGHT }}
        >
          {heroUrl ? (
            <>
              <img
                src={getProfileHeroSrc(heroUrl)}
                alt=""
                aria-hidden
                className={PROFILE_HERO_IMAGE_CLASS}
                loading="eager"
                decoding="async"
                onError={onHeroError}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/20 to-[#0a0a0a] pointer-events-none" />
            </>
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-[#00ad74]/25 via-[#0a0a0a] to-black" />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(0,173,116,0.15),transparent_55%)] pointer-events-none" />
        </div>

        <div className="profile-safe-x -mt-12 relative z-10 px-5 pb-4 max-w-lg mx-auto w-full">
          <div className="flex items-end gap-4">
            <div className="relative flex-shrink-0">
              {isLoadingUserProfile ? (
                <div className="w-[72px] h-[72px] rounded-2xl bg-white/[0.06] animate-pulse" />
              ) : (
                <>
                  <div className="w-[72px] h-[72px] rounded-2xl overflow-hidden ring-2 ring-white/40 border border-white/25 shadow-[0_8px_24px_rgba(0,0,0,0.35)] bg-[#141414]">
                    {avatarUrl ? (
                      <img
                        src={getProfileAvatarSrc(avatarUrl)}
                        alt={displayName}
                        className={PROFILE_AVATAR_IMAGE_CLASS}
                        width={72}
                        height={72}
                        loading="eager"
                        decoding="async"
                      />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-[#00ad74]/40 to-[#009c68]/20 flex items-center justify-center">
                        <span className="text-2xl font-bold text-white">{displayInitial}</span>
                      </div>
                    )}
                  </div>
                  {isCreator && isVerified && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-[#0a0a0a] ring-2 ring-white/40 flex items-center justify-center">
                      {verifiedBadgeUrl ? (
                        <img
                          src={verifiedBadgeUrl}
                          alt="Verified"
                          className="w-3.5 h-3.5 object-contain"
                        />
                      ) : (
                        <BadgeCheck className="w-3.5 h-3.5 text-[#00ad74] fill-[#00ad74]" />
                      )}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={onEditAvatar ?? onEditProfile}
                    disabled={isAvatarUploading}
                    aria-label="Change profile photo"
                    className="absolute -bottom-1 -left-1 w-8 h-8 rounded-full bg-[#0a0a0a] border border-white/20 flex items-center justify-center shadow-lg active:scale-95 hover:bg-white/10 transition-all touch-manipulation disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5 text-white/80" />
                  </button>
                </>
              )}
            </div>

            <div className="flex-1 min-w-0 pb-1">
              {isLoadingUserProfile ? (
                <div className="space-y-2">
                  <div className="h-7 w-40 bg-white/[0.06] rounded animate-pulse" />
                  <div className="h-4 w-24 bg-white/[0.06] rounded animate-pulse" />
                </div>
              ) : (
                <>
                  <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight truncate leading-tight">
                    {isSigningOut ? 'Signing out…' : displayName}
                  </h2>
                  {username && (
                    <p className="text-white/55 text-sm mt-1 truncate">@{username}</p>
                  )}
                  {(roleLabel || countryLabel) && (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 min-w-0">
                      {isCreator && (
                        <span className="inline-flex items-center rounded-full bg-[#00ad74]/15 border border-[#00ad74]/30 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#5ee4b0] flex-shrink-0">
                          Creator
                        </span>
                      )}
                      {!isCreator && roleLabel && (
                        <span className="inline-flex items-center rounded-full bg-white/[0.08] border border-white/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white/60 flex-shrink-0">
                          {roleLabel}
                        </span>
                      )}
                      {countryLabel && (
                        <span className="text-white/50 text-xs truncate">{countryLabel}</span>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {trimmedBio && !isLoadingUserProfile && (
            <div className="mt-5 w-full min-w-0">
              <p
                ref={bioRef}
                className={cn(
                  'text-white/75 text-sm leading-relaxed break-words',
                  bioExpanded ? 'whitespace-pre-wrap' : 'whitespace-pre-line overflow-hidden'
                )}
                style={!bioExpanded ? { maxHeight: BIO_COLLAPSED_MAX_HEIGHT } : undefined}
              >
                {trimmedBio}
              </p>
              {showBioToggle && (
                <button
                  type="button"
                  onClick={() => onBioExpandedChange(!bioExpanded)}
                  className="relative z-10 text-[#00ad74] text-xs font-semibold mt-2 py-1 touch-manipulation active:opacity-70"
                >
                  {bioExpanded ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 mt-6">
            {isLoadingCounts ? (
              <>
                <div className="flex-1 h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
                <div className="flex-1 h-14 rounded-2xl bg-white/[0.06] animate-pulse" />
              </>
            ) : (
              <>
                <div className="flex-1 rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur-md px-4 py-3 text-center">
                  <p className="text-lg font-bold text-white leading-none tabular-nums">
                    {formatProfileCount(followerCount)}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Followers</p>
                </div>
                <div className="flex-1 rounded-2xl bg-white/[0.06] border border-white/10 backdrop-blur-md px-4 py-3 text-center">
                  <p className="text-lg font-bold text-white leading-none tabular-nums">
                    {formatProfileCount(followingCount)}
                  </p>
                  <p className="text-[10px] uppercase tracking-widest text-white/50 mt-1">Following</p>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2.5 mt-6 w-full min-w-0">
            <button
              type="button"
              onClick={onEditProfile}
              className="h-10 flex-1 min-w-0 px-3 rounded-full bg-white text-black font-semibold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform touch-manipulation whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5 flex-shrink-0" />
              Edit Profile
            </button>
            <button
              type="button"
              onClick={onViewPublicProfile}
              className="h-10 flex-1 min-w-0 px-3 rounded-full bg-white/10 border border-white/20 text-white font-semibold text-sm flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all touch-manipulation whitespace-nowrap hover:bg-white/15"
            >
              <ExternalLink className="w-3.5 h-3.5 flex-shrink-0" />
              Public View
            </button>
          </div>

          {isLoadingArtistData ? (
            <div className="flex items-center gap-2 mt-5">
              <div className="w-10 h-10 rounded-full bg-white/[0.06] animate-pulse" />
              <div className="w-10 h-10 rounded-full bg-white/[0.06] animate-pulse" />
            </div>
          ) : socialLinks.length > 0 ? (
            <div className="flex items-center gap-2 flex-wrap mt-5">
              {socialLinks.map((link) => {
                const safeUrl = safeHrefUrl(link.url);
                const icon = getSocialIcon(link.platform, 'w-4 h-4');
                return safeUrl ? (
                  <a
                    key={link.id}
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={link.platform}
                    className="min-w-10 min-h-10 flex items-center justify-center rounded-full bg-white/[0.08] border border-white/10 text-white/70 hover:text-white hover:bg-white/12 transition-colors touch-manipulation"
                  >
                    {icon}
                  </a>
                ) : null;
              })}
            </div>
          ) : null}

          {tabsSlot && <div className="relative z-0 mt-6">{tabsSlot}</div>}
        </div>
      </section>
    </>
  );
}

export function AccountProfileSkeleton() {
  return (
    <div className="flex flex-col min-h-screen min-h-[100dvh] bg-[#0a0a0a] text-white overflow-y-auto content-with-nav">
      <ProfileHeroSkeletonCore />
    </div>
  );
}
