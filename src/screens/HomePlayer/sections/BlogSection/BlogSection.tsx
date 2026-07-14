import { useNavigate } from "react-router-dom";
import { BookOpen } from "lucide-react";

export const BlogSection = (): JSX.Element => {
  const navigate = useNavigate();

  return (
    <section className="w-full px-6 py-6">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="font-['Inter',sans-serif] font-bold text-white text-xl tracking-tight">
              From The Blog
            </h2>
            <p className="font-['Inter',sans-serif] text-white/65 text-sm mt-1">
              Artist stories, music tips, and platform updates.
            </p>
          </div>
          <BookOpen className="w-5 h-5 text-white/70" />
        </div>

        <button
          type="button"
          onClick={() => navigate("/blog")}
          className="mt-4 inline-flex items-center justify-center px-4 py-2 rounded-lg bg-[#00ad74] hover:bg-[#009b67] text-white text-sm font-semibold transition-colors"
        >
          Read Blog
        </button>
      </div>
    </section>
  );
};
