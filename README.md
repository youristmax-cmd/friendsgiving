# Friendsgiving potluck sign-up

Guests open one link, say who they are, claim a dish, and land on the shared menu.

- **Sign-up:** https://youristmax-cmd.github.io/friendsgiving/
- **Menu** (the link for Partiful): https://youristmax-cmd.github.io/friendsgiving/menu/

## How it's put together

- **Site:** static HTML/CSS/JS on GitHub Pages (`index.html`, `menu/`, `js/`, `css/`). `config.js` holds the API URL and the party's date, time and address.
- **Data:** a Cloudflare Worker (`worker/`) with one Durable Object that stores the dish slots and a log of every claim. A Durable Object handles one request at a time, so two people can never claim the same slot.
- **Guest list:** stored as a Worker secret (`GUESTS`). It is not in this repo and never reaches the browser.

## Changing things

Ask Claude in this folder. For example: "Mark the brisket as smoked brisket with a coffee rub", "free up a dessert slot", "add a third potato slot" or "show me everyone who's signed up". Those go through the host-only admin API, using the key saved in `.admin-key` (kept out of git).

Changing the date, time or address means editing `config.js` and pushing.

## Admin API

```sh
KEY=$(cat .admin-key); API=https://friendsgiving.maxyourist.workers.dev/
curl "$API?action=admin&key=$KEY"                                     # every slot + the claim log
curl -X POST "$API" -d '{"action":"admin","key":"'$KEY'","op":"set","slotId":"brisket","name":"Max","description":"Smoked brisket"}'
curl -X POST "$API" -d '{"action":"admin","key":"'$KEY'","op":"release","slotId":"dessert-2"}'
curl -X POST "$API" -d '{"action":"admin","key":"'$KEY'","op":"add","item":"Potato","course":"Sides","serves":12}'
curl -X POST "$API" -d '{"action":"admin","key":"'$KEY'","op":"remove","slotId":"potato-3"}'
```

A slot that has a name counts as claimed. One set by `set` belongs to whoever it names: typing that name on the sign-up shows it as their dish.

## How it behaves

- **Names:** fuzzy matching runs on the server. "A and B", "A & B" and "A + B" count as a couple. A name that's not on the list goes through as a single. Nobody has to give a last name. A name that fits two guests goes through as typed, with a gentle hint to add more.
- **Claims:** whoever loses a race for the last slot goes back to the dish list with a note. The same name and dish within 10 seconds counts as one claim, so a double tap is harmless.
- **Coming back:** typing the same name (or a partner's) shows the current dish, with a choice of *see the menu* or *change my dish*. Changing frees the old slot when the new one is claimed.
- **Menu:** refreshes every 45 seconds in place. After a claim, the guest's own dish is highlighted. The same phone keeps the highlight on the bare menu link.

## Developing

```sh
cd worker && npm install && npm run dev   # API on :8787 (needs worker/.dev.vars with GUESTS and ADMIN_KEY)
node dev/server.js                        # site on :8080, pointed at :8787
cd worker && npx wrangler deploy          # ship the API
```
