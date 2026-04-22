---
title: "Compare Two Saved Dig Outputs"
sectionSlug: debugging-with-dig
order: 3
---

Half the team is hitting the new API IP, the other half is still hitting the old one. You captured the response from a fresh resolver into `/home/dev/dns-debug/api-fresh.txt` and the response from a customer's stale resolver into `/home/dev/dns-debug/api-stale.txt`. Both files have the full `dig` output. You need to extract just the answer line from each and confirm they disagree, then note which resolver served which IP.

You start in `/home/dev`. Your job:

1. **Pull the answer line from each file** by running `grep "api.example.com" /home/dev/dns-debug/api-fresh.txt` and `grep "api.example.com" /home/dev/dns-debug/api-stale.txt` so both A records sit on screen.
2. **Pull the SERVER footer from each file** by running `grep "SERVER:" /home/dev/dns-debug/api-fresh.txt` and `grep "SERVER:" /home/dev/dns-debug/api-stale.txt` so you know which resolver returned which answer.
3. **Record the mismatch** by running `echo "stale 93.184.216.34 fresh 93.184.216.99 mismatch confirmed" > /home/dev/dns-debug/mismatch.txt` and then `cat /home/dev/dns-debug/mismatch.txt` to confirm.

The grader requires you to use `grep`, `echo`, and `cat`, and checks that your combined output contains the fresh IP `93.184.216.99`, the stale IP `93.184.216.34`, the resolver `1.1.1.1`, and the word `mismatch`.
