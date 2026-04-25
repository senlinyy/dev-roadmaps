---
title: "Map an HTTPS Service Across TCP/IP Layers"
sectionSlug: the-tcpip-model
order: 1
---

A new on-call engineer needs a handoff note for the public HTTPS service on `polaris-edge-01`. The socket inventory is in `/var/log/network/listeners.snapshot`, and the host's interface + default-route snapshot is in `/var/log/network/edge01-egress.snapshot`. Your job is to map that single service across the four TCP/IP layers so the next responder can explain where the application, transport, internet, and network-access details come from.

You start in `/home/dev`. Your job:

1. **Inspect both network snapshots** so you can see the public HTTPS listener and the host's egress path side by side.
2. **Surface the evidence for the application and transport layers** of the HTTPS service.
3. **Surface the evidence for the internet and network-access layers** from the interface and route snapshot.
4. **Write `/home/dev/reports/https-stack.note`** with four lines: `Application ...`, `Transport ...`, `Internet ...`, and `NetworkAccess ...`.
5. **Print the completed handoff note** so the mapping is visible in the terminal history.

The grader requires you to use `cat`, `grep`, and `echo`, and checks that your handoff note records `HTTPS`, `tcp/443`, `10.24.8.14 via 10.24.0.1`, and `eth0 52:54:00:24:08:14`.
