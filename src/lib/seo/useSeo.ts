import { useEffect } from "react";
import {
  absoluteUrl,
  SEO_DEFAULT_DESCRIPTION,
  SEO_DEFAULT_OG_IMAGE,
  SEO_DEFAULT_TITLE,
  SEO_SITE_NAME,
} from "./config";

export interface SeoOptions {
  title?: string;
  description?: string;
  /** Path or absolute URL */
  canonical?: string;
  image?: string | null;
  ogType?: string;
  noindex?: boolean;
  /** One or more JSON-LD objects */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
}

const MANAGED_ATTR = "data-airaplay-seo";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.querySelector(`meta[${attr}="${key}"][${MANAGED_ATTR}]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    el.setAttribute(MANAGED_ATTR, "1");
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertLink(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"][${MANAGED_ATTR}]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    el.setAttribute(MANAGED_ATTR, "1");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

function removeManagedJsonLd() {
  document.querySelectorAll(`script[type="application/ld+json"][${MANAGED_ATTR}]`).forEach((n) => n.remove());
}

function injectJsonLd(schemas: Record<string, unknown> | Array<Record<string, unknown>>) {
  removeManagedJsonLd();
  const list = Array.isArray(schemas) ? schemas : [schemas];
  list.forEach((schema) => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute(MANAGED_ATTR, "1");
    script.textContent = JSON.stringify(schema);
    document.head.appendChild(script);
  });
}

/**
 * Client-side SEO head management. Search crawlers also receive server-rendered
 * meta via /api/seo-crawl (middleware rewrite for bots).
 */
export function useSeo(options: SeoOptions | null | undefined) {
  useEffect(() => {
    if (!options) return;

    const title = options.title || SEO_DEFAULT_TITLE;
    const description = options.description || SEO_DEFAULT_DESCRIPTION;
    const canonical = options.canonical ? absoluteUrl(options.canonical) : absoluteUrl("/");
    const image = options.image || SEO_DEFAULT_OG_IMAGE;
    const ogType = options.ogType || "website";

    document.title = title;
    upsertMeta("name", "description", description);
    upsertLink("canonical", canonical);

    if (options.noindex) {
      upsertMeta("name", "robots", "noindex, nofollow");
    } else {
      const robots = document.querySelector(`meta[name="robots"][${MANAGED_ATTR}]`);
      robots?.remove();
    }

    upsertMeta("property", "og:site_name", SEO_SITE_NAME);
    upsertMeta("property", "og:title", title);
    upsertMeta("property", "og:description", description);
    upsertMeta("property", "og:type", ogType);
    upsertMeta("property", "og:url", canonical);
    upsertMeta("property", "og:image", image);

    upsertMeta("name", "twitter:card", "summary_large_image");
    upsertMeta("name", "twitter:title", title);
    upsertMeta("name", "twitter:description", description);
    upsertMeta("name", "twitter:image", image);

    if (options.jsonLd) {
      injectJsonLd(options.jsonLd);
    } else {
      removeManagedJsonLd();
    }

    return () => {
      removeManagedJsonLd();
    };
  }, [
    options?.title,
    options?.description,
    options?.canonical,
    options?.image,
    options?.ogType,
    options?.noindex,
    options?.jsonLd,
  ]);
}
