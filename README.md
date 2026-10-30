# Jon Pocket — Budget Tracker (web app)

A mobile-first budget tracker (purple template style) that runs in the browser and can be installed on a phone's home screen like a native app (PWA). Plain HTML, CSS and JavaScript — **no build step, no dependencies**.

## What works

| Tab | Features |
|---|---|
| **Home** | Get-started checklist for new users, purple card with total balance (sum of all pockets) and this month's income / expenses, Pockets row (Bank Jago, BCA, GoPay, OVO + your own) with each balance, "Spent this month" card with 3 swipeable slides (budget progress, spending pace chart vs budget, spending by category donut), goals progress, recent transactions |
| **Transactions** | Search, round category filters (All, Income, Recurring, Food, Transport…), grouped by day, "View Details" to edit or delete, import / export CSV, delete all data, change your name |
| **Monthly cycle** | A "month" runs from your payday (default the 25th: 25 Oct – 24 Nov). Change it in the data sheet → "Month starts on". Used by Home, budgets, Stats and the 50/30/20 check. |
| **Sign-in page** | Shown before entering the app on the live site: sign in or create an account. Each account's data is private. |
| **Account** (tap the logo, or Transactions → sliders) | Cloud sync status, sync now, sign out |
| **+ (centre)** | Add income, expense, or a transfer between pockets (e.g. BCA → GoPay top-up, not counted as spending) |
| **Pockets** | Add / edit / delete bank accounts, e-wallets and cash, set the current balance, see in/out per month and filter transactions by pocket |
| **Stats** | Weekly saved banner, Weekly / Monthly / Yearly spending chart, income vs expense, Categories / Top Spending / Top Income |
| **Plan** | Budgets (ring, daily allowance, per-category limits, recurring payments with Mark / Unmark), Goals (saved in a pocket, optionally following that pocket's balance; add money with an optional transfer between pockets; 50/30/20 check; savings calculator), Portfolio (coming soon) |

Data is always saved on the device first (`localStorage`), so the app works offline. When you sign in, it also syncs to your account in the cloud (Cloudflare D1) and merges changes from your other devices.

## Project structure

```
rencana/
├── index.html             App shell: top bar, tab bar, bottom sheet
├── styles.css             All styles (colours/tokens at the top)
├── js/
│   ├── app.js             Pages, sheets, events, routing (#/home, #/activity, #/stats, #/plan)
│   ├── data.js            Saving/loading (starts empty)
│   ├── format.js          Rupiah formatting, dates, escaping
│   └── icons.js           Categories and line icons
├── manifest.webmanifest   Makes it installable
├── sw.js                  Offline support (service worker)
├── icons/                 App icons (svg + png)
├── _headers               Cloudflare Pages headers
├── functions/api/         Server (Cloudflare Pages Functions)
│   ├── _middleware.js     Database check, origin check, session lookup
│   ├── signup.js login.js logout.js me.js
│   └── state.js           Load / save your data (versioned)
└── server/lib.js          Password hashing, sessions, database tables
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

## Cloud sync setup (one time)

The server code deploys automatically with the site. It just needs a database:

1. Cloudflare dashboard → **Storage & databases** → **D1 SQL database** → **Create**. Name it `jon-pocket` → **Create**.
2. **Workers & Pages** → your project (`financial-planner-app`) → **Settings** → **Bindings** → **Add** → **D1 database**.
   - Variable name: **`DB`** (exactly, in capitals)
   - D1 database: **jon-pocket** → **Save**
3. **Deployments** → latest deployment → **⋯** → **Retry deployment** (bindings only apply to new deployments).
4. Open the site → tap the logo → **Sign in or create account**.

The tables are created automatically on first use.

**Optional: lock sign-ups.** Settings → **Variables and secrets** → **Add** → type *Secret*, name `SIGNUP_CODE`, value of your choice → redeploy. New accounts then need that invite code.

**Run with the server locally:**
```bash
npx wrangler pages dev . --d1 DB=jon-pocket-local
```
(Live Server works too: without the server it skips the sign-in page and saves on the device only.)

**How syncing works:** every change is saved on the device, then uploaded about a second later. Each transaction and goal carries an edit time, so if two devices change things at the same time the app merges them item by item (newest edit wins, deletions are kept). Each account only ever reads and writes its own data. Signing out clears the device, and if a different account signs in on the same device, anything left from the previous account is removed first. Passwords are hashed (PBKDF2), sessions use an HttpOnly cookie for 90 days, and repeated wrong passwords are blocked for 15 minutes.

## Install on a phone
- **iPhone (Safari):** open your `.pages.dev` link → Share → **Add to Home Screen**.
- **Android (Chrome):** open the link → menu ⋮ → **Install app**.

It then opens full-screen with its own icon, like a native app.

## After you change files
Open `sw.js` and bump `const CACHE = 'rencana-v11'` to `'rencana-v12'` (and so on) before deploying, so installed phones pick up the new version.

## Changing the look
Colours live at the top of `styles.css` (`--primary`, `--yellow` …). Categories (names, colours, icons) are in `js/icons.js`. Saving and loading is in `js/data.js`.

## Next steps (when you're ready)
- **Bank email sync:** forward bank emails to a Cloudflare Email Worker that adds transactions to your account.
- **Live stock & crypto prices:** call a quotes API from a Pages Function so your API key stays secret.
- **Bigger app:** move to Vite + React or SvelteKit once screens multiply; Cloudflare Pages supports both.

## iPhone Shortcut (add transactions without opening the app)
In the app: tap your avatar → **iPhone Shortcut** → **Create Shortcut key**. The steps are shown there.

The Shortcut calls:

```
POST /api/quick-add
Authorization: Bearer <your key>
Content-Type: application/json
{ "type": "expense", "amount": 35000, "name": "Kopi", "category": "Food", "pocket": "GoPay" }
```

Only `amount` is required (`type` defaults to expense, `pocket` to BCA, `category` to Other). `amount` can also be `"35.000"`, `"35k"` or `"2jt"`. `GET /api/quick-add` with the same header returns your category and pocket names. Keys are stored hashed; making a new key or tapping **Turn off** disables the old one.
