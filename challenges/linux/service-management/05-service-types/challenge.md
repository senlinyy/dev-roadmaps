---
title: "Pick the Right systemd Service Type"
sectionSlug: service-types-and-what-active-means
order: 5
kind: quiz
---

The `Type=` directive is a contract between a process and systemd about when the service is really ready. This knowledge check focuses on readiness races, double-fork daemons, one-time jobs, notify units, and type mismatches that make green service status lie.
