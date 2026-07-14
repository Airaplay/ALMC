import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, MessageCircle, Send, Trash2, Edit, Heart, ChevronDown, ChevronUp } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar';
import { AuthModal } from './AuthModal';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { useAlert } from '../contexts/AlertContext';
import {
  supabase,
  addContentComment,
  updateContentComment,
  deleteContentComment
} from '../lib/supabase';
import {
  COMMENTS_CACHE_TTL_MS,
  commentsCache,
  getCommentsCacheKey,
  fetchCommentsForContent,
  type Comment
} from '../lib/contentCommentsCache';
import { formatDistanceToNowStrict } from 'date-fns';
import { BannerAdPosition } from '@capacitor-community/admob';
import { recordContribution } from '../lib/contributionService';
import { usePlayerBottomBanner } from '../hooks/usePlayerBottomBanner';
import { DEFAULT_BOTTOM_BANNER_AD_UNIT_ID } from '../lib/adPlacementConstants';
import { admobService } from '../lib/admobService';

/** Re-export so `import { CommentsModal, prefetchContentComments } from './CommentsModal'` stays valid for Rollup and older deploys. */
export { prefetchContentComments } from '../lib/contentCommentsCache';

interface CommentsModalProps {
  contentId: string;
  contentTitle: string;
  onClose: () => void;
  contentType?: string;
}

export const CommentsModal: React.FC<CommentsModalProps> = ({
  contentId,
  contentTitle,
  contentType = 'song',
  onClose
}) => {
  const alert = useAlert();
  const confirm = useConfirm();
  const { user, isAuthenticated, isInitialized } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyingToUser, setReplyingToUser] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const [likingComments, setLikingComments] = useState<Set<string>>(new Set());
  const [expandedReplies, setExpandedReplies] = useState<Set<string>>(new Set());
  const [isMiniPlayerActive, setIsMiniPlayerActive] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const editTextRef = useRef<HTMLTextAreaElement>(null);
  const replyTextRef = useRef<HTMLTextAreaElement>(null);

  // Native bottom banner while open (same pattern as TippingModal / TreatWithdrawalModal).
  // margin 0: body.modal-open hides HTML nav — banner sits at bottom above safe area.
  const COMMENTS_MODAL_AD_UNIT_ID = DEFAULT_BOTTOM_BANNER_AD_UNIT_ID;
  const showCommentsModalBanner = async (
    placementKey?: string,
    position?: BannerAdPosition,
    context?: Record<string, unknown>,
    margin?: number
  ) => {
    await admobService
      .showBanner(
        position,
        (context?.contentId as string | undefined) ?? contentId,
        (context?.contentType as string | undefined) ?? contentType ?? 'song',
        placementKey,
        COMMENTS_MODAL_AD_UNIT_ID,
        margin
      )
      .catch(() => {});
  };
  const hideCommentsModalBanner = (ownerPlacementKey?: string) => {
    admobService.hideBannerOwnedBy(ownerPlacementKey).catch(() => {});
  };
  usePlayerBottomBanner(
    'comments_modal_bottom_banner',
    showCommentsModalBanner,
    hideCommentsModalBanner,
    () => ({ contentId, contentType: contentType || 'song' }),
    [contentId, contentType],
    true,
    0
  );

  // Define loadComments BEFORE any hooks or functions that reference it
  const loadComments = useCallback(async (opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) {
        setIsLoading(true);
      }
      setError(null);
      const rootComments = await fetchCommentsForContent(contentId, contentType || 'song', {
        userId: user?.id,
        isAuthenticated
      });

      setComments(rootComments);
      const cacheKey = getCommentsCacheKey(contentId, contentType || 'song');
      commentsCache.set(cacheKey, { comments: JSON.parse(JSON.stringify(rootComments)), ts: Date.now() });
    } catch (err) {
      console.error('Error loading comments:', err);
      setError('Failed to load comments');
    } finally {
      setIsLoading(false);
    }
  }, [contentId, contentType, isAuthenticated, user]);

  const checkAuthAndLoadComments = async () => {
    if (isInitialized && isAuthenticated) {
      await loadComments();
    }
  };

  useEffect(() => {
    if (!isInitialized) return;

    const cacheKey = getCommentsCacheKey(contentId, contentType || 'song');
    const cached = commentsCache.get(cacheKey);
    const now = Date.now();
    const isCacheValid = cached && now - cached.ts < COMMENTS_CACHE_TTL_MS;

    if (isCacheValid && cached.comments.length >= 0) {
      setComments(cached.comments);
      setIsLoading(false);
      setError(null);
      loadComments({ silent: true });
    } else {
      loadComments();
    }
  }, [contentId, contentType, isInitialized, loadComments]);

  useEffect(() => {
    document.body.classList.add('modal-open');
    document.body.classList.add('modal-ad-banner-active');
    return () => {
      document.body.classList.remove('modal-open');
      document.body.classList.remove('modal-ad-banner-active');
    };
  }, []);

  useEffect(() => {
    const checkMiniPlayer = () => {
      setIsMiniPlayerActive(document.body.classList.contains('mini-player-active'));
    };

    checkMiniPlayer();

    const observer = new MutationObserver(checkMiniPlayer);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, []);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    // Check if we're in reply mode
    if (replyingTo) {
      await handleReplyToComment(replyingTo);
      return;
    }

    if (!newComment.trim()) return;

    const commentText = newComment.trim();
    const tempId = `temp-${Date.now()}`;

    // OPTIMISTIC UPDATE: Add comment immediately to UI
    const optimisticComment: Comment = {
      id: tempId,
      user_id: user?.id || '',
      comment_text: commentText,
      created_at: new Date().toISOString(),
      parent_comment_id: null,
      users: {
        display_name: user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'You',
        avatar_url: user?.user_metadata?.avatar_url || null
      },
      replies: [],
      likes_count: 0,
      is_liked: false
    };

    setComments([optimisticComment, ...comments]);
    setNewComment('');
    setIsSubmitting(true);

    try {
      // Post to server in background
      await addContentComment(contentId, contentType || 'song', commentText);
      // Reload to get actual server data (ID, timestamp, etc.)
      await loadComments();

      // Track engagement contribution for commenting
      recordContribution('content_comment', contentId, contentType || 'song').catch(console.error);
    } catch (err) {
      console.error('Error adding comment:', err);
      setError('Failed to add comment');
      // Remove optimistic comment on error
      setComments(comments.filter(c => c.id !== tempId));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditComment = async (commentId: string) => {
    if (!editText.trim()) return;

    const updatedText = editText.trim();

    // OPTIMISTIC UPDATE: Update comment immediately in UI
    const updateCommentInPlace = (comments: Comment[]): Comment[] => {
      return comments.map(comment => {
        if (comment.id === commentId) {
          return { ...comment, comment_text: updatedText };
        }
        if (comment.replies && comment.replies.length > 0) {
          return {
            ...comment,
            replies: updateCommentInPlace(comment.replies)
          };
        }
        return comment;
      });
    };

    setComments(updateCommentInPlace(comments));
    setEditingComment(null);
    setEditText('');
    setIsUpdating(true);

    try {
      // Update on server in background
      await updateContentComment(commentId, updatedText);
      // Reload to ensure consistency
      await loadComments();
    } catch (err: any) {
      console.error('Error updating comment:', err);
      const errorMsg = err?.message || err?.error_description || 'Unknown error';
      alert.showAlert({
        title: 'Error',
        message: `Failed to update comment: ${errorMsg}`,
        type: 'error'
      });
      // Reload to restore correct state on error
      await loadComments();
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    const confirmed = await confirm.confirm({
      title: 'Delete Comment',
      message: 'Are you sure you want to delete this comment? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      variant: 'danger'
    });

    if (!confirmed) return;

    // OPTIMISTIC UPDATE: Remove comment immediately from UI
    const removeCommentFromList = (comments: Comment[]): Comment[] => {
      return comments
        .filter(comment => comment.id !== commentId)
        .map(comment => {
          if (comment.replies && comment.replies.length > 0) {
            return {
              ...comment,
              replies: removeCommentFromList(comment.replies)
            };
          }
          return comment;
        });
    };

    const previousComments = comments;
    setComments(removeCommentFromList(comments));
    setIsDeleting(commentId);

    try {
      // Delete on server in background
      await deleteContentComment(commentId);
      // Reload to ensure consistency
      await loadComments();
    } catch (err: any) {
      console.error('Error deleting comment:', err);
      const errorMsg = err?.message || err?.error_description || 'Unknown error';
      alert.showAlert({
        title: 'Error',
        message: `Failed to delete comment: ${errorMsg}`,
        type: 'error'
      });
      // Restore previous state on error
      setComments(previousComments);
    } finally {
      setIsDeleting(null);
    }
  };

  const startEditing = (comment: Comment) => {
    setEditingComment(comment.id);
    setEditText(comment.comment_text);
  };

  const cancelEditing = () => {
    setEditingComment(null);
    setEditText('');
  };

  const handleReplyToComment = async (parentCommentId: string) => {
    const replyTextValue = (newComment || replyText).trim();

    if (!replyTextValue) return;

    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    const tempId = `temp-reply-${Date.now()}`;

    // OPTIMISTIC UPDATE: Add reply immediately to UI
    const optimisticReply: Comment = {
      id: tempId,
      user_id: user?.id || '',
      comment_text: replyTextValue,
      created_at: new Date().toISOString(),
      parent_comment_id: parentCommentId,
      users: {
        display_name: user?.user_metadata?.display_name || user?.email?.split('@')[0] || 'You',
        avatar_url: user?.user_metadata?.avatar_url || null
      },
      replies: [],
      likes_count: 0,
      is_liked: false
    };

    // Find parent and add reply optimistically
    const updateCommentsWithReply = (comments: Comment[]): Comment[] => {
      return comments.map(comment => {
        if (comment.id === parentCommentId) {
          return {
            ...comment,
            replies: [...(comment.replies || []), optimisticReply]
          };
        }
        if (comment.replies && comment.replies.length > 0) {
          return {
            ...comment,
            replies: updateCommentsWithReply(comment.replies)
          };
        }
        return comment;
      });
    };

    setComments(updateCommentsWithReply(comments));
    setExpandedReplies(prev => new Set([...prev, parentCommentId]));
    setReplyingTo(null);
    setReplyingToUser(null);
    setReplyText('');
    setNewComment('');
    setIsSubmittingReply(true);

    try {
      // Post to server in background
      await addContentComment(contentId, contentType || 'song', replyTextValue, parentCommentId);
      // Reload to get actual server data
      await loadComments();
      setExpandedReplies(prev => new Set([...prev, parentCommentId]));
    } catch (err) {
      console.error('Error replying to comment:', err);
      setError('Failed to add reply');
      // Reload to restore correct state on error
      await loadComments();
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const startReplying = (commentId: string, userName: string) => {
    setReplyingTo(commentId);
    setReplyingToUser(userName);
    setReplyText('');
    // Auto-focus the textarea
    setTimeout(() => {
      newCommentRef.current?.focus();
    }, 100);
  };

  const cancelReplying = () => {
    setReplyingTo(null);
    setReplyingToUser(null);
    setReplyText('');
    setNewComment('');
  };

  const handleToggleCommentLike = async (commentId: string) => {
    if (!isAuthenticated || !user?.id) {
      setShowAuthModal(true);
      return;
    }

    if (likingComments.has(commentId)) return;

    setLikingComments(prev => new Set([...prev, commentId]));

    try {
      const findCommentById = (comments: Comment[], id: string): Comment | null => {
        for (const comment of comments) {
          if (comment.id === id) return comment;
          if (comment.replies) {
            const found = findCommentById(comment.replies, id);
            if (found) return found;
          }
        }
        return null;
      };

      const comment = findCommentById(comments, commentId);
      if (!comment) {
        setLikingComments(prev => {
          const next = new Set(prev);
          next.delete(commentId);
          return next;
        });
        return;
      }

      // Store previous state for error recovery
      const previousComments = comments;
      
      // OPTIMISTIC UPDATE: Update UI immediately with immutable state update
      const wasLiked = comment.is_liked;
      const updateCommentImmutably = (commentsList: Comment[]): Comment[] => {
        return commentsList.map(c => {
          if (c.id === commentId) {
            return {
              ...c,
              is_liked: !wasLiked,
              likes_count: (c.likes_count || 0) + (wasLiked ? -1 : 1)
            };
          }
          if (c.replies && c.replies.length > 0) {
            return {
              ...c,
              replies: updateCommentImmutably(c.replies)
            };
          }
          return c;
        });
      };

      setComments(updateCommentImmutably(comments));

      // Perform server update using the toggle function
      const { data: newLikeStatus, error: toggleError } = await supabase
        .rpc('toggle_comment_like', { comment_uuid: commentId });

      if (toggleError) {
        console.error('Error toggling like:', toggleError);
        // Revert optimistic update on error
        setComments(previousComments);
        throw toggleError;
      }

      // Verify the optimistic update matches server response
      if (newLikeStatus !== !wasLiked) {
        console.warn('Optimistic update mismatch, reloading comments');
        await loadComments();
      } else {
        const cacheKey = getCommentsCacheKey(contentId, contentType || 'song');
        // Update like count from server to ensure accuracy
        const { data: likesCountData } = await supabase.rpc('get_comment_likes_count', { comment_uuid: commentId });
        if (likesCountData !== null && likesCountData !== undefined) {
          const updateLikeCount = (commentsList: Comment[]): Comment[] => {
            return commentsList.map(c => {
              if (c.id === commentId) {
                return { ...c, likes_count: likesCountData };
              }
              if (c.replies && c.replies.length > 0) {
                return { ...c, replies: updateLikeCount(c.replies) };
              }
              return c;
            });
          };
          const updatedComments = updateLikeCount(comments);
          setComments(updatedComments);
          commentsCache.set(cacheKey, { comments: JSON.parse(JSON.stringify(updatedComments)), ts: Date.now() });
        } else {
          // Keep optimistic state; update cache so reopen shows correct like state
          const optimisticComments = updateCommentImmutably(comments);
          commentsCache.set(cacheKey, { comments: JSON.parse(JSON.stringify(optimisticComments)), ts: Date.now() });
        }
      }
    } catch (error: any) {
      console.error('Error toggling comment like:', error);
      const errorMsg = error?.message || error?.error_description || 'Unknown error';
      alert.showAlert({
        title: 'Error',
        message: `Failed to update like status: ${errorMsg}`,
        type: 'error'
      });
      // Reload on error to restore correct state
      await loadComments();
    } finally {
      setLikingComments(prev => {
        const newSet = new Set(prev);
        newSet.delete(commentId);
        return newSet;
      });
    }
  };

  const toggleReplies = (commentId: string) => {
    setExpandedReplies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(commentId)) {
        newSet.delete(commentId);
      } else {
        newSet.add(commentId);
      }
      return newSet;
    });
  };

  const autoResizeTextarea = (textarea: HTMLTextAreaElement | null) => {
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  useEffect(() => {
    autoResizeTextarea(newCommentRef.current);
  }, [newComment]);

  useEffect(() => {
    autoResizeTextarea(editTextRef.current);
  }, [editText]);

  useEffect(() => {
    autoResizeTextarea(replyTextRef.current);
  }, [replyText]);

  const renderComment = (comment: Comment, isReply: boolean = false) => {
    // Check if current user owns this comment
    // Handle both string and UUID comparisons
    const currentUserId = user?.id;
    const commentUserId = comment.user_id;
    
    // Normalize both IDs to strings for comparison
    const userIdStr = currentUserId ? String(currentUserId).trim() : null;
    const commentUserIdStr = commentUserId ? String(commentUserId).trim() : null;
    
    const isOwner = isAuthenticated && 
                    userIdStr && 
                    commentUserIdStr && 
                    userIdStr === commentUserIdStr &&
                    !editingComment;
    
    // Debug logging for troubleshooting (only in development)
    if (isAuthenticated && currentUserId && import.meta.env.DEV) {
      console.log('[CommentsModal] Comment ownership:', {
        commentId: comment.id,
        currentUserId: userIdStr,
        commentUserId: commentUserIdStr,
        match: userIdStr === commentUserIdStr,
        isOwner,
        isAuthenticated,
        hasUser: !!user,
        editingComment: editingComment === comment.id
      });
    }
    
    const hasReplies = comment.replies && comment.replies.length > 0;
    const isExpanded = expandedReplies.has(comment.id);

    return (
      <div key={comment.id} className={`${isReply ? 'ml-11 pt-3' : ''}`}>
        <div className="flex items-start gap-3">
          <Avatar className={`${isReply ? 'w-8 h-8' : 'w-9 h-9'} flex-shrink-0`}>
            <AvatarImage src={comment.users.avatar_url || undefined} />
            <AvatarFallback className="bg-white/10 text-white/80 text-xs font-medium">
              {comment.users.display_name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            {/* Name and time row */}
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-white text-[13px]">
                {comment.users.display_name}
              </span>
              <span className="text-white/40 text-[11px]">
                {formatDistanceToNowStrict(new Date(comment.created_at), { addSuffix: false })}
              </span>
              
              {isOwner && (
                <div className="flex items-center gap-1.5 ml-auto z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(comment);
                    }}
                    className="p-2 active:bg-white/10 rounded-full transition-colors group hover:bg-white/10 flex items-center justify-center"
                    aria-label="Edit comment"
                    title="Edit comment"
                  >
                    <Edit className="w-4 h-4 text-white/80 group-active:text-white transition-colors" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteComment(comment.id);
                    }}
                    disabled={isDeleting === comment.id}
                    className="p-2 active:bg-white/10 rounded-full transition-colors group hover:bg-white/10 disabled:opacity-50 flex items-center justify-center"
                    aria-label="Delete comment"
                    title="Delete comment"
                  >
                    <Trash2 className="w-4 h-4 text-white/80 group-active:text-red-400 transition-colors" />
                  </button>
                </div>
              )}
            </div>

            {editingComment === comment.id ? (
              <div className="space-y-3 mt-2">
                <textarea
                  ref={editTextRef}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={1}
                  className="w-full px-3.5 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/40 focus:outline-none focus:border-white/30 transition-colors resize-none overflow-hidden"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                  placeholder="Edit your comment..."
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEditComment(comment.id)}
                    disabled={!editText.trim() || isUpdating}
                    className="px-4 py-2 bg-white text-black text-sm font-medium rounded-lg active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {isUpdating ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={cancelEditing}
                    className="px-4 py-2 text-white/70 text-sm font-medium active:bg-white/10 rounded-lg transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Comment text */}
                <p className="text-white/90 text-[13px] leading-[1.5] break-words">
                  {comment.comment_text}
                </p>

                {/* Actions row */}
                <div className="flex items-center gap-5 mt-2">
                  <button
                    onClick={() => handleToggleCommentLike(comment.id)}
                    disabled={likingComments.has(comment.id)}
                    className={`flex items-center gap-1.5 text-[12px] font-medium transition-colors min-h-[32px] ${
                      comment.is_liked
                        ? 'text-red-400'
                        : 'text-white/40 active:text-white/70'
                    } disabled:opacity-50`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${comment.is_liked ? 'fill-red-400' : ''}`} />
                    {(comment.likes_count || 0) > 0 && <span>{comment.likes_count}</span>}
                  </button>

                  {isAuthenticated && (
                    <button
                      onClick={() => startReplying(comment.id, comment.users.display_name)}
                      className="text-[12px] font-medium text-white/40 active:text-white/70 transition-colors min-h-[32px]"
                    >
                      Reply
                    </button>
                  )}

                  {hasReplies && (
                    <button
                      onClick={() => toggleReplies(comment.id)}
                      className="flex items-center gap-1 text-[12px] font-medium text-white/60 active:text-white/80 transition-colors min-h-[32px]"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-3.5 h-3.5" />
                          Hide replies
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-3.5 h-3.5" />
                          {comment.replies?.length} {(comment.replies?.length || 0) === 1 ? 'reply' : 'replies'}
                        </>
                      )}
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Replies */}
            {hasReplies && isExpanded && (
              <div className="mt-3 space-y-0 border-l border-white/10 -ml-1">
                {comment.replies?.map((reply) => renderComment(reply, true))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-end justify-center">
      {/* Backdrop — full viewport (body.modal-open hides bottom nav) */}
      <div
        className="absolute inset-0 bg-black/80"
        onClick={onClose}
      />

      {/* Modal Container — flush to bottom; safe area handled in input section */}
      <div
        className="relative w-full max-w-lg bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] rounded-t-[24px] flex flex-col animate-in slide-in-from-bottom duration-300 md:rounded-[24px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)]"
        style={{
          maxHeight: isMiniPlayerActive ? 'min(88dvh, 100dvh)' : 'min(92dvh, 100dvh)',
        }}
      >
        {/* Header */}
        <div className="flex-shrink-0">
          {/* Drag Handle */}
          <div className="flex justify-center pt-3 pb-2">
            <div className="w-9 h-1 bg-white/20 rounded-full" />
          </div>
          
          {/* Title Bar */}
          <div className="flex items-center justify-between px-5 pb-4">
            <div className="flex-1">
              <h2 className="text-white font-semibold text-base">
                Comments
              </h2>
              <p className="text-white/40 text-xs mt-0.5 truncate pr-4">
                {contentTitle}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 active:bg-white/20 transition-colors"
            >
              <X className="w-4 h-4 text-white/70" />
            </button>
          </div>
          
          {/* Divider */}
          <div className="h-px bg-white/[0.08]" />
        </div>

        {/* Comments List */}
        <div className="flex-1 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <div className="px-5 py-4">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
                <p className="text-white/50 text-sm mt-4">Loading...</p>
              </div>
            ) : error ? (
              <div className="py-12 text-center">
                <p className="text-white/50 text-sm mb-3">{error}</p>
                <button
                  onClick={loadComments}
                  className="text-white/70 text-sm font-medium active:text-white transition-colors"
                >
                  Tap to retry
                </button>
              </div>
            ) : comments.length === 0 ? (
              <div className="py-16 text-center">
                <div className="w-14 h-14 bg-white/[0.06] rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="w-6 h-6 text-white/30" />
                </div>
                <p className="text-white/80 font-medium text-[15px] mb-1">
                  No comments yet
                </p>
                <p className="text-white/40 text-sm">
                  {isAuthenticated
                    ? 'Be the first to comment'
                    : 'Sign in to comment'
                  }
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {comments.map((comment) => renderComment(comment))}
              </div>
            )}
          </div>
        </div>

        {/* Input Section */}
        <div
          className="flex-shrink-0 bg-[#0a0a0a] border-t border-white/[0.06]"
          style={{
            // Clear native adaptive banner (see --aira-banner-height) + safe area
            paddingBottom:
              'calc(max(env(safe-area-inset-bottom), 12px) + var(--aira-banner-height, 50px))',
          }}
        >
          {isAuthenticated ? (
            <div className="px-4 pt-3 pb-1">
              {/* Reply indicator */}
              {replyingTo && replyingToUser && (
                <div className="flex items-center justify-between mb-2.5 px-1">
                  <span className="text-white/50 text-xs">
                    Replying to <span className="text-white/70">@{replyingToUser}</span>
                  </span>
                  <button
                    onClick={cancelReplying}
                    className="text-white/50 text-xs active:text-white/70"
                  >
                    Cancel
                  </button>
                </div>
              )}

              <form onSubmit={handleAddComment} className="flex items-end gap-2.5">
                <Avatar className="w-9 h-9 flex-shrink-0 mb-1 self-end">
                  <AvatarImage src={user?.user_metadata?.avatar_url} />
                  <AvatarFallback className="bg-white/10 text-white/70 text-xs">
                    {user?.email?.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                
                <div className="flex-1 flex items-end gap-2 bg-white/[0.06] rounded-2xl px-4 py-2.5 min-h-[52px]">
                  <textarea
                    ref={newCommentRef}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    placeholder={replyingTo ? 'Write a reply...' : 'Add a comment...'}
                    rows={2}
                    className="flex-1 bg-transparent text-white text-[15px] placeholder-white/35 focus:outline-none resize-none py-1 max-h-[160px] leading-[1.45] min-h-[44px]"
                  />
                  <button
                    type="submit"
                    disabled={!newComment.trim() || isSubmitting || isSubmittingReply}
                    className="flex-shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-white disabled:bg-white/15 disabled:cursor-not-allowed active:scale-95 transition-all self-end mb-0.5"
                  >
                    {isSubmitting || isSubmittingReply ? (
                      <div className="w-3.5 h-3.5 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5 text-black" />
                    )}
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="px-4 py-3">
              <button
                onClick={() => setShowAuthModal(true)}
                className="w-full py-3 bg-white text-black font-medium text-sm rounded-full active:scale-[0.98] transition-transform"
              >
                Sign in to comment
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={async () => {
            setShowAuthModal(false);
            await checkAuthAndLoadComments();
          }}
        />
      )}
    </div>
  );
};
