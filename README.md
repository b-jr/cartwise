# CartWise 🛒

[![CI](https://github.com/b-jr/cartwise/actions/workflows/ci.yml/badge.svg)](https://github.com/b-jr/cartwise/actions/workflows/ci.yml) [![CodeQL](https://github.com/b-jr/cartwise/actions/workflows/codeql.yml/badge.svg)](https://github.com/b-jr/cartwise/actions/workflows/codeql.yml)

**Smart bulk buying while grocery prices keep climbing.** A phone web app for grocery shopping that focuses on **bulk deals**, with **nutrition ratings** shown next to every price. Scan a barcode, log the price you see, and the app tracks unit prices, deals, your pantry and your spending. There is no server and no account. Everything stays on your phone.

## Features

| Area | What it does |
|---|---|
| **Scan** | Camera barcode scanning (EAN/UPC and more), or type the number. Product info comes from [Open Food Facts](https://world.openfoodfacts.org). |
| **In-store mode** | Pick a store and keep scanning. Each scan shows the price prefilled from last time, and **Put in cart** logs the price and checks the item off your list. |
| **Deals** | Unit prices ($/oz, $/fl oz, $/item), "2 for $5" pricing, sale tags, a verdict against your own price history ("18% below your avg"), stock-up price alerts, and a sale-cycle estimate ("next sale likely around Dec 15"). |
| **Bulk** | Group items (e.g. "Eggs") to rank every size and store by unit price. The bulk check compares how fast you use an item with its shelf life, warns about waste, shows the real price after waste, and shows monthly and yearly savings compared with small packs. |
| **Health** | Nutri-Score, NOVA processing level, sugar/salt/fat traffic lights, protein and calories per $1, cost per serving, and a "healthier pick at about the same price" hint. |
| **Shopping list** | Grouped by the cheapest store. Compares one store with splitting the trip, and flags cheaper sizes. |
| **Checkout** | Records what you bought: monthly spend, savings compared with your usual prices, and totals by store. Bought items go into the pantry. |
| **Pantry** | Estimates what's left from your usage rate, warns when something is running low or about to expire, and adds low items to your list in one tap. |
| **Offline** | Installable PWA. It opens and scans with no signal. Scans of unknown items are queued and looked up when you're back online. |
| **Data** | Prices and purchases export as CSV for Excel. JSON backup and restore. Data from earlier versions migrates automatically. |

## Use it

Open **https://b-jr.github.io/cartwise/** on your phone, then install it. On Android Chrome use ⋮ → **Install app**. On iPhone Safari use Share → **Add to Home Screen**.

## Shipping changes (effortless mode)

Push to `main`, or merge a pull request, and that's it. CI then:
1. runs the unit tests, syntax checks and library checksum,
2. builds the site with only the public files and stamps the offline cache with the commit SHA, so phones update on their next launch,
3. deploys to GitHub Pages, but only if every check passed.

You can also code from anywhere: **Code → Codespaces → Create codespace** opens a ready editor that runs the tests and starts a live preview on its own.

## Security

See [SECURITY.md](SECURITY.md). In short: no server, no accounts, data stays on the device, a strict Content Security Policy, zero npm dependencies, a checksum-verified scanner library, Actions pinned to full SHAs with least-privilege tokens, CodeQL, secret scanning with push protection, Dependabot, and a protected `main`. To re-apply the repo settings: `scripts/secure-repo.sh b-jr/cartwise`.

## Develop

```bash
npm test          # unit tests for all deal / bulk / pantry / health logic (Node 18+)
npm run check     # syntax + vendored-library checksum
npm run serve     # http://localhost:8080 (camera works on localhost too)
```

```
index.html              markup for the five tabs + Content Security Policy
css/app.css             styles (light and dark mode)
js/core.js              pure logic: sizes, unit prices, deal verdicts, bulk check, pantry, spending, health
js/app.js               UI, camera, Open Food Facts lookups, offline queue, storage
sw.js                   service worker (offline cache)
manifest.webmanifest    install metadata
vendor/                 html5-qrcode 2.3.8 (Apache-2.0), bundled so scanning works offline; SHA256SUMS verified in CI
.github/                CI + deploy, CodeQL, Dependabot
scripts/secure-repo.sh  one-shot GitHub security settings
.devcontainer/          Codespaces setup
CLAUDE.md               conventions for AI-assisted coding
tests/core.test.mjs     node:test suite
```

All the math is in `js/core.js` with no DOM access, so new features can be tested without a browser. In the browser console, `__app.S` shows the live state.

### Data model (localStorage key `grocery-scanner-v2`)

```js
{
  v: 3,
  products: { [barcode]: { name, brand, size:{amt, unit:'g'|'ml'|'ct'}, group, ns, nova, n100, nServ, servQty,
                           target /*$ per pack*/, use /*packs per month*/, shelf /*days*/, buy } },
  prices:   [{ id, code, store, price /*total paid*/, packs, sale, date:'YYYY-MM-DD' }],
  list:     [{ code, qty, done }],
  purchases:[{ id, code, qty, packPrice, store, date, saved }],
  pantry:   { [barcode]: { asOf, lots:[{ qty, date }] } },   // FIFO lots; usage is subtracted from asOf to today
  pending:  [barcode],                                       // offline scans waiting for a lookup
  stores:   [...], trip: { active, store }, settings: { lowDays, lastStore, lastGroup }
}
```

## Ideas for next versions

- **Sync between devices**: save the backup JSON to a private GitHub Gist or Google Drive.
- **Weekly ads**: pull store circulars to spot sales before you go.
- **Shelf-tag OCR**: photograph the shelf tag to fill in price and unit price automatically.
- **Recipes and meal plans**: turn planned meals into list quantities, and use pantry stock first.
- **Shared household list**: real-time sync for more than one shopper.

## Credits

Product data © Open Food Facts contributors, under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/). Barcode decoding by [html5-qrcode](https://github.com/mebjas/html5-qrcode) (Apache-2.0).
