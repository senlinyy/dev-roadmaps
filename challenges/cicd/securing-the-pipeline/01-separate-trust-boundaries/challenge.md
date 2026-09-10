---
retired: true
title: "Stop an Unsafe Release"
sectionSlug: how-should-security-gates-and-exceptions-be-designed
order: 1
revision: 5
---

## Current situation

The checkout release already publishes a package. Security provides separate source, resolved-dependency, and image reports, but the workflow evaluates only the last layer and does not require it before release.

## The issue

A green image report cannot replace source or dependency evidence. Independent release jobs can deploy even when the required report is absent or blocking.

## Your task

Repair the source-to-release evidence chain in pipeline.yaml and its two policies. Evaluate source after checkout, dependencies after installation, and image evidence for the built package. Block high and critical findings; require security before staging and staging smoke success before production. Preserve one validated build.

## Success criteria

Healthy release evaluates all three report layers and promotes one package. Blocking source or dependency findings prevent build; a blocking image finding prevents all deployment. Missing reports stop release, and failed staging smoke blocks production.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

scan takes kind (source, dependencies, image), policy, and artifact for image reports. Security policy block lists severities. deploy policy security: true requires upstream passing image evidence for the exact digest. Reports are authored, not real scanner output.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
