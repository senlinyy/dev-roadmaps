---
retired: true
title: "Re-Evaluate Every Promotion Window"
sectionSlug: how-does-a-complete-canary-control-loop-fit-together
order: 6
revision: 2
---

## Current situation

The canary progresses through four exposure windows. One fixture stays healthy, a second develops latency problems at 50%, and a third loses baseline telemetry at 25%. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter assumes a single early success authorizes the entire release. That misses delayed regressions and cannot tell missing evidence from a pass.

## Your task

Rebuild the complete control loop: analyze every exposure, promote only after each gate, abort the late regression before 100%, and hold missing baseline telemetry before 50%. Use at least 100 requests per release and 300 seconds per window. Candidate errors must stay at or below 2%, increase by no more than 0.5 percentage points over baseline, latency stay at or below 300ms, and conversion drop by no more than 10% relative to baseline.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **All windows healthy:** Four complete passing windows. Required result: **deployed** on **green**.
- **Regression at 50%:** The first two windows pass; the third reaches 600ms. Required result: **aborted** on **blue**.
- **Baseline lost at 25%:** The second window lacks its baseline sample. Required result: **held**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. canary takes weights (increasing percentages written as quoted strings), assignment (sticky or random), and a policy filename. The policy uses minRequests, minSeconds, maxErrorRate (%), maxErrorIncrease (percentage points), maxLatency (ms), maxConversionDrop (relative %) and missing (hold or pass). Each exposure consumes the next matching authored window. Failed gates hold or return traffic to blue; they do not execute later steps.
:::
