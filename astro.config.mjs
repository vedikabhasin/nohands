// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import data from './src/data/nohands-exhibition-01-works.json' with { type: 'json' };

// The current exhibition is the front door. `/` sends visitors straight to its opening wall.
const ex = data.exhibition;
const current = `/exhibitions/${ex.slug ? `${ex.id}-${ex.slug}` : ex.id}`;

export default defineConfig({
  site: 'https://nomohands.com',
  output: 'static',
  // imageCDN off: artwork is optimized at build with sharp (AVIF/WebP + fallback), not at request time.
  adapter: netlify({ imageCDN: false }),
  trailingSlash: 'never',
  redirects: {
    '/': { status: 302, destination: current },
    // Legacy Square paths (/product/*, /shop*) are handled by public/_redirects: Netlify splats.
  },
  image: {
    // Keep sharp local: artwork files are large PNG/JPEG sources and are optimized at build time.
    service: { entrypoint: 'astro/assets/services/sharp' },
  },
  devToolbar: { enabled: false },
});
