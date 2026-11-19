# Security Policy

## Reporting a vulnerability

Please report it privately through **Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting). Do not open a public issue. You'll get a reply within 7 days.

## Security design

CartWise is a static web app with **no server, no accounts and no tracking**.

- **Your data stays on your device.** Prices, lists, pantry and spending live in the browser's local storage. Nothing is uploaded. Backups are files you control.
- **One outside service.** The app only sends **barcode numbers** to Open Food Facts to look up products. Requests are sent without cookies or a referrer.
- **Content Security Policy.** Scripts load only from this site, with no inline scripts and no `eval`. Network access is limited to Open Food Facts, plugins and frames are blocked, and form submission is disabled.
- **Input validation.** Scanned codes must be 6 to 14 digits before they're used in a URL. Product photos must be HTTPS from Open Food Facts. All text is HTML-escaped before display. Restored backups have a size limit and are validated again.
- **Supply chain.** There are zero npm runtime dependencies. The barcode library (html5-qrcode 2.3.8) is bundled in the repo, and CI checks its SHA-256 on every run. Every GitHub Action is pinned to a full commit SHA and kept current by Dependabot.
- **CI/CD.** Workflows run with read-only permissions by default. Only the deploy job gets `pages: write`, and credentials are never kept in the checkout. CodeQL scans the JavaScript and the workflow files on every push and every week.
- **Repository protections.** Secret scanning with push protection, Dependabot alerts, private vulnerability reporting, only GitHub-owned Actions allowed, and `main` protected from force-pushes and deletion. `scripts/secure-repo.sh` applies all of these.

## Known limits

- GitHub Pages can't set custom HTTP headers, so the CSP is set with a `<meta>` tag. This means `frame-ancestors` (clickjacking protection) can't be enforced. The app has no sign-in or actions that clickjacking could abuse.
- Inline `style="…"` attributes are allowed (`style-src-attr 'unsafe-inline'`). Style elements and remote stylesheets are not.
