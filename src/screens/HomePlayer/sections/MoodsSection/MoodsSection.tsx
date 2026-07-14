import { useNavigate } from "react-router-dom";

const MOODS = [
  "Chill",
  "Focus",
  "Workout",
  "Party",
  "Romance",
  "Sleep",
];

export const MoodsSection = (): JSX.Element => {
  const navigate = useNavigate();

  return (
    <section className="w-full px-6 py-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
          Moods
        </h2>
        <button
          type="button"
          onClick={() => navigate("/mood-discovery")}
          className="text-white/80 hover:text-white text-sm font-medium transition-colors"
        >
          View All
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {MOODS.map((mood) => (
          <button
            key={mood}
            type="button"
            onClick={() => navigate("/mood-discovery")}
            className="rounded-xl border border-white/15 bg-white/[0.04] px-3 py-3 text-sm text-white/90 font-medium"
          >
            {mood}
          </button>
        ))}
      </div>
    </section>
  );
};
