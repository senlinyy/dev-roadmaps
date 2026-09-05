---
title: "HTTP Is Healthy, Checkout Is Broken"
sectionSlug: how-does-production-feedback-complete-the-release
order: 6
revision: 1
---

## Current situation

A limited checkout candidate is deployed and returns successful HTTP responses. Authored production windows include technical metrics and purchase completion.

## The issue

The release currently ends at deployment. It can increase exposure without observing a purchase regression or waiting for enough evidence.

## Your task

Add candidate observation after deployment and configure health-policy.yaml. Require a 300-second window, at least 1000 requests, error rate at most 1 percent, latency at most 250 ms, and purchase completion at least 95 percent. Missing or insufficient evidence must not permit progression.

## Success criteria

Only the healthy window permits further exposure. Purchase degradation, elevated errors, too few requests, and a short window block progression for the deployed candidate.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

observe takes artifact and policy. Policy fields: minSeconds, minRequests, maxErrorRate, maxLatency, minPurchaseRate. Metrics use supplied windows; no live telemetry or traffic is generated.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
