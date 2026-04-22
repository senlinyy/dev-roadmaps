---
title: "Read a tcpdump Capture of a TCP Handshake"
sectionSlug: seeing-the-layers-with-tcpdump
order: 3
---

The API team complains that `10.0.5.7` cannot reach the load balancer on port 80, but `10.0.0.5` can hit it on 443 just fine. Someone ran `tcpdump -i eth0 -nn` on the LB and exported the result to `/home/dev/captures/api-handshake.txt`. Your job is to read the capture and prove what is happening at Layer 4.

You start in `/home/dev`. Your job:

1. **`cd` into `/home/dev/captures`** so the relative path is short.
2. **Show every packet involving the broken client `10.0.5.7`** with `grep "10.0.5.7" api-handshake.txt`. You should see three back-to-back SYNs and zero replies — a classic black hole.
3. **Show the working handshake from `10.0.0.5`** by grepping for `10.0.0.5.52314`. The output should include the `Flags [S.]` SYN-ACK from the LB.
4. **Count how many SYN retransmits the broken client sent** by piping the previous grep into `wc -l`.

The grader requires you to use `cd`, `grep`, and `wc`, finishes in `/home/dev/captures`, and checks that your combined output contains `10.0.5.7.51000`, `Flags [S.]`, `172.17.0.2.443`, and `GET /api/users`.
