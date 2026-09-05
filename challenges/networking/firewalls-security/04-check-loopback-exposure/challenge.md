---
title: "Check Loopback Exposure"
sectionSlug: how-do-you-diagnose-firewall-and-reachability-failures
order: 4
---

An agent works through `127.0.0.1:9100`, but a remote monitoring host cannot reach port 9100. Determine whether adding a firewall allow rule would solve the actual problem.

1. Inspect the listener and process owner.
2. Inspect INPUT policy and rules.
3. Probe the loopback address and the host interface address on port 9100.
4. Preserve the state for review.
