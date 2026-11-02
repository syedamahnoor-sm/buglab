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
`importScripts()` the real worker files, using absolute same-origin URLs.

### Workers: types and instances

Monaco 0.57.0 ships five worker bundles in `min/vs/assets/`. All five are
copied and verified, because `editor.main.js` references each of them:

| Worker type | Started for | Started in BugLab? |
|---|---|---|
| Editor worker | Generic editor services, any file | Yes |
| TypeScript worker | `.ts` and `.js` files | Yes |
| JSON worker | `.json` files | Yes |
| CSS worker | CSS, SCSS, Less | No (no such files in the workspace) |
| HTML worker | HTML, Handlebars, Razor | No (no such files in the workspace) |

Markdown, `.log` and plain-text files have no language worker.

Observed in headless Chrome, on both `next start` and `next dev`, with and
without jsDelivr blocked: after opening `INCIDENT.md`, `src/server.ts` and
`package.json`, there were exactly **three worker instances**, one each of the
editor, TypeScript and JSON types. Each loaded its script from
`/monaco/0.57.0/vs/assets/`. Workers are started lazily, the first time a type
is needed, and one instance of a type serves every open file of that language
(for example, `.ts` and `.js` files share one TypeScript worker). The count in
a session is therefore the number of worker types needed so far, at most three
with the current file types.

## Upgrading Monaco

Change the pinned version in `package.json`, run `npm install`, and run
`npm test`. The tests check that the pin, the lockfile and the installed
package agree, and that the new package still contains every file the editor
needs.

## Content-Security-Policy (to agree with the engine owner; not implemented)

No CSP is implemented yet. This section records what a policy must allow, so
it can be designed together with the engine owner.

### What Monaco needs

| Directive | Value | Reason |
|---|---|---|
| `script-src` | `'self'` | `loader.js` and the editor chunks are same-origin script tags. Code inspection found no `eval` or `new Function` on the paths Monaco 0.57.0 uses, so `'unsafe-eval'` should not be needed. This has not yet been tested under an enforcing policy. |
| `worker-src` | `'self' blob:` | Monaco always creates workers from `blob:` URLs. |
| `style-src` | `'self' 'unsafe-inline'` | Monaco injects `<style>` elements and inline `style` attributes. |
| `font-src` | `'self' data:` | The codicon font is a `data:` URL inside `editor.main.css`. |
| `img-src` | `'self' data:` | Inline images in Monaco's stylesheet. |
| `connect-src` | `'self'` | Monaco makes no network requests of its own. |

No third-party origin (such as `cdn.jsdelivr.net`) is needed.

### Next.js inline bootstrap scripts

`script-src 'self'` alone would break the whole app, not just the editor.
Next.js puts inline `<script>` elements in every page it renders. In the
current production build, the prerendered `/` contains 16 inline scripts
(alongside 8 external ones):

- one Turbopack runtime bootstrap;
- one that initialises `self.__next_f`;
- fourteen `self.__next_f.push(...)` calls carrying the React Server
  Components payload.

These must be allowed by the policy, as well as Monaco's needs above. Their
contents change with every build and with page data, so per-script hashes
aren't a practical option.

### Nonce-based CSP vs static rendering

| | Nonce per request | `'unsafe-inline'` for scripts |
|---|---|---|
| How | The proxy (formerly middleware) generates a nonce and sends it in the CSP header; Next.js adds it to its own scripts. | A fixed header, for example from `headers()` in `next.config.ts`. |
| Protection | Strong: injected inline scripts don't run. | Weaker: blocks scripts from other origins, but not injected inline scripts. |
| Rendering | Every page must render per request, because the HTML contains the nonce. `/` stops being static (it is `○ Static` today), and CDN caching of the HTML is lost. | Unchanged: `/` stays static and cacheable. |
| Cost | More server work per request and higher time-to-first-byte; interacts with Cache Components and partial prefetching, which the app enables. | None. |

This is a product decision for both owners. A reasonable path is to ship the
static policy first: it already removes third-party script origins and adds
`worker-src`, `object-src 'none'`, `base-uri 'self'` and `frame-ancestors`.
Move to nonces if the threat model needs protection against injected inline
scripts.

### Other open points

- With a nonce plus `'strict-dynamic'`, the injected `loader.js` inherits trust.
  Check in a browser that the workers' `importScripts()` calls are still allowed.
- Don't enforce Trusted Types yet: Monaco creates several policies of its own
  (for example `defaultWorkerFactory`).
- `@monaco-editor/loader` still contains its default jsDelivr URL as an unused
  string in the client bundle. A CSP without jsDelivr guarantees it can never be
  used.
- Roll out with `Content-Security-Policy-Report-Only` first, and check the
  workspace (editor, workers, diagnosis form) before enforcing.

## DOMPurify inside Monaco

Monaco 0.57.0 bundles its own copy of DOMPurify **3.4.15** (vendored at
`esm/vs/base/browser/dompurify/`, and inside the `min/vs` chunks we serve).
`npm audit` reports advisories against this version, which are fixed in
DOMPurify 3.4.17.

Status, as reviewed by the engine owner:

- This is **not** a claim that the bundled copy is free of vulnerabilities.
- No exploitable path was identified in the current configuration. Monaco calls
  DOMPurify with a fixed allowlist of tags and attributes and returns a DOM
  fragment. It does not use the options the advisories depend on (`IN_PLACE`,
  `SAFE_FOR_TEMPLATES`, or the XHTML parser mode). The editor is read-only and
  shows author-controlled challenge files, with no learner-supplied markup.
- An npm `overrides` entry would not help: the copy that runs in the browser is
  the one vendored into Monaco's build, not a separate `dompurify` package.

Follow-up: monitor Monaco releases and upgrade once one bundles DOMPurify 3.4.17
or later (bump the pin, then follow "Upgrading Monaco" above). Re-review this
assessment if the editor starts rendering learner-supplied content, Markdown
previews or hover content from untrusted sources.
