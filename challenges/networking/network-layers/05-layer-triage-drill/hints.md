Start from the bottom. Use `find . -type f` to see the captured checks, then inspect the numbered files in order.

---

`LOWER_UP`, `REACHABLE`, and `default via` clear Layers 1-3. A successful `Connected to checkout.internal` line clears Layer 4.

---

After TCP connects, look at the HTTP response and gateway log. `HTTP/2 503` plus `no healthy upstream` means the final fault is at the application layer, not the lower network layers.
