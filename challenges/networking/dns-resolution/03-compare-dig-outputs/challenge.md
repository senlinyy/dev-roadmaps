---
title: "Compare Two Saved Dig Outputs"
sectionSlug: debugging-with-dig
order: 3
---

Half the team is hitting the new API IP, the other half is still hitting the old one. You captured the response from a fresh resolver into `/var/log/dns/api.example.com.fresh` and the response from a customer's stale resolver into `/var/log/dns/api.example.com.stale`. Both files have the full `dig` output. You need to extract just the answer line from each and confirm they disagree, then note which resolver served which IP.

You start in `/home/dev`. Your job:

1. **Surface the answer section from both saved resolver outputs** so the fresh and stale A records can be compared directly.
2. **Surface the resolver identity from both files** so you know which server returned which answer.
3. **Record the mismatch** in `/home/dev/reports/dns-mismatch.note`, noting which resolver served the stale IP and which served the fresh one.
4. **Print the mismatch note** so the resolver-to-IP mapping is visible in the terminal history.

The grader requires you to use `grep`, `echo`, and `cat`, and checks that your note maps `1.1.1.1` to `93.184.216.99` and `192.0.2.53` to `93.184.216.34`.
