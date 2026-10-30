# Rencana — Financial Planner (web app)

A mobile-first budget tracker (purple template style) that runs in the browser and can be installed on a phone's home screen like a native app (PWA). Plain HTML, CSS and JavaScript — **no build step, no dependencies**.

## What works

| Tab | Features |
|---|---|
| **Home** | Welcome header, purple "Spent" card with ring progress, balance / income / saved, round category shortcuts, budget tip banner, recent transactions |
| **Transactions** | Search, filter tabs (All, Income, Recurring, Food, Transport…), grouped by day, "View Details" to edit or delete, export CSV, demo / reset data, change your name |
| **+ (centre)** | Add income or expense |
| **Stats** | Weekly saved banner, Weekly / Monthly / Yearly spending chart, income vs expense, Categories / Top Spending / Top Income |
| **Plan** | Budgets (ring, daily allowance, per-category limits), Goals (add money, 50/30/20 check, savings calculator), Portfolio (sample data) |

Data is saved in the browser's `localStorage` on that device only. There is no account or server yet.

## Project structure

```
rencana/
├── index.html             App shell: top bar, tab bar, bottom sheet
├── styles.css             All styles (colours/tokens at the top)
├── js/
│   ├── app.js             Pages, sheets, events, routing (#/home, #/activity, #/stats, #/plan)
│   ├── data.js            Saving/loading + demo data + sample portfolio
│   ├── format.js          Rupiah formatting, dates, escaping
│   └── icons.js           Categories and line icons
├── manifest.webmanifest   Makes it installable
├── sw.js                  Offline support (service worker)
├── icons/                 App icons (svg + png)
└── _headers               Cloudflare Pages headers
```

## Run it locally in VS Code

The app uses JavaScript modules and a service worker, so it must be served over `http://localhost` — **double-clicking `index.html` won't work**.

**Option A — Live Server extension (easiest)**
1. Open the `rencana` folder in VS Code (File → Open Folder).
2. Install the **Live Server** extension (by Ritwick Dey).
3. Right-click `index.html` → **Open with Live Server**. It opens at `http://127.0.0.1:5500` and reloads when you save.

**Option B — terminal (needs Node.js)**
```bash
cd rencana
npx serve .
```
Then open the URL it prints (usually `http://localhost:3000`).

**See it as a phone:** in Chrome press `F12` → click the phone/tablet icon (Toggle device toolbar) → pick *iPhone 14 Pro Max* or set 440 × 956.

**Test on your real phone (same Wi-Fi):** with Live Server running, open `http://<your-computer-IP>:5500` on the phone. (Install-to-home-screen and offline need HTTPS, so test those after deploying.)

## Deploy free on Cloudflare Pages

**Option A — drag and drop (no Git)**
1. Go to the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Name the project (e.g. `rencana`) and drop the whole `rencana` folder.
3. You get `https://rencana.pages.dev`. To update, upload a new version in the same project.

**Option B — Git (auto-deploy on every push)**
1. Push this folder to a GitHub repo.
2. Cloudflare → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick the repo.
3. Build settings: Framework preset **None**, Build command **(leave empty)**, Build output directory **`/`**.
4. Every `git push` redeploys.

**Option C — command line**
```bash
npx wrangler login
npx wrangler pages deploy . --project-name rencana
```

**Custom domain:** in the Pages project → Custom domains → add your domain.

## Install on a phone
- **iPhone (Safari):** open your `.pages.dev` link → Share → **Add to Home Screen**.
- **Android (Chrome):** open the link → menu ⋮ → **Install app**.

It then opens full-screen with its own icon, like a native app.

## After you change files
Open `sw.js` and bump `const CACHE = 'rencana-v2'` to `'rencana-v3'` (and so on) before deploying, so installed phones pick up the new version.

## Changing the look
Colours live at the top of `styles.css` (`--primary`, `--yellow` …). Categories (names, colours, icons) are in `js/icons.js`. Demo data is in `js/data.js`.

## Next steps (when you're ready)
- **Accounts & sync across devices:** add a backend — e.g. Cloudflare D1 (database) + Pages Functions, or Supabase / Firebase.
- **Live stock & crypto prices:** call a quotes API from a Pages Function so your API key stays secret.
- **Bigger app:** move to Vite + React or SvelteKit once screens multiply; Cloudflare Pages supports both.
