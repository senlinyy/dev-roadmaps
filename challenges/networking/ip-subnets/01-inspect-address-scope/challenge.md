---
title: "Inspect Address Scope"
sectionSlug: what-does-an-ip-address-represent-on-an-interface
order: 1
---

A dual-stack worker was copied from a template. Before anyone changes its network settings, establish which addresses belong to loopback and which belong to the workload interface.

1. Inspect every address on `lo`.
2. Inspect every address on `eth0`.
3. Retain enough output to distinguish IPv4, IPv6 link-local, and IPv6 global scope.
4. Leave the host unchanged.

The terminal is a bounded network simulation. The grader checks semantic observations against the unchanged scenario.
