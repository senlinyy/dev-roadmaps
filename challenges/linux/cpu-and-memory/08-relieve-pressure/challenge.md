---
title: "Relieve Competing Workload Pressure"
sectionSlug: what-evidence-should-you-preserve-before-intervention
order: 8
---

The orders API is competing with a replayable report export. The incident owner authorizes stopping only that export with a normal termination request. Keep the API process running and verify resource recovery. You start in `/home/dev`.

Your job:

1. Collect two current activity samples at least five simulated seconds apart, inspect memory headroom, and rank resident-memory consumers before intervention.
2. Identify the replayable report export by its command and request normal termination. Do not signal or reprioritize the orders API.
3. Recheck available memory and collect two fresh activity samples at least five simulated seconds apart.
4. Verify that the original orders API process remains present after the intervention.

The grader checks actual diagnostic observations, the targeted termination, and fresh recovery evidence; copied output is not evidence. Only the authored export exit changes this scenario's resource snapshot; there is no general scheduler or memory allocator.
