---
title: "Build the ADOT Pipeline"
sectionSlug: sending-traces-with-adot-and-the-cloudwatch-agent
order: 2
---

Complete an ADOT Collector configuration for orders-api. Receive OTLP over gRPC and HTTP, protect the collector with a memory limiter, batch telemetry, export traces to X-Ray, and export logs to CloudWatch Logs. Put the processors in both pipelines and include the exact receivers and exporters for each signal.
