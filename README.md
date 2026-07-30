# GetLeet

> **License note:** This repository is public for transparency and
> collaboration, but is **not** licensed for republishing to the Chrome
> Web Store or any other extension marketplace without the author's
> permission. See [LICENSE.md](./LICENSE.md).

A Chrome extension that syncs your accepted LeetCode submissions to a GitHub
repo automatically — no manually picking a folder for difficulty or topic
like LeetSync requires. It reads the problem's difficulty and topic tags
from LeetCode itself and commits the solution to the right folder for you.

## How it works

1. `src/content-main.js` runs in the LeetCode page's own JS context and
   watches the page's `fetch` calls for the submission-status polling
   endpoint. When it sees `"Accepted"`, it grabs the submission ID.
2. That gets relayed (via `content-isolated.js`) to the background service
   worker.
3. The background worker calls LeetCode's GraphQL API (`/graphql`) to get:
   - the submitted code + language (`submissionDetails` query)
   - the problem's difficulty + topic tags (`question` query)
4. It builds a folder path based on your chosen organization mode and
   commits the file to your GitHub repo via the GitHub Contents API.

## Setup

### 1. Load the extension
1. Go to `chrome://extensions`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select this folder

### 2. Create a GitHub token
1. GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens (or classic, with `repo` scope)
2. Grant it write access to the repo you want solutions pushed to
3. Copy the token

### 3. Configure the extension
Click the extension icon and fill in:
- **GitHub token** — from step 2
- **Repo owner / name** — e.g. `yourname` / `leetcode-solutions`
- **Branch** — usually `main`
- **Auto-organize by** — choose:
  - Difficulty only → `Easy/`, `Medium/`, `Hard/`
  - Topic only → `Array/`, `Dynamic-Programming/`, etc. (uses the first
    topic tag LeetCode lists for the problem)
  - Difficulty → Topic → `Medium/Dynamic-Programming/`
  - Topic → Difficulty → `Dynamic-Programming/Medium/`

Click **Save Settings**.

### 4. Solve problems as usual
You must be logged into leetcode.com in the same browser. Submit a
problem, wait for "Accepted", and the extension pushes the code to your
repo within a couple seconds. The badge on the extension icon flashes a
green checkmark on success.

## Notes / caveats

- This relies on the shape of LeetCode's internal GraphQL API, which is
  undocumented and can change without notice. If syncing stops working,
  open the LeetCode submission page, check DevTools → Network → look at
  the `/graphql` request bodies, and adjust the queries in
  `src/background.js` to match.
- Multi-tag problems: when a mode uses "topic," the extension currently
  uses the **first** topic tag LeetCode returns for that problem, since a
  problem can have several tags and only one is needed for a folder path.
- The extension only requests host permissions for `leetcode.com` and
  `api.github.com` — nothing else.
