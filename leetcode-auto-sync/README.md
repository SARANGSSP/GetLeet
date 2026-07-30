# LeetCode Auto-Organizer Sync

> **License note:** This repository is public for transparency and
> collaboration, but is **not** licensed for republishing to the Chrome
> Web Store or any other extension marketplace without the author's
> permission. See [LICENSE.md](./LICENSE.md).

A Chrome extension that syncs your accepted LeetCode submissions to a
GitHub repo automatically — one click to connect, then everything else
(username, repo, folder structure) is handled for you. It reads the
problem's difficulty and topic tags from LeetCode itself and commits the
solution to the right folder for you.

**Inspired by [LeetSync](https://github.com/LeetSync/LeetSync)** — the
original LeetCode → GitHub auto-sync extension. This project reuses the
same core idea (watch submissions, push to GitHub) with a different setup
flow and folder/README layout. All credit for pioneering this workflow
goes to the LeetSync team. 🙏

## How it works

1. `src/content-main.js` runs in the LeetCode page's own JS context and
   watches the page's `fetch` calls for the submission-status polling
   endpoint. When it sees `"Accepted"`, it grabs the submission ID.
2. That gets relayed (via `content-isolated.js`) to the background service
   worker.
3. The background worker calls LeetCode's GraphQL API (`/graphql`) to get:
   - the submitted code, language, and runtime/memory stats
     (`submissionDetails` query)
   - the problem's difficulty, topic tags, and full description
     (`question` query)
4. It builds a folder path based on your chosen organization mode —
   **one folder per problem** — and commits the solution file plus a
   formatted `README.md` (created once per problem) to your GitHub repo
   via the GitHub Contents API.

## Setup

### 1. Load the extension
1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select this folder

### 2. Connect GitHub
Click the extension icon and hit **Connect with GitHub**. That's it —
the extension:
- opens a GitHub authorization popup (no token to copy/paste)
- looks up your GitHub username automatically
- creates a `leetcode-solutions` repo under your account if you don't
  already have one (or reuses it if you do)

No owner, repo, branch, or token fields to fill in for the default setup.
If you want a different repo name or organization mode, they're available
under **Advanced settings**, along with a manual Personal Access Token
option and self-hosted OAuth backend fields for anyone who wants full
control.

### 3. Solve problems as usual
You must be logged into leetcode.com in the same browser. Submit a
problem, wait for "Accepted", and the extension pushes the code to your
repo within a couple seconds. The badge on the extension icon flashes a
green checkmark on success, and the popup's **streak** and **solved**
counters update automatically.

## Repo layout

Every problem gets its own folder, so resubmissions (in any language)
always land in the same place:

```
<Difficulty>/<Topic>/<Problem Title>/
  ├── Solution.py          # or .java, .cpp, etc. — one file per language used
  └── README.md            # created once: title, difficulty badge, topics,
                            # full problem statement, examples, and constraints
```

Commit messages follow LeetSync's convention, e.g.:

```
Time: 0 ms (100.00%) | Memory: 19.2 MB (88.88%) - LeetSync
```

## Notes / caveats

- This relies on the shape of LeetCode's internal GraphQL API, which is
  undocumented and can change without notice. If syncing stops working,
  open the LeetCode submission page, check DevTools → Network → look at
  the `/graphql` request bodies, and adjust the queries in
  `src/background.js` to match.
- Multi-tag problems: when a mode uses "topic," the extension currently
  uses the **first** topic tag LeetCode returns for that problem, since a
  problem can have several tags and only one is needed for a folder path.
- The problem description is converted from LeetCode's HTML to Markdown
  with a lightweight built-in converter — most formatting (code blocks,
  lists, bold/italic, examples, constraints) carries over cleanly, but it
  isn't a full HTML parser, so unusual formatting may occasionally slip
  through as raw text.
- The extension only requests host permissions for `leetcode.com`,
  `api.github.com`, and `github.com` — nothing else.
