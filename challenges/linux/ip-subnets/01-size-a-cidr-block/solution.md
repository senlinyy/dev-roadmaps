```bash
$ cat /srv/requests/payments-tier.request
$ cat /var/lib/ipam/free-blocks.csv
$ grep "/20" /var/lib/ipam/free-blocks.csv
$ echo "selected /20 4094 usable hosts" > /home/dev/reports/payments-tier-allocation.note
$ cat /home/dev/reports/payments-tier-allocation.note
```

The request needs 4000 hosts. `/22` is too small at 1022 usable hosts, while `/18` would waste far more space than necessary. `/20` is the smallest free block that still provides 4094 usable addresses.
