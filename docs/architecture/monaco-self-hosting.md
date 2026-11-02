# Self-hosted Monaco

The workspace editor (Monaco) is served from BugLab's own origin. No editor
code is loaded from a third-party CDN.

## How it works

| Piece | Role |
|---|---|
| `package.json` | Pins `monaco-editor` to an exact version (`0.57.0`). This is the single version source. |
| `scripts/monaco-assets.mjs copy` | Copies `node_modules/monaco-editor/min/vs` (151 files, ~25 MB) and the licence to `public/monaco/<version>/`. Fails if the installed version differs from the pin or the package layout lacks a required file. Skips the copy when the output is already complete. Removes copies of other versions. |
| `predev` / `prebuild` | Run the copy before `npm run dev` and `npm run build`. |
| `next.config.ts` | In the dev-server and production-build phases, fails with a clear message if the copied files are missing (this also catches a direct `next build`). Exposes `MONACO_VS_PATH` (`/monaco/<version>/vs`) to the client, and serves `/monaco/*` with `Cache-Control: public, max-age=31536000, immutable` (safe because the directory is named after an exact version). |
| `MonacoEditor.tsx` | Configures `@monaco-editor/react`'s loader with `MONACO_VS_PATH`. If the path is missing, the editor is not started at all, because the loader's built-in default is a jsDelivr URL. |
| `.gitignore` | Ignores the generated `public/monaco/`. |

The loader adds `<vs>/loader.js` as a script, then loads the editor chunks and
`editor/editor.main.css`. Workers are started from small `blob:` scripts that
`importScripts()` the real worker files, using absolute same-origin URLs. With
the current file types, three workers start: the editor worker, the TypeScript
worker and the JSON worker.

## Upgrading Monaco

Change the pinned version in `package.json`, run `npm install`, and run
`npm test`. The tests check that the pin, the lockfile and the installed
package agree, and that the new package still contains every file the editor
needs.

## Content-Security-Policy (to agree with the engine owner; not implemented)

What Monaco needs once a CSP is added:

| Directive | Value | Reason |
|---|---|---|
| `script-src` | `'self'` | `loader.js` and the editor chunks are same-origin script tags. No `'unsafe-eval'` was needed in browser testing. |
| `worker-src` | `'self' blob:` | Monaco always creates workers from `blob:` URLs. |
| `style-src` | `'self' 'unsafe-inline'` | Monaco injects `<style>` elements and inline `style` attributes. |
| `font-src` | `'self' data:` | The codicon font is a `data:` URL inside `editor.main.css`. |
| `img-src` | `'self' data:` | Inline images in Monaco's stylesheet. |
| `connect-src` | `'self'` | Monaco makes no network requests of its own. |

No third-party origin (such as `cdn.jsdelivr.net`) is needed.

Open points for the CSP work:

- Next.js's own inline scripts need a nonce or `'unsafe-inline'`. A per-request
  nonce makes `/` render dynamically instead of statically.
- With a nonce plus `'strict-dynamic'`, the injected `loader.js` inherits trust.
  Check in a browser that the workers' `importScripts()` calls are still allowed.
- Don't enforce Trusted Types yet: Monaco creates several policies of its own
  (for example `defaultWorkerFactory`).
- `@monaco-editor/loader` still contains its default jsDelivr URL as an unused
  string in the client bundle. A CSP without jsDelivr guarantees it can never be
  used.
