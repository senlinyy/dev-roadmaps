---
title: "Expose a Hidden Pipeline Failure"
sectionSlug: when-should-you-use-line-tools-structured-tools-or-another-interface
order: 9
---

A log-count pipeline prints zero even though its input is missing. A separate, readable log also lacks a completion marker. Those are different conditions and must not be diagnosed from output alone.

You start in `/home/dev`. `missing.log` must stay absent. `healthy.log` is a readable service log.

Your job:

1. With the default pipeline status behavior, pass the missing log through an ERROR filter and a line counter. Observe the diagnostic despite the zero count.
2. Enable pipeline failure propagation and repeat the same investigation. Inspect its exit status.
3. Quietly search `healthy.log` for the literal marker `deployment complete`, then inspect that search's exit status.
4. Leave the readable log unchanged and keep the missing input absent.

The grader checks the requested command results and file state, not an explanation or manually typed answer.
