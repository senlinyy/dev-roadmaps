---
title: "One Package, Two Environments"
sectionSlug: why-should-one-artifact-move-through-every-environment
order: 2
revision: 1
---

## Current situation

The checkout build embeds staging settings. Production is expected to use a different database and secret reference while keeping the new checkout feature disabled.

## The issue

The package carries environment-specific configuration, so it cannot be promoted unchanged with the correct behavior in both environments.

## Your task

Repair pipeline.yaml, staging.yaml, and production.yaml. Build a validated package without embedded environment settings, then supply each environment's configuration at deployment. Keep secrets as scoped references and preserve one artifact through staging verification and production.

## Success criteria

Both environments deploy the same single-built package. Staging uses staging-db with the feature enabled; production uses production-db with it disabled. No environment configuration is embedded in the package; failed staging health prevents production.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

build optionally accepts config; omit it for environment-neutral bytes. deploy accepts a config YAML file containing database, secret, and newCheckout. verify takes artifact and environment. No secret values or feature code execute.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
