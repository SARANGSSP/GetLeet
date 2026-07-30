# Privacy Policy — GetLeet

**Last updated:** July 30, 2026

GetLeet is a Chrome extension that syncs your accepted LeetCode
submissions to a GitHub repository you control. This policy explains what
data the extension touches, where it goes, and what it does *not* do.

## What data GetLeet accesses

- **LeetCode submission data**: your submitted code, the programming
  language used, runtime/memory stats, and the problem's title,
  difficulty, topic tags, and description. This is read directly from
  leetcode.com while you're logged in, using your existing browser
  session.
- **GitHub account data**: your GitHub username and a GitHub access token
  (obtained via GitHub's official OAuth flow), used to create/access a
  repository under your account and commit files to it.

## What GetLeet does with this data

- Submission code and problem details are committed directly to the
  GitHub repository you connect — nothing else is done with them.
- Your GitHub access token is stored locally in your browser
  (`chrome.storage.sync`) so you don't have to reconnect every time. It is
  sent only to GitHub's API and, during the initial connect step, to the
  OAuth backend that exchanges an authorization code for that token.
- Sync stats (streak, solved count) are calculated and stored locally in
  your browser (`chrome.storage.local`).

## What GetLeet does NOT do

- GetLeet does not sell, share, or transmit your data to any third party.
- GetLeet does not send your code, submissions, or GitHub data to any
  server other than GitHub's own API and the OAuth token-exchange
  backend described above — and that backend does not log or store the
  code or token; it's a pure pass-through exchange.
- GetLeet does not track your browsing outside of leetcode.com problem
  pages.

## Data retention and control

- All extension data lives in your own browser storage and your own
  GitHub repository. Uninstalling the extension removes its locally
  stored data (settings, token, stats). Your GitHub repository and its
  history are unaffected, since that data belongs to you on GitHub.
- You can revoke GetLeet's GitHub access at any time from
  [github.com/settings/applications](https://github.com/settings/applications).

## Contact

Questions about this policy or the extension can be raised via an issue
on the project's GitHub repository.
