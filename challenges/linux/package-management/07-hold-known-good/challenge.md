---
title: "Hold the Known-Good Build"
sectionSlug: how-do-third-party-sources-and-pins-change-risk
order: 7
revision: 1
---

The next `database-agent` build has a known regression, while an unrelated `curl` security update is approved. Protect the known-good database agent without blocking the rest of the maintenance window.

You start in `/home/dev`. Your job:

1. **Inspect the installed and candidate database-agent versions.**
2. **Place only that package on hold.**
3. **Run the normal upgrade** so unrelated eligible packages can move.
4. **Verify the active hold list** after the transaction.

The grader checks that the database agent stays at its known-good version while the approved package upgrades.
