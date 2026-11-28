# Community dictionary — roadmap

> **Status**: 2026-11-27 — Phases 0, 1, 2 and 4 done; Worker live at `dict-api.taigikeyboard.tw`; Phase 3 site live with sign-in and submit, Japanese and English UI; "My submissions" (edit) in progress.

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
| D11 | Any signed-in contributor can edit any community entry (maintainer 2026-11-28; was own entries only); the original contributor keeps the credit, editors are listed in `editors`. Each edit goes through a pull request and review like a new entry. Withdraw was dropped (maintainer 2026-11-27): a contributor reports a word they want gone. |
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
                                            duplicate + in-review check
                                            mint installation token
                                            create branch, commit, PR  ───▶  pull request
                       ◀── PR URL ──────
```

- **Sign-in** uses the GitHub App's user authorization (web application flow with `state` and PKCE `S256`). A GitHub App user token carries no scopes, so the consent screen only asks to verify the account. The token exchange needs the client secret, which is why a Worker exists at all. The Worker reads `id` and `login` once and discards the user token; it keeps no refresh token.
- **Writing** uses the App's installation token, never the user's token: one submission = one commit = one pull request (maintainer 2026-11-26): the Git Data API builds a tree holding every file of the submission, a commit on it with `author` = the contributor's noreply identity (the App is the committer), and the branch ref pointing at it; then the pull request is opened. (Replaced per-file Contents API commits the same day: one commit per word, about 22 writes for 20 words against GitHub's secondary write limit, and a half-written branch when a call failed.) The App needs `contents: write` and `pull_requests: write` on this repository and nothing else.
- **Session** is a short-lived value signed by the Worker (HMAC), carried in an HttpOnly cookie (maintainer 2026-11-26, over a bearer token in `localStorage`): the Worker's subdomain and the site are the same site, so `SameSite=Lax` lets the site's credentialed `fetch` send it while page scripts cannot read it. Every POST checks the `Origin` header.
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
  "examples": [{ "hanji": "…", "tl": "…" }],
  "note": "…the contributor's explanation…",
  "contributor": "octocat",
  "contributor_id": 583231,
  "submitted": "2026-11-20",
  "editors": [],
  "itaigi_contributors": []
}
```

Ownership is `contributor_id`, never the directory name: a contributor who renames their account keeps editing their old entries, and new entries go to a directory under the new login.

| Field | Required | Notes |
|---|---|---|
| `tl` | yes | Tâi-lô |
| `hanji` | no | Hanji or kana; empty when the word has no Hanji |
| `accents`, `place` | no; `place` when `accents` has 其他 | the ten accents used by the Ministry of Education dictionary, or 其他 with free text (form: a ＋ after the accents, like the tags', opens a floating input; the text becomes one more ticked pill, stored as 其他 + `place`; maintainer 2026-11-26, replaces the 其他：… pill, which replaced the 所在 field) |
| `tags` | no | up to 5 semantic tags (maintainer 2026-11-21): the site's list (`site/tags.js`) or the contributor's own, each ≤ 10 characters of Han ideographs, kana, Tâi-lô letters and hyphens; whether an own tag is good Taiwanese is checked at review, as with Tâi-lô (D8) |
| `meaning` | no | Mandarin or English equivalent (no separate source field since 2026-11-20: where the word was seen goes in `note`) |
| `examples` | no | Example sentences (maintainer 2026-11-20): up to 5, each `{ hanji, tl }` — the sentence in Hanji (or kana) and in Tâi-lô, either may be empty but not both (maintainer 2026-11-26: two columns, several rows like the words). Sentences, so no script rule: punctuation is allowed |
| `note` | no | the contributor's explanation |
| `editors` | yes (may be empty) | everyone else who changed the entry, `{ login, id }` in order of first edit (D11, 2026-11-28) |
| `itaigi_contributors` | yes (may be empty) | the names itaigi.tw credits an entry brought over from iTaigi (2026-11-28); cards credit them instead of `contributor` |

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

### Edit (D11)

| Action | Pull request contains |
|---|---|
| Edit, pair unchanged | the same file, modified |
| Edit, Hanji or Tâi-lô changed | new file under the new key + deletion of the old file; duplicate rules run again |
| Edit while the first pull request is still open | one more commit on that pull request's branch |
| Past 20 commits on one open pull request | refused (`cap_contributor`) |

Withdraw was dropped (maintainer 2026-11-27): a contributor who wants an entry gone reports it, and the maintainer removes it.

## Phases

One pull request per phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | This roadmap, README, licences | Done 2026-11-27 — code Apache-2.0 (`LICENSE`), data CC0 1.0 (`LICENSE-DATA`) |
| 1 | Entry schema; one validation module (field limits, character whitelists, normalization, key) used by the site, the Worker and CI; CI job that validates every changed entry and its file name; compile script | Done |
| 2 | Worker: `/login`, `/callback`, `/submit` (new and edit), `/mine` (2026-11-27; `/withdraw` removed the same day), session, caps, pull request creation; tests against a mocked GitHub API | Done 2026-11-26, deployed |
| 3 | Site: the submission form, search over accepted entries, "My submissions" page (edit), "submitted" page with the pull request link; Pages deploy | In progress — sign-in, submit and the "submitted" page live 2026-11-26; "My submissions" (edit, withdraw) next |
| 4 | One-time setup by the maintainer (GitHub App, Worker secrets, DNS), then an end-to-end submission on the live site | Done 2026-11-26 — App 「台語齒盤群眾辭典 TaigiKeyboard」 (slug `taigikeyboard`, bot `taigikeyboard[bot]` = `SUBMIT_APP_LOGIN`; created as `taigi-dictionary-submit`, renamed the same day — a rename changes the slug and bot login, so update the variable with it), public, Worker deployed, test pull request #1 opened by the bot with the contributor as commit author, `validate` passed in submission mode, closed unmerged |

### Phase 1 — schema and checks

- Limits: Hanji ≤ 50 characters, Tâi-lô ≤ 200 (2026-11-28; were 20 and 80), place ≤ 20, meaning ≤ 100, each example line ≤ 300, note ≤ 1,000; one line per field except `note`.
- Character whitelists: none for Hanji and Tâi-lô since 2026-11-28 (§ iTaigi merge; were CJK ideographs, kana, Tâi-lô letters and hyphen / Latin letters, tone marks, hyphen, space, tone digits); tags keep theirs.
- CI fails when a file name does not match its content's key, when a field breaks a limit, or when a pull request from the App touches anything outside `entries/`.
- Ownership in CI: for every file a submission commit adds, modifies or deletes, the commit author's id (from the noreply address) must equal the file's `contributor_id` — a second gate behind the Worker's own check.
- No check of whether the Tâi-lô is correct (D8).

Built (2026-11-20). Implementation choices the roadmap did not fix (defaults, open to change):

| Choice | Value |
|---|---|
| Required fields | `tl` only (2026-11-20); `place` when `accents` contains 其他. `hanji` may be empty (many Taiwanese words have no Hanji). |
| Stored text | NFC, LF line endings, trimmed; no control, format or line-separator characters except ZWJ, and (2026-11-28) no U+FFFD, lone surrogates or private-use characters, in every text field. The site and the Worker take form input through `prepareEntry` (clean, then validate); CI runs the strict `validateEntry`, which rejects unclean files. |
| Stored `tl` | Keeps the contributor's case and spaces; only the key normalizes it. |
| File format | `serializeEntry`: fixed field order, two-space indent, final newline. CI rejects any other formatting. |
| Pull request modes | **submission** = opened by the App's bot login (repository variable `SUBMIT_APP_LOGIN`, set in Phase 4) from a branch of this repository: only `entries/`, no merge commits, ownership per commit (2026-11-28, D11): a file the author does not own may only be modified or moved with its identity kept and `editors` = old list + author; new files are the author's own (id and login); every non-add change answers to its previous version. **member** (owner, member, collaborator) = whole-tree check only. **outside** = anyone else: may not change `entries/`. |
| Validator trust | CI runs `scripts/validate.js` from the base revision against the head checkout, so a pull request cannot change its own gate; a change to the validator takes effect after it merges. |
| Directory | Must be a valid GitHub login. A submission that adds a file must put it under `entries/<contributor>/`; existing files stay put after an account rename. One `contributor_id` may hold a key only once across all directories. |
| Compiled CSV | One row per key; list columns joined with `; `, free-text columns join distinct values with a newline; cells starting with `= + - @` get a leading `'`. `search.json` keeps every attestation in full, including `contributor_id`. |

Code: `lib/entry.js` (shared), `scripts/validate.js` (CI), `scripts/compile.js`, `.github/workflows/validate.yml`, tests in `test/`. Node.js ≥ 24.2 (the validator needs no npm packages): `npm test`, `npm run validate`, `npm run compile`. The site build (not the validator) uses the git submodule `vendor/taigi-converter` (2026-11-21, as kautian-mirror does); clone with `--recurse-submodules` or run `git submodule update --init`.

### Phase 2 — Worker

- The contributor's `id` and `login` come only from GitHub's `/user` response, never from the form.
- Form text never reaches a shell or a template: the entry is `JSON.stringify` output, the commit message and pull request body are built from validated fields.
- Branch `submit/<user id>/<key>`; pull request title `add` / `edit <hanji> <tl>`; no labels.
- One submission may carry up to 20 words (maintainer 2026-11-20): they share accents, tags, place, meaning, examples and note; each word is its own entry file, all in one commit and one pull request (branch named after the first word's key, title and commit subject `add <n> words`, the commit body listing the words). The cap counts pull requests, not words.
- Edit: the Worker reads the target file; since 2026-11-28 any signed-in contributor may edit any entry (D11), keeping its contributor and adding the editor to `editors`. A changed pair adds the new file and deletes the old one in the same commit. An edit or withdrawal of an entry still in an open submission is one more commit on that branch (fast-forward only, so a concurrent write fails rather than being lost).
- Caps (initial values): 5 open submissions per contributor, 100 in total. Over the cap, the form says so and nothing is created.
- Errors shown to the contributor are generic ("already submitted", "please try again later").

Built (2026-11-26; maintainer: build and test locally now, deploy together with the GitHub App in Phase 4). Code in `worker/` (its own `package.json` with wrangler, so the Pages build does not install it); tests in `test/worker.test.js` run the Worker against an in-memory GitHub under `npm test`. Verified against GitHub Docs (web application flow with PKCE, App JWT, installation tokens) and Cloudflare Docs (`routes[].custom_domain`) on 2026-11-26.

| Choice | Value |
|---|---|
| Host | `dict-api.taigikeyboard.tw` as a Workers Custom Domain in `worker/wrangler.jsonc` (the zone is on Cloudflare); `workers_dev` off |
| Routes | `GET /login?return=#/…` → GitHub; `GET /callback` → back to `SITE_URL` + that hash route (anything else → `#/`); `GET /session` → `{ id, login }` or 401; `POST /logout`; `POST /submit` (new: `{ words: [{ hanji, tl }], accents, tags, place, meaning, examples: [{ hanji, tl }], note }`; edit: the same fields for one word plus `path`); `GET /mine` → `{ submissions: [{ path, entry, pullRequest }] }` (own open submissions) or 401 |
| Responses | `{ pullRequest: { url, number } }`, or `{ error: <code> }` with codes `invalid` (+ `errors` from `lib/entry.js`), `already_submitted` (+ `keys`), `cap_contributor`, `cap_total`, `in_review`, `not_found`, `unchanged`, `signed_out`, `forbidden_origin`, `too_large`, `try_later` — the site maps codes to Taiwanese text |
| Session | 24 hours, cookie `__Host-session`; the OAuth `state` + PKCE verifier sit in a signed 10-minute `__Host-oauth` cookie (`__Host-`: no sibling subdomain can plant either); each signed value carries its use, so one is never accepted as the other; the GitHub user token is used for `/user` only and never stored |
| Installation token | App JWT (`iss` = client ID) → `GET /repos/{repo}/installation` → token limited to this repository and `contents` + `pull_requests: write`; cached per isolate until five minutes before expiry |
| Duplicate check | the target path on the base branch plus the contributor's own open submissions' file lists (roadmap § Worker budget); a file any other open submission touches is refused with `in_review` (2026-11-28) |
| Branch name | `submit/<id>/<key>`; `-2`, `-3`… when an open pull request already uses it; a leftover branch of a closed pull request is reset to the base tip |
| Edit | an entry in the contributor's open submission is read from and edited on that branch (no new pull request, no cap check); otherwise from the base branch in a new pull request. An unchanged pair keeps its file, directory and `contributor`; a changed pair moves to `entries/<current login>/` when the owner edits, and stays under the stored contributor's directory when anyone else does (2026-11-28) |
| Pull request body | `Submitted by @<login>` (so GitHub notifies them of the review), the Hanji / Tâi-lô list, and the CC0 1.0 line (D4) |
| Local run | `make worker-dev` (wrangler dev on 127.0.0.1:8787, `--local-upstream` so the callback URL stays local); secrets in `worker/.dev.vars` from `worker/.dev.vars.example` |
| Abuse limits | Only the caps for now. A per-user rate limit (Workers rate-limit binding), a blocked-ids list and `concurrency` in `validate.yml` were raised by the 2026-11-26 security review (a few accounts can exhaust GitHub's secondary write limit; 20 accounts fill `CAP_TOTAL`; an org block does not reach App-opened pull requests); maintainer 2026-11-26: launch first and observe |
| Trusted origin | All of `https://taigikeyboard.tw`, which every org project page shares; script on any of them can act for the signed-in visitor (2026-11-26 review). A dedicated origin would reverse D1 |

### Phase 3 — site

Current state (2026-11-27). Superseded wording and dated decisions live in git history.

- **Build**: static, no bundler; native ES modules, `dist/` mirrors the repo so `site/*.js` imports `../lib/entry.js` directly. `scripts/build-site.js` copies every `site/*.js`, writes the import map and modulepreload list, builds `search.json` (every entry, community and iTaigi alike, since 2026-11-28), `tag-map.json` and `stats.json`, and adds Pe̍h-ōe-jī and 方音符號 at build time through the `vendor/taigi-converter` submodule. D3 (`d3-*` npm packages, exact pins) ships from `dist/vendor/`, no CDN. Fonts come from kautian-mirror on the same origin. Local preview: `make preview` (`scripts/serve.js`).
- **Modules**: `app.js` router and page shells; `page.js` frame (title, back button); `data.js` cached loaders; `search-box.js`; `form.js` widgets; `submit-page.js`; `cards.js` (cards, word tip); `word-parts.js`; `tag-map.js` bubble map; `story.js` statistics; `strings.js` UI text; `logic.js` DOM-free logic shared with the build scripts.
- **Pages**: `#/` home — site title, D3 force bubble map of the 27 tags: each tag's 150-word pool packed inside it, first words largest; free zoom (trackpad pinch, Ctrl + wheel, two-finger pinch, ＋ / − buttons) or a click on a tag, and words fade in as they grow readable on screen (level of detail, 2026-11-27); click a word for its cards, then statistics revealed on scroll (totals, words per tag, word length, tag pairs, community contributors' GitHub pictures). `#/search` — 揣詞 page with its own search box (community entries first, then iTaigi; `/` focuses it). `#/submit` — the form. `#/tag/<name>`, `#/contributor/<name>`, `#/word/<hanji>/<tl>` — card pages, 60 cards then more on scroll. Subpages have a back button above the title.
- **Top bar**: a dark announcement strip with what the site is, a 提交新詞 button and a 揣詞 button; each hides (keeping its place) on its own page.
- **Sidebar**: 語言, 外觀, 字型, 台羅 / 白話字 / 方音符號 switches. Docked and collapsible on wide screens, a drawer on phones. Choices are `<html data-*>` attributes restored before first paint. 外觀 and the reading switches share kautian-mirror's `settings` key; 字型 and 語言 are this site's own (`community-settings`), since kautian-mirror saves its 芫荽 default into the shared key (2026-11-27).
- **Languages** (2026-11-27): Taiwanese (default), Japanese, English for all interface text and the 27 tag names (`site/strings.js`, `site/tags.js` labels); entry data is never translated. Every Hanji of the Taiwanese text occurs in a 教典 headword (`make check-hanji ODS=kautian.ods`); 台語 is kept although 教典 writes 臺語 (maintainer 2026-11-27).
- **Tags**: 27 semantic tags named with 教典 headwords; the tag is the stored key and the route, translations are display labels. iTaigi pairs were tagged once (教典 categories, then Claude) before they became entries; the tags are part of their entry files.
- **iTaigi**: CC0 words from itaigi.tw's official export; since 2026-11-28 ordinary entries under `entries/taigikeyboard/` (§ iTaigi merge), editable like any other. Cards credit their iTaigi contributors (`itaigi_contributors`), with a link to iTaigi.
- **Submit**: signed out, the button reads 「登入 GitHub 提交」 and keeps the form in sessionStorage across sign-in; signed in, it posts `/submit` and shows 「提交成功」 with the pull request link. The form validates with `lib/entry.js` first; validation and Worker errors are issue codes worded in the reader's language. One's own earlier pair is a row error; another contributor's asks for one confirmation.
- **Not built yet**: "My submissions" (edit), planned below.

### Phase 4 — maintainer setup

1. Create the GitHub App (callback URL = `https://dict-api.taigikeyboard.tw/callback`; permissions `contents: write`, `pull_requests: write`; install on this repository only), and put its client ID in `worker/wrangler.jsonc` `GITHUB_CLIENT_ID`.
   Set the repository variable `SUBMIT_APP_LOGIN` to its bot login (`<app-slug>[bot]`) so CI treats its pull requests as submissions.
2. Convert the private key to PKCS#8 and store the three secrets with `wrangler secret put`.
3. Point a subdomain of `taigikeyboard.tw` at the Worker.
4. Enable Pages; protect `main` with a ruleset that requires a pull request and does not put the App on the bypass list. Done 2026-11-26: ruleset `require-pr` (pull request, merge or rebase only per D7, required check `validate`, not strict) with repository admins bypassing so the maintainer still pushes to `main` directly (maintainer); `protect-main` (no deletion, no force push) stays without bypass.
5. Make the App public ("Any account"): GitHub lets only members of the owning organization authorize a private App, and contributors are not members. Installations on other accounts are never used — the Worker resolves the installation by `GITHUB_REPO`.

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

## Maintenance round 2026-11-27 — cleanup, refactor, i18n

Source: whole-project review (2026-11-27). Maintainer choices: delete the hidden top-bar search box,
the submit form's "not yet open" mode and the duplicate test run in `pages.yml`; keep the Worker's
edit / withdraw / logout routes for "My submissions"; full refactor in separate commits; preview
through a Node static server.

| Step | Scope | Status |
|---|---|---|
| 1 | Cleanup: `--ease-emphasized` self-reference, dead code and selectors, unused exports, small duplicates, stale comments, `scripts/serve.js` | Done 2026-11-27 |
| 2 | Refactor: split `site/app.js` by job, split `tag-map.js` `draw`, page ids `home` / `search` | Done 2026-11-27 |
| 3 | Validation errors as codes (`lib/entry.js`), one formatter for CI, a message table for the site | Done 2026-11-27 |
| 4 | `build-site` generates the import map and modulepreload list | Done 2026-11-27 |
| 5 | i18n: Taiwanese (default), Japanese, English for UI text and tag names; sidebar 語言 select; every Taiwanese Hanji checked against 教典 (sutian.moe.edu.tw) | Done 2026-11-27 |
| 6 | Docs: README rewrite, Phase 3 section as current state, everything outside UI text and data in English | Done 2026-11-27 |

## My submissions — edit, report, sign out (planned 2026-11-27)

Maintainer decisions 2026-11-27: every action needs a GitHub sign-in; no withdraw (D11 narrows to
edit); the Worker's unused `POST /withdraw` is removed; edits to an open submission are capped at
20 commits per pull request; the whole-origin trust of `taigikeyboard.tw` (Trusted origin, Phase 2)
is accepted ("依據你的建議", after the withdraw route goes, the exposure is edit-only and every edit
waits for review). A contributor who wants a word gone reports it.

| Step | Commit | Scope (grounded in code) |
|---|---|---|
| 1 | `feat(worker)` (done) | Remove `withdraw()` (`worker/src/submit.js`) and its route (`worker/src/index.js` `ACTIONS`) with its tests; `submitEdit` refuses a 21st commit on an open submission (`GET /pulls/{n}` `commits`) with `cap_contributor`; new `GET /mine` → the signed-in contributor's open submissions only (branches `submit/<own id>/`, via `loadState`), as `[{ path, entry, pullRequest: { url, number } }]`, 401 signed out, `no-store`. Tests for each. Deploy with the site. (Calls superseded 2026-11-28 by § Worker budget.) |
| 2 | `feat(site)` (done) | 登出 button (`POST /logout`, already in the Worker) beside the signed-in state on the form and on 我的提交. |
| 3 | `feat(site)` (done) | `#/mine` 我的提交: signed out → sign-in button; signed in → accepted words (`search.json` attestations with the session's `contributor_id`) and words in review (`GET /mine`), as cards. Each own attestation (here and on every card page) gets 修改: the form for that one word, filled from the entry, posting `/submit` with `path`. |
| 4 | `feat(site)` (done) | 回報 on every card: a new GitHub issue from `.github/ISSUE_TEMPLATE/report.yml` (issue form; word, key, source, page URL prefilled through query parameters; reason dropdown; details). GitHub requires a sign-in to file it. |

Security (review 2026-11-27): identity only from GitHub `/user`; signed `__Host-` HttpOnly cookie;
POST checks `Origin`; edits read the stored file from the base branch or the editor's own
submission branch only (since 2026-11-28 anyone may edit, D11); strict `parseEntryPath`; CI re-checks ownership from
the base revision; every edit is a pull request the maintainer merges. New surface: `GET /mine`
answers only for the session's own id; the sign-out button closes a shared-computer session that
could otherwise edit for 24 hours.

Deliberately not adopted: withdraw (maintainer 2026-11-27); a Worker-filed issue (would need
`issues: write` on the App and its own abuse limits, and the maintainer wants a GitHub sign-in for
every action anyway); reading branch files through raw.githubusercontent.com (cached for minutes,
so a fresh edit would show stale).

## Batch submission — CSV through a GitHub issue (2026-11-27)

Maintainer decisions 2026-11-27: GitHub issue only (no email: an entry needs a GitHub login + id,
and a public mailbox would sit on the site); one word per CSV row, `accents` / `tags` split by `;`,
one example per row; the entry point is the last tip above the 提交新詞 form.

| Piece | Scope (grounded in code) |
|---|---|
| `site/batch-template.csv` | Header `hanji,tl,accents,tags,place,meaning,example_hanji,example_tl,note` + one sample row; copied to `dist/` by `scripts/build-site.js`. |
| `.github/ISSUE_TEMPLATE/batch.yml` | Issue form: CSV textarea (paste or attach a `.csv`), CC0 checkbox. The issue author is the contributor. |
| `site/submit-page.js` `submitTips` | 「若有準備 CSV 檔案，請來遮 ap-lóo，用這个範本阮較好處理。」 as the last tip above the new-word form (not on 修改). |
| `scripts/import-batch.js` | `make import-batch ISSUE=12` (or `CSV=… LOGIN=…`): reads the issue via `gh`, looks up the author's id, runs every row through `prepareEntry`, writes `entries/<login>/<key>.json` only when no row fails (else lists each problem by line). The maintainer commits on a branch and opens a PR with `Closes #12` — member mode in `scripts/validate.js`, so ownership checks do not apply; `MAX_WORDS` (form cap) does not apply either. |

## Open editing — anyone edits any community entry (2026-11-28)

Maintainer decisions 2026-11-28: any signed-in GitHub account may edit any community entry, through
a pull request like every other change (D11 widens from "own entries" to "any entry"); iTaigi words
(`data/itaigi.json`) stay out of this slice; the original contributor keeps the credit and every
other editor is listed in a new `editors` field, shown on the card as 修改：<login>; a changed pair
stays under the original contributor's directory; on a card that merges several attestations the
pencil edits the signed-in person's own attestation, else the earliest one.

| Piece | Scope (grounded in code) |
|---|---|
| `lib/entry.js` | New last field `editors`: `[{ login, id }]`, distinct ids, never the entry's own `contributor_id`. `nextEditors(entry, user)` appends the editor once (owner edits leave it unchanged). The 11 committed entry files get `"editors": []`. |
| `worker/src/submit.js` | `ownedTarget` → `editTarget`: no `not_owner`; reads the editor's own open submission that touches the path, else the base branch. Identity fields (`contributor`, `contributor_id`, `submitted`) always come from the stored entry; `editors` from `nextEditors`. A changed pair goes to `entries/<contributor>/` (the owner's current login when the owner edits, as before); the duplicate check runs for the entry's `contributor_id`. Branch `submit/<editor id>/<key>`, so caps count the editor. `listOwn` lists every entry on the editor's own branches. |
| `scripts/validate.js` | Submission ownership per commit: a file whose `contributor_id` is not the commit author may only be modified (identity fields kept, `editors` = the old list plus the author) or moved (deleted, with an added file in the same commit carrying the same identity); a plain add or delete stays the owner's. |
| site | 修改 on every community card, signed in or not (the edit page asks for a sign-in); 修改：<editors> after the byline; a contributor's page also lists words they edited; the edit page loads any collected entry; the form's own-pair check uses the entry's contributor, not the editor. |

Deliberately not adopted: editors derived from git history at build time (maintainer commits such as
batch imports would show up as edits, and the Pages build would need full history).

## Worker budget — constant GitHub calls per request (2026-11-28)

Maintainer 2026-11-28: the Worker runs on the Cloudflare Workers Free plan (50 subrequests and
10 ms CPU per request); its use must not grow with the number of words (iTaigi's ~18k entries are
next) nor with the queue of open submissions. Before: a submission listed every open pull request's
files (one call each), read the base branch's whole recursive tree plus a blob per matching key,
and `GET /mine` read each own file separately. Pre-implementation review 2026-11-28: go with
revisions (all adopted below).

GraphQL fields verified against the live repository (`make graphql-check` sends the Worker's own
two operations through `gh api graphql`; a missing `object(expression:)` is plain null).

| Request | GitHub calls (installation token: +2 once per isolate-hour) |
|---|---|
| New submission (≤ 20 words) | `Submissions` + `Blobs` (oid of the ≤ 20 target paths on main) → `POST /git/trees`, `POST /git/commits`, `POST /git/refs` (+ `PATCH` to reset a closed pull request's leftover branch), `POST /pulls` = 6–7 |
| Edit | `Submissions` + `Blobs` (the target, from the editor's own submission head or main) (+ `Blobs` for a changed pair's new path) → tree, commit, then a new branch + `POST /pulls`, or (`PATCH /pulls/{n}` when the file list grows) + fast-forward `PATCH` of the editor's branch = 5–8 |
| `GET /mine` | `Submissions` (+ one `Blobs` read of every own file, `<head oid>:<path>`) = 1–2 |

Open pull requests are read newest first, 100 to a GraphQL page (each page past the first is one
more `Submissions` call); past 3 pages (fork spam) requests fail closed (`try_later`, logged). `CAP_TOTAL` stays 100. `test/worker.test.js` counts the calls of a
20-word submission, an edit and `/mine` with 50 open submissions and with none: the same 6 / 6 / 2.

| Piece | Code |
|---|---|
| `worker/src/github.js` | `graphql(token, operationName, query, variables)`; a response with `errors` throws. `apiOrNull` removed. |
| File list in the pull request body | `<!-- community-dictionary-files ["entries/…", …] -->`: every entry path the submission's commits wrote or deleted. Written on create; on an extending edit that adds a path, the body is updated before the branch moves (a request that dies in between leaves the list too long). Two different pair changes sent at once on one submission can still leave it one path short (the later body wins, the earlier branch move wins); CI stays the gate, and there is no compare-and-swap on a body without another call. Whether a listed path still exists is read from the branch (gone after the editor's own pair change → `not_found`, skipped by `/mine`). The last marker counts; every path must pass `parseEntryPath`; a body without one touches nothing silently (an old Worker's pull request: see Deploy), a broken one touches nothing and is logged. Only the App and the maintainer can edit a bot pull request's body; CI stays the real gate. |
| `worker/src/submit.js` | `snapshot()` (`Submissions`: base commit + tree; open pull requests from this repository's `submit/` branches with body, commit count, head commit + tree) and `blobs()` (`Blobs`) replace `openSubmissions`, `filesOf`, `commitCount`, `tip`, `readEntry`, `ownedOnBase`. Duplicate check (D10) = the target path `entries/<login>/<key>.json` exists on main (whoever's file it is) or is in the contributor's own open submissions' lists (their edits of other people's entries do not count). Commits start from the snapshot's commit and tree. |
| Behaviour change | A key held under an older login directory after an account rename passes the Worker; CI (`checkTree` → `duplicatePairErrors` on the pull request head) refuses it, and the site's form warns first (`duplicateStatus` matches by `contributor_id`). A submission's earlier path stays "touched" after a later pair change, so the owner moving back onto it is refused (a non-owner's move back is allowed). |
| `test/fake-github.js` | `POST /graphql` answers `Submissions` and `Blobs` by operation name from the in-memory git state; dead REST routes removed; `PATCH /pulls/{n}` added. |

Deploy: no open `submit/` pull requests may exist when the new Worker goes live (bodies from the
old Worker carry no file list) — checked with `gh pr list` right before `npm --prefix worker run deploy`.
Dogfood: after deploy, the Workers dashboard's CPU time and wall time for one 20-word submission and one `/mine`, also once several submissions are open (GraphQL wall time grows with the queue even though the call count does not).

Deliberately not adopted: GraphQL `createCommitOnBranch` (one call, but the commit author is the
App, which breaks D7 and the CI ownership check by noreply address); the pull request files listing
in GraphQL (no previous path for renames); caching file lists per head sha in KV (state to keep in
sync, and Free-plan KV writes are capped at 1,000 a day); folding `Blobs` into `Submissions`
(one call fewer, but one query text per request shape).

## iTaigi merge — every iTaigi word becomes an ordinary entry (2026-11-28)

Maintainer decisions 2026-11-28: every iTaigi word becomes an entry under the organisation account
`taigikeyboard` (id 241070258), so anyone can edit it like any other entry (D11); the iTaigi
contributor names stay on the entry; the Hanji / Tâi-lô character rules are dropped for everyone
("不需要檢查格式，全部收" — slashes, spaces, punctuation all accepted; still one line, NFC, trimmed,
no control characters, no U+FFFD or private-use characters; lengths raised to Hanji 50 / Tâi-lô
200); slash variants stay as written; garbled characters are auto-fixed and rows still invalid are
left out and listed (8 rows: 2 with U+FFFD in the Tâi-lô, 6 with private-use Hanji — "先不收，列出清單");
of the 57 export rows the snapshot dropped, all but the 12 with an empty 羅馬字 come back
(「除了羅馬字欄是空的以外…都可以救回來」, plus 生番仔𡳞脬, whose Tâi-lô sits in the Hanji field after a
full-width space); one list orders community words first, then the rest by case- and tone-free
Tâi-lô (「社群詞優先，再照台羅字母」).

Measured 2026-11-28 (`data/itaigi.json` + itaigi.tw's official export; pre-implementation review
simulated the migration): 18,103 snapshot rows; the dropped 57 = 9 Tâi-lô with only accented
letters (`ê-á`, `î`: `scripts/itaigi.js` tested `[A-Za-z]`), 12 with Hanji and Tâi-lô swapped (5
land on existing keys once swapped), 24 Mandarin → Taiwanese Hanji with no reading (kept as
written: Hanji = the Mandarin, Tâi-lô = the Taiwanese Hanji, for editors to fix), 12 empty. Expected
result: 17,934 files, 8 rows left out; no key shared with a community entry; at most 4 tags and 3
names per key; longest Hanji 44, Tâi-lô 146.

| Step | Commit | Scope (grounded in code) |
|---|---|---|
| 1 | `feat(schema)` | `lib/entry.js`: new last field `itaigi_contributors` (names as itaigi.tw shows them: distinct one-line strings ≤ 50 characters, no control characters; `[]` on every community entry); `checkText` loses its `script` parameter and Hanji / Tâi-lô get a garbled rule (U+FFFD, private use) instead; `SCRIPT_RULES` keeps only the Hanji rule for tags (`checkTags`); `hanji_needs`, `tl_script`, `tl_needs` issue codes go; `LIMITS` hanji 50, tl 200; `credit(attestation)` → the names a card, the stats, the CSV, a contributor page and the form show (`itaigi_contributors` when non-empty, else `contributor`). The 11 community files get `"itaigi_contributors": []`. Worker: identity (new words `[]`, edits keep the stored list); words reach GitHub text safely — the pull request body lists them in a fenced code block, title and commit subject are cut to 60 characters with `@` and `#` replaced by full-width forms (now that the character rules no longer keep them out: no mention, no issue link). CI: `itaigi_contributors` joins the identity fields a next version keeps; a new entry carries `[]`. Callers: `scripts/import-batch.js`, `scripts/mock-worker.js`, `site/logic.js` `formToRaw` and `duplicateStatus`, `test/fixtures.js`, `test/entry.test.js`. `scripts/romanize.js` gives no Pe̍h-ōe-jī / 方音符號 for a Tâi-lô without a Latin letter. |
| 2 | `feat(data)` | `scripts/migrate-itaigi.js` (rerunnable; clears `entries/taigikeyboard/` first; deleted in step 3): `data/itaigi.json` rows plus the recovered export rows (downloaded as `scripts/import-itaigi.js` does; tags `[]`): accented-only Tâi-lô kept, swapped pairs swapped back, 生番仔𡳞脬 split at its full-width space, Mandarin rows as written → auto-fix (`ı`→`i`, U+2011→`-`, `ⁿ`→`nn`, drop U+200B) → merge by key (first spelling, tags and names in first-seen order) → `prepareEntry` → `entries/taigikeyboard/<key>.json` (`submitted` 2026-11-28, `editors` []). Asserts the expected counts (17,934 written, 8 left out) and prints every row left out with its issues; the commit body lists them. |
| 3 | `refactor(site)` | One data source: `compile` turns every entry into `search.json` rows, ordered community first, then by case- and tone-free Tâi-lô (`foldSearch`), then Hanji; `build-site` stops writing `itaigi.json`. `site/data.js` drops `loadItaigiIndex`; `loadRows` returns rows indexed once (`indexRows`: folded Tâi-lô, `/` variants, syllable tails, as `indexItaigi` does today); `searchRows` ranks every row exact → prefix → rest (today's `searchItaigi`), and `findExisting` uses it; `searchTags`' own-tag set is computed once; `wordsWithTag` / `wordsByContributor` / `wordsSpelled` return one list (contributor match by `credit`; spelling match by `pairKey`, so links to merged spellings still find their word); `cardList` takes it. Cards: the byline uses `credit`, an iTaigi word adds the · iTaigi link, 修改 like any entry. `scripts/tag-map.js`, `scripts/stats.js`: rows only, credits by `credit` (the GitHub faces leave out entries with iTaigi names; 匿名 unchanged); `compile` CSV contributors column by `credit`. Delete `data/itaigi.json`, `scripts/itaigi.js`, `scripts/import-itaigi.js`, `scripts/migrate-itaigi.js`, the `.classify-cache` ignore line if unused. Docs and comments that describe two sources. Tests follow. |

Steps 2 and 3 land in one push (step 2 alone would show every iTaigi word twice). Deploy: no open
`submit/` pull requests (old-format entries would fail `compile` after the schema change); push,
then `npm --prefix worker run deploy`.

Sizes (built 2026-11-28): `search.json` 6.55 MB raw / 874 KB gzip for 17,945 words (before: `itaigi.json` 1.86 MB / 566 KB + `search.json`
5 KB); parse ≈ 17 ms and index ≈ 32 ms on desktop. It is now also loaded where only the small
`search.json` was: the form's word rows and duplicate check, 我貢獻 ê 詞, the 修改 page. CI's
`checkTree` reads ~17,900 files in under half a second. The Worker only reads named paths
(§ Worker budget).

Also left out by the maintainer's rule (empty 羅馬字): 11 export rows, two of which hold a reading in
the Hanji field (`la̋ng-jióng`, `ta̋ng-jióng`); re-add by hand if wanted.

Known and left as is: `submitted` is the migration date for every iTaigi entry (the export has no
dates); near-identical keys (`--` versus a space) can now coexist, as 43 groups already do; one
open pull request per edit against the cap of 5 per contributor; the export's 華語 gloss stays out
(no Mandarin on the site).

Deliberately not adopted: keeping iTaigi as a separate read-only source with a "補充" button
(maintainer chose direct editing); one entry per iTaigi contributor (the organisation account holds
one file per key, D10, and the names ride along); re-classifying the recovered rows' tags with
`claude -p` (editors can add tags); an `ITAIGI_ACCOUNT` constant in shared code (a non-empty
`itaigi_contributors` is the one marker; the account appears only in the migration script);
dropping empty fields from `search.json` (2% of gzip).
