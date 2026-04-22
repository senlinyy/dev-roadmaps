---
title: "Audit a Zone File by Record Type"
sectionSlug: record-types-you-will-use
order: 2
---

Before flipping `example.com` over to a new DNS provider you need a record-type audit of the current zone. The exported zone file is at `/home/dev/dns-debug/example-zone.txt` and contains a mix of `A`, `AAAA`, `CNAME`, `MX`, `TXT`, and `NS` records. The migration ticket asks you to confirm that the zone has the expected MX priority `10`, an SPF `TXT` record, and a `CNAME` for `www`.

You start in `/home/dev`. Your job:

1. **Count the A records** in `/home/dev/dns-debug/example-zone.txt` so the migration ticket has a concrete inventory number.
2. **Surface the mail-routing and alias records** so the MX priority and `www` alias target are both visible.
3. **Find the SPF TXT record** so the email-auth policy is captured in the audit note.

The grader requires you to use `grep`, and checks that your combined output contains `MX 10 mail1.example.com`, `CNAME app.example.com`, and `v=spf1`.
