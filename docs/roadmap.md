# Community dictionary — roadmap

> **Status**: 2026-11-20 — Phase 1 built; Phase 3 first slice live (search, form with validation, explanation, Pages deploy); Phase 2 and the rest of Phase 3 pending.

## Goal

A git-based community dictionary of Taiwanese words, collected from speakers who are not developers. A contributor signs in with a GitHub account, fills in one form, and presses **Submit**; a pull request is opened for them and the maintainer reviews it. The contributor never sees a fork, a branch or a pull request form.

The site is independent of TaigiKeyboard. The collected words will be imported into TaigiKeyboard as a dictionary source (maintainer 2026-11-25); the import itself is not planned in this roadmap.

## Decisions

Maintainer decisions, 2026-11-20 unless dated otherwise:

| # | Decision |
|---|---|
| D1 | Repository `taigikeyboard/community-dictionary`, site at `taigikeyboard.tw/community-dictionary/`, styled like `taigikeyboard.tw/kautian-mirror/`. Data, site and Worker live in this one repository. |
| D2 | Replaces the paused accent-variation contribution plan in the TaigiKeyboard repository; accent variation is one kind of entry here. |
| D3 | No categories (2026-11-20, replacing an earlier list of 腔口差 / 台語新詞 / 一般詞目補充 / 其他): one form holds all fields, and only Tâi-lô is required. An accent variation fills the accents, a new word the meaning (where it was heard goes in the note), a missing word only Hanji and Tâi-lô. |
| D4 | Contributed data is CC0. No consent checkbox (maintainer 2026-11-20); the CC0 terms must still reach contributors another way before Phase 2 opens submissions (sign-in screen or PR body). |
| D5 | A GitHub account is required for every submission (2026-11-12). No anonymous path. |
| D6 | Submit path = Cloudflare Worker + GitHub sign-in (2026-11-12): contributors are speakers, not developers. |
| D7 | The contributor is the commit author (`<id>+<login>@users.noreply.github.com`), so the account appears in the repository's Contributors. Pull requests are merged with a merge commit or rebase, never squash (2026-11-12). |
| D8 | Romanization is Tâi-lô only and is reviewed by hand; the maintainer's merge is the only gate on its correctness. Automated checks cover format and duplicates (2026-11-12). |

| D9 | One JSON file per entry, in one directory per contributor (about 30 contributors expected). |
| D10 | Entry identity = (Hanji, Tâi-lô); accents, meaning and the rest are fields. Different contributors may each submit the same pair — the second is an attestation, not a duplicate. The same contributor cannot submit a pair twice. |
| D11 | A contributor can edit and withdraw their own entries, in the first version. Both go through a pull request and review like a new entry. |
| D12 | (Withdrawn 2026-11-20.) A multiple-choice 腔口差 kind (語音差異 / 詞彙差異 / 其他) was added and then removed the same day; categories were later removed altogether (D3). |

Defaults chosen by the plan (not yet confirmed by the maintainer):

- **A dedicated GitHub App**, installed on this repository only.
- **No database** — caps are counted from open pull requests.
- **Code licence** and **repository visibility**: open.

## Architecture

```
browser (GitHub Pages, static)            Cloudflare Worker                 GitHub
──────────────────────────────            ─────────────────                 ──────
"Sign in with GitHub"  ───────────────▶  /login  ── redirect ───────────▶  authorize
                                          /callback ◀── code ─────────────
                                            exchange code (client secret)
                                            GET /user → id, login
                       ◀── session ─────    signed session (id, login)
form → POST /submit    ───────────────▶    validate (shared module)
                                            duplicate + ownership check
                                            mint installation token
                                            create branch, commit, PR  ───▶  pull request
                       ◀── PR URL ──────
```

- **Sign-in** uses the GitHub App's user authorization (web application flow with `state` and PKCE `S256`). A GitHub App user token carries no scopes, so the consent screen only asks to verify the account. The token exchange needs the client secret, which is why a Worker exists at all. The Worker reads `id` and `login` once and discards the user token; it keeps no refresh token.
- **Writing** uses the App's installation token, never the user's token: create a branch ref, then `PUT /repos/{owner}/{repo}/contents/{path}` with `branch`, `author` (the contributor's noreply identity) and `committer` (the App), then open the pull request. The App needs `contents: write` and `pull_requests: write` on this repository and nothing else.
- **Session** is a short-lived value signed by the Worker (HMAC). Cookie versus bearer header is decided in Phase 2; either way `/submit` checks the `Origin` header.
- **No database.** Rate limits are derived from GitHub state: a cap on open submission pull requests per contributor and in total, counted by branch prefix.
- **Secrets** (Worker only): App private key (PKCS#8 for WebCrypto), client secret, session signing key.

Verified against GitHub documentation on 2026-11-20: "Generating a user access token for a GitHub App" (authorize parameters, PKCE, empty `scope`) and "Create or update file contents" (`branch`, `author`, `committer`). Re-verify, and verify the Cloudflare Workers APIs used, when Phase 2 starts.

## Data model

One JSON file per entry: `entries/<login>/<key>.json`. `<login>` is the contributor's GitHub login when the entry was first submitted; `<key>` is the first 16 hex characters of SHA-256 over `hanji + "\n" + tl` after normalization (NFC, lowercase Tâi-lô, spaces to hyphens).

```json
{
  "hanji": "八",
  "tl": "pueh",
  "accents": ["鹿港偏泉腔"],
  "tags": ["食食"],
  "place": "",
  "meaning": "",
  "example": "",
  "note": "…the contributor's explanation…",
  "contributor": "octocat",
  "contributor_id": 583231,
  "submitted": "2026-11-20"
}
```

Ownership is `contributor_id`, never the directory name: a contributor who renames their account keeps editing their old entries, and new entries go to a directory under the new login.

| Field | Required | Notes |
|---|---|---|
| `tl` | yes | Tâi-lô |
| `hanji` | no | Hanji or kana; empty when the word has no Hanji |
| `accents`, `place` | no; `place` when `accents` has 其他 | the ten accents used by the Ministry of Education dictionary, or 其他 with a place name |
| `tags` | no | up to 5 semantic tags (maintainer 2026-11-21): the site's list (`site/tags.js`) or the contributor's own, each ≤ 10 characters in the Hanji field's script; whether an own tag is good Taiwanese is checked at review, as with Tâi-lô (D8) |
| `meaning` | no | Mandarin or English equivalent (no separate source field since 2026-11-20: where the word was seen goes in `note`) |
| `example` | no | An example sentence (maintainer 2026-11-20) |
| `note` | no | the contributor's explanation |

Why one file per entry, one directory per contributor:

- Two open pull requests never touch the same file, so submissions never conflict and need no rebase job.
- A contributor's whole contribution is one directory: easy to browse, adopt or exclude as a unit.
- Two contributors attesting the same pair each keep their own file (D10).
- A review shows one small file with named fields.

Duplicate rules (D10), checked by listing the repository tree and the open submission branches for `<key>`:

| Same `<key>` found | Result |
|---|---|
| under the same `contributor_id` | rejected: "already submitted" — edit it instead |
| under other contributors only | accepted; the form first shows who submitted it and asks for a different accent or an added note |

A build step compiles `entries/` into one CSV and the site's search JSON, merging files with the same key into one row that lists every attesting contributor; the compiled files are build output, not tracked.

### Edit and withdraw (D11)

| Action | Pull request contains |
|---|---|
| Edit, pair unchanged | the same file, modified |
| Edit, Hanji or Tâi-lô changed | new file under the new key + deletion of the old file; duplicate rules run again |
| Edit while the first pull request is still open | one more commit on that pull request's branch |
| Withdraw | deletion of the file |

A withdrawn entry leaves the current data; it stays in git history and its CC0 dedication is not revoked. The explanation page says so.

## Phases

One pull request per phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | This roadmap, README, licences | In progress |
| 1 | Entry schema; one validation module (field limits, character whitelists, normalization, key) used by the site, the Worker and CI; CI job that validates every changed entry and its file name; compile script | Done |
| 2 | Worker: `/login`, `/callback`, `/submit` (new and edit), `/withdraw`, session, caps, pull request creation; tests against a mocked GitHub API | Pending |
| 3 | Site: the submission form, search over accepted entries, "My submissions" page (edit, withdraw), "submitted" page with the pull request link; Pages deploy | In progress — first slice live; sign-in, submit, "My submissions" and "submitted" wait for Phase 2 |
| 4 | One-time setup by the maintainer (GitHub App, Worker secrets, DNS), then an end-to-end submission on the live site | Pending |

### Phase 1 — schema and checks

- Limits: Hanji ≤ 20 characters, Tâi-lô ≤ 80, place ≤ 20, meaning ≤ 100, example ≤ 300, note ≤ 1,000; one line per field except `note`.
- Character whitelists: Hanji field (labelled 漢字、日語) = CJK ideographs, kana for Japanese loanwords (added 2026-11-20), Tâi-lô letters and hyphen (Hàn-lô mixed writing is allowed); Tâi-lô field = Latin letters, combining tone marks, hyphen, space, tone digits.
- CI fails when a file name does not match its content's key, when a field breaks a limit, or when a pull request from the App touches anything outside `entries/`.
- Ownership in CI: for every file a submission commit adds, modifies or deletes, the commit author's id (from the noreply address) must equal the file's `contributor_id` — a second gate behind the Worker's own check.
- No check of whether the Tâi-lô is correct (D8).

Built (2026-11-20). Implementation choices the roadmap did not fix (defaults, open to change):

| Choice | Value |
|---|---|
| Required fields | `tl` only (2026-11-20); `place` when `accents` contains 其他. `hanji` may be empty (many Taiwanese words have no Hanji). |
| Stored text | NFC, LF line endings, trimmed; no control, format or line-separator characters except ZWJ. Hanji allows Han ideographs (not radicals), letters with tone marks, hyphens. The site and the Worker take form input through `prepareEntry` (clean, then validate); CI runs the strict `validateEntry`, which rejects unclean files. |
| Stored `tl` | Keeps the contributor's case and spaces; only the key normalizes it. |
| File format | `serializeEntry`: fixed field order, two-space indent, final newline. CI rejects any other formatting. |
| Pull request modes | **submission** = opened by the App's bot login (repository variable `SUBMIT_APP_LOGIN`, set in Phase 4) from a branch of this repository: only `entries/`, no merge commits, ownership checked on both the old and new version of each touched file. **member** (owner, member, collaborator) = whole-tree check only. **outside** = anyone else: may not change `entries/`. |
| Validator trust | CI runs `scripts/validate.js` from the base revision against the head checkout, so a pull request cannot change its own gate; a change to the validator takes effect after it merges. |
| Directory | Must be a valid GitHub login. A submission that adds a file must put it under `entries/<contributor>/`; existing files stay put after an account rename. One `contributor_id` may hold a key only once across all directories. |
| Compiled CSV | One row per key; list columns joined with `; `, free-text columns join distinct values with a newline; cells starting with `= + - @` get a leading `'`. `search.json` keeps every attestation in full, including `contributor_id`. |

Code: `lib/entry.js` (shared), `scripts/validate.js` (CI), `scripts/compile.js`, `.github/workflows/validate.yml`, tests in `test/`. Node.js ≥ 24.2, no npm dependencies: `npm test`, `npm run validate`, `npm run compile`. The site build (not the validator) uses the git submodule `vendor/taigi-converter` (2026-11-21, as kautian-mirror does); clone with `--recurse-submodules` or run `git submodule update --init`.

### Phase 2 — Worker

- The contributor's `id` and `login` come only from GitHub's `/user` response, never from the form.
- Form text never reaches a shell or a template: the entry is `JSON.stringify` output, the commit message and pull request body are built from validated fields.
- Branch `submit/<user id>/<key>`; pull request title `add` / `edit` / `withdraw <hanji> <tl>`; no labels.
- One submission may carry up to 20 words (maintainer 2026-11-20): they share accents, tags, place, meaning, example and note; each word is its own entry file, all in one pull request (branch named after the first word's key, title `add <n> words`). The cap counts pull requests, not words.
- Edit and withdraw: the Worker reads the target file and refuses unless its `contributor_id` equals the session's id. A changed pair is two serial Contents API calls on the branch (create, then delete — the documentation forbids running them in parallel).
- Caps (initial values): 5 open submissions per contributor, 100 in total. Over the cap, the form says so and nothing is created.
- Errors shown to the contributor are generic ("already submitted", "please try again later").

### Phase 3 — site

- Static; style tokens taken from kautian-mirror. Built (2026-11-20) without a bundler: native ES modules, `dist/` mirrors the repo so `site/*.js` imports `../lib/entry.js` directly (`npm run build`). The Iansui font is loaded from kautian-mirror on the same origin (`/kautian-mirror/fonts/`) instead of committing a 2.7 MB copy; without it the system font is used.
- Interface text in Taiwanese (Hanji), kept to field labels. Top bar and 說明 page since 2026-11-25 (maintainer: 「把上方導覽列加回來，將揣詞的按鈕放在導覽頁，並且需要一頁說明」; replaces the 2026-11-20 no-nav / no-explanation decision): site name left, 揣詞 / 提交新詞 / 說明 right (the form's label is 提交新詞 since 2026-11-26, maintainer; it was 貢獻詞); the 「‹ 揣詞」 back links are gone. Homepage subtitle 「收錄 ê 台語詞會入去台語齒盤」 (maintainer 2026-11-26); the slogan 「揣無詞？來社群辭典貢獻！」 stays as the meta and share description. Sidebar: open by default on wide screens, collapsed with a « bar at its foot into a » strip down the left edge (after docusaurus.io; maintainer 2026-11-26); phones open it as a drawer from a floating button at the lower left. `#/about` says what is collected (腔口差, new words, words dictionaries lack), a word's way (提交新詞 → 檢查 → 社群辭典 → 台語齒盤; the maintainer says collected words will be imported into TaigiKeyboard), and the CC0 terms (D4). Homepage tags (maintainer 2026-11-26): a zoomable bubble map drawn with D3 (d3-hierarchy and friends, npm dependencies bundled into dist/vendor/, no CDN): one circle per site tag sized by its word count, 40 sample words inside, click to zoom in and open a word. Account notices still need a place before submissions open.
- Search over accepted entries (maintainer 2026-11-20): a search box on the home page, and the same community results under the word row being typed on the form page. Results open as a popover over the page, so nothing below moves. Before submit the form applies the duplicate rules above from the published search JSON.
- Dictionary search withdrawn (maintainer 2026-11-20): the daily pull of `taigikeyboard/taigikeyboard` dictionary data into the site was removed, along with its pre-submit "already in a dictionary" notice. Search covers community entries only.
- Sidebar (maintainer 2026-11-21), after kautian-mirror's: a toggle at the top left opens a sidebar docked on wide screens and a drawer on narrow ones, holding 外觀 (自動 / 淺色 / 暗色), 字型 (系統 / 粉圓 / 芫荽 / 源樣明體 / 源樣烏體, served by kautian-mirror on the same origin) and 選單顯示 白話字 / 方音符號 (on by default). Choices are `<html data-*>` attributes saved in `localStorage` and restored before first paint. Result rows in both popovers show Pe̍h-ōe-jī (where it differs from Tâi-lô) and 方音符號, converted from Tâi-lô at build time by `scripts/romanize.js` (`vendor/taigi-converter`; its 1.5 MB dictionary module stays out of the browser) into `search.json` and `itaigi.json`.
- iTaigi in search (maintainer 2026-11-21): the search box also lists matches from iTaigi 華台對照典 (CC0 per the iTaigi licence notice), listed after the community entries with no source heading (maintainer 2026-11-21; CC0 needs no attribution). Source: itaigi.tw's own export (`https://itaigi.tw/匯出資料`; switched 2026-11-21 from ChhoeTaigi's CSV, last updated 2021). iTaigi no longer changes (maintainer 2026-11-21), so `scripts/import-itaigi.js`, run by hand, downloads it once and commits the snapshot `data/itaigi.json` — one row per Hanji + Tâi-lô pair with its tags; no contributor names (iTaigi names are often real names, maintainer 2026-11-21) — and build-site turns it into `dist/itaigi.json` with Pe̍h-ōe-jī and 方音符號. Deploys download nothing. The import keeps the crowdsourced rows (the bundled 台文華文線頂辭典 and 教典 rows are dropped, as ChhoeTaigi/iTaigiDataMirror does), turns full-width spaces in Tâi-lô into plain ones, drops rows whose Tâi-lô has no Latin letter, and leaves out the Mandarin gloss (no Mandarin on the site, maintainer 2026-11-21). Search matches Hanji or the start of a Tâi-lô syllable (each `/`-joined variant reading on its own); exact matches first, then prefixes. Every iTaigi word card lists one contributor, `itaigi` (`ITAIGI_CONTRIBUTOR` in `site/logic.js`, maintainer 2026-11-21), as a byline at the card's lower right (tags lower left; no visible label, 貢獻者 read aloud and on hover; maintainer 2026-11-21); a contributor is a link to the card page `#/contributor/<name>` (all words they gave; community contributors by GitHub login; maintainer 2026-11-21: a contributor is one more tag). iTaigi rows never enter `entries/` and play no part in the form's duplicate rules; the word rows do not show them.
- Tags (maintainer 2026-11-21): 27 semantic tags named with 教典 headwords (`site/tags.js`, e.g. 身軀、食食、厝宅、𨑨迌、外來語), shown as chips under the search box. A chip opens the tag's card page `#/tag/<name>` (all its words as cards, 60 at a time, the next batch loading on scroll — no 閣看 button, maintainer 2026-11-21; no counts, maintainer 2026-11-21); a search result opens the word's card page `#/word/<hanji>/<tl>` (maintainer 2026-11-21). A card shows the readings, the tags (each a link to its page) and, for community entries, accents, meaning, example, note and contributors. Results under the form's word rows do not link, so typed words are never lost. The form offers the same tags as pills (several may be picked) and an input for the contributor's own; own tags in accepted entries appear as extra chips after the listed ones. The homepage also lists every contributor as a chip (標籤 and 貢獻者 both as `#name` text, no chip boxes, maintainer 2026-11-21; rows contributors most words first, from build-time `dist/contributors.json`; maintainer 2026-11-21), each opening `#/contributor/<name>`. `scripts/import-itaigi.js` (run by hand, not in CI) tags each iTaigi pair: pairs the 教典 also lists take their 教典 categories mapped to tags (about 15%), the rest are classified by Claude through the `claude` CLI from Hanji, Tâi-lô and the Mandarin gloss, 1–2 tags each or none. The tags are part of the committed snapshot `data/itaigi.json`.
- "My submissions" filters the same JSON by the signed-in id — no extra Worker endpoint — and offers edit and withdraw.

### Phase 4 — maintainer setup

1. Create the GitHub App (callback URL = the Worker's `/callback`; permissions `contents: write`, `pull_requests: write`; install on this repository only).
   Set the repository variable `SUBMIT_APP_LOGIN` to its bot login (`<app-slug>[bot]`) so CI treats its pull requests as submissions.
2. Convert the private key to PKCS#8 and store the three secrets with `wrangler secret put`.
3. Point a subdomain of `taigikeyboard.tw` at the Worker.
4. Enable Pages; protect `main` with a ruleset that requires a pull request and does not put the App on the bypass list.

## Best practices alignment

| Mainstream practice | Source | This plan |
|---|---|---|
| Form on a static site → bot opens a pull request, maintainer merges | Staticman (`github.com/eduardoboucas/staticman`) | Phases 2–3 |
| GitHub sign-in for a static site needs a server-side code exchange | GitHub Docs § Generating a user access token for a GitHub App; Simon Willison, "GitHub OAuth for a static site using Cloudflare Workers" | Architecture |
| Least privilege: a GitHub App scoped to one repository, short-lived installation tokens | GitHub Docs § Best practices for creating a GitHub App | Dedicated App |
| Contributors credited by commit author email | GitHub Docs § Why are my contributions not showing up | D7 |
| One record per file to avoid merge conflicts in crowd-edited data | no single mainstream reference; common in data repositories (for example `github/advisory-database`) | Data model |

Deliberately not adopted:

- **GitHub issue form + Actions intake** — the contributor lands on github.com and meets issues (D6).
- **Decap CMS open authoring** — forks under the contributor's account and asks for the `public_repo` scope.
- **Committing with the contributor's own token** — needs a fork or write access.
- **A database or KV store** — GitHub state already answers every question the Worker asks.
- **An automated Tâi-lô validator** — D8.
- **Fuzzy duplicate detection** — a near-duplicate reading may be the accent difference itself.
