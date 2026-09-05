---
title: "Ready to Release Is Not Approved to Release"
sectionSlug: how-do-environments-and-approval-gates-add-evidence
order: 3
revision: 1
---

## Current situation

The checkout release has staging smoke checks and an authored release-manager decision. The production policy does not require that decision to match the current candidate.

## The issue

An unrelated or expired approval can be treated as permission, and production's graph does not wait for staging.

## Your task

Repair pipeline.yaml, approval.yaml, and rollout.yaml. Keep the validated single build, stage and verify it, then require an approved, unexpired release-manager decision for that exact artifact and production environment before deployment. Approval cannot override technical failure.

## Success criteria

Only the healthy, properly approved release reaches production. Missing/denied, expired, or wrong-candidate approval blocks it. A staging failure prevents both approval consumption and production.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

approve takes artifact, environment, policy. Approval policy fields: actors, bindArtifact, expires. deploy policy approval: true requires an upstream matching approval. The scenario clock supplies expiry checks.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
