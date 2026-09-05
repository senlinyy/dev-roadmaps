---
title: "Find the Right Reference"
sectionSlug: how-do-search-and-substitution-find-and-review-changes
order: 6
---

Before changing a backend address, review every reference and know how to revisit a match. You start in `/home/dev`.

Your job:

1. **Open `/home/dev/upstreams.conf` in Vim** and search forward for the shared backend address `api.internal`.
2. **Move to a subsequent match and back to the previous match** using search navigation.
3. **Perform a backward search** for the same address, without modifying the file.
4. **Quit and display the unchanged file** from the terminal.

The grader checks successful forward and backward search movement, next/previous match navigation, and a completed read-only session.
