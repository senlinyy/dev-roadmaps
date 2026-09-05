---
title: "Inspect the Active Edge"
sectionSlug: how-do-you-install-nginx-and-find-its-effective-configuration
order: 1
---

An inherited host is believed to run Nginx on port 80. Establish the active process boundary and validate its saved configuration before making any change.

1. Inspect Nginx service status.
2. Inspect the TCP listener and process owner on port 80.
3. Read `/etc/nginx/nginx.conf`.
4. Test the saved configuration.
5. Request headers from `http://edge.example.com/health` and leave the host unchanged.
