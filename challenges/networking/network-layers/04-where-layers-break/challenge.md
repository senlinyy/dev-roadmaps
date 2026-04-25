---
title: "Pinpoint Which Layer Broke from Tool Output"
sectionSlug: where-each-layer-breaks
order: 4
---

For each scenario below, you are handed a snippet of *real* Linux network-tool output. The text is the failure marker your future self will grep for at 3am. Your job is to read each snippet, recognize which OSI layer the tool reports on, and pick the **single layer** that is broken.

You should not need to memorize every tool. Focus on which layer the failure marker actually proves: a `NO-CARRIER` flag is not the same evidence class as a TCP `Connection refused`, even though both look like “the network is down.”
