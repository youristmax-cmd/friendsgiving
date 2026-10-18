# Friendsgiving potluck sign-up

Guests open one link, say who they are, claim a dish, and land on the shared menu.

- **Sign-up:** `https://maxyourist.github.io/friendsgiving/`
- **Menu** (the link for Partiful): `https://maxyourist.github.io/friendsgiving/menu/`

The site is static (GitHub Pages). The Google Sheet is the database, behind a small Apps Script web app.

## One-time setup (about 10 minutes)

### 1. Put the backend in the sheet

1. Open the sign-up sheet → **Extensions → Apps Script**.
2. Delete whatever is in `Code.gs` and paste in all of [`apps-script/Code.gs`](apps-script/Code.gs). Save (⌘S).
3. In the toolbar's function dropdown pick **`setup`** → **Run**. Approve the permissions prompt. Google will warn that the app isn't verified: click **Advanced → Go to … (unsafe)**. It's your own script.
4. The execution log should read something like `Guests: 26 people, 9 couples` and list each couple. The sheet now has three new tabs:
   - **Slots**: one row per dish slot. Carly's and Max's rows are already claimed.
   - **Guests**: the roster. A shared value in `Couple` means two people are partners. Put alternate spellings in `Aliases`, comma-separated.
   - **Log**: every claim, swap and release.

   `Sheet1` stays as it was, as a backup. If a couple came out wrong, fix it in **Guests**.

### 2. Deploy it as a web app

1. **Deploy → New deployment** → gear icon → **Web app**.
2. **Execute as:** Me. **Who has access:** Anyone.
3. **Deploy**, then copy the **Web app URL** (it ends in `/exec`).

### 3. Fill in `config.js`

```js
apiUrl: 'https://script.google.com/macros/s/…/exec',
date: 'Saturday, November 21',
time: '6 PM',
address: '123 Main St, Apt 4',
```

### 4. Publish

1. Create a **public** repo named `friendsgiving` under `maxyourist`, then push:
   ```sh
   git remote add origin https://github.com/maxyourist/friendsgiving.git
   git push -u origin main
   ```
2. In the repo, go to **Settings → Pages → Build and deployment**: Source **Deploy from a branch**, branch **main**, folder **/ (root)**. Save.
3. After a minute or so the links at the top go live. Open the sign-up on your phone, then post the menu link on Partiful.

That's everything. After this, nothing needs touching.

## Using the sheet by hand (optional)

- Any row in **Slots** with a **Name** counts as claimed, whether or not it has a ClaimId. Type a description next to your own dishes and it shows up on the menu within a minute.
- To free a slot, clear its Name, Description, ClaimId, ClaimedAt and Members cells.
- To add a slot, add a row with SlotId, Course (`To Start`, `The Main`, `Sides`, `Sweets` or `Drinks`), Item, Serving Size and Big (`TRUE` steers couples toward it).
- If you rename a claimed row by hand, it now belongs to whoever is named there.

## If you change `Code.gs` later

Paste the new code, then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL stays the same. A "New deployment" would give you a new URL.

## How it behaves

- **Names:** fuzzy matching against the Guests tab runs on the server, so the guest list never reaches anyone's browser. "A and B", "A & B" and "A + B" count as a couple. A name that's not on the list goes through as a single. A name that matches two guests (a shared last name) asks for a full name.
- **Claims:** taken under a lock, so two people can't get the same slot. Whoever loses goes back to the dish list with a note. The same name and dish within 10 seconds counts as one claim, so a double tap is harmless.
- **Coming back:** typing the same name (or a partner's) shows the current dish, with a choice of *see the menu* or *change my dish*. Changing frees the old slot when the new one is claimed.
- **Menu:** refreshes every 45 seconds in place. After a claim, the guest's own dish is highlighted. The same phone keeps the highlight on the bare menu link.

## Local preview

```sh
node dev/server.js           # http://localhost:8080, runs Code.gs against an in-memory copy of the sheet
LATENCY=900 node dev/server.js   # roughly Apps Script speed
```

The local preview builds its fake sheet from `_handoff/`, which is kept out of git because it contains the guest list.
