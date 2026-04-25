---
title: "Pick the Right systemd Service Type"
sectionSlug: service-types-and-what-active-means
order: 5
kind: quiz
---

The `Type=` directive in a unit file tells systemd how the service signals readiness. Pick the wrong type and systemd either marks the service "active" before it can serve traffic, or hangs forever waiting for a notification that never comes.

This quiz puts you in front of common readiness mismatches. The right answer is whichever type lets dependent services (and load balancers, and health checks) believe the service is ready exactly when it really is.
