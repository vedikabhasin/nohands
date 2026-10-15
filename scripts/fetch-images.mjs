// Downloads every artwork image listed in the exhibition JSON into src/assets/works/.
// Square (nomohands.com) is a one-time source only. Run once, commit the files, never at runtime.
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataPath = join(root, 'src/data/nohands-exhibition-01-works.json');
const outDir = join(root, 'src/assets/works');
const refDir = join(root, 'reference/square-mockups');
const data = JSON.parse(await readFile(dataPath, 'utf8'));

let previous = {};
try { previous = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')); } catch {}
const manifest = {};
for (const work of data.works) {
  manifest[work.id] = [];
  for (const [i, img] of work.images.entries()) {
    const ext = new URL(img.url).pathname.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
    const file = `${work.id}-${i + 1}.${ext}`;
    // Only the artwork itself is bundled; room mockups are kept out of src/ so they never ship.
    const prev = previous[work.id]?.find((p) => p.path?.endsWith(`/${file}`));
    const role = prev?.role ?? 'unreviewed';
    const dir = join(role === 'artwork' || role === 'unreviewed' ? outDir : refDir, work.id);
    await mkdir(dir, { recursive: true });
    const dest = join(dir, file);
    let exists = false;
    try { exists = (await stat(dest)).size > 0; } catch {}
    if (!exists) {
      const res = await fetch(img.url);
      if (!res.ok) throw new Error(`${res.status} for ${img.url}`);
      await writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
    const size = (await stat(dest)).size;
    // role is set by hand after viewing the files: 'artwork' (the painting alone), 'mockup' (room scene), 'mockup-sold' (room scene with a SOLD badge).
    manifest[work.id].push({ path: dest.slice(root.length + 1), role, width_px: img.width_px, bytes: size, source: img.url });
    console.log(`${exists ? 'kept' : 'saved'} ${work.id}/${file} ${(size / 1e6).toFixed(1)} MB`);
  }
}
await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('manifest written');
