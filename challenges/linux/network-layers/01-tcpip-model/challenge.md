---
title: "Classify Services by Transport Layer"
sectionSlug: the-tcpip-model
order: 1
---

A new on-call engineer needs a quick map of which services on `polaris-edge-01` use TCP vs UDP and what application-layer protocols they speak. The platform team exported the listening services from `ss -tlnp` / `ss -ulnp` into a flat inventory at `/home/dev/audit/service-inventory.txt`, one service per line in the format `name  proto/port  app-protocol`.

You start in `/home/dev`. Your job:

1. **Inspect the service inventory** at `/home/dev/audit/service-inventory.txt` so you understand the columns and the services in scope.
2. **Isolate only the UDP-backed services** from that inventory so the on-call engineer can see which application protocols are using transport-layer UDP.
3. **Find the row that proves HTTPS is listening** on the standard secure web port and show it in full.
4. **Count how many services use TCP** so the handoff note includes the transport-layer split.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `udp/53`, `udp/123`, `udp/3478`, `tcp/443`, and `HTTPS`.
