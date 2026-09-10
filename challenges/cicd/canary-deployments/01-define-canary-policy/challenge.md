---
retired: true
title: "Build a Measured Exposure Ladder"
sectionSlug: how-do-release-shape-traffic-weight-sample-size-and-time-fit-together
order: 1
revision: 2
---

## Current situation

Orders checkout has authored telemetry at 5%, 25%, 50% and 100% candidate traffic. Multi-step payment sessions need stable release assignment. The initial blast radius is at most 5%, and later jumps may not exceed 50 percentage points. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The release jumps directly to full exposure with random per-request assignment. It bypasses every opportunity to stop before the whole customer population is affected.

## Your task

Replace the direct jump with a measured progression through the available windows, keep sessions in stable cohorts, and verify full green only after all windows pass. Use at least 100 requests per release and 300 seconds per window. Candidate errors must stay at or below 2%, increase by no more than 0.5 percentage points over baseline, latency stay at or below 300ms, and conversion drop by no more than 10% relative to baseline.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Healthy progression:** All four windows meet the release budget. Required result: **deployed** on **green**.
- **First-window latency:** The candidate reaches 450ms in the first 5% window. Required result: **aborted** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. canary takes weights (increasing percentages written as quoted strings), assignment (sticky or random), and a policy filename. The policy uses minRequests, minSeconds, maxErrorRate (%), maxErrorIncrease (percentage points), maxLatency (ms), maxConversionDrop (relative %) and missing (hold or pass). Each exposure consumes the next matching authored window. Failed gates hold or return traffic to blue; they do not execute later steps.
:::
