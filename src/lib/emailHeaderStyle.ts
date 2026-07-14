/**
 * White logo on black: solid header so the mark stays visible (many clients strip `<style>`).
 * Keep in sync with `supabase/functions/_shared/emailHeaderStyle.ts`.
 */
const HEADER_STYLE_RULE =
  '.header { background-color: #000000; background: #000000; color: #ffffff; padding: 30px; text-align: center; }';

const HEADER_INLINE_STYLE =
  'style="background-color:#000000;background:#000000;color:#ffffff;padding:30px;text-align:center;"';

export function enforceBlackEmailHeaderBackground(html: string): string {
  if (!html) return html;

  let out = html.replace(/\.header\s*\{[\s\S]*?\}/g, HEADER_STYLE_RULE);

  out = out.replace(
    /(<div\b[^>]*\bclass=["'][^"']*\bheader\b[^"']*["'][^>]*?)\s+style=["'][^"']*["']/gi,
    `$1 ${HEADER_INLINE_STYLE}`,
  );

  out = out.replace(
    /<div(\s+[^>]*\bclass=["'][^"']*\bheader\b[^"']*["'][^>]*)>/gi,
    (_m, attrs: string) => {
      if (/\bstyle\s*=/i.test(attrs)) return `<div${attrs}>`;
      return `<div ${HEADER_INLINE_STYLE.trim()}${attrs}>`;
    },
  );

  return out;
}
