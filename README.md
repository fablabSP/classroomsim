# ClassroomSim 3.0

Classroom role-play practice and Lead Trainer assessment for the CET *Leading and Assessing AI-Enabled Learning Experiences* course.

There are two interfaces:
- **Evaluator.** Whoever starts a session is the first evaluator. Other evaluators join with the 10-character evaluator code. Every evaluator gets the same screens: set up, run the round, deal cards, observe, review and export.
- **Participant.** People join on their phones. Each gets a secret **role card**, dealt face down, that they tap to flip open. During the round, **scenario cards** are dealt to them face down too. Flipping a card open tells the evaluators "I've read it".

It is a web app **hosted on GitHub Pages**, built and published by GitHub itself. Nothing runs on your computer, and nothing is installed on phones: everyone just opens the link (or scans the QR code) in their normal web browser. **Firebase** (free Spark plan, no credit card) is used only as the real-time database, so cards reach phones instantly.

---

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

## Phone alerts and vibration

- **Android:** full vibration for new cards, plus short taps when buttons are pressed.
- **iPhone:** Apple doesn't let websites vibrate. The [web-haptics](https://github.com/lochie/web-haptics) library and others use a trick: tapping a hidden iOS "switch" gives a haptic tick. Since **iOS 26.5**, Apple only gives that tick for a real finger tap. A tap made by code no longer counts ([ios-haptics PR #13](https://github.com/tijnjh/ios-haptics/pull/13), [haptics.kushagragolash.dev](https://haptics.kushagragolash.dev/)). So no website can buzz an iPhone when a card *arrives*. ClassroomSim therefore:
  - puts an invisible switch over every card and quick-log button, so **real taps** (flipping a card open, logging an observation) give a tick on iPhones with iOS 17.4 or later;
  - alerts iPhones about new cards with a **chime, a screen flash and the full-screen card table**. Everyone taps **Turn on alerts** once and keeps the page open.
- The tick is a device feature I could not test here. Try it on an iPhone (Settings → Sounds & Haptics → System Haptics must be on).

## Rules from bugs we fixed
- **Inserting code into a page with `String.replace`:** always pass a function (`.replace(x, () => code)`). A plain string treats `$&`, `$1` etc. inside the code as patterns and silently corrupts it. (This broke the QR code in the demo build.)
- **Helpers used at start-up must be declared above their first use.** A `const` read before its line throws, and if that throw is inside a `try` it fails silently. (This once made the app ignore a saved sign-in.)
- **Anything shared by every phone (like the clock) goes in one shared document**, not copied into each phone's private document. Otherwise every Start or Pause costs one write per participant.
- **Batch background work** (joins, card flips) into one transaction, and let one device do it. Many devices doing it separately leads to slow joins and wasted writes.

## Privacy
- No accounts. Firebase gives each device an anonymous ID.
- Use first names or aliases, and don't enter sensitive personal data.
- See [Security](#security) for evaluator access.
- There is no automatic clean-up on the free plan. Delete old sessions (`sessions/<CODE>`) in the Firestore console each term.
