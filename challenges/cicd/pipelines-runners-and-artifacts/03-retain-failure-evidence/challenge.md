---
title: "The Failed Test Lost Its Evidence"
sectionSlug: why-do-artifacts-carry-outputs-between-jobs
order: 3
revision: 1
---

## Current situation

A checkout test worker starts a temporary application and retains a JSON result only after its tests succeed. The worker's temporary files disappear after a release investigation.

## The issue

A failing test exits before report retention and teardown. The release team loses its useful failure record while a temporary server may remain running.

## Your task

Repair the job lifecycle so unit tests execute normally, their reports are retained at test-results.json on both success and failure, and generated files/processes are cleaned. Keep packaging downstream of successful tests; failure handling must not hide the original test result.

## Success criteria

Both cases retain the actual unit report and leave no test-worker residue. A test failure remains a failed pipeline and packaging never executes. A healthy run still builds the application.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

report takes check and path and retains that executed check's actual result. finally supports report and cleanup; it does not clear failure. needs is a list and gates packaging on the test job.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
