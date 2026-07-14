import { absoluteUrl, SEO_SITE_NAME, SEO_SITE_ORIGIN } from "./config";

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function buildBreadcrumbListSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function buildWebSiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SEO_SITE_NAME,
    url: SEO_SITE_ORIGIN,
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SEO_SITE_ORIGIN}/explore?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function buildOrganizationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SEO_SITE_NAME,
    url: SEO_SITE_ORIGIN,
    logo: `${SEO_SITE_ORIGIN}/favicon.png`,
  };
}

export function buildMusicRecordingSchema(opts: {
  name: string;
  url: string;
  image?: string | null;
  durationSeconds?: number | null;
  artistName?: string;
  artistUrl?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicRecording",
    name: opts.name,
    url: absoluteUrl(opts.url),
    image: opts.image || undefined,
    duration: opts.durationSeconds ? `PT${Math.round(opts.durationSeconds)}S` : undefined,
    byArtist: opts.artistName
      ? {
          "@type": "MusicGroup",
          name: opts.artistName,
          url: opts.artistUrl ? absoluteUrl(opts.artistUrl) : undefined,
        }
      : undefined,
  };
}

export function buildMusicAlbumSchema(opts: {
  name: string;
  url: string;
  image?: string | null;
  description?: string | null;
  releaseDate?: string | null;
  artistName?: string;
  artistUrl?: string;
  tracks?: Array<{ name: string; url: string; position: number }>;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicAlbum",
    name: opts.name,
    url: absoluteUrl(opts.url),
    image: opts.image || undefined,
    description: opts.description || undefined,
    datePublished: opts.releaseDate || undefined,
    byArtist: opts.artistName
      ? {
          "@type": "MusicGroup",
          name: opts.artistName,
          url: opts.artistUrl ? absoluteUrl(opts.artistUrl) : undefined,
        }
      : undefined,
    track: opts.tracks?.length
      ? opts.tracks.map((t) => ({
          "@type": "MusicRecording",
          name: t.name,
          url: absoluteUrl(t.url),
          position: t.position,
        }))
      : undefined,
  };
}

export function buildMusicPlaylistSchema(opts: {
  name: string;
  url: string;
  image?: string | null;
  description?: string | null;
  creatorName?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicPlaylist",
    name: opts.name,
    url: absoluteUrl(opts.url),
    image: opts.image || undefined,
    description: opts.description || undefined,
    creator: opts.creatorName
      ? { "@type": "Person", name: opts.creatorName }
      : undefined,
  };
}

export function buildVideoObjectSchema(opts: {
  name: string;
  url: string;
  image?: string | null;
  description?: string;
  uploadDate?: string | null;
  durationSeconds?: number | null;
  creatorName?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: opts.name,
    url: absoluteUrl(opts.url),
    thumbnailUrl: opts.image || undefined,
    description: opts.description || undefined,
    uploadDate: opts.uploadDate || undefined,
    duration: opts.durationSeconds ? `PT${Math.round(opts.durationSeconds)}S` : undefined,
    creator: opts.creatorName
      ? { "@type": "Person", name: opts.creatorName }
      : undefined,
  };
}

export function buildMusicGroupSchema(opts: {
  name: string;
  url: string;
  image?: string | null;
  description?: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: opts.name,
    url: absoluteUrl(opts.url),
    image: opts.image || undefined,
    description: opts.description || undefined,
  };
}

export function buildArticleSchema(opts: {
  headline: string;
  url: string;
  description?: string;
  image?: string | null;
  datePublished?: string | null;
  dateModified?: string | null;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description || opts.headline,
    image: opts.image ? [opts.image] : undefined,
    datePublished: opts.datePublished || undefined,
    dateModified: opts.dateModified || opts.datePublished || undefined,
    author: { "@type": "Organization", name: SEO_SITE_NAME },
    publisher: { "@type": "Organization", name: SEO_SITE_NAME, url: SEO_SITE_ORIGIN },
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(opts.url) },
  };
}

export function buildCollectionPageSchema(opts: {
  name: string;
  url: string;
  description?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: opts.name,
    url: absoluteUrl(opts.url),
    description: opts.description || undefined,
  };
}
