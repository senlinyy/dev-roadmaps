---
title: "Replace Carefully"
sectionSlug: how-do-search-and-substitution-find-and-review-changes
order: 7
---

Active endpoints are moving to production, but a commented rollback example must retain the development address. You start in `/home/dev`.

Your job:

1. **Open `/home/dev/endpoints.conf` in Vim** and use a file-wide substitution with confirmation.
2. **Change every active `api-dev.example.com` reference to `api-prod.example.com`**, including both entries on the mirrors line.
3. **Reject the replacement in the rollback comment** so that example stays byte-for-byte unchanged.
4. **Save, quit, and display the saved file** from the terminal.

The grader checks substitution, both accepted and rejected confirmations, and all active and preserved references.
