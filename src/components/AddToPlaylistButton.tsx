import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ListPlus, ListMusic, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

interface AddToPlaylistButtonProps {
  songId: string | undefined | null;
  iconSize?: string;
  buttonClass?: string;
}

const AddToPlaylistButton = ({ songId, iconSize = "w-[18px] h-[18px]", buttonClass = "p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all" }: AddToPlaylistButtonProps) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<{ id: string; title: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchPlaylists = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("playlists").select("id, title").eq("user_id", user.id).order("created_at", { ascending: false });
    if (data) setPlaylists(data);
    setLoading(false);
  }, [user?.id]);

  const addSong = async (playlistId: string) => {
    if (!songId) return;
    const { data: existing } = await supabase.from("playlist_songs").select("id").eq("playlist_id", playlistId).eq("song_id", songId).maybeSingle();
    if (existing) { toast.info("Song already in playlist"); setOpen(false); return; }
    const { data: maxOrder } = await supabase.from("playlist_songs").select("position").eq("playlist_id", playlistId).order("position", { ascending: false }).limit(1).maybeSingle();
    const nextOrder = (maxOrder?.position ?? -1) + 1;
    const { error } = await supabase.from("playlist_songs").insert({ playlist_id: playlistId, song_id: songId, position: nextOrder });
    if (error) toast.error("Failed to add song"); else toast.success("Added to playlist");
    setOpen(false);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!user) { toast.error("Sign in to add to playlist"); return; }
    if (!songId) { toast.error("No song selected"); return; }
    setOpen(v => !v);
    if (!open) fetchPlaylists();
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={handleClick} className={buttonClass} title="Add to playlist">
        <ListPlus className={iconSize} />
      </button>
      {open && songId && (
        <>
          <div className="fixed inset-0 z-[110]" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 z-[120] w-56 rounded-2xl bg-card border border-border shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-border/50">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.12em]">Add to playlist</p>
            </div>
            <button
              onClick={() => { setOpen(false); navigate("/create-playlist"); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left border-b border-border/30"
            >
              <ListPlus className="w-4 h-4 text-foreground" />
              <span className="font-medium">Create New Playlist</span>
            </button>
            <ScrollArea className="max-h-48">
              {loading ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              ) : playlists.length === 0 ? (
                <p className="text-xs text-muted-foreground px-4 py-3">No playlists yet</p>
              ) : (
                playlists.map(pl => (
                  <button
                    key={pl.id}
                    onClick={() => addSong(pl.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors text-left"
                  >
                    <ListMusic className="w-4 h-4 text-muted-foreground" />
                    <span className="font-medium truncate">{pl.title}</span>
                  </button>
                ))
              )}
            </ScrollArea>
          </div>
        </>
      )}
    </div>
  );
};

export default AddToPlaylistButton;
