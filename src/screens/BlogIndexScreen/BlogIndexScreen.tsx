import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { persistentCache } from '../../lib/persistentCache';
import { Spinner } from '../../components/Spinner';
import { formatDistanceToNow } from 'date-fns';

const BLOG_INDEX_CACHE_KEY = 'blog_index_posts';
const BLOG_INDEX_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  cover_image_url: string | null;
  published_at: string | null;
}

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://www.airaplay.com';

export const BlogIndexScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    document.title = 'Blog | Airaplay';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) metaDesc.setAttribute('content', 'Discover the latest from Airaplay – artist spotlights, music news, and tips.');
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const cached = await persistentCache.get<BlogPost[]>(BLOG_INDEX_CACHE_KEY);
        if (mounted && Array.isArray(cached) && cached.length > 0) {
          setPosts(cached);
          setIsLoading(false);
          // Background revalidate
          const { data, error } = await supabase.rpc('get_blog_posts', { limit_count: 50, offset_count: 0 });
          if (!error && mounted && Array.isArray(data)) {
            setPosts(data);
            await persistentCache.set(BLOG_INDEX_CACHE_KEY, data, BLOG_INDEX_CACHE_TTL);
          }
          return;
        }
        const { data, error } = await supabase.rpc('get_blog_posts', { limit_count: 50, offset_count: 0 });
        if (error) throw error;
        if (mounted && Array.isArray(data)) {
          setPosts(data);
          await persistentCache.set(BLOG_INDEX_CACHE_KEY, data, BLOG_INDEX_CACHE_TTL);
        }
      } catch (err) {
        console.error('Error loading blog:', err);
        if (mounted) setPosts([]);
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  return (
    <div className="flex flex-col min-h-0 flex-1 w-full bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto" style={{ minHeight: '100dvh' }}>
      <header
        className="w-full py-5 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm flex-shrink-0"
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
      >
        <div className="flex items-center justify-between">
          <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} aria-label="Go back" className="p-2 hover:bg-white/10 rounded-full transition-all">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="font-bold text-lg">Blog</h1>
          <div className="w-10" />
        </div>
      </header>

      <div className="px-5 py-6 flex-1 min-h-[200px]">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Spinner size={32} className="text-white" />
            <p className="mt-4 text-white/60">Loading posts...</p>
          </div>
        ) : posts.length === 0 ? (
          <p className="text-white/60 text-sm">No posts yet. Check back soon.</p>
        ) : (
          <ul className="space-y-6">
            {posts.map((post) => (
              <li key={post.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/blog/${post.slug}`)}
                  className="w-full text-left group flex gap-4 p-4 rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 transition-all"
                >
                  {post.cover_image_url ? (
                    <img src={post.cover_image_url} alt="" className="w-24 h-24 rounded-xl object-cover flex-shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-24 h-24 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                      <FileText className="w-8 h-8 text-white/30" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h2 className="font-bold text-white group-hover:text-[#3ba208] transition-colors line-clamp-2">{post.title}</h2>
                    {post.excerpt && <p className="text-white/60 text-sm mt-1 line-clamp-2">{post.excerpt}</p>}
                    {post.published_at && (
                      <p className="text-white/40 text-xs mt-2">{formatDistanceToNow(new Date(post.published_at), { addSuffix: true })}</p>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
