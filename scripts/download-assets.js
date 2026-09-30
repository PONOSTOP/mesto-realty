// Optional asset refresh. Demo photographs are checked in; normal setup is offline.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const dir = new URL("../public/assets/", import.meta.url);
await mkdir(dir, { recursive: true });
const photos = {
  hero: "photo-1600585154340-be6161a56a0c",
  "property-1": "photo-1600210492486-724fe5c67fb0",
  "property-2": "photo-1600607687920-4e2a09cf159d",
  "property-3": "photo-1600566753086-00f18fb6b3ea",
  "property-4": "photo-1600047509807-ba8f99d2cdde",
  "property-5": "photo-1484154218962-a197022b5858",
  "property-6": "photo-1497366811353-6870744d04b2",
};
for (const [name, photo] of Object.entries(photos)) {
  const response = await fetch(
    `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=${name === "hero" ? 2000 : 1000}&q=85`,
  );
  if (!response.ok) throw new Error(`Failed ${name}: ${response.status}`);
  const image = await sharp(Buffer.from(await response.arrayBuffer()))
    .webp({ quality: 85 })
    .toBuffer();
  await writeFile(new URL(`${name}.webp`, dir), image);
  console.log(`Saved ${name}.webp`);
}
