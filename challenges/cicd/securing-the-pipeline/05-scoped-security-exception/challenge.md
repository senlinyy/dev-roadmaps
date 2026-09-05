---
title: "An Exception That Never Expires"
sectionSlug: how-should-security-gates-and-exceptions-be-designed
order: 5
revision: 1
---

## Current situation

Security authorized one temporary exception for legacy-parser in app, owned by checkout-team and approved by security-lead until scenario time 1100. The current release policy ignores all high findings.

## The issue

Blanket suppression permits unrelated findings and survives past the authorized deadline. No release record identifies the bounded exception being used.

## Your task

Repair security.yaml and exceptions.json, then wire the image evaluation into the release path. Block high and critical findings; represent only the supplied finding/artifact/owner/approver/expiry exception with its compensating-control reason. Missing reports must still stop release.

## Success criteria

The authorized exception permits its one release and is recorded. An expired exception, unrelated critical finding, or missing report blocks deployment. Clean releases still pass.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

Security policy block lists severities and exceptions names a JSON array file. Each entry has id, artifact, owner, approvedBy, expires, reason. Scenario time and allowed exception authorities are fixed.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
