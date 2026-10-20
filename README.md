# NoHands

Online gallery for the artist Vedi. Exhibitions are the unit of the site; the MVP ships Exhibition 001.

## Stack

Astro (static output), Netlify adapter, sharp image pipeline, self-hosted Fraunces and Inter. No client framework.

```sh
npm install
npm run dev      # local preview
npm run build    # static build into dist/
npm run check    # type-check .astro and .ts
```

## Data is the source of truth

`src/data/nohands-exhibition-01-works.json` drives every page, price, size and option. Components never hard-code values.
`src/lib/exhibition.ts` is the only place that reads it.

- Titles are displayed exactly as the `title` field. `square_title` is only for matching legacy files.
- Print prices are flat per work for now. A per-size `price_usd` overrides the flat price when set.
- To mark an original as sold: set `status` to `sold` and `sold_at_usd`, then redeploy.
- Stripe Payment Links go in each work's `stripe` object. A `null` link renders a disabled Buy button.
  The site appends `client_reference_id={work}:{variant}` to every link so a later webhook can tell variants apart.

Wall titles are provisional: a wall's `title` of `null` falls back to the series label or the titles of its works.
The exhibition `slug` is `null` until Vedi names the exhibition.

## Images

`npm run fetch-images` downloads every file the data lists from Square, skipping files already present; it also runs
automatically before every build (`prebuild`), so a checkout without the images still builds while Square is up.
Commit the downloaded files before Square is retired. The artwork files live in `src/assets/works/{id}/`; the room mockups live in `reference/square-mockups/` and never ship.
`src/assets/works/manifest.json` records each file's `role`: `artwork` (the painting alone, used on the site), `mockup`
(generic room scene, unused), or `mockup-sold` (room scene with a baked-in badge, unused). Exactly one file per work is the
artwork. Square is never read at runtime.

## The walk

`src/components/Gallery.astro` is one continuous corridor built with CSS 3D from short bays (one per painting), so no
layer is huge or passes behind the camera: paintings hang along both walls in walk order, alternating left and right. `src/scripts/walk.ts` turns scroll position into a camera path: walk forward, turn
toward a painting as you approach so its frame lands 1:1 one perspective distance away (the eye never leaves the
corridor), hold while the facts show, turn back, walk on. The scene receives one
transform per frame; nothing paints on scroll. `src/components/FramedPainting.astro` is the gilt frame with pin, wire
and price tag; `src/components/PaintingDetails.astro` is the facts block (gilt star for works flagged
`one_of_a_kind_badge: "gold"`). Reduced motion renders the paintings as a flat list.

Easing uses two curves only: easeOutExpo (`--ease`) and easeOutBack (`--ease-back`) for small accents.

## Routes

| Route | What |
|---|---|
| `/` | 302 to the current exhibition |
| `/exhibitions/001` | the gallery walk (`/exhibitions/001-{slug}` once the exhibition is named); `?at={work-id}` lands on that work |
| `/paintings/{id}` | direct, indexable painting page |
| `/product/*`, `/shop*` | 301 to the exhibition (the only legacy Square rule) |
| `/success`, `/cancel` | Stripe return pages |

Still to build: `/exhibitions/001/grid`, `/commission`, structured data and Open Graph, PostHog events (the client already
dispatches `nohands:track` DOM events with the agreed names).
