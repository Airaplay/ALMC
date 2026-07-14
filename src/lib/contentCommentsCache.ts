import { supabase, getContentComments } from './supabase';

export const COMMENTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface Comment {
  id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
  parent_comment_id: string | null;
  users: {
    display_name: string;
    avatar_url: string | null;
  };
  replies?: Comment[];
  likes_count?: number;
  is_liked?: boolean;
}

export const commentsCache = new Map<string, { comments: Comment[]; ts: number }>();

export function getCommentsCacheKey(contentId: string, contentType: string): string {
  return `${contentType}-${contentId}`;
}

const commentsPrefetchPromises = new Map<string, Promise<void>>();

export async function fetchCommentsForContent(
  contentId: string,
  contentType: string,
  opts?: { userId?: string; isAuthenticated?: boolean }
): Promise<Comment[]> {
  const fetchedComments = await getContentComments(contentId, contentType || 'song');
  const commentsMap = new Map<string, Comment>();
  const rootComments: Comment[] = [];

  fetchedComments.forEach((comment: Comment) => {
    commentsMap.set(comment.id, { ...comment, replies: [] });
  });

  const commentIds = fetchedComments.map((c: Comment) => c.id);
  if (commentIds.length > 0) {
    try {
      const likesPromises = commentIds.map(id =>
        supabase.rpc('get_comment_likes_count', { comment_uuid: id })
      );
      const likedPromises = opts?.isAuthenticated && opts?.userId
        ? commentIds.map(id => supabase.rpc('is_comment_liked_by_user', {
            comment_uuid: id,
            user_uuid: opts.userId
          }))
        : [];

      const [likesResults, likedResults] = await Promise.all([
        Promise.all(likesPromises),
        Promise.all(likedPromises)
      ]);

      commentIds.forEach((id, index) => {
        const commentWithLikes = commentsMap.get(id);
        if (commentWithLikes) {
          commentWithLikes.likes_count = likesResults[index]?.data || 0;
          commentWithLikes.is_liked = likedResults[index]?.data || false;
        }
      });
    } catch (err) {
      console.error('Error loading comment likes:', err);
      commentIds.forEach(id => {
        const comment = commentsMap.get(id);
        if (comment) {
          comment.likes_count = 0;
          comment.is_liked = false;
        }
      });
    }
  }

  fetchedComments.forEach((comment: Comment) => {
    if (comment.parent_comment_id) {
      const parent = commentsMap.get(comment.parent_comment_id);
      const currentComment = commentsMap.get(comment.id);
      if (parent && currentComment) {
        parent.replies = parent.replies || [];
        parent.replies.push(currentComment);
      }
    } else {
      const currentComment = commentsMap.get(comment.id);
      if (currentComment) {
        rootComments.push(currentComment);
      }
    }
  });

  return rootComments;
}

export async function prefetchContentComments(contentId: string, contentType: string = 'song'): Promise<void> {
  const cacheKey = getCommentsCacheKey(contentId, contentType || 'song');
  const cached = commentsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < COMMENTS_CACHE_TTL_MS) {
    return;
  }

  const inFlight = commentsPrefetchPromises.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const prefetchPromise = (async () => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData?.user?.id;
      const prefetchedComments = await fetchCommentsForContent(contentId, contentType || 'song', {
        userId: userId || undefined,
        isAuthenticated: !!userId
      });
      commentsCache.set(cacheKey, {
        comments: JSON.parse(JSON.stringify(prefetchedComments)),
        ts: Date.now()
      });
    } catch (err) {
      console.error('Error prefetching comments:', err);
    } finally {
      commentsPrefetchPromises.delete(cacheKey);
    }
  })();

  commentsPrefetchPromises.set(cacheKey, prefetchPromise);
  return prefetchPromise;
}
