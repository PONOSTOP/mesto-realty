import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
const directory = new URL("../public/assets/vendor/", import.meta.url);
await mkdir(directory, { recursive: true });
await build({
  entryPoints: [
    new URL(
      "../public/js/architectural-viewer-source.js",
      import.meta.url,
    ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  ],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  outfile: new URL("architectural-viewer.js", directory).pathname.replace(
    /^\/([A-Za-z]:)/,
    "$1",
  ),
});
await copyFile(
  new URL("../node_modules/three/LICENSE", import.meta.url),
  new URL("architectural-viewer-LICENSE.txt", directory),
);
