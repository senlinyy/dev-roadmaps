---
title: "Build the Release Playbook"
sectionSlug: roll-out-from-ci
order: 2
revision: 2
---

Build the playbook that CI will release after approval. Require an immutable release identifier, update one host at a time with zero tolerated failures, and verify health before each host completes its batch.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
