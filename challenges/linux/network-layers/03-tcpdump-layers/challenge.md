---
title: "Read a tcpdump Capture of a TCP Handshake"
sectionSlug: seeing-the-layers-with-tcpdump
order: 3
---

The API team complains that `10.0.5.7` cannot reach the load balancer on port 80, but `10.0.0.5` can hit it on 443 just fine. Someone ran `tcpdump -i eth0 -nn` on the LB and exported the result to `/var/log/network/lb-handshake.capture`. Your job is to read the capture and prove what is happening at Layer 4.

You start in `/home/dev`. Your job:

1. **Move into `/var/log/network`** so you can work against the saved capture with short relative paths.
2. **Surface every packet involving the broken client `10.0.5.7`** and show the evidence that its SYNs never receive a reply.
3. **Surface the working exchange from `10.0.0.5`** and include the lines that prove the load balancer answered with a SYN-ACK.
4. **Count the broken client's SYN attempts** so you can quantify the retransmits in the incident note.

The grader requires you to use `cd`, `grep`, and `wc`, finishes in `/var/log/network`, and checks that your combined output contains `10.0.5.7.51000`, `Flags [S.]`, `172.17.0.2.443`, and `GET /api/users`.
