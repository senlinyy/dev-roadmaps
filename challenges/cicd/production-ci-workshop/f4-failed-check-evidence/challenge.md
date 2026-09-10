---
title: "Preserve failures and their diagnostic reports"
sectionSlug: preserve-failures-and-their-diagnostic-reports
order: 4
revision: 1
---

## Description

An assertion fails in the Orders test suite, but CI reports success and no diagnostic report is retained. The team cannot trust the green status or investigate the failure from the run’s artifacts.

As the CI maintainer, investigate the test wrapper and workflow, then restore reliable failure reporting without losing readable output.

## Requirements

1. **Failure Propagation**. Preserve the test process’s nonzero exit status through the logging wrapper so a failing assertion fails the CI job.
2. **Diagnostic Reports**. Retain both the JUnit report and console log when tests fail, not only on successful runs.
3. **Readable Output**. Keep test output visible in the job log while saving the diagnostic files.
4. **Build Gate**. Prevent compilation from running after failed tests; do not suppress errors to keep the pipeline green.

:::expand[Workspace and verification]{kind="note"}

Editable files: `scripts/test-ci.sh`, `.github/workflows/ci.yml`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
