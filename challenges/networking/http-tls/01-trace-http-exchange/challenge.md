---
title: "Trace an HTTP Exchange"
sectionSlug: how-do-you-inspect-the-complete-request-with-curl-and-openssl
order: 1
---

Checkout requests reach the public API but return a service error. Capture the request boundary and the responding component before investigating the backend.

1. Send a verbose GET request to `https://api.example.com/orders`.
2. Retain the negotiated TLS version and ALPN result.
3. Retain the request line, Host header, status, server header, and request ID.
4. Leave the endpoint unchanged.
