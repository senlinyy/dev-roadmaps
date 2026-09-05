---
title: "Restore Only HTTPS Ingress"
order: 2
---

The first responder proved that host filtering blocks a healthy local HTTPS listener. Restore the required public port without opening the internal admin listener.

1. Inspect INPUT and both listeners.
2. Insert a TCP port 443 ACCEPT rule at position 1.
3. Prove HTTPS now connects.
4. Prove port 9000 still times out.
5. Inspect the final numbered chain and counters.
