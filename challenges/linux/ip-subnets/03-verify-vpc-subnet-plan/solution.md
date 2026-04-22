```bash
$ wc -l /srv/requests/payments-vpc.plan
$ grep "az-b" /srv/requests/payments-vpc.plan
$ cat /var/lib/ipam/payments-vpc.allocations
```

`wc -l` confirms the file size matches what you expect from the plan. `grep "az-b"` isolates the AZ-b pair so you can eyeball them against the reference table. The reference shows each `/20` ends exactly one address before the next one begins (`10.0.15.255` -> `10.0.16.0`, `10.0.47.255` -> `10.0.48.0`, ending at `10.0.63.255`), which is the signature of a clean non-overlapping plan.
