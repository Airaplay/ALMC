import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { persistentCache } from '../../lib/persistentCache';
import { Spinner } from '../../components/Spinner';

const BLOG_POST_CACHE_TTL = 15 * 60 * 1000; // 15 minutes
import { createSafeHtml } from '../../lib/sanitizeHtml';
import { extractTocFromHtml, injectHeadingIds, rewriteInternalLinks, type TocItem } from '../../lib/blogUtils';
import { formatDistanceToNow } from 'date-fns';
import { useAdPlacement } from '../../hooks/useAdPlacement';

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : 'https://www.airaplay.com';

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  content: string;
  cover_image_url: string | null;
  faq: Array<{ question: string; answer: string }> | null;
  category: string | null;
  tags: string[] | null;
  published_at: string | null;
  updated_at: string | null;
}

export const BlogPostScreen = (): JSX.Element => {
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [related, setRelated] = useState<BlogPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { showRewarded } = useAdPlacement('BlogPostScreen');

  const contentWithIds = useMemo(
    () => (post?.content ? injectHeadingIds(rewriteInternalLinks(post.content)) : ''),
    [post?.content]
  );
  const toc = useMemo(() => extractTocFromHtml(contentWithIds), [contentWithIds]);

  // Show fullscreen ad when opening a blog post, before reading
  useEffect(() => {
    if (!slug) return;
    showRewarded('blog_open_rewarded', {
      contentId: slug,
      contentType: 'blog',
    }).catch(() => {
      // Fail-safe: blog reading should never break because of ads
    });
  }, [slug, showRewarded]);

  useEffect(() => {
    if (!slug) {
      setError('Invalid post');
      setIsLoading(false);
      return;
    }
    let mounted = true;
    const cacheKey = `blog_post_${slug}`;
    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const cached = await persistentCache.get<{ post: BlogPost; related: BlogPost[] }>(cacheKey);
        if (mounted && cached?.post) {
          setPost(cached.post);
          setRelated(cached.related ?? []);
          setIsLoading(false);
          // Background revalidate
          const { data: postData, error: postError } = await supabase.rpc('get_blog_post_by_slug', { post_slug: slug });
          if (!postError && mounted) {
            const row = Array.isArray(postData) ? postData[0] : postData;
            if (row) {
              const { data: relatedData } = await supabase.rpc('get_related_blog_posts', {
                current_post_id: row.id,
                limit_count: 4
              });
              const relatedList = Array.isArray(relatedData) ? (relatedData as BlogPost[]) : [];
              setPost(row as BlogPost);
              setRelated(relatedList);
              await persistentCache.set(cacheKey, { post: row as BlogPost, related: relatedList }, BLOG_POST_CACHE_TTL);
            }
          }
          return;
        }
        const { data: postData, error: postError } = await supabase.rpc('get_blog_post_by_slug', { post_slug: slug });
        if (postError) throw postError;
        const row = Array.isArray(postData) ? postData[0] : postData;
        if (!mounted) return;
        if (!row) {
          setError('Post not found');
          setPost(null);
          setIsLoading(false);
          return;
        }
        setPost(row as BlogPost);

        const { data: relatedData } = await supabase.rpc('get_related_blog_posts', {
          current_post_id: row.id,
          limit_count: 4
        });
        const relatedList = mounted && Array.isArray(relatedData) ? (relatedData as BlogPost[]) : [];
        setRelated(relatedList);
        await persistentCache.set(cacheKey, { post: row as BlogPost, related: relatedList }, BLOG_POST_CACHE_TTL);
      } catch (err) {
        console.error('Error loading post:', err);
        if (mounted) {
          setError('Failed to load post');
          setPost(null);
        }
      } finally {
        if (mounted) setIsLoading(false);
      }
    };
    load();
    return () => { mounted = false; };
  }, [slug]);

  // SEO: document title, meta, canonical, JSON-LD
  useEffect(() => {
    if (!post) return;
    document.title = `${post.title} | Airaplay Blog`;
    const desc = post.excerpt || post.title;
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', desc);

    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', `${BASE_URL}/blog/${post.slug}`);

    const articleSchema = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.excerpt || post.title,
      image: post.cover_image_url ? [post.cover_image_url] : undefined,
      datePublished: post.published_at || undefined,
      dateModified: post.updated_at || post.published_at || undefined,
      author: { '@type': 'Organization', name: 'Airaplay' },
      publisher: { '@type': 'Organization', name: 'Airaplay', url: BASE_URL },
      mainEntityOfPage: { '@type': 'WebPage', '@id': `${BASE_URL}/blog/${post.slug}` }
    };
    const faqSchema =
      post.faq && post.faq.length > 0
        ? {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: post.faq.map((item) => ({
              '@type': 'Question',
              name: item.question,
              acceptedAnswer: { '@type': 'Answer', text: item.answer }
            }))
          }
        : null;

    const scriptId = 'blog-jsonld';
    const existing = document.getElementById(scriptId);
    if (existing) existing.remove();
    const script = document.createElement('script');
    script.id = scriptId;
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(articleSchema);
    document.head.appendChild(script);

    if (faqSchema) {
      const faqScriptId = 'blog-faq-jsonld';
      const existingFaq = document.getElementById(faqScriptId);
      if (existingFaq) existingFaq.remove();
      const faqScript = document.createElement('script');
      faqScript.id = faqScriptId;
      faqScript.type = 'application/ld+json';
      faqScript.textContent = JSON.stringify(faqSchema);
      document.head.appendChild(faqScript);
    }

    return () => {
      const s = document.getElementById(scriptId);
      if (s) s.remove();
      const f = document.getElementById('blog-faq-jsonld');
      if (f) f.remove();
    };
  }, [post]);

  if (!slug || error) {
    return (
      <div className="flex flex-col min-h-screen bg-[#0d0d0d] text-white items-center justify-center p-6">
        <p className="text-white/60 mb-4">{error || 'Invalid post'}</p>
        <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="px-4 py-2 rounded-xl bg-[#309605] text-white">
          Go back
        </button>
      </div>
    );
  }

  if (isLoading || !post) {
    return (
      <div className="flex flex-col min-h-screen bg-[#0d0d0d] text-white items-center justify-center p-6">
        <Spinner size={32} className="text-white" />
        <p className="mt-4 text-white/60">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-0 flex-1 w-full bg-gradient-to-b from-[#1a1a1a] via-[#0d0d0d] to-[#000000] text-white content-with-nav overflow-y-auto" style={{ minHeight: '100dvh' }}>
      <header
        className="w-full py-5 px-5 sticky top-0 z-20 bg-gradient-to-b from-[#1a1a1a] to-transparent backdrop-blur-sm flex-shrink-0"
        style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px) * 0.25)', paddingBottom: '1.25rem' }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30 rounded-lg"
              aria-label="Airaplay home"
            >
              <img src="/official_airaplay_logo.png" alt="Airaplay" className="h-8 object-contain" />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} aria-label="Go back" className="p-2 hover:bg-white/10 rounded-full transition-all">
              <ArrowLeft className="w-6 h-6" />
            </button>
            <span className="font-bold text-lg truncate max-w-[60%]">{post.title}</span>
            <div className="w-10" />
          </div>
        </div>
      </header>

      <div className="px-5 py-6 flex-1 max-w-[780px] mx-auto w-full">
        {post.cover_image_url && (
          <img
            src={post.cover_image_url}
            alt=""
            className="w-full aspect-video object-cover rounded-2xl mb-6"
            loading="eager"
            fetchPriority="high"
          />
        )}
        {post.published_at && (
          <p className="text-white/50 text-sm mb-4">{formatDistanceToNow(new Date(post.published_at), { addSuffix: true })}</p>
        )}

        <div className="flex flex-col md:flex-row gap-8">
          {toc.length > 0 && (
            <nav aria-label="Table of contents" className="flex-shrink-0 md:w-48 order-2 md:order-1">
              <h3 className="text-xs font-semibold text-white/60 uppercase tracking-wider mb-3">On this page</h3>
              <ul className="space-y-2">
                {toc.map((item) => (
                  <li key={item.id} style={{ paddingLeft: item.level === 3 ? '1rem' : 0 }}>
                    <a
                      href={`#${item.id}`}
                      className="text-sm text-white/70 hover:text-white transition-colors scroll-mt-24"
                    >
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <article className="flex-1 min-w-0 order-1 md:order-2">
            <div
              className="prose prose-invert prose-sm max-w-none font-['Inter',sans-serif] text-white/90 [&_a]:text-[#3ba208] [&_a]:underline [&_a:hover]:opacity-90 [&_h2]:mt-8 [&_h2]:mb-4 [&_h2]:scroll-mt-24 [&_h3]:mt-6 [&_h3]:mb-3 [&_h3]:scroll-mt-24 [&_p]:leading-relaxed [&_ul]:list-disc [&_ol]:list-decimal [&_li]:my-1"
              dangerouslySetInnerHTML={createSafeHtml(contentWithIds)}
            />
          </article>
        </div>

        {post.faq && post.faq.length > 0 && (
          <section className="mt-12 pt-8 border-t border-white/10">
            <h2 className="text-xl font-bold text-white mb-4">FAQ</h2>
            <dl className="space-y-4">
              {post.faq.map((item, i) => (
                <div key={i} className="bg-white/5 rounded-xl p-4">
                  <dt className="font-semibold text-white mb-1">{item.question}</dt>
                  <dd className="text-white/70 text-sm">{item.answer}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {related.length > 0 && (
          <section className="mt-12 pt-8 border-t border-white/10">
            <h2 className="text-xl font-bold text-white mb-4">Related posts</h2>
            <ul className="grid gap-4 sm:grid-cols-2">
              {related.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/blog/${r.slug}`)}
                    className="w-full text-left flex gap-3 p-4 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all"
                  >
                    {r.cover_image_url ? (
                      <img src={r.cover_image_url} alt="" className="w-20 h-20 rounded-lg object-cover flex-shrink-0" loading="lazy" />
                    ) : (
                      <div className="w-20 h-20 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-6 h-6 text-white/30" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white line-clamp-2">{r.title}</h3>
                      {r.excerpt && <p className="text-white/60 text-xs line-clamp-2 mt-0.5">{r.excerpt}</p>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
};
