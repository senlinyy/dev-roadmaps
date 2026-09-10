---
retired: true
title: "Bind Production Authority to the Candidate"
sectionSlug: why-must-artifact-creation-be-separate-from-production-authorization
order: 5
revision: 2
---

## Current situation

ci-builder creates the artifact; release-owner independently authorizes production. Cases include exact approval for green, approval for a different retained candidate, and an attempted self-approval by the builder. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter treats staging and artifact creation as permission to deploy. It neither verifies who authorized production nor which bytes they approved.

## Your task

Create the full evidence chain and enforce independent exact-candidate production authorization. Promote green only in the authorized case. Keep blue active for mismatched and self-approved evidence, even though application checks pass.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Authorized green:** release-owner approved green for production. Required result: **deployed** on **green**.
- **Approval for different bytes:** The approval names rebuilt, not green. Required result: **held** on **blue**.
- **Builder self-approval:** The authorizing actor is ci-builder, not the independent release owner. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. select chooses a retained release; attest verifies source and builder against authored provenance. stage takes config and parity YAML mapping filenames plus secret references. smoke verifies the staged bytes. authorize takes environment and actor; promote transfers the selected bytes unchanged. Changing selection invalidates earlier evidence. No build, registry access, signing service or production deployment runs.
:::
