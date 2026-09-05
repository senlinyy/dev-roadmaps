---
title: "The Workflow Can Remove Its Own Protection"
sectionSlug: how-do-review-audit-detection-and-recovery-protect-the-chain
order: 6
revision: 1
---

## Current situation

The checkout repository accepts application and pipeline changes under one permissive review policy. Scenario proposals include sensitive workflow edits, author self-approval, and failed workflow-policy checks.

## The issue

A change can remove its own safeguards or be approved by someone without responsibility for release controls.

## Your task

Configure review-policy.yaml and make the integration job consume it before merge. Protect pipeline.yaml, .ci/, and deploy/ changes with platform-team ownership, require at least one independent review for every change, and require unit plus workflow-policy evidence. Do not reject ordinary properly reviewed application changes.

## Success criteria

Ordinary peer-reviewed changes and independently platform-reviewed workflow changes pass. Wrong-owner review, self-approval, or failed workflow-policy evidence blocks merge.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

review reads protectedPaths (prefixes), owners, independent, minReviews, and checks. Proposal authors, changed paths, reviewers, and reported checks are immutable fixtures. merge separately consumes current source-check evidence.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
