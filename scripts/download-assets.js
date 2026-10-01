// Optional asset refresh. Demo photographs are checked in; normal setup is offline.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
const dir = new URL("../public/assets/", import.meta.url);
await mkdir(dir, { recursive: true });
const photos = {
  hero: "photo-1486406146926-c627a92ad1ab",
  "property-1": "photo-1497366754035-f200968a6e72",
  "property-2": "photo-1441986300917-64674bd600d8",
  "property-3": "photo-1586528116311-ad8dd3c8310d",
  "property-4": "photo-1565043589221-1a6fd9ae45c7",
  "property-5": "photo-1497366811353-6870744d04b2",
  "property-6": "photo-1500382017468-9049fed747ef",
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
