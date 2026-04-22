```bash
$ wc -l /home/dev/vpc/proposal.txt
$ grep "az-b" /home/dev/vpc/proposal.txt
$ cat /home/dev/vpc/subnet-ranges.txt
```

`wc -l` confirms the file size matches what you expect from the plan. `grep "az-b"` isolates the AZ-b pair so you can eyeball them against the reference table. The reference shows each `/20` ends exactly one address before the next one begins (`10.0.15.255` -> `10.0.16.0`, `10.0.47.255` -> `10.0.48.0`, ending at `10.0.63.255`), which is the signature of a clean non-overlapping plan.
