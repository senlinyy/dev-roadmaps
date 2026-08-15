---
title: "Replace Imperative Setup"
sectionSlug: repeated-runs-should-settle
order: 1
revision: 2
---

A bootstrap play currently uses shell commands that report changes every time. Replace them with convergent tasks that create the service account, directory, and package state without hiding failures or inventing `changed_when` expressions.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
