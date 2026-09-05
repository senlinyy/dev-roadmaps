---
title: "Restore an SPA Deep Link"
sectionSlug: how-does-nginx-serve-static-files-directly
order: 3
---

The application shell loads at `/`, but refreshing `/account/settings` returns 404 because no file exists at that literal path.

1. Capture the current deep-link response.
2. Change `try_files` so real files and directories still win, then fall back to `/index.html`.
3. Test and reload the saved configuration.
4. Prove the deep link now returns the application shell.
