# Community dictionary — roadmap

> **Status**: Draft 2026-11-20 — Phase 0 (this document). Nothing is built yet.

## Goal

A git-based community dictionary of Taiwanese words, collected from speakers who are not developers. A contributor signs in with a GitHub account, fills in one form, and presses **Submit**; a pull request is opened for them and the maintainer reviews it. The contributor never sees a fork, a branch or a pull request form.

The site is independent of TaigiKeyboard. Connecting the collected data to the keyboard is outside this roadmap.

## Decisions

Maintainer decisions, 2026-11-20 unless dated otherwise:

| # | Decision |
|---|---|
| D1 | Repository `taigikeyboard/community-dictionary`, site at `taigikeyboard.tw/community-dictionary/`, styled like `taigikeyboard.tw/kautian-mirror/`. Data, site and Worker live in this one repository. |
| D2 | Replaces the paused accent-variation contribution plan in the TaigiKeyboard repository; accent variation is one category here. |
| D3 | Categories in the first version: 腔口差 (accent variation), 台語新詞 (new words), 一般詞目補充 (missing words), 其他 (other). The site explains each one. |
| D4 | Contributed data is CC0. The form carries a required consent checkbox. |
| D5 | A GitHub account is required for every submission (2026-11-12). No anonymous path. |
| D6 | Submit path = Cloudflare Worker + GitHub sign-in (2026-11-12): contributors are speakers, not developers. |
| D7 | The contributor is the commit author (`<id>+<login>@users.noreply.github.com`), so the account appears in the repository's Contributors. Pull requests are merged with a merge commit or rebase, never squash (2026-11-12). |
| D8 | Romanization is Tâi-lô only and is reviewed by hand; the maintainer's merge is the only gate on its correctness. Automated checks cover format and duplicates (2026-11-12). |

Defaults chosen by the plan (not yet confirmed by the maintainer):

- **One file per entry** (see Data model) instead of one CSV per category.
- **Entry identity = (Hanji, Tâi-lô)**; the category is a field, so the same pair cannot be submitted twice under two categories.
- **A dedicated GitHub App**, installed on this repository only.
- **Code licence**: open.

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
                                            duplicate check (file exists?)
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

One JSON file per entry: `entries/<key>.json`, where `<key>` is the first 16 hex characters of SHA-256 over `hanji + "\n" + tl` after normalization (NFC, lowercase Tâi-lô, spaces to hyphens).

```json
{
  "hanji": "八",
  "tl": "pueh",
  "category": "khiunn-khau",
  "accents": ["鹿港偏泉腔"],
  "place": "",
  "meaning": "",
  "source": "",
  "note": "…the contributor's explanation…",
  "contributor": "octocat",
  "submitted": "2026-11-20"
}
```

| Field | Categories | Notes |
|---|---|---|
| `hanji`, `tl`, `category`, `note` | all | `note` is the contributor's explanation |
| `accents`, `place` | 腔口差 | the ten accents used by the Ministry of Education dictionary, or 其他 with a place name |
| `meaning`, `source` | 台語新詞 | Mandarin or English equivalent; where the word was seen, or an example sentence |

Why one file per entry:

- Two open pull requests never touch the same file, so submissions never conflict and need no rebase job.
- The duplicate check is "does `entries/<key>.json` exist on `main` or in an open submission branch" — one API call, no parsing.
- A review shows one small file with named fields.

A build step compiles `entries/` into one CSV and the site's search JSON; the compiled files are build output, not tracked.

## Phases

One pull request per phase.

| Phase | Scope | Status |
|---|---|---|
| 0 | This roadmap, README, licences | In progress |
| 1 | Entry schema; one validation module (field limits, character whitelists, normalization, key) used by the site, the Worker and CI; CI job that validates every changed entry and its file name; compile script | Pending |
| 2 | Worker: `/login`, `/callback`, `/submit`, session, caps, pull request creation; tests against a mocked GitHub API | Pending |
| 3 | Site: home page with the explanation of each category, the submission form, search over accepted entries, "submitted" page with the pull request link; Pages deploy | Pending |
| 4 | One-time setup by the maintainer (GitHub App, Worker secrets, DNS), then an end-to-end submission on the live site | Pending |

### Phase 1 — schema and checks

- Limits: Hanji ≤ 20 characters, Tâi-lô ≤ 80, place ≤ 20, meaning ≤ 100, source ≤ 300, note ≤ 1,000; one line per field except `note`.
- Character whitelists: Hanji field = CJK ideographs plus Tâi-lô letters and hyphen (Hàn-lô mixed writing is allowed); Tâi-lô field = Latin letters, combining tone marks, hyphen, space, tone digits.
- CI fails when a file name does not match its content's key, when a field breaks a limit, or when a pull request from the App changes anything outside one new `entries/*.json`.
- No check of whether the Tâi-lô is correct (D8).

### Phase 2 — Worker

- The contributor's `id` and `login` come only from GitHub's `/user` response, never from the form.
- Form text never reaches a shell or a template: the entry is `JSON.stringify` output, the commit message and pull request body are built from validated fields.
- Branch `submit/<user id>/<key>`; pull request title `add <hanji> <tl>`; label = category.
- Caps (initial values): 5 open submissions per contributor, 100 in total. Over the cap, the form says so and nothing is created.
- Errors shown to the contributor are generic ("already submitted", "please try again later").

### Phase 3 — site

- Static, built with esbuild like kautian-mirror; fonts and style tokens taken from it.
- Interface text in Taiwanese (Hanji), with an explanation page: what each category means, what a good entry looks like, how review works, the CC0 notice, and that the contributor's GitHub account becomes public as the commit author.
- Search over accepted entries; the form warns before submit when the exact (Hanji, Tâi-lô) already exists.

### Phase 4 — maintainer setup

1. Create the GitHub App (callback URL = the Worker's `/callback`; permissions `contents: write`, `pull_requests: write`; install on this repository only).
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
