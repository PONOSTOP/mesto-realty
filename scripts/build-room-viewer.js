import { build } from "esbuild";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";

const directory = new URL("../public/assets/vendor/", import.meta.url);
await mkdir(directory, { recursive: true });
await build({
  stdin: {
    contents: "export { Viewer } from '@mkkellogg/gaussian-splats-3d';",
    resolveDir: process.cwd(),
    sourcefile: "room-viewer-entry.js",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  plugins: [
    {
      name: "embedded-host-disposal",
      setup(builder) {
        builder.onLoad(
          { filter: /gaussian-splats-3d\.module\.js$/ },
          async (args) => {
            let source = await readFile(args.path, "utf8");
            // Externalize helper styles for strict CSP. A listing has one
            // viewer, so stable helper classes do not need instance suffixes.
            source = source.replaceAll("${this.elementID}", "");
            const helperStyles = [];
            source = source.replace(
              /style\.innerHTML = (`[\s\S]*?`);/g,
              (_, css) => {
                helperStyles.push(css.slice(1, -1));
                return "style.rel = 'stylesheet'; style.href = '/assets/vendor/room-viewer.css';";
              },
            );
            if (helperStyles.length !== 3)
              throw new Error(
                "Review viewer style patch for the new upstream version",
              );
            source = source.replaceAll(
              "document.createElement('style')",
              "document.createElement('link')",
            );
            await writeFile(
              new URL("room-viewer.css", directory),
              helperStyles.join("\n"),
            );
            const original = "document.body.removeChild(this.rootElement);";
            if (!source.includes(original))
              throw new Error(
                "Review viewer disposal patch for the new upstream version",
              );
            // Upstream assumes every root is a direct body child during disposal.
            // Embedded listing hosts belong to the application and must remain mounted.
            return {
              contents: source.replace(
                original,
                "if (this.rootElement.parentNode === document.body) document.body.removeChild(this.rootElement);",
              ),
              loader: "js",
            };
          },
        );
      },
    },
  ],
  outfile: new URL("room-viewer.js", directory).pathname.replace(
    /^\/(\w:)/,
    "$1",
  ),
});
await copyFile(
  new URL(
    "../node_modules/@mkkellogg/gaussian-splats-3d/LICENSE",
    import.meta.url,
  ),
  new URL("GaussianSplats3D-LICENSE.txt", directory),
);
await copyFile(
  new URL("../node_modules/three/LICENSE", import.meta.url),
  new URL("three-LICENSE.txt", directory),
);
const packageData = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
await writeFile(
  new URL("room-viewer-README.txt", directory),
  `Local GaussianSplats3D browser viewer.\nGaussianSplats3D ${packageData.dependencies["@mkkellogg/gaussian-splats-3d"]}, Three.js ${packageData.dependencies.three}.\nSource: https://github.com/mkkellogg/GaussianSplats3D\nRebuild: npm run build:room-viewer\nThe embedded sort worker uses WebAssembly. Property pages require script-src 'self' 'wasm-unsafe-eval' and worker-src 'self' blob:. JavaScript unsafe-eval is not required.\nShared memory, SIMD and GPU sorting are disabled by the application for compatibility.\nLocal lifecycle patch: during disposal, remove the root from document.body only if it is a direct child. Embedded hosts belong to the application. Sorting and rendering remain upstream.\n`,
);
