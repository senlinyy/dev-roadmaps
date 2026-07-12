---
title: "Audit a Zone File by Record Type"
sectionSlug: dns-records-used-in-real-work
order: 2
---

Before flipping `example.com` over to a new DNS provider you need a record-type audit of the current zone. The exported zone file is at `/etc/bind/zones/db.example.com`, and a provider dry-run report is at `/var/log/dns/provider-import-check.log`. The migration ticket asks you to confirm address, mail, alias, and TXT evidence before approving the cutover.

You start in `/home/dev`. Your job:

1. **Count the A records** in `/etc/bind/zones/db.example.com` so the migration ticket has a concrete inventory number.
2. **Surface the mail-routing and alias records** so the MX priority and `www` alias target are both visible.
3. **Find the SPF TXT record** so the email-auth policy is captured in the audit note.
4. **Inspect the provider dry-run report** and surface any warning or error lines before the migration is approved.

The grader requires `cat`, `grep`, and `wc`, and checks that your combined output contains the mail, alias, SPF, and import-warning evidence.
