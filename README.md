# ClassroomSim 3.7

Classroom role-play practice and Lead Trainer assessment for the CET *Leading and Assessing AI-Enabled Learning Experiences* course.

There are two interfaces:
- **Evaluator.** Whoever starts a session is the first evaluator. Other evaluators join with the 10-character evaluator code. Every evaluator gets the same screens: set up, run the round, deal cards, observe, review and export.
- **Participant.** People join on their phones. Each gets a secret **role card**, dealt face down, that they tap to flip open. During the round, **scenario cards** are dealt to them face down too. Flipping a card open tells the evaluators "I've read it".

It is a web app **hosted on GitHub Pages**, built and published by GitHub itself. Nothing runs on your computer, and nothing is installed on phones: everyone just opens the link (or scans the QR code) in their normal web browser. **Firebase** (free Spark plan, no credit card) is used only as the real-time database, so cards reach phones instantly.

---

## What's new in 3.7.1
- Updated card art: scenario icons now match the role icons of the same colour (✕ red, ✋ yellow, ? blue, ! black, ✓ green), and the Support Trainer card is named to match the app.
- Card images carry the app version in their link, so phones load new art straight after an update instead of a cached copy.

## What's new in 3.7
- **New card artwork.** Every role, trainer and scenario card now uses the illustrated SDKit-style designs, with the three new backs (Role, Trainer, Scenario). Text sits in each card's white panel, which grows downwards when a card has more text.

## What's new in 3.6
- **Pop-ups no longer close by accident** when you drag across text (e.g. to select it) and let go on the dark background.
- **PDF reports.** Records → *This session (PDF)* or *All my sessions*. Course admin → *PDF report* for one session or *PDF of all sessions*. Each PDF has a summary of every round, then each round's score card result, scores, feedback, card ratings, notes and change history.
- **Automatic score card.** Review → Outcome shows which rubric areas meet the standard and suggests Competent or Not yet competent. The course admin sets the rules. Evaluators and the admin can override it with a reason, and every change is in the change history.
- **Course scenario cards from CSV.** Course admin → Scenario cards → Upload CSV. They are added to every session's deck.
- **Better admin search.** Search by evaluator name and date (e.g. `koh`, `6 Nov`, `2026-11-06`, `06/11/2026`) as well as code, cohort and topic.

## What's new in 3.5
- **Card deck for evaluators.** Tap 🂠 in the top bar (or Records → Card deck) to see every role, trainer and scenario card, filter by type and colour, and flip between fronts and backs.
- **Course admin view.** One read-only screen for every session in the database: all evaluators' scores, notes, card ratings, feedback, change history, plus a table of every assessment and a raw view of every stored document. Protected by an admin passcode (setup step 5c).

## What's new in 3.4

- **Participants leave automatically after 1 hour.** Evaluators keep access to everything. See [Participant time limit](#participant-time-limit).

## What's new in 3.3

- **Better alerts on iPhones** (which can't be vibrated by websites): the screen pulses yellow and a chime repeats until the card is opened, with an Off/Soft/Loud setting. Evaluators get a **🔔 Nudge** button for cards not yet flipped. See [Phone alerts and vibration](#phone-alerts-and-vibration).

## What's new in 3.2

- **Evaluator access locked down.** The evaluator code is now 10 characters (about 800 trillion combinations) instead of a 6-digit PIN, so it cannot be guessed by trying them all. Optional course-wide **start passcode** so only your evaluators can start sessions. Only the evaluator who started a session can change the code or remove evaluators, and removing someone changes the code automatically. Every assessment save is kept in a **change history**. See [Security](#security).
- **Tap haptics on iPhone.** Flipping a card and tapping quick-log buttons gives a haptic tick on iPhones (and a short vibration on Android). See [Phone alerts and vibration](#phone-alerts-and-vibration).

## What's new in 3.1

- **Join QR pops up as soon as a session is created**, ready for the projector, with a live "joined" count. A **QR** button in the top bar brings it back from any screen. The evaluator code is never shown on the projector.
- **Big classes:** deal **1, 2 or 3 of each colour** role card (up to 15 colour cards). The app suggests a number from the class size. Up to **80 participants** per session.
- **Several classes:** each session has its own code and runs independently. Evaluators see **"Your sessions on this device"** and can switch between classes, or start another, without closing anything.
- **Faster and lighter:** a whole class scanning at once is let in as one batch. One evaluator device does the background work, with the others as automatic backup. Starting or pausing a round updates one shared clock instead of every phone's card.

## What's new in 3.0

| | |
|---|---|
| **Look and feel** | Complete redesign as a "printed classroom kit": grid-paper background, chunky outlined pieces, a scoreboard timer, and the Atkinson Hyperlegible typeface (made for low-vision readers) for easy reading from age 20 to 60. |
| **Flip cards** | Playing-card-shaped Role, Trainer and Scenario cards, dealt face down with a patterned back and flipped open in 3D with a tap. New scenario cards arrive on a full-screen table so they can't be missed, and a card can be turned face down again so neighbours can't peek. |
| **Two interfaces** | Evaluator and participant. All evaluators share the same screens and controls. |
| **GitHub + Firebase** | Hosted free on GitHub Pages, real-time data on Firebase. Anonymous sign-in, so no accounts. Runs in any phone browser, with nothing to install. |
| **Card preview** | Before dealing a scenario card, the evaluator sees exactly the card the learner will get. |

All earlier features are kept: guided setup with "What to do now", automatic or manual dealing, one-tap quick-log with flag-then-label, timestamps on every note, scenario ratings, Review checklist with "Draft from notes", round history, printable report, and CSV/JSON export.

---

## How it works

```
 Participant phones                 Firebase (Firestore)               Evaluator devices
 ───────────────────               ─────────────────────              ─────────────────────
 people/{me}  ── join, "flipped" ─▶                ◀─ listen ───────  run the session rules
 views/{me}   ◀─ my cards only ───  views/{uid}     ── transactions ─▶ (any open evaluator
                                    engine/state  (evaluators only)    device keeps timed
                                    secret/pin    (evaluators only)    cards going)

            The web page itself comes from GitHub Pages: https://<you>.github.io/<repo>/
```

- `firestore.rules` makes sure a participant can only read **their own** cards. Only evaluators can read the full session or the evaluator code.
- The free Firebase plan has no server code, so the evaluators' browsers run the session. Every change is a Firestore **transaction**, so two evaluators tapping at once never overwrite each other.
- **Keep at least one evaluator screen open during a round.** Timed scenario cards are dealt by whichever evaluator device is open. If all evaluator screens close, the timeline waits until one comes back (the timer still counts).
- Someone who joins mid-round waits and is let in when the next round starts.

**How many classes and people?** Each session is separate, so several classes can run at the same time. Up to 80 participants per session.

**Free limits.** Firebase Spark ([pricing](https://firebase.google.com/pricing?hl=id)) allows 50,000 reads and 20,000 writes a day, with 1 GiB stored. The load test (`tests/scale.test.js`) runs 3 classes of 40 at once, with 2 evaluators each, all scanning the QR at the same moment. One round used about 160 writes and 480 reads per class. A full class of 40 (6 rounds, active note-taking) comes to roughly 1,500 to 2,000 writes and 4,000 to 5,000 reads, so **about 8 to 10 classes of 40 a day** fit in the free limits. The limits reset every day. If you outgrow them, switching the Firebase project to the pay-as-you-go Blaze plan needs no code changes (it is billed per use, typically cents per class). GitHub Pages is free for **public** repositories. A private repository needs a paid GitHub plan for Pages. The code contains no secrets, so a public repository is fine.

---

## Set it up (about 20 minutes, all in your web browser)

### Part A: Firebase (the database)
1. Go to the [Firebase console](https://console.firebase.google.com) → **Create a project** (Google Analytics is not needed).
2. **Build → Firestore Database → Create database** → *Start in production mode* → location **asia-southeast1 (Singapore)**.
3. Still in Firestore, open the **Rules** tab. Delete what is there, paste in the whole of `firestore.rules` from this folder, then click **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable → Save**.
5. **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.
5b. **Recommended: set a start passcode** so only your evaluators can start sessions. In **Firestore Database → Data**: **Start collection** `config` → Document ID `access` → add a field `startCode` (string) = a passcode you choose, e.g. `FabLab-Eval-2026`. Give it only to your evaluators. To change it later, edit that field. To turn it off, delete the `access` document.
5c. **Optional: turn on the course admin view.** In **Firestore Database → Data**, inside the `config` collection add a document `admin` with a field `code` (string) = a long admin passcode, at least 16 characters and different from the start passcode (e.g. four random words plus a number). Then anyone with that passcode can open **Evaluator → Course admin** (or **Records → Course admin view**) and read every session. Admins can read everything, and can change only round results (with a reason), the score card rules and the course scenario cards. Changing the `code` field signs every admin out on every device at once. Delete the `admin` document to switch the feature off.
6. **Project settings** (gear icon) → **Your apps** → click the web icon `</>` → give it a nickname → **Register app**. Keep the `firebaseConfig` box open: you need it in Part B.

### Part B: GitHub (the website)
1. On GitHub: **New repository** → name it e.g. `classroomsim` → **Public** → Create.
2. **Add file → Upload files** → drag in everything from the unzipped `ClassroomSim_v3` folder → **Commit changes**.
   - Check the repository now has a `.github/workflows/deploy.yml` file. Some computers hide folders that start with a dot, so it can get left out. If it is missing: **Add file → Create new file**, type `.github/workflows/deploy.yml` as the name, paste in that file's contents, and commit.
3. Open `public/config.js` in GitHub and click the ✏️ pencil. Select the example `const firebaseConfig = { ... };` block and paste the `firebaseConfig` block from Firebase (Part A, step 6) over it. Pasting the whole Firebase snippet, import lines included, is fine too. **Commit changes**.
   - After any change, wait for the green tick in the **Actions** tab, then reload the app. Phones may keep the old file for up to 10 minutes. If the app shows **Can't connect yet**, it now says exactly which step is missing.
4. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
5. Open the **Actions** tab. The "Publish to GitHub Pages" run starts by itself after each commit (or click **Run workflow**). When it shows a green tick, your app is live at
   **`https://<your-github-username>.github.io/classroomsim/`**

That's it. Every later change you commit (for example new scenario cards in `src/scenarios.js`) is tested, built and published automatically.

**Updating the security rules later:** paste the new `firestore.rules` into the Firestore Rules tab again. Or, to publish them from GitHub too, add two repository secrets (**Settings → Secrets and variables → Actions**): `FIREBASE_PROJECT_ID` (your project ID) and `FIREBASE_SERVICE_ACCOUNT` (Firebase → Project settings → Service accounts → Generate new private key, then paste the whole file).

---

## Running a class
1. Open the link on the laptop or tablet. Choose **Evaluator → Start a session**. The join QR pops up straight away: put it on the projector and watch the joined count go up. (The **QR** button in the top bar shows it again any time.)
2. Participants scan, type their name, and tap **Turn on alerts**.
3. Other evaluators: send them **Copy private evaluator invite** (Set up → Evaluators), or they choose **Evaluator → Join with evaluator code** and type the 10-character code.
4. Follow **What to do now**: choose trainers → pick **how many of each colour** (the app suggests one for your class size) → **Deal role cards** → choose automatic or manual dealing → **Start**.
   Running another class? ⚙ Settings → **Switch to another session or start a new one**. The first class keeps running.
5. **Run:** set the lesson moment, pick a learner, pick a card, check the preview, **Deal this card**. That phone shakes and the card lands face down.
6. **Observe:** tap quick-log items, **⚑ Flag** then tap what it was, and rate each card.
7. **Review:** fill flagged moments → **Draft from notes** → edit → scores and outcome → **Save**. Then **Next round** (trainers rotate).
8. **Records:** printable report and CSV/JSON export.

**Phone alerts:** see [Phone alerts and vibration](#phone-alerts-and-vibration).

---

## Files
- `src/pdf.js` builds the PDF report (bundled to `public/pdf.js`, loaded only when needed).
| Path | What it is |
|---|---|
| `src/scenarios.js`, `src/quicktags.js` | Scenario cards and quick-log items (edit these to customise) |
| `src/logic.js` | Session rules (roles, timeline, ratings, exports) |
| `src/engine.js` | Runs a session on Firestore (evaluator and participant sides) |
| `src/store-firebase.js` | Firestore + anonymous sign-in |
| `src/store-memory.js` | In-memory database with the same rules, for tests and the demo |
| `src/app.js` | The interface |
| `public/` | The website GitHub Pages publishes (`app.js` is built from `src/` by GitHub) |
| `firestore.rules` | Who can read and write what |
| `demo/ClassroomSim_demo.html` | Single-file demo of all three screens (no Firebase needed) |

The rubric areas and the 1–4 scale are a **draft**. Map them to the course's approved criteria before formal use.

## Testing
GitHub runs `npm test` (the logic and engine tests) on every commit and won't publish if they fail. Those tests use an in-memory database that enforces the same rules as `firestore.rules`. If you ever want to test the real rules file against Google's emulator (on a computer with Node.js and Java): `npm install && npm run test:rules`.

## Security

**What participants can and cannot do.** The database rules are the real lock, because they run on Google's servers, not in the app.
- A participant can only write to **their own** join record (name, "I flipped it", "a trainer came to me"). Even those taps only count for cards dealt to them, and the record is size-limited so it can't be flooded.
- A participant **cannot read** anyone else's cards, the session's results, notes, scores, the evaluator code or the course settings, and **cannot write** to any of them. This is covered by the automated tests (`tests/engine.test.js`) and the emulator test (`tests/rules.test.js`).
- So the only way to change results is to become an evaluator. That is guarded by:

| Lock | What it stops |
|---|---|
| **10-character evaluator code** (`XXXX-XXXX-XX`) | Guessing. A 6-digit PIN could be brute-forced by a script; this cannot. |
| **Start passcode** (optional, set in `config/access`) | Participants starting their own "evaluator" sessions. |
| **Owner-only controls** | Only the evaluator who started the session can change the code or remove evaluators (enforced by the rules). |
| **Removing an evaluator changes the code** | A removed person rejoining with the old code. They are also signed out of that session immediately. |
| **Change history** on every assessment save | Results being quietly changed: every save shows who, when and the outcome (Review → Outcome → Change history, and in the exports). |

**Good practice:** send the evaluator code privately (use **Copy private evaluator invite**). Never show it on the projector (the join QR screen never does) or post it in a class chat. If it leaks, the session owner taps **New code**.

**Limits to know about.** Sign-in is anonymous (no school accounts), so anyone who *has* the evaluator code is trusted as an evaluator, and evaluators share one session record, so one evaluator could in principle edit another's notes. The change history makes that visible. For formal, high-stakes assessment, the next step up would be signing evaluators in with school Microsoft or Google accounts. Firebase supports that, and I can add it if you want it.

## Participant time limit

Each session is open to **participants for 1 hour** from when it is created. **Evaluators are never time-limited**, so Review, Records, the printable report and exports stay available, also from "Your sessions on this device".

**How it works:**
1. **The session stores a closing time** (`participantsUntil`), 1 hour after it is created.
2. **Phones leave by themselves.** Each participant's phone shows "open until 3:45 pm", warns them 5 minutes before, and at that time disconnects, removes itself from the session and shows "This session has ended".
3. **The database enforces it.** `firestore.rules` compares Google's own server clock with the closing time. After it, a participant's phone **cannot read its cards, send anything, or join**, even if someone keeps the page open or tampers with the app. Evaluator access is checked separately and has no time limit.

**Evaluator controls** (top of Set up and Run): **+30 min** if the class runs long, **Close now** to send all participant phones out straight away, and **Reopen for 30 min** after closing. Participants can then rejoin by scanning the QR again, and their earlier answers and history are kept.

To change the default of 60 minutes, edit `PARTICIPANT_MINUTES` in `src/logic.js`.

## Phone alerts and vibration

- **Android:** full vibration for new cards, plus short taps when buttons are pressed.
- **iPhone:** Apple doesn't let websites vibrate. The [web-haptics](https://github.com/lochie/web-haptics) library and others use a trick: tapping a hidden iOS "switch" gives a haptic tick. Since **iOS 26.5**, Apple only gives that tick for a real finger tap. A tap made by code no longer counts ([ios-haptics PR #13](https://github.com/tijnjh/ios-haptics/pull/13), [haptics.kushagragolash.dev](https://haptics.kushagragolash.dev/)). So no website can buzz an iPhone when a card *arrives*. ClassroomSim therefore:
  - puts an invisible switch over every card and quick-log button, so **real taps** (flipping a card open, logging an observation) give a tick on iPhones with iOS 17.4 or later;
  - alerts iPhones about new cards in other ways (all of this works on Android too):
    - the **whole screen pulses yellow** until the card is flipped open (visible with the phone face up on the desk; the screen is kept awake);
    - a **chime repeats every 5 seconds** until the card is opened (up to a minute). Choose **Off / Soft / Loud** in ⚙ Settings; Soft is the default because a loud chime can give a role away;
    - if the person switches away and comes back while a card is waiting, it alerts **straight away**;
    - evaluators see **"not flipped yet"** on each card in play and can tap **🔔 Nudge** to alert that phone again;
    - after turning on alerts, iPhone users see short tips and a **Test my alert** button.
  - Everyone taps **Turn on alerts** once and keeps the page open. A locked phone can't receive anything from a website; the alert plays as soon as it is unlocked.
- The tick is a device feature I could not test here. Try it on an iPhone (Settings → Sounds & Haptics → System Haptics must be on).

## Course admin view
- **What admins can change:** a round's result (override, with a reason), the score card rules and the course scenario cards. Nothing else: they cannot edit scores, notes, evaluators or participants.
- **What admins see:** every session (newest first, searchable), each session's evaluators, participants, rounds, scores, Lead and Support feedback, scenario card ratings and who rated them, observation notes and who wrote them, the change history of every saved result, the event log, the evaluator code, and every raw database document. The **All assessments** tab puts every round from every session in one table with a CSV download.
- **How it is protected:** the passcode lives in `config/admin`, which the app can never read. Signing in writes a proof document (`admins/{device id}`) that the database rules only accept if it matches. On every read the rules check the proof still matches, so changing the passcode cuts everyone off immediately. Admins have no write access to any session.
- **Cost:** opening the list reads about 50 documents. Opening one session reads every document in it (about 2 per participant). Loading **All assessments** reads about 3 documents per session. Well within the free 50,000 reads a day.

## Automatic score card
- Default rule: **Competent when at least 4 of 6 areas score 3 or higher and no area scores below 2.** Not seen does not count towards the 4.
- Course admin → **Score card rules** lets you change the score that meets the standard (2, 3 or 4), how many areas need it (1 to 6), the floor (none, 2 or 3) and any must-pass areas.
- Each saved round keeps the rule it was graded with, so changing the rules later doesn't silently change past results. Saving that round again regrades it with the current rules.
- **Override:** on Review, pick Competent or Not yet competent instead of *Use automatic*. A reason is required. The admin can do the same from the session page (shown as "Name (admin)" in the history). Picking *Use automatic* again goes back to the score card result.
- The PDF shows the final result, how it was decided (Automatic, By hand or Override), the score card result and the override reason.

## Scenario cards from CSV (course admin)
1. Course admin → **Scenario cards** → **CSV template**. Open it in Excel and add one card per row.
2. Columns: `id, colour, title, instruction, if_approached_say, recovery, phase, difficulty, objective, context`. Only colour, title and instruction are required. Leave id blank to number cards automatically (X01, X02…).
3. Save as CSV, then **Upload CSV**. You get a preview with any bad rows listed. Choose *Add to existing* or *Replace all*, then **Save these cards**.
4. Evaluator screens pick the cards up the next time they open a session. Cards that were already dealt stay in the records unchanged.

## Card artwork
- Source images live in `art/source/` (one PNG per card, named like `role-red.png`, `scenario-blue.png`, `trainer-lead.png`, `back-role.png`).
- To change a design: replace the PNG (keep the name and the white text panel), then run `python3 scripts/cards.py` and commit. The script trims the white surround, measures the white panel, and writes `public/cards/*.webp` plus `src/card-art.js`.
- Fronts: the card picture and header are shown as-is; the white panel stretches if the text is long, so nothing is cut off.
- Backs: the frame is drawn in the colours taken from your design and your emblem is placed in the middle, so a back always matches its front's height when it flips.
- Custom scenario cards (from an evaluator or CSV) use the scenario front of their colour.
- About 340 KB in total. A phone only downloads the images for the cards it actually shows.

## The cards
| Type | Cards | Notes |
|---|---|---|
| Role cards (6) | Red: Disengaged learner · Yellow: Over-keen learner · Blue: Struggling learner · Black: Disruptive learner · Green: Engaged learner · Grey: Regular learner | Faces in `src/app.js` (`ROLE`), colours in `public/styles.css` (`--r-*`) |
| Trainer cards (2) | Lead Trainer · Support Trainer | |
| Scenario cards (20) | 4 per colour, IDs R01–R04, Y01–Y04, B01–B04, K01–K04 (black), G01–G04 | Text in `src/scenarios.js`; evaluators can add custom ones per session |

There are 3 card backs (role, scenario, trainer). Backs are the same for every colour on purpose: if they differed, people could tell each other's secret role from across the room.

## Rules from bugs we fixed
- **Inserting code into a page with `String.replace`:** always pass a function (`.replace(x, () => code)`). A plain string treats `$&`, `$1` etc. inside the code as patterns and silently corrupts it. (This broke the QR code in the demo build.)
- **Helpers used at start-up must be declared above their first use.** A `const` read before its line throws, and if that throw is inside a `try` it fails silently. (This once made the app ignore a saved sign-in.)
- **Anything shared by every phone (like the clock) goes in one shared document**, not copied into each phone's private document. Otherwise every Start or Pause costs one write per participant.
- **A pop-up's background only closes on a real tap:** the press and the release must both be on the background, with no text selected. A click event fires on the common parent when you press inside and release outside, which used to close the pop-up while someone was selecting text.
- **For packages with both CommonJS and ES builds, import the ES build when you need the default export** (`jspdf-autotable/es`). Bundling the CommonJS one gave `default is not a function` only when a PDF was made.
- **Put a version stamp on image links that can change** (`cards/x.webp?v=3.7.1`). Otherwise phones keep showing the old picture from their cache after you upload new art.
- **Never reuse a short class name for two things.** The page's "‹ Back" link style (`.back`) also matched card backs (`.face.back`), underlining the name on every card back. Scope shared names, e.g. `.face.back`, `button.back`.
- **Card art shadows go on their own layer, not a `filter` on the card face.** A filter on a 3D-flipped face can flatten the flip on iOS, and a shadow drawn behind with `z-index:-1` still paints over the face's own background, so both the art and its shadow are pseudo-elements behind the text.
- **Load heavy, rarely used code on demand** (the PDF maker is its own `pdf.js`, fetched the first time someone downloads a report), so participants' phones never download it.
- **Batch background work** (joins, card flips) into one transaction, and let one device do it. Many devices doing it separately leads to slow joins and wasted writes.

## Privacy
- No accounts. Firebase gives each device an anonymous ID.
- Use first names or aliases, and don't enter sensitive personal data.
- See [Security](#security) for evaluator access.
- There is no automatic clean-up on the free plan. Delete old sessions (`sessions/<CODE>`) in the Firestore console each term.
