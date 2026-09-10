---
retired: true
title: "Deployment Started, Service Never Became Ready"
sectionSlug: how-do-health-checks-and-gradual-rollouts-limit-failure
order: 4
revision: 1
---

## Current situation

Production has four healthy old instances. The current rollout replaces all of them without observing readiness or enforcing a deadline.

## The issue

A process can start but never become ready. The current procedure calls that a successful release and can consume all healthy capacity.

## Your task

Repair rollout.yaml and wire it into the package deployment in pipeline.yaml. Replace one instance at a time, use temporary surge capacity, preserve at least three healthy instances, and require readiness within 30 seconds before continuing.

## Success criteria

Normal and 25-second startup replace all four instances. An unhealthy or over-deadline candidate stops before any old instance is replaced, preserving four healthy old instances. Only one release package is built.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

deploy policy supports readiness, deadline, batch, surge, and minHealthy. Timings and replicas are authored, bounded state transitions—not Kubernetes or a real scheduler.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
