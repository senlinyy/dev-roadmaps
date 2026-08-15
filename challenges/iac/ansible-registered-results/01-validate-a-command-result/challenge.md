---
title: "Validate a Command Result"
sectionSlug: validation-before-service-changes
order: 1
revision: 2
---

A vendor configuration checker is the only supported validation interface. Run it without claiming a change, register its result, fail on a nonzero return code, and assert that the expected success marker is present before deployment continues.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
