---
retired: true
title: "Missing Data Is Not a Green Signal"
sectionSlug: how-do-automated-gates-form-a-fail-closed-control-loop
order: 4
revision: 1
---

## Current situation

The release has four telemetry conditions: a healthy full sample, only eight candidate requests, a missing candidate stream, and a thirty-second observation despite enough requests. The same analysis policy must handle all three. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter accepts empty evidence and skips the sample/time requirements, treating the absence of observed failures as proof of safety.

## Your task

Repair both the progressive release plan and its evidence policy. Promote healthy evidence, but hold at the first 5% exposure when samples or telemetry are insufficient; do not increase traffic or falsely classify an inconclusive window as an application regression. Use at least 100 requests per release and 300 seconds per window. Candidate errors must stay at or below 2%, increase by no more than 0.5 percentage points over baseline, latency stay at or below 300ms, and conversion drop by no more than 10% relative to baseline.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Enough evidence:** All windows have 500 requests per release. Required result: **deployed** on **green**.
- **Eight requests:** Only eight candidate requests were observed in the first window. Required result: **held**.
- **Observation too short:** 500 requests per release arrived, but only 30 seconds elapsed. Required result: **held** at 5% traffic.
- **Missing candidate telemetry:** The first candidate stream is absent. Required result: **held**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. canary takes weights (increasing percentages written as quoted strings), assignment (sticky or random), and a policy filename. The policy uses minRequests, minSeconds, maxErrorRate (%), maxErrorIncrease (percentage points), maxLatency (ms), maxConversionDrop (relative %) and missing (hold or pass). Each exposure consumes the next matching authored window. Failed gates hold or return traffic to blue; they do not execute later steps.
:::
