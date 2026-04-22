---
title: "Classify Services by Transport Layer"
sectionSlug: the-tcpip-model
order: 1
---

A new on-call engineer needs a quick map of which services on `polaris-edge-01` use TCP vs UDP and what application-layer protocols they speak. The platform team exported the listening services from `ss -tlnp` / `ss -ulnp` into a flat inventory at `/home/dev/audit/service-inventory.txt`, one service per line in the format `name  proto/port  app-protocol`.

You start in `/home/dev`. Your job:

1. **Read the full inventory** with `cat /home/dev/audit/service-inventory.txt` so you know what is in scope.
2. **List every UDP service** (transport-layer UDP usually means DNS, NTP, or media/STUN) by grepping for `udp/` in that file.
3. **Confirm HTTPS is bound** by grepping for `tcp/443` and showing the matching line.
4. **Count the TCP services** with `grep -c "tcp/" /home/dev/audit/service-inventory.txt`.

The grader requires you to use `cat` and `grep`, and checks that your combined output mentions `udp/53`, `udp/123`, `udp/3478`, `tcp/443`, and `HTTPS`.
