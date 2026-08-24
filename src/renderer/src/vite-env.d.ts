/// <reference types="vite/client" />

/**
 * Vite's ambient types for the renderer.
 *
 * What they are here for is the one line in `main.tsx` that imports
 * `./styles/index.css` for its side effect. A stylesheet is not a module TypeScript
 * knows anything about, and from TypeScript 7 an untyped side-effect import is
 * an error rather than an implicit `any` — so the declaration has to come from
 * somewhere, and Vite ships it for every asset kind it can bundle.
 */
