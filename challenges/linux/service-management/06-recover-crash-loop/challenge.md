---
title: "Recover From a Crash Loop"
sectionSlug: how-do-restart-policy-resource-controls-and-timers-add-resilience
order: 6
---

The orders unit is failed with `start-limit-hit`. The restart policy already has a five-second delay and a three-start limit within sixty seconds. Removing those controls would leave the bad deployment retrying indefinitely. You start in `/home/dev`.

Your job:

1. Use the current boot's recent journal to find the first application failure.
2. Repair `/etc/orders/app.env` using database URL `postgres://orders@db.internal/orders`. Preserve its other settings, root ownership, and mode `600`. Leave the unit and restart limits unchanged.
3. Clear the failed state and start the repaired service.
4. Advance the lab clock by ten seconds, then inspect its active state, result, restart policy, delay, and automatic restart count.

The grader checks repair of the actual environment source and fresh property inspection of the recovered process. Foreground `sleep` advances simulated time immediately; there is no real database connection.
