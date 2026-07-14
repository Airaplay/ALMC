import type { CSSProperties } from 'react';

/**
 * Header padding matching full-screen headers (ProfileScreen, NotificationsModal, PlaylistDetailScreen).
 * Use on modal header rows; horizontal padding matches px-5 (omit pt or pb utilities on the header).
 */
export const MODAL_HEADER_SAFE_AREA_STYLE: CSSProperties = {
  paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)',
  paddingBottom: '1.25rem',
  paddingLeft: 'calc(1.25rem + env(safe-area-inset-left, 0px))',
  paddingRight: 'calc(1.25rem + env(safe-area-inset-right, 0px))',
};
