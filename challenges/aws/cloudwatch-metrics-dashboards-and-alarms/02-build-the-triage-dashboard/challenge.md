---
title: "Build the Triage Dashboard"
sectionSlug: build-dashboards-for-triage
order: 2
---

Build the first triage dashboard for orders-api. Use one metric widget in eu-west-2 with a 60-second period. Plot ALB RequestCount as Sum, HTTPCode_Target_5XX_Count as Sum, and TargetResponseTime p95 for the supplied load balancer dimension. Give the widget a clear title and keep all three signals together so an operator can compare traffic, errors, and latency.
