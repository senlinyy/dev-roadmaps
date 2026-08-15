---
title: "Compose Reusable Task Files"
sectionSlug: reuse-also-has-timing
order: 1
revision: 2
---

Split a deployment into statically imported installation work and conditionally included verification work. Keep both task files real and linked from the main play so tooling can see installation early while verification remains runtime-controlled.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
