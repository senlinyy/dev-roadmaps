---
retired: true
title: "Stop a Checkout Regression Behind Green Infrastructure"
sectionSlug: what-should-special-canary-forms-and-metrics-prove
order: 5
revision: 1
---

## Current situation

Candidate CPU-independent service signals look healthy: 0.1% errors and 180ms latency. In the bad case, checkout conversion falls from the baseline 10% to 8.2%, an 18% relative drop. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The existing release policy ignores business outcomes. It would continue a technically healthy release that prevents customers completing purchases.

## Your task

Build a progressive, cohort-stable rollout with a business gate as well as technical checks. Promote the healthy candidate and abort the checkout regression at 5% exposure. Use at least 100 requests per release and 300 seconds per window. Candidate errors must stay at or below 2%, increase by no more than 0.5 percentage points over baseline, latency stay at or below 300ms, and conversion drop by no more than 10% relative to baseline.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Healthy checkout:** Candidate conversion matches the baseline. Required result: **deployed** on **green**.
- **Lost purchases:** Candidate conversion is 8.2% against baseline 10%, despite healthy errors and latency. Required result: **aborted** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. canary takes weights (increasing percentages written as quoted strings), assignment (sticky or random), and a policy filename. The policy uses minRequests, minSeconds, maxErrorRate (%), maxErrorIncrease (percentage points), maxLatency (ms), maxConversionDrop (relative %) and missing (hold or pass). Each exposure consumes the next matching authored window. Failed gates hold or return traffic to blue; they do not execute later steps.
:::
