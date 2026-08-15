---
title: "Wire a Safe Restart Handler"
sectionSlug: notify-and-handlers
order: 1
revision: 2
---

The orders service should restart only after a validated configuration change. Render the template, notify one named handler, and define that handler with the service module so multiple notifications still produce one restart.

Work across the provided files as needed. The grader checks the resulting Ansible project, including relationships between files, rather than matching a sample answer.
