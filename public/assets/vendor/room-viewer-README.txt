Local GaussianSplats3D browser viewer.
GaussianSplats3D 0.4.7, Three.js 0.170.0.
Source: https://github.com/mkkellogg/GaussianSplats3D
Rebuild: npm run build:room-viewer
The embedded sort worker uses WebAssembly. Property pages require script-src 'self' 'wasm-unsafe-eval' and worker-src 'self' blob:. JavaScript unsafe-eval is not required.
Shared memory, SIMD and GPU sorting are disabled by the application for compatibility.
Local lifecycle patch: during disposal, remove the root from document.body only if it is a direct child. Embedded hosts belong to the application. Sorting and rendering remain upstream.
