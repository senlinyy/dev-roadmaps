---
title: "Bootstrap Node Telemetry"
sectionSlug: opentelemetry-setup
order: 3
---

Finish the telemetry bootstrap in `telemetry.js` and keep it imported before the application starts in `server.js`. Initialize the Azure Monitor OpenTelemetry distro with `APPLICATIONINSIGHTS_CONNECTION_STRING` from the environment and set the service name to `devpolaris-orders-api`. Do not hard-code a connection string or initialize telemetry after the server import.

The grader checks both source files and the startup ordering.
