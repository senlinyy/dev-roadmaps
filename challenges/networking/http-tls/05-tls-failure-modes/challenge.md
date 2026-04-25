---
title: "Classify TLS Handshake and Trust Failures"
sectionSlug: when-http-and-tls-break
order: 5
---

The synthetic monitor is paging on a wave of HTTPS failures across several services, and your inbox is full of `curl -v` and `openssl s_client` snippets from frustrated engineers. Each one sounds like "TLS broke" — but the *kind* of TLS break determines which team owns the fix and which control plane needs to change.

For each scenario below, identify the most likely failure mode. Pay attention to whether the handshake reached the certificate-exchange stage, what the alert byte was, and what the client's trust store knows.
