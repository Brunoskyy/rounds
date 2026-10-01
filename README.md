<p align="center">
  <img src="docs/logo.svg" width="76" alt="">
</p>

<h1 align="center">Rounds</h1>

<p align="center">
  Maintenance rounds that work with no signal.<br>
  <sub>React 19 · TypeScript · IndexedDB · service worker · Node 24 · SQLite</sub>
</p>

<br>

A technician walks a plant with a checklist: read the pressure gauge, check
the pump seals, photograph the panel, sign off. That walk is called a round,
hence the name. Boiler rooms have no Wi-Fi, so the app works as if the network
were optional, and loses nothing when two people edit the same round from two
phones. That last part is the project: a sync engine with an outbox, a
three-way merge, and a conflict screen that asks the person instead of letting
a timestamp pick.

<p align="center">
  <img src="docs/screenshots/round.jpg" width="300" alt="A round in progress: a pressure reading flagged outside its range, status buttons per item">
  <img src="docs/screenshots/conflict.jpg" width="300" alt="The sync page showing one item with two versions to choose from">
</p>

## Running it

You need Node 24 (`nvm use` reads the `.nvmrc`). No database to install: the
server keeps a SQLite file in `data/` and seeds two sites on first start.

1. Clone and install:

   ```bash
   git clone https://github.com/Brunoskyy/rounds.git && cd rounds
   nvm use
   npm install
   ```

2. Build and start, from the repo root. One process on port 8788 serves the
   API and the app with its service worker, which is what makes offline work:

   ```bash
   npm run build
   npm start
   ```

3. Open http://localhost:8788, type a name, pick a site, start a round. Then
   switch the network off in devtools, keep working, reload the page, and
   switch it back on. For a conflict, edit the same item from a second browser
   profile while the first one is offline.

Stop with Ctrl+C. To start over, delete the `data/` folder (and the site data
in the browser's devtools).

For development with hot reload, use two terminals from the repo root:
`npm run dev -w server` (API on 8788) and `npm run dev -w web` (app on
http://localhost:5174). The service worker only runs in the built app, so
test offline with step 2.

| Command (repo root) | |
| --- | --- |
| `npm test` | shared, server and client tests |
| `npm run typecheck` | `tsc` per workspace |
| `docker build -t rounds . && docker run -p 8788:8788 -v rounds:/data rounds` | the built app in a container |

## How offline works

- **The service worker** precaches the app shell and never caches `/api`; a
  new version is offered in a banner, never applied under someone's fingers.
- **IndexedDB** holds two copies of every round: the one this device edits and
  the last one the server confirmed. Every edit goes into an outbox.
- **The sync engine** (`web/src/sync/engine.ts`, about 150 lines) drains the
  outbox when online and pulls what changed since the last sync.

## How conflicts work

The server keeps a version per round, and a write names the version it was
made from; the check and the write are one SQL statement, so two devices can't
both win. The loser gets a 409 with the current record and merges three ways:
base (last confirmed), mine and theirs. An item only one side changed is
taken; both sides with the same change is fine; both sides with different
changes is a conflict the person resolves on the sync page, while the rest of
the queue keeps going.

Whole-field last-writer-wins would have been thirty lines shorter. On a
maintenance round, silently turning "issue: seal weeping" into "ok" is the
wrong thirty lines to save.

## Things worth opening

- **`shared/src/merge.ts`:** the three-way merge, pure, with each case in its tests.
- **`web/src/sync/engine.ts`:** push, merge on 409, retry, park, pull.
- **`server/src/store.ts`:** `putRound` is one `UPDATE ... WHERE version = ?`.
- **`web/src/components/ItemRow.tsx`:** sized for a thumb in a glove; a reading
  out of range becomes an issue on its own.

## Tests

35 tests, run with `npm test` from the repo root: the merge and validators as
pure functions, the server over real HTTP including the losing write, and the
client's repo and engine against `fake-indexeddb` and a fake API with an
offline switch (queue offline, survive a reload, merge a clean 409, park a real
conflict, keep an edit made while a push is in flight).

## Layout

```
shared/src/   types, three-way merge, validation
server/src/   SQLite store with versioned writes, HTTP, seed
web/src/      IndexedDB repo and outbox, sync engine, screens
```

## What's missing

- No accounts: the name typed on first launch is the technician.
- No background sync with the app closed; it syncs whenever it is open and online.
- Checklists are seeded, not editable.
