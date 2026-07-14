import { useState, useEffect, useRef } from 'react';
import { Plus, Pencil, Trash2, Loader2, Upload, ImageIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LoadingLogo } from '../../components/LoadingLogo';
import {
  validateImageFile,
  getValidatedExtension,
  sanitizeFileName,
  ALLOWED_IMAGE_EXTENSIONS,
} from '../../lib/fileSecurity';

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
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string | null;
}

interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  cover_image_url: string;
  category: string;
  tags: string;
  is_published: boolean;
  published_at: string;
}

const INITIAL_FORM: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  cover_image_url: '',
  category: '',
  tags: '',
  is_published: false,
  published_at: '',
};

type FaqItem = { question: string; answer: string };

const INITIAL_FAQ: FaqItem[] = [{ question: '', answer: '' }];

// --- Helpers: simple Markdown → HTML (no HTML knowledge needed)
function simpleMarkdownToHtml(text: string): string {
  if (!text.trim()) return '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = esc(text);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  out = out.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  out = out.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  const blocks = out.split(/\n\n+/).filter((p) => p.trim());
  return blocks
    .map((p) => {
      const t = p.trim();
      if (/^<h[23]>/.test(t)) return t;
      return `<p>${t.replace(/\n/g, '<br />')}</p>`;
    })
    .join('\n');
}

function looksLikeHtml(s: string): boolean {
  const t = s.trim();
  return t.startsWith('<') && (t.includes('</') || t.includes('/>'));
}

function slugFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Component
export const BlogManagementSection = (): JSX.Element => {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BlogPost | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [faq, setFaq] = useState<FaqItem[]>(INITIAL_FAQ);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadPosts = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from('blog_posts')
        .select('*')
        .order('created_at', { ascending: false });
      if (e) throw e;
      setPosts((data as BlogPost[]) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load posts');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPosts();
  }, []);

  useEffect(() => {
    if (editing) {
      setForm({
        title: editing.title,
        slug: editing.slug,
        excerpt: editing.excerpt ?? '',
        content: editing.content ?? '',
        cover_image_url: editing.cover_image_url ?? '',
        category: editing.category ?? '',
        tags: Array.isArray(editing.tags) ? editing.tags.join(', ') : '',
        is_published: !!editing.is_published,
        published_at: editing.published_at ? editing.published_at.slice(0, 16) : '',
      });
      setFaq(
        editing.faq?.length
          ? editing.faq.map((q) => ({ question: q.question ?? '', answer: q.answer ?? '' }))
          : INITIAL_FAQ
      );
      setFormOpen(true);
    } else if (!formOpen) {
      setForm(INITIAL_FORM);
      setFaq(INITIAL_FAQ);
    }
  }, [editing, formOpen]);

  const setFormField = (name: keyof FormState, value: string | boolean) => {
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'title' && !editing && typeof value === 'string') {
        next.slug = slugFromTitle(value);
      }
      return next;
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setFormField(name as keyof FormState, type === 'checkbox' ? checked : value);
  };

  const setFaqEntry = (index: number, field: 'question' | 'answer', value: string) => {
    setFaq((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addFaq = () => setFaq((prev) => [...prev, { question: '', answer: '' }]);
  const removeFaq = (index: number) =>
    setFaq((prev) => (prev.length <= 1 ? INITIAL_FAQ : prev.filter((_, i) => i !== index)));

  const getFaqPayload = (): FaqItem[] =>
    faq
      .filter((x) => x.question.trim() && x.answer.trim())
      .map((x) => ({ question: x.question.trim(), answer: x.answer.trim() }));

  const uploadImage = async (file: File): Promise<string> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You must be signed in to upload images.');
    const validation = validateImageFile(file);
    if (!validation.valid) throw new Error(validation.error ?? 'Invalid image');
    const ext = getValidatedExtension(file.name, ALLOWED_IMAGE_EXTENSIONS);
    if (!ext) throw new Error('Allowed: jpg, jpeg, png, webp, gif');
    const base = sanitizeFileName(file.name).replace(/\.[^.]+$/, '') || 'image';
    const path = `${user.id}/blog/blog-${Date.now()}-${base}.${ext}`;
    const { error: e } = await supabase.storage.from('thumbnails').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    });
    if (e) throw new Error((e as { message?: string }).message ?? 'Upload failed');
    const { data } = supabase.storage.from('thumbnails').getPublicUrl(path);
    return data.publicUrl;
  };

  const onImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setError(null);
    setUploadingImage(true);
    try {
      const url = await uploadImage(file);
      setForm((prev) => ({ ...prev, cover_image_url: url }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadingImage(false);
    }
  };

  const publishPost = async (id: string) => {
    setError(null);
    setPublishingId(id);
    try {
      const { error: e } = await supabase
        .from('blog_posts')
        .update({
          is_published: true,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (e) throw e;
      setSuccess('Post published. It will appear on the home screen and /blog.');
      await loadPosts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish');
    } finally {
      setPublishingId(null);
    }
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!form.title.trim() || !form.slug.trim()) {
      setError('Title and slug are required.');
      return;
    }
    if (!form.cover_image_url.trim()) {
      setError('Feature image is required.');
      return;
    }
    setSubmitting(true);
    try {
      const rawContent = form.content.trim();
      const content = looksLikeHtml(rawContent) ? rawContent : simpleMarkdownToHtml(rawContent);
      const payload = {
        title: form.title.trim(),
        slug: form.slug.trim().toLowerCase(),
        excerpt: form.excerpt.trim() || null,
        content: content || '',
        cover_image_url: form.cover_image_url.trim() || null,
        category: form.category.trim() || null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        is_published: form.is_published,
        published_at: form.is_published
          ? (form.published_at ? new Date(form.published_at).toISOString() : new Date().toISOString())
          : null,
        faq: getFaqPayload(),
        updated_at: new Date().toISOString(),
      };

      if (editing) {
        const { error: e } = await supabase.from('blog_posts').update(payload).eq('id', editing.id);
        if (e) throw e;
        setSuccess('Post updated.');
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const insert = {
          ...payload,
          created_at: new Date().toISOString(),
          ...(user?.id && { author_id: user.id }),
        };
        const { error: e } = await supabase.from('blog_posts').insert(insert);
        if (e) throw e;
        setSuccess('Post created.');
      }
      setEditing(null);
      setForm(INITIAL_FORM);
      setFaq(INITIAL_FAQ);
      setFormOpen(false);
      await loadPosts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save post');
    } finally {
      setSubmitting(false);
    }
  };

  const deletePost = async (id: string) => {
    if (!confirm('Delete this post? This cannot be undone.')) return;
    try {
      const { error: e } = await supabase.from('blog_posts').delete().eq('id', id);
      if (e) throw e;
      setSuccess('Post deleted.');
      if (editing?.id === id) {
        setEditing(null);
        setFormOpen(false);
      }
      await loadPosts();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(INITIAL_FORM);
    setFaq(INITIAL_FAQ);
    setFormOpen(true);
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">Blog</h2>
        <button
          type="button"
          onClick={() => {
            if (formOpen) {
              setFormOpen(false);
              setEditing(null);
            } else {
              openAdd();
            }
          }}
          className="flex items-center gap-2 px-4 py-2 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208]"
        >
          <Plus className="w-4 h-4" />
          {formOpen ? 'Cancel' : 'Add post'}
        </button>
      </div>

      {(error || success) && (
        <div
          className={`mb-4 p-3 rounded-lg ${error ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}
        >
          {error || success}
        </div>
      )}

      {formOpen && (
        <form onSubmit={submitForm} className="mb-8 p-4 border border-gray-200 rounded-lg space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <input
                type="text"
                name="title"
                value={form.title}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="Post title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Slug * (URL: /blog/slug)</label>
              <input
                type="text"
                name="slug"
                value={form.slug}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="post-slug"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Excerpt</label>
            <textarea
              name="excerpt"
              value={form.excerpt}
              onChange={handleInputChange}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Short summary for SEO and cards"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Content</label>
            <p className="text-xs text-gray-500 mb-1">
              Plain text. Use **bold**, *italic*, ## Heading 2, ### Heading 3, [text](url). New lines = paragraphs.
            </p>
            <textarea
              name="content"
              value={form.content}
              onChange={handleInputChange}
              rows={10}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
              placeholder="Write your post here..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Feature image *</label>
            <p className="text-xs text-gray-500 mb-2">Upload (JPG, PNG, WebP, GIF, max 5MB) or paste URL.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={onImageSelect}
              className="hidden"
            />
            {form.cover_image_url ? (
              <div className="space-y-2">
                <img
                  src={form.cover_image_url}
                  alt="Feature"
                  className="h-40 w-auto object-cover rounded-lg border border-gray-200 max-w-xs"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingImage}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
                  >
                    {uploadingImage ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {uploadingImage ? 'Uploading…' : 'Replace'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, cover_image_url: '' }))}
                    className="text-sm text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingImage}
                className="w-full flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-300 rounded-lg hover:border-[#309605] hover:bg-gray-50/50 disabled:opacity-50"
              >
                {uploadingImage ? (
                  <Loader2 className="w-10 h-10 text-[#309605] animate-spin" />
                ) : (
                  <ImageIcon className="w-10 h-10 text-gray-400" />
                )}
                <span className="text-sm font-medium text-gray-600">
                  {uploadingImage ? 'Uploading…' : 'Click to upload feature image'}
                </span>
              </button>
            )}
            <input
              type="url"
              name="cover_image_url"
              value={form.cover_image_url}
              onChange={handleInputChange}
              className="mt-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              placeholder="Or paste image URL"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Category</label>
              <input
                type="text"
                name="category"
                value={form.category}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="e.g. News"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                name="tags"
                value={form.tags}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="music, artist, tips"
              />
            </div>
          </div>

          <div className="p-4 rounded-lg border-2 border-amber-200 bg-amber-50/80 space-y-3">
            <p className="text-sm font-medium text-amber-800">
              Posts show on home and /blog only when <strong>Published</strong>. Check below and save.
            </p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="is_published"
                checked={form.is_published}
                onChange={(e) => setFormField('is_published', e.target.checked)}
                className="rounded border-gray-300 w-5 h-5"
              />
              <span className="font-semibold text-gray-800">Published</span>
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Published at (optional)</label>
              <input
                type="datetime-local"
                name="published_at"
                value={form.published_at}
                onChange={handleInputChange}
                className="px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">FAQ (optional)</label>
            <p className="text-xs text-gray-500 mb-2">Q&A pairs for the post and search.</p>
            {faq.map((item, i) => (
              <div key={i} className="mb-3 p-3 border border-gray-200 rounded-lg bg-gray-50/50">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-medium text-gray-500">#{i + 1}</span>
                  <button type="button" onClick={() => removeFaq(i)} className="text-xs text-red-600 hover:underline">
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={item.question}
                  onChange={(e) => setFaqEntry(i, 'question', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2 text-sm"
                  placeholder="Question"
                />
                <textarea
                  value={item.answer}
                  onChange={(e) => setFaqEntry(i, 'answer', e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="Answer"
                />
              </div>
            ))}
            <button type="button" onClick={addFaq} className="text-sm text-[#309605] hover:underline flex items-center gap-1">
              <Plus className="w-4 h-4" /> Add Q&A
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2 bg-[#309605] text-white rounded-lg hover:bg-[#3ba208] disabled:opacity-50"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {editing ? 'Update post' : 'Create post'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex items-center gap-3 text-gray-600">
          <LoadingLogo variant="pulse" size={32} />
          <span>Loading posts...</span>
        </div>
      ) : posts.length === 0 ? (
        <p className="text-gray-500">No blog posts yet. Add one above.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border border-gray-200 rounded-lg">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Title</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Slug</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Status</th>
                <th className="text-left p-3 text-sm font-semibold text-gray-700">Updated</th>
                <th className="p-3 text-sm font-semibold text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <tr key={post.id} className="border-t border-gray-200 hover:bg-gray-50">
                  <td className="p-3 text-gray-900">{post.title}</td>
                  <td className="p-3 text-gray-600 font-mono text-sm">/blog/{post.slug}</td>
                  <td className="p-3">
                    <span className={post.is_published ? 'text-green-600' : 'text-gray-500'}>
                      {post.is_published ? 'Published' : 'Draft'}
                    </span>
                  </td>
                  <td className="p-3 text-gray-500 text-sm">
                    {post.updated_at ? new Date(post.updated_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      {!post.is_published && (
                        <button
                          type="button"
                          onClick={() => publishPost(post.id)}
                          disabled={publishingId === post.id}
                          className="px-2 py-1.5 text-sm font-medium text-white bg-[#309605] hover:bg-[#3ba208] rounded-lg disabled:opacity-60"
                        >
                          {publishingId === post.id ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="w-4 h-4 animate-spin" /> Publishing…
                            </span>
                          ) : (
                            'Publish'
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setEditing(post)}
                        className="p-2 text-gray-600 hover:bg-gray-200 rounded-lg"
                        aria-label="Edit"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => deletePost(post.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        aria-label="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
