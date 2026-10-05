import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Only called for the original cover of a known demonstration listing.
// Keep its DB filename so existing links and galleries continue to work.
export async function restoreDemoPhoto({ filename, source, uploadDir }) {
  if (!/^[a-f0-9-]{36}\.webp$/.test(filename))
    throw new Error("Invalid demo photo filename");
  await mkdir(uploadDir, { recursive: true });
  try {
    await writeFile(path.join(uploadDir, filename), await readFile(source), {
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
