# CartWise: notes for AI coding assistants

A static, offline-first PWA for grocery bulk deals. No build step, no framework, no npm dependencies.

## Commands
- `npm test` runs the unit tests (node:test). They must pass before any commit.
- `npm run check` runs a syntax check and verifies the vendored library's checksum.
- `npm run serve` serves the app at http://localhost:8080. In the console, `__app.S` is the live state (localhost only).

## Layout
- `js/core.js` holds **all** logic (unit prices, deal verdicts, bulk check, pantry, spending, health). It's pure, with no DOM. New logic goes here, with tests in `tests/core.test.mjs`.
- `js/app.js` is the UI. It renders HTML strings, and clicks go through `data-act="name"` → the `ACT` object, and changes through `data-chg`.
- `sw.js` is the offline cache. CI stamps `__BUILD__` with the commit SHA, so never bump it by hand.

## Rules (security)
- Every value put into HTML goes through `esc()`. Image URLs go through `C.safeImageUrl()`. Barcodes go through `C.isProductBarcode()`.
- No inline `<script>`, no `on*=` attributes, no `eval`/`new Function`. The CSP in `index.html` blocks them.
- A new outside host has to be added to the CSP on purpose, and justified in `SECURITY.md`.
- Don't add npm runtime dependencies. If a library is truly needed, bundle it in `vendor/` and add its hash to `vendor/SHA256SUMS`.
- GitHub Actions must be pinned to a full commit SHA with a `# vX.Y.Z` comment, and only `actions/*` and `github/*` are allowed.
- Keep the localStorage key `grocery-scanner-v2` and extend `C.migrate()` when the data shape changes. Users' data must survive every update.
