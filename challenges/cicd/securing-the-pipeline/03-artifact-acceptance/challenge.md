---
title: "Correct Tag, Untrusted Artifact"
sectionSlug: how-do-sboms-digests-signatures-and-provenance-protect-artifacts
order: 3
revision: 1
---

## Current situation

The release uses an app artifact name, but its builder, source, inventory, and signature-verification evidence are not all checked before production.

## The issue

A familiar name can hide an unapproved build path or evidence for another digest. A checksum alone does not establish who produced the package.

## Your task

Extend the validated producer to attach inventory and authored provenance/signature evidence before publishing. In a downstream release worker, evaluate acceptance.yaml and make deployment require acceptance of the exact package. Trust only trusted-ci building candidate-43; require inventory, passing signature evidence, and digest binding.

## Success criteria

The trusted candidate deploys. Wrong builder, wrong source, failed signature, absent inventory, or evidence for another digest all block deployment. Inventory comes from the resolved dependencies, not a handwritten passing report.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

attest takes artifact and inventory. accept takes artifact and policy (builders, source, signature, inventory, bindDigest). deploy policy accepted: true requires an upstream acceptance proof. Signature results are immutable scenario fixtures.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
