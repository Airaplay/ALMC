import { memo } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MoodCategory } from "@/lib/moodAnalysisService";

interface MoodCategoryCardProps {
  mood: MoodCategory;
  variant: "app" | "web" | "grid";
  onClick: () => void;
  className?: string;
}

function MoodCategoryCardInner({
  mood,
  variant,
  onClick,
  className,
}: MoodCategoryCardProps) {
  const accent = mood.color || "#ffffff";

  const baseButton =
    "group relative overflow-hidden text-left transition-all duration-300 touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 active:scale-[0.97]";

  if (variant === "grid") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Browse ${mood.name}`}
        className={cn(
          baseButton,
          "rounded-2xl p-5 border border-white/[0.07] hover:border-white/15 hover:shadow-lg hover:shadow-black/30",
          className
        )}
        style={{
          background: `linear-gradient(150deg, ${accent}24 0%, ${accent}0a 45%, rgba(255,255,255,0.025) 100%)`,
        }}
      >
        <div
          className="absolute -top-10 -right-10 w-32 h-32 rounded-full blur-3xl opacity-30 group-hover:opacity-55 transition-opacity duration-500 pointer-events-none"
          style={{ backgroundColor: accent }}
        />

        <div
          className="relative w-14 h-14 rounded-2xl flex items-center justify-center text-[1.75rem] mb-4"
          style={{
            background: `linear-gradient(145deg, ${accent}35, ${accent}12)`,
            boxShadow: `0 10px 28px ${accent}22`,
          }}
        >
          <span aria-hidden>{mood.icon}</span>
        </div>

        <div className="relative pr-5">
          <h3 className="font-bold text-white text-[15px] tracking-tight leading-tight line-clamp-1">
            {mood.name}
          </h3>
          {mood.description && (
            <p className="text-white/45 text-xs mt-1.5 line-clamp-2 leading-relaxed">
              {mood.description}
            </p>
          )}
        </div>

        <ChevronRight
          aria-hidden
          className="absolute right-3.5 bottom-4 w-4 h-4 text-white/15 group-hover:text-white/55 group-hover:translate-x-0.5 transition-all duration-300"
        />

        <div
          className="absolute bottom-0 inset-x-0 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: `linear-gradient(90deg, transparent, ${accent}cc, transparent)`,
          }}
        />
      </button>
    );
  }

  if (variant === "web") {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`Browse ${mood.name}`}
        className={cn(
          baseButton,
          "rounded-2xl p-4 sm:p-5 border border-border/25 hover:border-border/50 hover:scale-[1.02] hover:shadow-md",
          className
        )}
        style={{
          background: `linear-gradient(145deg, ${accent}18 0%, ${accent}06 50%, transparent 100%)`,
        }}
      >
        <div
          className="absolute -top-6 -right-6 w-20 h-20 rounded-full blur-2xl opacity-25 group-hover:opacity-45 transition-opacity pointer-events-none"
          style={{ backgroundColor: accent }}
        />

        <div
          className="absolute top-3 right-3 w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center text-lg sm:text-xl opacity-70 group-hover:opacity-100 transition-all duration-300"
          style={{
            background: `linear-gradient(135deg, ${accent}28, ${accent}10)`,
          }}
        >
          <span aria-hidden>{mood.icon}</span>
        </div>

        <div className="relative mt-5 sm:mt-6 pr-9">
          <h3 className="text-sm sm:text-base font-bold text-foreground tracking-tight line-clamp-1">
            {mood.name}
          </h3>
          {mood.description && (
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-1 line-clamp-2 leading-snug">
              {mood.description}
            </p>
          )}
        </div>

        <div
          className="absolute bottom-0 inset-x-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{ backgroundColor: accent }}
        />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Browse ${mood.name}`}
      className={cn(
        baseButton,
        "rounded-2xl p-3 border border-white/[0.08] hover:border-white/18 hover:shadow-md hover:shadow-black/25",
        className
      )}
      style={{
        background: `linear-gradient(155deg, ${accent}20 0%, ${accent}08 50%, rgba(255,255,255,0.03) 100%)`,
      }}
    >
      <div
        className="absolute -top-4 left-1/2 -translate-x-1/2 w-16 h-16 rounded-full blur-2xl opacity-25 group-hover:opacity-45 transition-opacity pointer-events-none"
        style={{ backgroundColor: accent }}
      />

      <div className="relative text-center">
        <div
          className="inline-flex w-10 h-10 items-center justify-center rounded-xl text-xl mb-2"
          style={{
            background: `linear-gradient(145deg, ${accent}30, ${accent}10)`,
          }}
        >
          <span aria-hidden>{mood.icon}</span>
        </div>
        <h3 className="font-bold text-white text-xs tracking-tight line-clamp-1">
          {mood.name}
        </h3>
        {mood.description && (
          <p className="text-white/45 text-[10px] mt-0.5 line-clamp-2 leading-snug">
            {mood.description}
          </p>
        )}
      </div>
    </button>
  );
}

export const MoodCategoryCard = memo(MoodCategoryCardInner);
MoodCategoryCard.displayName = "MoodCategoryCard";
