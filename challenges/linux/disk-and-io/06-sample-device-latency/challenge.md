---
title: "Find the Slow Device"
sectionSlug: how-do-you-connect-slow-io-to-a-device-and-process
order: 6
---

The orders API has slow writes without a capacity alert. Its data lives under `/var/lib/app`. Compare current host waiting and device latency rather than trusting a since-boot average or utilization alone. You start in `/home/dev`.

Your job:

1. Map the application data path to its backing device.
2. Collect two current host-activity samples at least five simulated seconds apart.
3. Collect two current extended I/O samples for both devices at least five simulated seconds apart. Include read/write latency, throughput, queue depth, and utilization.
4. Leave processes, files, and storage unchanged.

The grader checks targeted command evidence and the required final state. The terminal is a bounded simulation; copied diagnostic text is not evidence.
