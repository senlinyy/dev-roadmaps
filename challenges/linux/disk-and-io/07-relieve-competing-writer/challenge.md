---
title: "Identify the Competing Writer"
sectionSlug: how-do-you-identify-the-process-behind-device-activity
order: 7
---

Device `vdb` is slow while a replayable report export competes with the orders API. The incident owner authorizes a normal termination request for the export only, after you establish its identity and current I/O activity. Keep the API running. You start in `/home/dev`.

Your job:

1. Collect two current five-second I/O intervals for `vdb`, and inspect process identities.
2. Read the export's per-process I/O counters twice, at least five simulated seconds apart, and inspect its open files.
3. Request normal termination of only the replayable export. Do not signal or reprioritize the API.
4. Repeat the two device intervals and verify that the original orders API process is still present.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
