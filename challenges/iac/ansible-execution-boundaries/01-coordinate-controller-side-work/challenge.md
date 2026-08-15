---
title: "Coordinate Controller-Side Work"
sectionSlug: delegating-to-another-host
order: 1
revision: 2
---

The release play needs one controller-side artifact lookup, per-host load balancer actions, and a fact shared back to the managed hosts. Place each operation at the correct execution boundary and avoid repeating the global lookup.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
