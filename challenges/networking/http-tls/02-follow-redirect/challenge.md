---
title: "Follow an HTTPS Redirect"
sectionSlug: how-do-methods-status-codes-headers-and-cookies-carry-meaning
order: 2
---

The public health URL responds, but a monitor claims the application is unavailable. Establish whether it is seeing a redirect or the final HTTPS response.

1. Request only the headers from `http://status.example.com/health` without following redirects.
2. Repeat the header request while following redirects.
3. Preserve both the redirect Location and the final status.
