# Bug Audit

Grouped by severity. Each entry notes whether it's fixed, mitigated (improved
but not eliminated), or still open, and which file to look at.

## Fixed

1. **LeetCode `/v2/check/` endpoint mismatch** (`src/content-main.js`)
   The submission-status regex only matched `/submissions/detail/<id>/check/`.
   LeetCode's actual endpoint is `/submissions/detail/<id>/v2/check/`. Fixed
   by making the `v2/` segment optional in the regex.

2. **Bloated Azure Functions deploy (554MB)** (`backend-functions/package.json`)
   `azure-functions-core-tools` was pulling the entire CLI tool into
   `node_modules` on every install. Removed from package.json;
   `.funcignore` added as a second line of defense.

3. **GitHub commit 409 conflicts, single case** (`src/background.js`)
   A stale `sha` between GET and PUT caused rejected writes. Mitigated with
   one automatic retry that re-fetches the sha. See #8 for the broader
   concurrency fix.

4. **OAuth flow has no CSRF `state` parameter** (`src/background.js`,
   `startGithubOAuth`)
   Fixed. A random `state` (via `crypto.randomUUID()`) is now sent with
   the GitHub authorization request and verified against the value
   returned in the redirect before the flow proceeds. A mismatch aborts
   with an explicit error instead of silently continuing.

5. **`htmlToMarkdown` silently ate `<pre>` blocks** (`src/lib.js`)
   Found via the new unit tests (`tests/lib.test.mjs`): the regex meant to
   strip `<p>` tags (`<p[^>]*>`) also matched `<pre>`, since `[^>]*` happily
   consumed the "re". This silently deleted every code-block wrapper
   before the code-fence logic ever ran, so example blocks in generated
   READMEs lost their triple-backtick fencing. Fixed with a lookahead
   (`<p(?=[\s>])[^>]*>`) so it only matches `<p>` / `<p class="...">`, not
   `<pre>`.

6. **Repo auto-creation always defaulted to public, no way to change it**
   (`src/background.js`, `popup/`) Added a "Make the repo private" checkbox
   under Advanced settings. It's only consulted when the repo is first
   created (GitHub's API doesn't let you flip visibility on write-only
   tokens after the fact without an extra call, and this keeps the OAuth
   scope minimal).

## Mitigated (meaningfully improved, not eliminated)

7. **`ALLOWED_EXTENSION_ORIGIN` defaults to `"*"`** (`backend/server.js`,
   `backend-functions/src/functions/githubToken.js`)
   Still defaults open until you set it — that part can't be fixed in code
   since the real value depends on your published extension ID, which
   doesn't exist until you publish. Mitigated by adding rate limiting (#8)
   as a second layer, and this is called out explicitly in the Chrome Web
   Store checklist in `DEPLOY.md` as a required step before/at publish
   time.

8. **No rate limiting on `/api/github/token`**
   Added a lightweight in-memory rate limiter (10 requests/minute per IP)
   to both backend options. This is a best-effort guard, not a hard
   boundary: it resets if the process restarts, and on Azure Functions
   Consumption plan it only persists for as long as the instance stays
   warm. Combined with the fact that each exchange still needs a valid,
   single-use GitHub `code`, this meaningfully raises the bar for abuse
   without needing a database.

9. **Concurrent writes race condition** (`src/background.js`)
   Added a per-file-path write queue (`enqueueWrite`) so overlapping syncs
   to the *same* path (e.g. a rapid resubmission of the same problem)
   serialize instead of racing each other's GET-sha-then-PUT sequence.
   This covers the common case within a single service worker lifetime,
   but doesn't survive a service worker restart or protect against two
   *different* browser instances/machines writing at once — a real
   distributed lock would need server-side state.

10. **Submission de-duplication was in-memory and per-page-load**
    (`src/content-main.js`, `src/background.js`)
    `content-main.js`'s in-memory `Set` still exists as a cheap first-pass
    filter, but the authoritative check now lives in
    `chrome.storage.local` (`seenSubmissionIds`, capped at 300 entries),
    which survives page reloads and service worker restarts. If a sync
    fails partway through, the submission ID is un-marked so a later retry
    isn't silently dropped forever.

11. **GraphQL query shapes are unverified against schema changes**
    (`src/background.js`) Each query (`submissionDetails`, `question`) now
    has a reduced fallback version. If the full query fails with what
    looks like a schema-mismatch error (unknown field/argument), the code
    automatically retries with the fallback instead of breaking the whole
    sync — you lose the runtime/memory stats in the commit message or the
    full problem description in the README, but the sync still completes.
    The field names themselves (`runtimeDisplay`, `runtimePercentile`,
    etc.) are still a best-effort guess and should be checked against a
    live DevTools → Network `/graphql` payload if things look off.

12. **No retry/backoff on transient network failures**
    Added a small `withRetry` helper (`src/lib.js`, unit tested) with
    exponential backoff, applied to the LeetCode GraphQL call, the GitHub
    Contents API calls, the OAuth token exchange, and the `/user` lookup.
    Doesn't help with a fully offline browser, but recovers from brief
    blips (DNS hiccup, a dropped connection, a 5xx).

13. **No user-visible error surface**
    A failed sync now sets a red "!" badge on the extension icon, and the
    popup shows a dismissible-on-next-sync error banner with the failure
    message and timestamp (`chrome.storage.local.lastError`). Still no
    push notification — the badge/banner only shows up when you look at
    the extension.

14. **Unknown submission languages fall back to `.txt`**
    Expanded `LANG_EXT` (`src/lib.js`) to cover LeetCode's SQL dialects
    (MySQL/MSSQL/Oracle/PostgreSQL → `.sql`) and Bash (`.sh`), in addition
    to the original list. Still a hardcoded map — any brand-new language
    LeetCode adds will fall back to `.txt` until the map is updated.

15. **`htmlToMarkdown` is regex-based, not a real HTML parser**
    Service workers have no DOM/`DOMParser`, so this remains a sequence of
    regex substitutions. Added link conversion (`<a href>` → Markdown
    link) and a few more HTML entities (`&times;`, `&le;`, `&ge;`,
    `&minus;`, `&hellip;`). The `<p>`/`<pre>` collision from #5 is fixed,
    but unusual or deeply nested markup can still fall through the final
    tag-stripping pass as plain text. Now covered by unit tests
    (`tests/lib.test.mjs`) so future regressions here are caught
    automatically instead of only being noticed by inspecting a commit.

## Still open

16. **Multi-topic problems only use the first tag** (`buildFolderPath` in
    `src/lib.js`) LeetCode doesn't guarantee tag ordering is meaningful,
    so folder assignment for multi-tag problems is somewhat arbitrary.
    Left as-is — this is a product decision (which folder wins) more than
    a bug, and changing it would need a UI to let people choose or a
    "multi-file-under-multiple-folders" design.

17. **Streak/solved stats live only in `chrome.storage.local`**
    (`updateStats`, `computeStreak`) Reinstalling the extension or
    clearing extension storage resets the streak and solved count to zero
    even though the GitHub repo history is untouched. Not fixed — would
    need either syncing a compact summary through `chrome.storage.sync`
    (small quota, workable for just the numbers) or reconstructing stats
    from the GitHub repo's commit history on demand. Left as a known
    limitation for now.

18. **Extension ID instability for Web Store publishing**
    A freshly loaded unpacked extension gets a different ID than the one
    Chrome assigns after publishing, unless you pin it with a `key` in
    `manifest.json` generated from your own keypair *before* first
    publish. This matters here because the GitHub OAuth redirect URI
    (`https://<ext-id>.chromiumapp.org/`) is derived from that ID — if it
    changes after publishing, the OAuth App's callback URL (and anyone's
    already-registered backend config) breaks. Not something we can fix in
    code since the keypair must be generated and kept by you. Steps are in
    the "Before submitting to the Chrome Web Store" checklist in
    `DEPLOY.md`.

19. **No automated coverage for the `chrome.*`-dependent code**
    `tests/lib.test.mjs` now covers all the pure logic (folder naming,
    commit message formatting, HTML→Markdown, streak math, retry
    behavior, base64 encoding, schema-error detection) with plain Node
    tests — run with `node --test tests/`. `background.js` itself (OAuth
    flow, GitHub API calls, storage) still has no automated coverage,
    since exercising it needs a mocked `chrome.*` API surface, which is a
    bigger lift than this pass covers.

## Not Bugs, But Worth Flagging

- `.funcignore` and `local.settings.json.example` ship inside the
  `backend-functions` deployment package (not excluded), harmless but
  unnecessary bytes in every deploy.
- No app icon set in `manifest.json` — Chrome shows a generic default
  icon both while loaded unpacked and (unless you add one before
  publishing) in the Chrome Web Store listing itself. Worth adding
  16/48/128px icons before submitting — see `DEPLOY.md`.
