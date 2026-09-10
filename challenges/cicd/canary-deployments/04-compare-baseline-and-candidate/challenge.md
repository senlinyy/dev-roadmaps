---
retired: true
title: "Catch a Regression Hidden by Absolute Limits"
sectionSlug: how-should-baseline-and-canary-telemetry-be-compared
order: 3
revision: 1
---

## Current situation

The baseline records 0.1% errors. In one candidate case the error rate rises to 1.2% while remaining under the service-wide 2% ceiling. Healthy windows are also supplied so an always-abort policy is not acceptable. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The existing gate reads only an overly generous absolute threshold. It can promote a release whose errors are much worse than its control population.

## Your task

Build the exposure sequence and compare each candidate window with its baseline. Complete the healthy case and abort the regressing one at the first window. Use at least 100 requests per release and 300 seconds per window. Candidate errors must stay at or below 2%, increase by no more than 0.5 percentage points over baseline, latency stay at or below 300ms, and conversion drop by no more than 10% relative to baseline.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Comparable releases:** Baseline and candidate both report 0.1% errors. Required result: **deployed** on **green**.
- **Relative error regression:** Candidate errors are 1.2%; baseline remains 0.1%. Required result: **aborted** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. canary takes weights (increasing percentages written as quoted strings), assignment (sticky or random), and a policy filename. The policy uses minRequests, minSeconds, maxErrorRate (%), maxErrorIncrease (percentage points), maxLatency (ms), maxConversionDrop (relative %) and missing (hold or pass). Each exposure consumes the next matching authored window. Failed gates hold or return traffic to blue; they do not execute later steps.
:::
