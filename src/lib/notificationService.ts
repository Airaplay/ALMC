import { supabase } from './supabase';

export type NotificationType =
  | 'upload_success'
  | 'upload_error'
  | 'upload_processing'
  | 'comment'
  | 'like'
  | 'follow'
  | 'tip'
  | 'withdrawal'
  | 'promotion'
  | 'system';

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  message: string;
  metadata?: Record<string, any>;
}

/** True if the error is a foreign key violation (e.g. user_id not in users table). */
function isForeignKeyViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const o = error as { message?: string; code?: string | number };
  const msg = o.message != null ? String(o.message) : '';
  const code = o.code != null ? String(o.code) : '';
  return code === '23503' || /foreign key constraint|violates foreign key|notifications_user_id_fkey/i.test(msg);
}

export const createNotification = async ({
  userId,
  type,
  message,
  metadata = {}
}: CreateNotificationParams): Promise<void> => {
  try {
    const { error } = await supabase
      .from('notifications')
      .insert({
        user_id: userId,
        type,
        message,
        metadata,
        is_read: false
      });

    if (error) {
      if (isForeignKeyViolation(error)) {
        console.warn('Notification skipped: user_id not found in users table.', userId);
        return;
      }
      console.error('Failed to create notification:', error);
    }
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      console.warn('Notification skipped: user_id not found in users table.', userId);
      return;
    }
    console.error('Error creating notification:', err);
  }
};

export const createUploadSuccessNotification = async (
  userId: string,
  uploadTitle: string,
  uploadType: 'single' | 'album' | 'video'
): Promise<void> => {
  const typeLabel = uploadType === 'single' ? 'song' : uploadType === 'album' ? 'album' : 'video';
  const message = `Your ${typeLabel} "${uploadTitle}" has been uploaded successfully and is now live!`;

  await createNotification({
    userId,
    type: 'upload_success',
    message,
    metadata: {
      upload_type: uploadType,
      upload_title: uploadTitle,
      timestamp: new Date().toISOString()
    }
  });
};

export const createUploadErrorNotification = async (
  userId: string,
  uploadTitle: string,
  uploadType: 'single' | 'album' | 'video',
  errorMessage: string
): Promise<void> => {
  const typeLabel = uploadType === 'single' ? 'song' : uploadType === 'album' ? 'album' : 'video';
  const message = `Failed to upload ${typeLabel} "${uploadTitle}": ${errorMessage}`;

  await createNotification({
    userId,
    type: 'upload_error',
    message,
    metadata: {
      upload_type: uploadType,
      upload_title: uploadTitle,
      error: errorMessage,
      timestamp: new Date().toISOString()
    }
  });
};

export const markNotificationAsRead = async (notificationId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', notificationId);

    if (error) {
      console.error('Failed to mark notification as read:', error);
    }
  } catch (err) {
    console.error('Error marking notification as read:', err);
  }
};

export const markAllNotificationsAsRead = async (userId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Failed to mark all notifications as read:', error);
    }
  } catch (err) {
    console.error('Error marking all notifications as read:', err);
  }
};

export const deleteNotification = async (notificationId: string): Promise<void> => {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', notificationId);

    if (error) {
      console.error('Failed to delete notification:', error);
    }
  } catch (err) {
    console.error('Error deleting notification:', err);
  }
};

/**
 * Insert a notification row (e.g. title, message, type). Swallows FK violations
 * so callers don't fail when user_id is missing from the referenced table.
 */
export const insertNotificationSafe = async (row: {
  user_id: string;
  title?: string;
  message: string;
  type: string;
  metadata?: Record<string, unknown>;
  is_read?: boolean;
}): Promise<void> => {
  try {
    const { error } = await supabase.from('notifications').insert({
      user_id: row.user_id,
      title: row.title ?? null,
      message: row.message,
      type: row.type,
      metadata: row.metadata ?? {},
      is_read: row.is_read ?? false
    });
    if (error) {
      if (isForeignKeyViolation(error)) {
        console.warn('Notification skipped: user_id not in users table.', row.user_id);
        return;
      }
      console.error('Failed to insert notification:', error);
    }
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      console.warn('Notification skipped: user_id not in users table.', row.user_id);
      return;
    }
    throw err;
  }
};

export const getUnreadNotificationCount = async (userId: string): Promise<number> => {
  try {
    const { count, error } = await supabase
      .from('notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_read', false);

    if (error) {
      console.error('Failed to get unread notification count:', error);
      return 0;
    }

    return count || 0;
  } catch (err) {
    console.error('Error getting unread notification count:', err);
    return 0;
  }
};
