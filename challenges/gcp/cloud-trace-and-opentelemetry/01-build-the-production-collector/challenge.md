---
title: "Build the Production Collector"
sectionSlug: exporter-and-collector
order: 1
---

Complete the OpenTelemetry Collector configuration for `orders-api`. Receive OTLP over gRPC and HTTP, batch telemetry before export, attach the production service identity, and export traces to Google Cloud Trace.

The traces pipeline must use the OTLP receiver, resource and batch processors, and Google Cloud exporter in that order of responsibility.
