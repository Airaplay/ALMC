import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import TopNav from "@/components/layout/TopNav";
import LeftSidebar from "@/components/layout/LeftSidebar";
import BottomPlayer from "@/components/layout/BottomPlayer";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Bell, Check, CheckCheck, Trash2,
  Music, Users, Megaphone, Heart, MessageSquare, ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Sender {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
  sender_id: string | null;
  reference_id: string | null;
  reference_type: string | null;
  sender?: Sender | null;
}

const typeIcons: Record<string, typeof Bell> = {
  collaboration_accepted: Users,
  collaboration_declined: Users,
  collaboration_request: Users,
  collaboration_withdrawn: Users,
  promotion: Megaphone,
  like: Heart,
  comment: MessageSquare,
  new_release: Music,
};

const typeColors: Record<string, string> = {
  collaboration_accepted: "bg-emerald-500/15 text-emerald-400",
  collaboration_declined: "bg-rose-500/15 text-rose-400",
  collaboration_request: "bg-blue-500/15 text-blue-400",
  collaboration_withdrawn: "bg-orange-500/15 text-orange-400",
  promotion: "bg-purple-500/15 text-purple-400",
  like: "bg-rose-500/15 text-rose-400",
  comment: "bg-sky-500/15 text-sky-400",
  new_release: "bg-yellow-500/15 text-yellow-400",
};

const NotificationScreen = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [selected, setSelected] = useState<Notification | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*, sender:users!sender_id(id, display_name, username, avatar_url)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (!error && data) {
        setNotifications(data as unknown as Notification[]);
      } else {
        const { data: plain } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (plain) {
          const senderIds = [...new Set(plain.map((n: any) => n.sender_id).filter(Boolean))];
          let senderMap: Record<string, Sender> = {};
          if (senderIds.length) {
            const { data: senders } = await supabase
              .from("users")
              .select("id, display_name, username, avatar_url")
              .in("id", senderIds);
            if (senders) {
              senderMap = Object.fromEntries(senders.map((s: any) => [s.id, s]));
            }
          }
          setNotifications(
            plain.map((n: any) => ({ ...n, sender: n.sender_id ? senderMap[n.sender_id] ?? null : null }))
          );
        }
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("notifications_realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => setNotifications((prev) => [payload.new as Notification, ...prev]))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => setNotifications((prev) => prev.map((n) => n.id === (payload.new as Notification).id ? { ...n, ...(payload.new as Notification) } : n)))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => setNotifications((prev) => prev.filter((n) => n.id !== (payload.old as any).id)))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const markAsRead = async (id: string) => {
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    setSelected((prev) => prev?.id === id ? { ...prev, is_read: true } : prev);
  };

  const markAllAsRead = async () => {
    if (!user?.id) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    toast.success("All marked as read");
  };

  const deleteNotification = async () => {
    if (!deleteTarget) return;
    await supabase.from("notifications").delete().eq("id", deleteTarget);
    setNotifications((prev) => prev.filter((n) => n.id !== deleteTarget));
    if (selected?.id === deleteTarget) setSelected(null);
    setDeleteTarget(null);
    toast.success("Notification deleted");
  };

  const handleCollabAction = async (notif: Notification, action: "accepted" | "declined") => {
    if (!notif.reference_id) return;
    const { error } = await supabase
      .from("collaboration_requests")
      .update({ status: action, updated_at: new Date().toISOString() })
      .eq("id", notif.reference_id);
    if (error) { toast.error("Failed to update request"); return; }
    if (notif.sender_id) {
      await supabase.from("notifications").insert({
        user_id: notif.sender_id,
        type: `collaboration_${action}`,
        title: action === "accepted" ? "Collaboration Accepted!" : "Collaboration Declined",
        message: `Your collaboration request has been ${action}.`,
        sender_id: user?.id,
        reference_id: notif.reference_id,
        reference_type: "collaboration_request",
      });
    }
    await markAsRead(notif.id);
    toast.success(action === "accepted" ? "Collaboration accepted" : "Collaboration declined");
  };

  const handleSelect = (notif: Notification) => {
    setSelected(notif);
    if (!notif.is_read) markAsRead(notif.id);
  };

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "Just now";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  };

  const filtered = tab === "unread" ? notifications.filter((n) => !n.is_read) : notifications;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4">
          <Bell className="w-12 h-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">Sign in to view notifications</p>
          <Button onClick={() => navigate("/auth")}>Sign In</Button>
        </div>
      </div>
    );
  }

  // ─── Mobile: list hidden when detail open; on md+ both panels can show ───
  const showDetail = !!selected;

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background min-h-[100dvh]">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <LeftSidebar />

        <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
          {/* ════ LIST PANEL — visible when no selection (mobile) or always (desktop) ════ */}
          <div
            className={cn(
              "flex flex-col border-r border-border/50 overflow-hidden flex-1 min-w-0",
              showDetail ? "hidden md:flex md:max-w-[380px] md:flex-shrink-0" : "flex"
            )}
          >
            {/* List Header — same design style, mobile-safe padding */}
            <div
              className="flex-shrink-0 px-4 sm:px-5 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-border/50"
              style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
            >
              <div className="flex items-end justify-between mb-3 sm:mb-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/40 mb-1">Inbox</p>
                  <h1 className="text-lg sm:text-xl font-black tracking-tight text-foreground flex items-center gap-2">
                    Notifications
                    {unreadCount > 0 && (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                        {unreadCount}
                      </span>
                    )}
                  </h1>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] justify-end items-center"
                  >
                    <CheckCheck className="w-3.5 h-3.5" /> All read
                  </button>
                )}
              </div>

              {/* Tab switcher — same rounded-xl style */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-muted/50 border border-border/30">
                {(["all", "unread"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={cn(
                      "flex-1 py-2.5 sm:py-1.5 rounded-lg text-[12px] font-bold transition-all min-h-[44px] sm:min-h-0",
                      tab === t
                        ? "bg-foreground text-background shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t === "unread" && unreadCount > 0 ? `Unread (${unreadCount})` : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* List — scrollable, touch-friendly row height */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              {loading ? (
                <div className="p-3 sm:p-4 space-y-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-16 sm:h-14 rounded-xl bg-muted/30 animate-pulse" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center min-h-[280px] py-12 text-center px-6">
                  <div className="w-14 h-14 rounded-2xl bg-muted/40 flex items-center justify-center mb-3">
                    <Bell className="w-6 h-6 text-muted-foreground/30" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {tab === "unread" ? "You're all caught up" : "No notifications"}
                  </p>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    {tab === "unread" ? "No unread notifications" : "Activity will appear here"}
                  </p>
                </div>
              ) : (
                <div className="py-2">
                  {filtered.map((notif) => {
                    const Icon = typeIcons[notif.type] || Bell;
                    const iconColor = typeColors[notif.type] || "bg-muted text-muted-foreground";
                    const senderName = notif.sender?.display_name || notif.sender?.username || "System";
                    const isSelected = selected?.id === notif.id;

                    return (
                      <button
                        key={notif.id}
                        onClick={() => handleSelect(notif)}
                        className={cn(
                          "group w-full text-left flex items-start gap-3 px-4 py-3.5 min-h-[72px] sm:min-h-0 transition-all relative touch-manipulation",
                          isSelected
                            ? "bg-secondary/60"
                            : !notif.is_read
                            ? "bg-primary/[0.04] hover:bg-primary/[0.08] active:bg-primary/[0.1]"
                            : "hover:bg-secondary/30 active:bg-secondary/40"
                        )}
                      >
                        {!notif.is_read && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-8 rounded-full bg-primary" />
                        )}
                        <div className="relative flex-shrink-0 mt-0.5">
                          {notif.sender?.avatar_url ? (
                            <img src={notif.sender.avatar_url} alt={senderName} className="w-9 h-9 rounded-full object-cover" />
                          ) : (
                            <div className={cn("w-9 h-9 rounded-full flex items-center justify-center", iconColor)}>
                              <Icon className="w-4 h-4" />
                            </div>
                          )}
                          {notif.sender?.avatar_url && (
                            <div className={cn("absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center border-2 border-background", iconColor)}>
                              <Icon className="w-2 h-2" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-0.5">
                            <p className={cn(
                              "text-[13px] truncate",
                              notif.is_read ? "font-medium text-foreground" : "font-bold text-foreground"
                            )}>
                              {senderName}
                            </p>
                            <span className="text-[10px] text-muted-foreground/50 font-mono flex-shrink-0">
                              {timeAgo(notif.created_at)}
                            </span>
                          </div>
                          <p className={cn(
                            "text-[12px] truncate",
                            notif.is_read ? "text-muted-foreground" : "text-foreground/80 font-medium"
                          )}>
                            {notif.title}
                          </p>
                          {notif.message && (
                            <p className="text-[11px] text-muted-foreground/60 truncate mt-0.5">
                              {notif.message}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ════ DETAIL PANEL — on mobile: full screen when selected; on md+: right panel ════ */}
          <div
            className={cn(
              "flex flex-col flex-1 overflow-hidden bg-background",
              !showDetail && "hidden md:flex"
            )}
          >
            {selected ? (
              <>
                <div
                  className="flex-shrink-0 px-4 sm:px-6 md:px-8 pt-4 sm:pt-6 pb-4 sm:pb-5 border-b border-border/50 flex items-start justify-between gap-3"
                  style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
                >
                  <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                    <button
                      onClick={() => setSelected(null)}
                      className="flex-shrink-0 mt-0.5 p-2.5 rounded-lg hover:bg-secondary active:bg-secondary/80 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center md:hidden"
                      aria-label="Back to list"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    {(() => {
                      const Icon = typeIcons[selected.type] || Bell;
                      const iconColor = typeColors[selected.type] || "bg-muted text-muted-foreground";
                      const senderName = selected.sender?.display_name || selected.sender?.username || "System";
                      return (
                        <div className="flex items-start gap-3 sm:gap-4 min-w-0 flex-1">
                          <div className="relative flex-shrink-0">
                            {selected.sender?.avatar_url ? (
                              <img src={selected.sender.avatar_url} alt={senderName} className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl object-cover" />
                            ) : (
                              <div className={cn("w-11 h-11 sm:w-12 sm:h-12 rounded-2xl flex items-center justify-center", iconColor)}>
                                <Icon className="w-5 h-5" />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground/50 mb-0.5">
                              {selected.type.replace(/_/g, " ")}
                            </p>
                            <h2 className="text-base sm:text-lg font-black tracking-tight text-foreground leading-snug">
                              {selected.title}
                            </h2>
                            <p className="text-[12px] text-muted-foreground mt-0.5">
                              From <span className="font-semibold text-foreground">{senderName}</span>
                              {" · "}
                              {formatDistanceToNow(new Date(selected.created_at), { addSuffix: true })}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!selected.is_read && (
                      <button
                        onClick={() => markAsRead(selected.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border/50 text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:border-border transition-colors min-h-[44px]"
                      >
                        <Check className="w-3.5 h-3.5" /> Mark read
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(selected.id)}
                      className="p-2.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
                      aria-label="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 sm:py-8">
                  {selected.message ? (
                    <div className="max-w-2xl">
                      <p className="text-[15px] text-foreground leading-relaxed">
                        {selected.message}
                      </p>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm italic">No additional details.</p>
                  )}

                  {selected.type === "collaboration_request" && selected.reference_id && !selected.is_read && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mt-8 pt-8 border-t border-border/40">
                      <button
                        onClick={() => handleCollabAction(selected, "accepted")}
                        className="flex-1 px-6 py-3.5 rounded-xl bg-foreground text-background text-[13px] font-bold hover:opacity-90 active:opacity-80 transition-opacity min-h-[48px]"
                      >
                        Accept Collaboration
                      </button>
                      <button
                        onClick={() => handleCollabAction(selected, "declined")}
                        className="flex-1 px-6 py-3.5 rounded-xl border border-border text-[13px] font-bold text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors min-h-[48px]"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center px-6 py-12">
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-muted/30 flex items-center justify-center mb-4 sm:mb-5">
                  <Bell className="w-8 h-8 sm:w-9 sm:h-9 text-muted-foreground/20" />
                </div>
                <p className="text-sm sm:text-base font-bold text-foreground mb-1">No message selected</p>
                <p className="text-[12px] sm:text-[13px] text-muted-foreground">
                  Pick a notification from the list to read it here
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <BottomPlayer />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete notification?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteNotification}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default NotificationScreen;
