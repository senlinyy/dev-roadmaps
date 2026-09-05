---
title: "Locate the Failing Request Boundary"
sectionSlug: how-do-you-debug-a-request-by-layer
order: 6
---

The health endpoint `https://app.example.com/health` is failing. Collect evidence from name lookup through HTTP before recommending a repair. You start in `/home/dev`.

1. Resolve `app.example.com` and inspect the selected route to its returned address.
2. Probe TCP port `443` on that endpoint.
3. Trace the HTTPS request, including connection and certificate verification evidence, and inspect its response headers.
4. Leave configuration and workloads unchanged. Do not bypass certificate verification.

The grader checks targeted observations and unchanged state, not copied text. This read-only IPv4 simulation has no live network access. Captures cover a bounded authored window; probes finish immediately.
