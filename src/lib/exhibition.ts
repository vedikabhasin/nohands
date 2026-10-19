/**
 * Data layer. Everything on the site is derived from the exhibition JSON (the source of truth)
 * plus the image manifest that says which downloaded file is the artwork itself.
 * No component may hard-code a title, size, price or image path.
 */
import type { ImageMetadata } from 'astro';
import data from '@/data/nohands-exhibition-01-works.json';
import manifest from '@/assets/works/manifest.json';

export type SizeKey = 'small' | 'medium' | 'large';
export type WorkStatus = 'available' | 'sold';

export interface Inches {
  width: number;
  height: number;
}

export interface PrintSize {
  key: SizeKey;
  label: string;
  size: Inches;
  available: boolean;
  /** Resolved price: per-size price when set, otherwise the work's flat print price. */
  price: number;
  reviewBeforeSale: boolean;
  stripe: string | null;
}

export interface Work {
  id: string;
  title: string;
  description: string | null;
  medium: string;
  originalSize: Inches;
  orientation: 'portrait' | 'landscape';
  status: WorkStatus;
  originalPrice: number;
  soldAt: number | null;
  printPrice: number;
  prints: PrintSize[];
  stripeOriginal: string | null;
  series: string | null;
  resolutionFlag: string | null;
  /** 'gold' fills the one-of-a-kind star with the gilt finish. */
  badge: 'gold' | null;
  /** The artwork image (never a room mockup). */
  image: ImageMetadata;
  imageFile: string;
  /** Zero-based position in the walk. */
  index: number;
  wall: number;
}

export interface Wall {
  number: number;
  /** Editorial title shown on the wall. Provisional: data-driven fallback until the artist sets one. */
  title: string;
  titleIsFallback: boolean;
  note: string;
  works: Work[];
}

export interface Series {
  id: string;
  label: string;
  works: string[];
  hangRule: string;
}

export interface Exhibition {
  id: string;
  /** URL segment: `001` until a slug is set, then `001-{slug}`. */
  route: string;
  title: string;
  status: 'current' | 'archived' | 'upcoming';
  walkOrder: string[];
  works: Work[];
  walls: Wall[];
  series: Series[];
}

const SIZE_LABELS: Record<SizeKey, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const SIZE_KEYS: SizeKey[] = ['small', 'medium', 'large'];

const imageFiles = import.meta.glob<ImageMetadata>('/src/assets/works/**/*.{png,jpg,jpeg}', {
  eager: true,
  import: 'default',
});

type ManifestEntry = { path: string; role: string; width_px: number; bytes: number; source: string };
const manifestByWork = manifest as Record<string, ManifestEntry[]>;

function artworkImage(workId: string): { image: ImageMetadata; file: string } {
  const entries = manifestByWork[workId] ?? [];
  const entry = entries.find((e) => e.role === 'artwork');
  if (!entry) throw new Error(`No image marked as the artwork for "${workId}" in src/assets/works/manifest.json`);
  const image = imageFiles[`/${entry.path}`];
  if (!image) throw new Error(`Artwork file missing on disk: ${entry.path}`);
  return { image, file: entry.path };
}

type RawWork = (typeof data.works)[number];
type RawSize = { width: number; height: number; available: boolean; price_usd: number | null; review_before_sale?: boolean };

function buildWork(raw: RawWork, index: number, wall: number): Work {
  const { image, file } = artworkImage(raw.id);
  const prints = SIZE_KEYS.map<PrintSize>((key) => {
    const s = raw.print_sizes_in[key] as RawSize;
    const stripeKey = `print_${key}` as keyof typeof raw.stripe;
    return {
      key,
      label: SIZE_LABELS[key],
      size: { width: s.width, height: s.height },
      available: s.available,
      price: s.price_usd ?? raw.print_price_usd,
      reviewBeforeSale: s.review_before_sale === true,
      stripe: raw.stripe[stripeKey] ?? null,
    };
  });
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description ?? null,
    medium: raw.medium,
    originalSize: { ...raw.original_size_in },
    orientation: raw.orientation as Work['orientation'],
    status: raw.status as WorkStatus,
    originalPrice: raw.original_price_usd,
    soldAt: raw.sold_at_usd ?? null,
    printPrice: raw.print_price_usd,
    prints,
    stripeOriginal: raw.stripe.original ?? null,
    series: 'series' in raw ? ((raw as { series?: string }).series ?? null) : null,
    resolutionFlag: 'resolution_flag' in raw ? ((raw as { resolution_flag?: string }).resolution_flag ?? null) : null,
    badge: (raw as { one_of_a_kind_badge?: string }).one_of_a_kind_badge === 'gold' ? 'gold' : null,
    image,
    imageFile: file,
    index,
    wall,
  };
}

function build(): Exhibition {
  const ex = data.exhibition;
  const wallOf = new Map<string, number>();
  for (const w of ex.walls) for (const id of w.works) wallOf.set(id, w.wall);

  const rawById = new Map(data.works.map((w) => [w.id, w]));
  const works = ex.walk_order.map((id, index) => {
    const raw = rawById.get(id);
    if (!raw) throw new Error(`walk_order references unknown work "${id}"`);
    const wall = wallOf.get(id);
    if (!wall) throw new Error(`work "${id}" is not placed on any wall`);
    return buildWork(raw, index, wall);
  });
  const byId = new Map(works.map((w) => [w.id, w]));

  const walls: Wall[] = ex.walls.map((w) => {
    const works = w.works.map((id) => {
      const work = byId.get(id);
      if (!work) throw new Error(`wall ${w.wall} references unknown work "${id}"`);
      return work;
    });
    const series = ex.series.find((s) => works.length > 1 && works.every((wk) => s.works.includes(wk.id)));
    const fallback = series ? series.label : works.map((wk) => wk.title).join(' / ');
    return {
      number: w.wall,
      title: w.title ?? fallback,
      titleIsFallback: w.title == null,
      note: w.note,
      works,
    };
  });

  const slug = (ex as { slug?: string | null }).slug;
  return {
    id: ex.id,
    route: slug ? `${ex.id}-${slug}` : ex.id,
    title: ex.title,
    status: ex.status as Exhibition['status'],
    walkOrder: [...ex.walk_order],
    works,
    walls,
    series: ex.series.map((s) => ({ id: s.id, label: s.label, works: [...s.works], hangRule: s.hang_rule })),
  };
}

const exhibitions: Exhibition[] = [build()];

export const siteName: string = data.site;
export const artistName: string = data.artist;
export const currency: string = data.pricing_rules.currency;

export function getExhibitions(): Exhibition[] {
  return exhibitions;
}

export function getCurrentExhibition(): Exhibition {
  return exhibitions.find((e) => e.status === 'current') ?? exhibitions[0];
}

export function getExhibition(id: string): Exhibition | undefined {
  return exhibitions.find((e) => e.id === id);
}

export function getWork(id: string): { work: Work; exhibition: Exhibition } | undefined {
  for (const exhibition of exhibitions) {
    const work = exhibition.works.find((w) => w.id === id);
    if (work) return { work, exhibition };
  }
  return undefined;
}

export function neighbours(exhibition: Exhibition, work: Work): { prev: Work | null; next: Work | null } {
  return {
    prev: exhibition.works[work.index - 1] ?? null,
    next: exhibition.works[work.index + 1] ?? null,
  };
}

/** Public URLs. Route names are chosen for search, not gallery jargon. */
export function exhibitionPath(exhibition: Exhibition): string {
  return `/exhibitions/${exhibition.route}`;
}
export function gridPath(exhibition: Exhibition): string {
  return `${exhibitionPath(exhibition)}/grid`;
}
export function paintingPath(work: Work): string {
  return `/paintings/${work.id}`;
}
export function walkPathAt(exhibition: Exhibition, work: Work): string {
  return `${exhibitionPath(exhibition)}?at=${work.id}`;
}

export const siteTagline = `${siteName} by ${artistName}`;

/** Medium without its "on paper" support, for the page title pattern "original {medium} painting on paper". */
export function mediumForTitle(work: Work): string {
  return work.medium.replace(/\s+on\s+[a-z ]*paper$/i, '').toLowerCase();
}

/** `{Title}, original {medium} painting on paper | NoHands by Vedi` */
export function paintingPageTitle(work: Work): string {
  return `${work.title}, original ${mediumForTitle(work)} painting on paper | ${siteTagline}`;
}

/** Lowest purchasable price for a work (prints, or the original when cheaper and available). */
export function priceFrom(work: Work): number {
  const prices = work.prints.filter((p) => p.available).map((p) => p.price);
  if (work.status === 'available') prices.push(work.originalPrice);
  return Math.min(...prices);
}

/**
 * On-wall size in inches. The Large print's long side sets the scale so the work reads with
 * presence; the real aspect ratio comes from the image so the artwork is never distorted.
 */
export function onWallInches(work: Work): { w: number; h: number } {
  const large = work.prints.find((p) => p.key === 'large')!.size;
  const long = Math.max(large.width, large.height);
  const ratio = work.image.width / work.image.height;
  return ratio >= 1 ? { w: long, h: long / ratio } : { w: long * ratio, h: long };
}

/** Alt text per the brief: title, medium, size. */
export function altText(work: Work): string {
  return `${work.title}, ${work.medium}, ${inches(work.originalSize)}`;
}

export function inches(size: Inches): string {
  return `${trim(size.width)} × ${trim(size.height)} in`;
}

export function centimetres(size: Inches): string {
  return `${Math.round(size.width * 2.54)} × ${Math.round(size.height * 2.54)} cm`;
}

/** Lowest available reproduction price, or null when none is available. */
export function printFrom(work: Work): number | null {
  const prices = work.prints.filter((p) => p.available).map((p) => p.price);
  return prices.length ? Math.min(...prices) : null;
}

export function usd(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace(/\.0+$/, '');
}

/**
 * Widths for responsive variants: never larger than the source file, and capped so the build does
 * not spend minutes encoding 5000px AVIFs nobody downloads. Wall and detail ladders overlap on
 * purpose so Astro reuses the same generated files.
 */
export function widthsFor(image: ImageMetadata, candidates: number[], cap: number): number[] {
  const max = Math.min(image.width, cap);
  const ok = candidates.filter((w) => w < max);
  ok.push(max);
  return [...new Set(ok)].sort((a, b) => a - b);
}
