import { useState } from "react";
import { Share2, MessageCircle, Send, Facebook, Linkedin, Copy, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { shareToPlatform } from "@/lib/shareUtils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ShareMenuProps {
  url: string;
  title: string;
  /** Prefilled message for social platforms and native share (defaults to title). */
  shareText?: string;
  /** Cover URL for OG link previews when sharing via platform buttons. */
  coverImageUrl?: string | null;
  /** Optional extra className for the trigger button */
  triggerClassName?: string;
  /** Icon size class, defaults to "w-4 h-4" */
  iconSize?: string;
  /** Show label next to icon */
  showLabel?: boolean;
  /** Align popover */
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}

const platforms = [
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "twitter", label: "X / Twitter", icon: Share2 },
  { id: "facebook", label: "Facebook", icon: Facebook },
  { id: "telegram", label: "Telegram", icon: Send },
  { id: "linkedin", label: "LinkedIn", icon: Linkedin },
] as const;

const ShareMenu = ({
  url,
  title,
  shareText,
  coverImageUrl,
  triggerClassName,
  iconSize = "w-4 h-4",
  showLabel = false,
  align = "end",
  side = "bottom",
}: ShareMenuProps) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const messageText = shareText ?? title;

  const handleShareVia = async (platform: string) => {
    await shareToPlatform(platform, url, messageText, { title, coverImageUrl });
    setOpen(false);
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(url);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-all",
            triggerClassName
          )}
          title="Share"
          aria-label="Share"
        >
          <Share2 className={iconSize} />
          {showLabel && <span className="ml-1.5 text-sm font-medium">Share</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-52 p-1.5 bg-card/95 backdrop-blur-xl border-border/50 rounded-xl shadow-xl"
        align={align}
        side={side}
        sideOffset={8}
      >
        <p className="px-3 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Share via
        </p>
        {platforms.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => void handleShareVia(id)}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors rounded-lg text-left"
          >
            <Icon className="w-4 h-4 text-muted-foreground" />
            {label}
          </button>
        ))}
        <div className="border-t border-border/50 mt-1 pt-1">
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-secondary/60 transition-colors rounded-lg text-left"
          >
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-muted-foreground" />}
            {copied ? "Copied!" : "Copy Link"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default ShareMenu;
