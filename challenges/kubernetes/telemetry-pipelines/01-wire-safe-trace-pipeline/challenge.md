---
title: "Wire a Safe Trace Pipeline"
sectionSlug: configure-the-collector-in-layers
order: 1
---

The collector defines component names but does not yet receive, protect, batch, or export traces. Complete the trace route for the observability namespace.

Your job:

1. **Listen for OTLP gRPC on `0.0.0.0:4317` and HTTP on `0.0.0.0:4318`**.
2. **Limit memory** with a 5-second check interval, 80 percent limit, and 25 percent spike limit.
3. **Batch traces** with a 5-second timeout and batch size 8192.
4. **Export to `tempo.observability.svc.cluster.local:4317`** and wire the trace pipeline in receiver, processor, exporter order.

The grader checks every component and the final service pipeline.
