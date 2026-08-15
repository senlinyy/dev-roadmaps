---
title: "Wire One Module Output into Another"
sectionSlug: wiring-outputs-into-other-modules
order: 1
revision: 2
---

The root environment composes an application module and an observability module. Publish the application endpoint through its public output and pass that output into monitoring without reaching through the module boundary.

Your job:

1. **Declare** string input `endpoint` in `modules/monitoring` and use it for the health check URL.
2. **Declare** output `endpoint` in `modules/app` from `aws_lb.app.dns_name`.
3. **Pass** `module.app.endpoint` to `module.monitoring.endpoint` in the root module.

The grader checks the resulting configuration and its relationships, not formatting or a prose explanation.
