# Bug Audit — v1

Status as of first working end-to-end sync. Grouped by severity. Each entry
notes whether it was fixed during initial development, partially mitigated,
or is still open.

## Fixed

1. **LeetCode `/v2/check/` endpoint mismatch** (`src/content-main.js`)
   The submission-status regex only matched `/submissions/detail/<id>/check/`.
   LeetCode's actual endpoint is `/submissions/detail/<id>/v2/check/`, so
   detection silently never fired. Fixed by making the `v2/` segment
   optional in the regex.

2. **Bloated Azure Functions deploy (554MB)** (`backend-functions/package.json`)
   `azure-functions-core-tools` was listed as a devDependency, so `npm
   install` pulled the entire CLI tool (with its own bundled runtime) into
   `node_modules`, which then got zipped and uploaded on every publish.
   Removed from package.json; `.funcignore` added as a second line of
   defense.

3. **GitHub commit 409 conflicts** (`src/background.js`)
   `commitFileToGithub` fetches a file's current `sha` then PUTs an update
   using that sha. If the sha goes stale between the GET and PUT (e.g. the
   file already existed from an earlier run), GitHub rejects the write.
   Mitigated with a single automatic retry that re-fetches the sha. **Not a
   complete fix** — see Open Issues below.

## Open Issues

### Security

4. **OAuth flow has no CSRF `state` parameter** (`src/background.js`,
   `startGithubOAuth`)
   The authorization URL sent to GitHub doesn't include a `state` value
   that gets verified on return. This is a standard OAuth CSRF protection —
   without it, a malicious site could in theory trick the flow into binding
   an attacker's GitHub session to the user's extension. Low real-world
   risk given the extension-only redirect URI, but worth adding for
   correctness before wider distribution.

5. **`ALLOWED_EXTENSION_ORIGIN` defaults to `"*"`** (`backend/server.js`,
   `backend-functions/src/functions/githubToken.js`)
   Until explicitly set, the backend's token-exchange endpoint accepts
   requests from any origin. Anyone who discovers the backend URL and a
   valid `client_id` could attempt the exchange. Should be hard-locked to
   the real extension origin before any public release, not just
   recommended in the docs.

6. **No rate limiting on `/api/github/token`**
   A public backend URL with no rate limiting could be hit repeatedly.
   Low impact (GitHub's own OAuth token endpoint enforces its own limits
   and each exchange still requires a valid, single-use `code`), but worth
   adding basic throttling if this goes public.

7. **Storage account key was exposed in plaintext during setup** (this
   conversation, not the code) — already flagged; rotate via `az storage
   account keys renew`.

### Correctness

8. **Concurrent writes race condition, partial coverage**
   `handleAcceptedSubmission` writes the solution file and README.md via
   `Promise.all`, i.e. concurrently. The 409-retry (#3) covers the common
   case, but under true simultaneous conflicting writes to the *same* path
   (e.g. rapid resubmission of the same problem faster than the first
   commit completes) a second retry could still collide. No queuing/locking
   exists.

9. **Submission de-duplication is in-memory and per-page-load**
   `seenSubmissionIds` in `content-main.js` resets on every page
   navigation/refresh. Re-visiting a problem page after a refresh and
   somehow re-triggering the same check response (unlikely but not
   impossible with LeetCode's polling) isn't protected against by anything
   server-side.

10. **GraphQL query shapes are unverified against schema changes**
    `submissionDetails` and `question` queries in `background.js` were
    written from general knowledge of LeetCode's (undocumented, unversioned)
    GraphQL API, the same way #1 was wrong. Any future field rename (e.g.
    `topicTags` → something else) will fail silently or with an unhelpful
    error. No schema validation or fallback exists. **This now also covers
    the new `runtimeDisplay` / `runtimePercentile` / `memoryDisplay` /
    `memoryPercentile` / `content` fields added for commit-message stats
    and README generation — these field names are a best-effort guess and
    should be checked against a real DevTools → Network `/graphql` payload
    if commit messages or READMEs come out with "N/A" or garbled text.**

11. **Multi-topic problems only use the first tag**
    `buildFolderPath` always uses `topicTags[0]`. LeetCode doesn't
    guarantee tag ordering is meaningful (e.g. "primary" vs "secondary"
    topic), so folder assignment for multi-tag problems is somewhat
    arbitrary.

12. **Unknown submission languages fall back to `.txt`**
    `LANG_EXT` in `background.js` is a hardcoded map. Any language LeetCode
    adds later, or any name mismatch between GraphQL's `lang.name` and the
    map's keys, silently produces a `.txt` file instead of erroring or
    warning.

13. **`htmlToMarkdown` is regex-based, not a real HTML parser**
    (`src/background.js`) Service workers have no DOM/`DOMParser`, so the
    problem-statement-to-Markdown conversion is done with a sequence of
    regex substitutions. It handles LeetCode's typical tag set (`p`, `br`,
    `pre`, `code`, `b`/`strong`, `i`/`em`, `sup`, `ul`/`ol`/`li`) but isn't
    exhaustive — unusual nested markup or tags not in the list will fall
    through the final tag-stripping pass as plain text rather than being
    reformatted.

14. **Streak/solved stats reset if `chrome.storage.local` is cleared**
    (`updateStats`, `computeStreak`) Stats live only in
    `chrome.storage.local` (device-local, not synced). Reinstalling the
    extension or clearing extension storage resets the streak and solved
    count to zero even though the GitHub repo history is untouched.

### UX / Reliability

15. **No user-visible error surface**
    All sync failures currently only appear in the background service
    worker's console (`chrome://extensions` → Errors). A failed sync is
    silent from the popup's perspective — no badge, no notification, no
    "last sync failed" state. The popup only tracks `lastSync` on success.

16. **No retry/backoff on transient network failures**
    A single dropped request to LeetCode's GraphQL API or GitHub's API
    (browser offline for a moment, DNS blip) fails the whole sync
    permanently for that submission with no retry.

17. **Extension ID instability for Web Store publishing**
    Already flagged separately — dev extension ID ≠ published ID unless a
    stable `key` is set in `manifest.json` before packaging. Not yet
    implemented.

18. **No tests**
    Zero automated coverage — everything was verified manually against a
    live LeetCode account and live Azure resources during this session.

19. **Repo auto-creation always defaults to public** (`ensureRepoExists`)
    The one-click connect flow creates `leetcode-solutions` as a public
    repo (`private: false`) if it doesn't already exist. Anyone who wants a
    private repo needs to either create it themselves beforehand (the
    extension will detect and reuse it) or the default should be revisited
    before wider distribution.

## Not Bugs, But Worth Flagging

- `.funcignore` and `local.settings.json.example` ship inside the
  `backend-functions` deployment package (not excluded), harmless but
  unnecessary bytes in every deploy.
- No app icon set in `manifest.json` — Chrome shows a generic default icon.
