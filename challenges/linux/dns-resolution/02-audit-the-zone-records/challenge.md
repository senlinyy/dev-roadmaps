---
title: "Audit a Zone File by Record Type"
sectionSlug: record-types-you-will-use
order: 2
---

Before flipping `example.com` over to a new DNS provider you need a record-type audit of the current zone. The exported zone file is at `/home/dev/dns-debug/example-zone.txt` and contains a mix of `A`, `AAAA`, `CNAME`, `MX`, `TXT`, and `NS` records. The migration ticket asks you to confirm that the zone has the expected MX priority `10`, an SPF `TXT` record, and a `CNAME` for `www`.

You start in `/home/dev`. Your job:

1. **Count the A records** by running `grep -c " A " /home/dev/dns-debug/example-zone.txt` so the ticket has a concrete number.
2. **Show the MX and CNAME rows** by running `grep "MX" /home/dev/dns-debug/example-zone.txt` and `grep "CNAME" /home/dev/dns-debug/example-zone.txt` so the priority and alias targets are visible.
3. **Show the SPF TXT record** by running `grep "v=spf1" /home/dev/dns-debug/example-zone.txt` so the email-auth string is captured.

The grader requires you to use `grep`, and checks that your combined output contains `MX 10 mail1.example.com`, `CNAME app.example.com`, and `v=spf1`.
