import { useState, useEffect, useRef, useMemo } from 'react';
import { Spinner } from '../../components/Spinner';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plane, Trash2, MoreVertical, AlertCircle, Send } from 'lucide-react';
import { supabase, getThreadMessages, replyToMessage, deleteMessage, markMessagesAsRead, Message } from '../../lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import { BottomActionSheet } from '../../components/BottomActionSheet';
import { CustomConfirmDialog } from '../../components/CustomConfirmDialog';
import { ToastNotification } from '../../components/ToastNotification';

export const MessageThreadScreen = () => {
  const { threadId } = useParams<{ threadId: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageText, setMessageText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<{ display_name: string; username: string | null; avatar_url: string | null } | null>(null);
  const [otherUserProfile, setOtherUserProfile] = useState<{ display_name: string; username: string | null; avatar_url: string | null } | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [isUserAtBottom, setIsUserAtBottom] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastMessageCountRef = useRef(0);
  const channelRef = useRef<any>(null);
  const currentUserIdRef = useRef<string | null>(null);
  const currentUserProfileRef = useRef<{ display_name: string; username: string | null; avatar_url: string | null } | null>(null);

  useEffect(() => {
    if (!threadId) return;

    const initializeThread = async () => {
      setIsLoading(true);
      try {
        await loadCurrentUser();
        await loadMessages();
        setupRealtimeSubscription();
        markMessagesAsRead(threadId);
      } catch (err) {
        console.error('Error initializing thread:', err);
      } finally {
        setIsLoading(false);
      }
    };

    initializeThread();

    return () => {
      if (channelRef.current) {
        channelRef.current.unsubscribe();
        channelRef.current = null;
      }
    };
  }, [threadId]);

  useEffect(() => {
    if (isUserAtBottom && messages.length > lastMessageCountRef.current) {
      scrollToBottom('auto');
    }
    lastMessageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [messageText]);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = '40px';
      const newHeight = Math.min(Math.max(textarea.scrollHeight, 40), 120);
      textarea.style.height = `${newHeight}px`;
    }
  };

  const loadCurrentUser = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.id) {
        setCurrentUserId(user.id);
        currentUserIdRef.current = user.id;

        const { data: profileData } = await supabase
          .from('users')
          .select('display_name, username, avatar_url')
          .eq('id', user.id)
          .maybeSingle();

        if (profileData) {
          const profile = {
            display_name: profileData.display_name || 'You',
            username: profileData.username,
            avatar_url: profileData.avatar_url,
          };
          setCurrentUserProfile(profile);
          currentUserProfileRef.current = profile;
        }
      }
    } catch (err) {
      console.error('Error loading current user:', err);
    }
  };

  const loadMessages = async (keepOptimistic = false) => {
    if (!threadId) return;

    setError(null);

    try {
      const [messagesData, threadData] = await Promise.all([
        getThreadMessages(threadId),
        currentUserIdRef.current ? supabase
          .from('message_threads')
          .select('user1_id, user2_id')
          .eq('id', threadId)
          .maybeSingle() : Promise.resolve({ data: null })
      ]);

      if (keepOptimistic) {
        setMessages(prev => {
          const optimisticMessages = prev.filter(msg => msg.id.startsWith('temp-'));
          const realMessages = messagesData.filter(msg => !msg.id.startsWith('temp-'));
          return [...realMessages, ...optimisticMessages];
        });
      } else {
        const realMessages = messagesData.filter(msg => !msg.id.startsWith('temp-'));
        setMessages(realMessages);
      }

      // Determine the other user ID
      if (currentUserIdRef.current && threadData?.data) {
        const otherUserId = threadData.data.user1_id === currentUserIdRef.current
          ? threadData.data.user2_id
          : threadData.data.user1_id;

        if (otherUserId) {
          // Fetch the other user's profile
          const { data: otherUser } = await supabase
            .from('users')
            .select('display_name, username, avatar_url')
            .eq('id', otherUserId)
            .maybeSingle();

          if (otherUser) {
            setOtherUserProfile({
              display_name: otherUser.display_name || 'User',
              username: otherUser.username,
              avatar_url: otherUser.avatar_url,
            });
          }
        }
      } else if (messagesData.length > 0 && currentUserIdRef.current) {
        // Fallback: get user from messages
        const otherUserMessage = messagesData.find(msg => msg.sender_id !== currentUserIdRef.current);
        if (otherUserMessage && otherUserMessage.sender) {
          setOtherUserProfile({
            display_name: otherUserMessage.sender.display_name || 'User',
            username: otherUserMessage.sender.username,
            avatar_url: otherUserMessage.sender.avatar_url,
          });
        }
      }
    } catch (err: any) {
      console.error('Error loading messages:', err);
      setError(err.message || 'Failed to load messages');
    }
  };


  const setupRealtimeSubscription = () => {
    if (!threadId) return;

    if (channelRef.current) {
      channelRef.current.unsubscribe();
    }

    const channel = supabase
      .channel(`messages_${threadId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        async (payload) => {
          const newMessage = payload.new as any;
          console.log('📨 Real-time INSERT event received:', newMessage.id, 'from:', newMessage.sender_id);
          console.log('📨 Current user ID from ref:', currentUserIdRef.current);

          // Fetch sender profile info first
          let senderInfo = {
            id: newMessage.sender_id,
            display_name: 'User',
            username: null,
            avatar_url: null,
          };

          if (newMessage.sender_id === currentUserIdRef.current && currentUserProfileRef.current) {
            senderInfo = {
              id: currentUserIdRef.current,
              display_name: currentUserProfileRef.current.display_name,
              username: currentUserProfileRef.current.username,
              avatar_url: currentUserProfileRef.current.avatar_url,
            };
          } else {
            const { data: senderData } = await supabase
              .from('users')
              .select('display_name, username, avatar_url')
              .eq('id', newMessage.sender_id)
              .maybeSingle();

            if (senderData) {
              senderInfo = {
                id: newMessage.sender_id,
                display_name: senderData.display_name || 'User',
                username: senderData.username,
                avatar_url: senderData.avatar_url,
              };
            }
          }

          setMessages(prev => {
            const existingIndex = prev.findIndex(msg => msg.id === newMessage.id);
            if (existingIndex !== -1) {
              return prev;
            }

            const withoutTemp = newMessage.sender_id === currentUserIdRef.current
              ? prev.filter(msg => !msg.id.startsWith('temp-'))
              : prev;

            const newMessages = [...withoutTemp, {
              id: newMessage.id,
              sender_id: newMessage.sender_id,
              receiver_id: newMessage.receiver_id,
              message_text: newMessage.message_text,
              is_deleted: newMessage.is_deleted,
              is_read: newMessage.is_read,
              created_at: newMessage.created_at,
              sender: senderInfo,
            }];

            // Scroll to bottom after adding message
            setTimeout(() => scrollToBottom('smooth'), 100);

            return newMessages;
          });

          // Mark as read if from other user
          if (newMessage.sender_id !== currentUserIdRef.current) {
            markMessagesAsRead(threadId);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `thread_id=eq.${threadId}`,
        },
        (payload) => {
          const updatedMessage = payload.new as any;
          setMessages(prev => prev.map(msg =>
            msg.id === updatedMessage.id
              ? { ...msg, is_deleted: updatedMessage.is_deleted, message_text: updatedMessage.message_text }
              : msg
          ));
        }
      )
      .subscribe();

    // Store the channel reference for cleanup
    channelRef.current = channel;
  };

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    setIsUserAtBottom(distanceFromBottom < 100);
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!threadId || !messageText.trim() || isSending || !currentUserId) return;

    const messageTextValue = messageText.trim();
    setMessageText('');

    const optimisticMessage: Message = {
      id: `temp-${Date.now()}`,
      sender_id: currentUserId,
      receiver_id: '',
      message_text: messageTextValue,
      is_deleted: false,
      is_read: false,
      created_at: new Date().toISOString(),
      sender: {
        id: currentUserId,
        display_name: currentUserProfile?.display_name || 'You',
        username: currentUserProfile?.username || null,
        avatar_url: currentUserProfile?.avatar_url || null,
      },
    };

    setMessages(prev => [...prev, optimisticMessage]);
    scrollToBottom('smooth');

    setIsSending(true);
    try {
      await replyToMessage(threadId, messageTextValue);

      setTimeout(async () => {
        try {
          const { data: sentMessages } = await supabase
            .from('messages')
            .select('*, sender:users!messages_sender_id_fkey(id, display_name, username, avatar_url)')
            .eq('thread_id', threadId)
            .eq('sender_id', currentUserId)
            .order('created_at', { ascending: false })
            .limit(1);

          if (sentMessages && sentMessages.length > 0) {
            const realMessage = sentMessages[0];

            setMessages(prev => {
              const withoutTemp = prev.filter(msg => !msg.id.startsWith('temp-'));
              const messageExists = withoutTemp.find(msg => msg.id === realMessage.id);

              if (messageExists) {
                return prev.filter(msg => !msg.id.startsWith('temp-'));
              }

              return [...withoutTemp, {
                id: realMessage.id,
                sender_id: realMessage.sender_id,
                receiver_id: realMessage.receiver_id,
                message_text: realMessage.message_text,
                is_deleted: realMessage.is_deleted,
                is_read: realMessage.is_read,
                created_at: realMessage.created_at,
                sender: realMessage.sender ? {
                  id: realMessage.sender.id,
                  display_name: realMessage.sender.display_name || 'You',
                  username: realMessage.sender.username,
                  avatar_url: realMessage.sender.avatar_url,
                } : {
                  id: currentUserId,
                  display_name: currentUserProfile?.display_name || 'You',
                  username: currentUserProfile?.username || null,
                  avatar_url: currentUserProfile?.avatar_url || null,
                },
              }];
            });
          }
        } catch (fetchErr) {
          console.error('Failed to fetch sent message:', fetchErr);
        }

        setIsSending(false);
      }, 300);
    } catch (err: any) {
      console.error('❌ Error sending message:', err);
      // Remove the optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== optimisticMessage.id));
      setMessageText(messageTextValue);
      setToast({
        message: err.message || 'Failed to send message',
        type: 'error',
      });
      setIsSending(false);
    }
  };

  const handleDeleteClick = (message: Message) => {
    setSelectedMessage(message);
    setShowActionSheet(false);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    console.log('🔴 handleConfirmDelete called');
    console.log('🔴 selectedMessage:', selectedMessage);
    console.log('🔴 isDeleting:', isDeleting);

    if (!selectedMessage) {
      console.log('❌ No selected message');
      return;
    }

    if (isDeleting) {
      console.log('❌ Already deleting');
      return;
    }

    const messageId = selectedMessage.id;
    console.log('🔴 Deleting message ID:', messageId);

    setIsDeleting(true);

    try {
      console.log('🔴 Calling deleteMessage...');

      // Optimistically update the UI immediately
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === messageId
            ? { ...msg, is_deleted: true, message_text: 'Message deleted' }
            : msg
        )
      );

      const result = await deleteMessage(messageId);
      console.log('✅ Message deleted successfully, result:', result);
      setShowDeleteConfirm(false);
      setSelectedMessage(null);
      setToast({
        message: 'Message deleted',
        type: 'success',
      });
    } catch (err: any) {
      console.error('❌ Error deleting message:', err);
      console.error('❌ Error details:', {
        message: err.message,
        code: err.code,
        details: err.details,
        hint: err.hint,
      });

      // Rollback the optimistic update
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === messageId
            ? { ...msg, is_deleted: false, message_text: selectedMessage?.message_text || msg.message_text }
            : msg
        )
      );

      setToast({
        message: err.message || 'Failed to delete message',
        type: 'error',
      });
      setShowDeleteConfirm(false);
      setSelectedMessage(null);
    } finally {
      console.log('🔴 Setting isDeleting to false');
      setIsDeleting(false);
    }
  };

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    messagesEndRef.current?.scrollIntoView({ behavior });
  };

  const filteredMessages = useMemo(
    () => messages.filter(msg => !msg.is_deleted || msg.sender_id === currentUserId),
    [messages, currentUserId]
  );

  const shouldShowAvatar = (message: Message, index: number): boolean => {
    if (index === 0) return true;
    const prevMessage = filteredMessages[index - 1];
    return !prevMessage || prevMessage.sender_id !== message.sender_id;
  };

  const shouldShowName = (message: Message, index: number): boolean => {
    return shouldShowAvatar(message, index);
  };

  const shouldShowTimestamp = (message: Message, index: number): boolean => {
    if (index === filteredMessages.length - 1) return true;
    const nextMessage = filteredMessages[index + 1];
    return !nextMessage || nextMessage.sender_id !== message.sender_id;
  };

  const getMessageSpacing = (message: Message, index: number): string => {
    return shouldShowAvatar(message, index) ? 'mt-4' : 'mt-1';
  };

  return (
    <div className="flex flex-col h-screen overflow-x-hidden bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-[#1a1a1a]/95 backdrop-blur-md border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-white/10 rounded-full transition-colors"
          >
            <ArrowLeft className="w-6 h-6 text-white" />
          </button>
          {isLoading ? (
            <div className="flex-1">
              <div className="h-5 w-32 bg-white/10 rounded animate-pulse"></div>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-bold truncate text-white">
                {otherUserProfile?.display_name || 'User'}
              </h1>
              {otherUserProfile?.username && (
                <p className="text-xs text-white/60 truncate">
                  @{otherUserProfile.username}
                </p>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto overflow-x-hidden px-5 py-6 pb-40 space-y-4 scrollbar-hide"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <Spinner size={32} className="text-white" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4">
              <AlertCircle className="w-8 h-8 text-red-400" />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Error</h3>
            <p className="text-sm text-white/60 mb-4">{error}</p>
            <button
              onClick={() => loadMessages()}
              className="px-6 py-3 bg-[#309605] hover:bg-[#3ba208] rounded-full text-sm font-medium transition-colors"
            >
              Try Again
            </button>
          </div>
        ) : filteredMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-4">
              <Send className="w-10 h-10 text-white/60" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">No Messages</h3>
            <p className="text-sm text-white/60">Start the conversation!</p>
          </div>
        ) : (
          <>
            {filteredMessages.map((message, index) => {
              const isOwnMessage = message.sender_id === currentUserId;
              const isDeleted = message.is_deleted;
              const isOptimistic = message.id.startsWith('temp-');
              const showAvatar = shouldShowAvatar(message, index);
              const showName = shouldShowName(message, index);
              const showTimestamp = shouldShowTimestamp(message, index);
              const spacing = getMessageSpacing(message, index);

              return (
                <div
                  key={message.id}
                  className={`flex w-full ${isOwnMessage ? 'justify-end pr-8' : 'justify-start'} ${spacing}`}
                >
                  <div className={`flex gap-2 max-w-[85%] ${isOwnMessage ? 'flex-row-reverse' : 'flex-row'}`}>
                    {!isOwnMessage && (
                      <div className="w-8 h-8 flex-shrink-0">
                        {showAvatar ? (
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-white/10">
                            {message.sender.avatar_url ? (
                              <img
                                src={message.sender.avatar_url}
                                alt={message.sender.display_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-[#309605]/30 to-[#3ba208]/30 flex items-center justify-center">
                                <span className="text-xs font-bold text-white">
                                  {message.sender.display_name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}

                    <div className="flex flex-col gap-1">
                      {!isOwnMessage && showName && (
                        <span className="text-xs text-white/60 px-3">
                          {message.sender.display_name}
                        </span>
                      )}
                      <div className="relative group">
                        <div
                          className={`px-4 py-2.5 ${
                            showAvatar
                              ? 'rounded-2xl'
                              : isOwnMessage
                                ? 'rounded-2xl rounded-tr-md'
                                : 'rounded-2xl rounded-tl-md'
                          } ${
                            isOwnMessage
                              ? 'bg-[#309605] text-white'
                              : 'bg-white/10 text-white'
                          } ${isDeleted ? 'opacity-60 italic' : ''} ${isOptimistic ? 'opacity-70' : ''}`}
                        >
                          <p className="text-[15px] leading-[1.47] whitespace-pre-wrap break-words">
                            {message.message_text}
                            {isOptimistic && (
                              <span className="text-xs opacity-70 ml-2">Sending...</span>
                            )}
                          </p>
                        </div>
                        {isOwnMessage && !isDeleted && !isOptimistic && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMessage(message);
                              setShowActionSheet(true);
                            }}
                            className="absolute -right-1 top-1/2 transform -translate-y-1/2 p-1.5 hover:bg-white/10 active:bg-white/20 rounded-full transition-colors"
                            aria-label="Message options"
                          >
                            <MoreVertical className="w-4 h-4 text-white/40" />
                          </button>
                        )}
                      </div>
                      {showTimestamp && (
                        <span className={`text-[11px] text-white/40 px-3 ${isOwnMessage ? 'text-right' : 'text-left'}`}>
                          {formatDistanceToNow(new Date(message.created_at), { addSuffix: true }).replace('about ', '')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSendMessage}
        className="fixed left-1/2 transform -translate-x-1/2 w-full max-w-[390px] bg-[#1a1a1a]/95 backdrop-blur-md border-t border-white/10 px-5 py-4 z-50"
        style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-end gap-3 max-w-full">
          <div className="flex-1 min-w-0">
            <textarea
              ref={textareaRef}
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
              placeholder="Message..."
              rows={1}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-3xl text-[15px] leading-[1.47] text-white placeholder-white/40 focus:outline-none resize-none scrollbar-hide"
              style={{
                minHeight: '40px',
                maxHeight: '120px',
                overflowY: messageText.split('\n').length > 5 ? 'auto' : 'hidden'
              }}
              disabled={isSending}
            />
          </div>
          <button
            type="submit"
            disabled={!messageText.trim() || isSending}
            className="flex-shrink-0 w-12 h-12 flex items-center justify-center bg-[#309605] hover:bg-[#3ba208] disabled:bg-white/10 disabled:opacity-50 rounded-full transition-all active:scale-95"
            aria-label="Send message"
          >
            {isSending ? (
              <Spinner size={20} className="text-white" />
            ) : (
              <Send className="w-5 h-5 text-white" />
            )}
          </button>
        </div>
      </form>

      <BottomActionSheet
        isOpen={showActionSheet}
        onClose={() => {
          setShowActionSheet(false);
          // Don't clear selectedMessage here - let the dialog handler manage it
        }}
        title="Message Options"
        actions={[
          {
            label: 'Delete Message',
            icon: <Trash2 className="w-5 h-5" />,
            onClick: () => selectedMessage && handleDeleteClick(selectedMessage),
            variant: 'destructive' as const,
          },
        ]}
      />

      <CustomConfirmDialog
        isOpen={showDeleteConfirm}
        title="Delete Message?"
        message="This message will be deleted for you. This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        isLoading={isDeleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => {
          if (!isDeleting) {
            setShowDeleteConfirm(false);
            setSelectedMessage(null);
          }
        }}
      />

      {toast && (
        <ToastNotification
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};
