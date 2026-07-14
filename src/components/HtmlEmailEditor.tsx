import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { mergeAttributes } from '@tiptap/core';
import type { ResizableNodeViewDirection } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import TextAlign from '@tiptap/extension-text-align';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Image as ImageIcon,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Eye,
  Code2,
  List,
  ListOrdered,
  RotateCcw,
  MousePointerClick,
  Smartphone,
} from 'lucide-react';
import {
  buildAppStoreBadgeTipTapContent,
  buildEmailCtaButtonHtml,
  buildPlayStoreBadgeTipTapContent,
  buildStoreBadgesRowTipTapContent,
  DEFAULT_APP_STORE_URL,
  DEFAULT_PLAY_STORE_URL,
} from '../lib/emailComposerSnippets';

const emailImageResizeDirections: ResizableNodeViewDirection[] = [
  'bottom-right',
  'bottom-left',
  'top-right',
  'top-left',
  'right',
  'bottom',
];

/** Responsive output for email + Tiptap v3 resizable node view in the editor. */
const EmailBodyImage = Image.extend({
  renderHTML({ node, HTMLAttributes }) {
    const w = node.attrs.width as number | null | undefined;
    const h = node.attrs.height as number | null | undefined;
    const rest = { ...HTMLAttributes } as Record<string, unknown>;
    delete rest.width;
    delete rest.height;
    let style = 'max-width:100%;height:auto;display:block;';
    if (w != null && w > 0) {
      style += `width:${w}px;`;
    }
    if (h != null && h > 0) {
      style += `height:${h}px;`;
    }
    const extra: Record<string, string | number> = { style };
    if (w != null && w > 0) {
      extra.width = w;
    }
    if (h != null && h > 0) {
      extra.height = h;
    }
    return ['img', mergeAttributes(this.options.HTMLAttributes, rest, extra)];
  },
}).configure({
  inline: false,
  allowBase64: false,
  resize: {
    enabled: true,
    minWidth: 48,
    minHeight: 48,
    alwaysPreserveAspectRatio: true,
    directions: emailImageResizeDirections,
  },
});

/** Inline store badges with link marks — survives TipTap serialization as clickable anchors. */
const StoreBadgeImage = Image.extend({
  name: 'storeBadgeImage',
  inline: true,
  group: 'inline',
  marks: 'link',
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      ...this.parent?.(),
      store: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-store'),
        renderHTML: (attrs) => (attrs.store ? { 'data-store': attrs.store } : {}),
      },
    };
  },
  renderHTML({ node, HTMLAttributes }) {
    const w = node.attrs.width as number | null | undefined;
    const rest = { ...HTMLAttributes } as Record<string, unknown>;
    delete rest.width;
    delete rest.height;
    let style = 'display:block;border:0;max-width:100%;height:auto;';
    if (w != null && w > 0) {
      style += `width:${w}px;`;
    }
    const extra: Record<string, string | number> = { style, border: 0 };
    if (w != null && w > 0) {
      extra.width = w;
    }
    return ['img', mergeAttributes(this.options.HTMLAttributes, rest, extra)];
  },
}).configure({
  inline: true,
  allowBase64: false,
  resize: { enabled: false },
});

type Props = {
  value: string;
  onChange: (nextHtml: string) => void;
  onUploadImage: (file: File) => Promise<string>;
  disabled?: boolean;
  /** Gmail-style single frame: gray toolbar, flat icon buttons, larger compose area */
  layout?: 'default' | 'compose';
  /** Show CTA button + Play/App Store badge quick inserts (marketing composer). */
  quickInserts?: boolean;
};

function looksLikeHtml(s: string): boolean {
  const t = s.trim();
  return t.startsWith('<') && (t.includes('</') || t.includes('/>'));
}

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <p></p>
  </body>
</html>`;

export const HtmlEmailEditor = ({
  value,
  onChange,
  onUploadImage,
  disabled,
  layout = 'default',
  quickInserts = false,
}: Props): JSX.Element => {
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [htmlDraft, setHtmlDraft] = useState(value);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const initialContent = useMemo(() => {
    const v = (value || '').trim();
    if (!v) return DEFAULT_HTML;
    return looksLikeHtml(v) ? v : `<p>${v}</p>`;
  }, []); // intentionally only once on mount

  const editor = useEditor({
    editable: !disabled,
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: quickInserts,
        enableClickSelection: quickInserts,
        HTMLAttributes: {
          rel: 'noopener noreferrer',
          target: '_blank',
        },
      }),
      EmailBodyImage,
      StoreBadgeImage,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content: initialContent,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(html);
      setHtmlDraft(html);
    },
  });

  // Keep editor in sync when parent changes (e.g. switch templates).
  useEffect(() => {
    if (!editor) return;
    const incoming = (value || '').trim();
    const incomingHtml = incoming ? (looksLikeHtml(incoming) ? incoming : `<p>${incoming}</p>`) : DEFAULT_HTML;
    const current = editor.getHTML();
    if (incomingHtml !== current) {
      editor.commands.setContent(incomingHtml, false);
      setHtmlDraft(incomingHtml);
    }
  }, [value, editor]);

  const toggleMode = () => {
    if (!editor) return;
    if (mode === 'visual') {
      setHtmlDraft(editor.getHTML());
      setMode('html');
    } else {
      // When switching back to visual, apply HTML draft into editor
      const next = (htmlDraft || '').trim() || DEFAULT_HTML;
      editor.commands.setContent(next, false);
      onChange(next);
      setMode('visual');
    }
  };

  const setLink = () => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Enter URL', previousUrl || 'https://');
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
  };

  const onPickImage = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const insertHtmlBlock = (html: string) => {
    if (!editor || mode !== 'visual') return;
    editor.chain().focus().insertContent(html).run();
  };

  const insertCtaButton = () => {
    const label = window.prompt('Button label', 'Download Airaplay');
    if (label === null) return;
    const url = window.prompt('Button link URL', 'https://airaplay.com');
    if (url === null) return;
    insertHtmlBlock(buildEmailCtaButtonHtml(label, url));
  };

  const insertPlayStoreBadge = () => {
    const url = window.prompt('Google Play link', DEFAULT_PLAY_STORE_URL);
    if (url === null) return;
    editor?.chain().focus().insertContent(buildPlayStoreBadgeTipTapContent(url)).run();
  };

  const insertAppStoreBadge = () => {
    const url = window.prompt('App Store link', DEFAULT_APP_STORE_URL);
    if (url === null) return;
    editor?.chain().focus().insertContent(buildAppStoreBadgeTipTapContent(url)).run();
  };

  const insertBothStoreBadges = () => {
    const play = window.prompt('Google Play link', DEFAULT_PLAY_STORE_URL);
    if (play === null) return;
    const apple = window.prompt('App Store link', DEFAULT_APP_STORE_URL);
    if (apple === null) return;
    editor?.chain().focus().insertContent(buildStoreBadgesRowTipTapContent(play, apple)).run();
  };

  const onImageSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editor) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const url = await onUploadImage(file);
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Image upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  const visualToolbarDisabled = disabled || !editor || mode !== 'visual';
  const isCompose = layout === 'compose';

  const tbBtnDefault = (active: boolean) =>
    `px-2 py-1 rounded border text-sm flex items-center gap-1 disabled:opacity-50 ${
      active ? 'bg-blue-100 border-blue-200 text-blue-700' : 'bg-white border-gray-300 text-gray-700'
    }`;

  const tbBtnCompose = (active: boolean) =>
    `p-2 rounded-md text-gray-700 disabled:opacity-40 flex items-center justify-center ${
      active ? 'bg-gray-300/70 text-gray-900' : 'hover:bg-gray-200/80'
    }`;

  const toolbarBtnClass = (active: boolean) => (isCompose ? tbBtnCompose(active) : tbBtnDefault(active));

  const toolbar = (
    <div
      className={
        isCompose
          ? 'flex flex-wrap items-center justify-between gap-1 border-b border-[#dadce0] bg-[#f0f0f0] px-1.5 py-1'
          : 'flex flex-wrap items-center justify-between gap-2'
      }
    >
        <div className="flex flex-wrap items-center gap-0.5">
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive('bold'))}
            title="Bold (Ctrl+B)"
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive('italic'))}
            title="Italic (Ctrl+I)"
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleUnderline().run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive('underline'))}
            title="Underline (Ctrl+U)"
          >
            <UnderlineIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={setLink}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(false)}
            title="Link"
          >
            <LinkIcon className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onPickImage}
            disabled={visualToolbarDisabled || isUploading}
            className={toolbarBtnClass(false)}
            title="Insert image"
          >
            <ImageIcon className="w-4 h-4" />
            {!isCompose && (isUploading ? <span className="text-xs">Uploading…</span> : <span className="text-xs">Image</span>)}
          </button>
          {editor?.isActive('image') && (
            <>
              <div className={isCompose ? 'mx-0.5 h-6 w-px bg-[#dadce0]' : 'mx-1 h-6 w-px bg-gray-200'} />
              <button
                type="button"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .updateAttributes('image', { width: null, height: null })
                    .run()
                }
                disabled={visualToolbarDisabled}
                className={toolbarBtnClass(false)}
                title="Reset to original image size"
              >
                <RotateCcw className="h-4 w-4" />
                {!isCompose && <span className="text-xs">Reset size</span>}
              </button>
            </>
          )}
          <div className={isCompose ? 'w-px h-6 bg-[#dadce0] mx-0.5' : 'w-px h-6 bg-gray-200 mx-1'} />
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive('bulletList'))}
            title="Bulleted list"
          >
            <List className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive('orderedList'))}
            title="Numbered list"
          >
            <ListOrdered className="w-4 h-4" />
          </button>
          <div className={isCompose ? 'w-px h-6 bg-[#dadce0] mx-0.5' : 'w-px h-6 bg-gray-200 mx-1'} />
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign('left').run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive({ textAlign: 'left' }))}
            title="Align left"
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign('center').run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive({ textAlign: 'center' }))}
            title="Align center"
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => editor?.chain().focus().setTextAlign('right').run()}
            disabled={visualToolbarDisabled}
            className={toolbarBtnClass(!!editor?.isActive({ textAlign: 'right' }))}
            title="Align right"
          >
            <AlignRight className="w-4 h-4" />
          </button>
          {quickInserts && (
            <>
              <div className={isCompose ? 'mx-0.5 h-6 w-px bg-[#dadce0]' : 'mx-1 h-6 w-px bg-gray-200'} />
              <button
                type="button"
                onClick={insertCtaButton}
                disabled={visualToolbarDisabled}
                className={toolbarBtnClass(false)}
                title="Insert call-to-action button"
              >
                <MousePointerClick className="h-4 w-4" />
                {!isCompose && <span className="text-xs">Button</span>}
              </button>
              <button
                type="button"
                onClick={insertPlayStoreBadge}
                disabled={visualToolbarDisabled}
                className={toolbarBtnClass(false)}
                title="Insert Google Play badge"
              >
                <Smartphone className="h-4 w-4" />
                {!isCompose && <span className="text-xs">Play</span>}
              </button>
              <button
                type="button"
                onClick={insertAppStoreBadge}
                disabled={visualToolbarDisabled}
                className={toolbarBtnClass(false)}
                title="Insert App Store badge"
              >
                <Smartphone className="h-4 w-4" />
                {!isCompose && <span className="text-xs">App Store</span>}
              </button>
              <button
                type="button"
                onClick={insertBothStoreBadges}
                disabled={visualToolbarDisabled}
                className={
                  isCompose
                    ? 'rounded-md px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-200/80 disabled:opacity-40'
                    : 'rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700 disabled:opacity-50'
                }
                title="Insert Play Store + App Store badges side by side"
              >
                Store badges
              </button>
            </>
          )}
        </div>

      <button
        type="button"
        onClick={toggleMode}
        disabled={disabled || !editor}
        className={
          isCompose
            ? 'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-200/80 disabled:opacity-50'
            : 'flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50'
        }
        title={mode === 'visual' ? 'View/edit HTML' : 'Back to visual editor'}
      >
        {mode === 'visual' ? <Code2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        {mode === 'visual' ? 'HTML' : 'Visual'}
      </button>
    </div>
  );

  const uploadBlock =
    uploadError &&
    (isCompose ? (
      <div className="border-b border-red-200 bg-red-50 px-3 py-2">
        <p className="text-sm text-red-800">{uploadError}</p>
      </div>
    ) : (
      <div className="rounded-lg border border-red-200 bg-red-100 p-3">
        <p className="text-sm text-red-700">{uploadError}</p>
      </div>
    ));

  const fileInput = (
    <input ref={fileInputRef} type="file" accept="image/*" onChange={onImageSelected} className="hidden" />
  );

  const editorArea =
    mode === 'visual' ? (
      <div
        className={
          isCompose
            ? 'min-h-[220px] flex-1 overflow-y-auto overflow-x-hidden bg-white [&_.ProseMirror]:min-h-[200px] [&_.ProseMirror]:px-4 [&_.ProseMirror]:py-3 [&_.ProseMirror]:text-[15px] [&_.ProseMirror]:leading-6 [&_.ProseMirror]:text-[#202124] [&_.ProseMirror]:outline-none [&_.ProseMirror_a]:cursor-pointer [&_.ProseMirror_a_img]:border-0'
            : 'overflow-x-hidden overflow-hidden rounded-lg border border-gray-300'
        }
      >
        {isCompose ? (
          <EditorContent editor={editor} className="email-html-editor" />
        ) : (
          <div className="bg-white p-3">
            <EditorContent editor={editor} className="email-html-editor" />
          </div>
        )}
      </div>
    ) : (
      <textarea
        value={htmlDraft}
        onChange={(e) => {
          const next = e.target.value;
          setHtmlDraft(next);
          onChange(next);
        }}
        rows={isCompose ? 14 : 16}
        disabled={disabled}
        className={
          isCompose
            ? 'min-h-[200px] w-full flex-1 resize-y border-0 bg-white px-4 py-3 font-mono text-sm text-gray-900 outline-none focus:ring-0 disabled:opacity-50'
            : 'w-full rounded-lg border border-gray-300 px-4 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 disabled:opacity-50'
        }
      />
    );

  if (isCompose) {
    return (
      <div className="flex min-h-[240px] flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-sm">
          {toolbar}
          {uploadBlock}
          {fileInput}
          {editorArea}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {toolbar}
      {uploadBlock}
      {fileInput}
      {editorArea}
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" />
          Tip: use “Preview” to confirm it renders well in email clients.
        </span>
      </p>
    </div>
  );
};

