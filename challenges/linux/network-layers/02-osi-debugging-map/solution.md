```bash
$ cat /home/dev/runbook/osi-cheatsheet.txt
$ grep "Connection refused" /home/dev/runbook/osi-cheatsheet.txt
$ grep "NO-CARRIER" /home/dev/runbook/osi-cheatsheet.txt
$ grep "ARP" /home/dev/runbook/osi-cheatsheet.txt
```

The cheatsheet pairs each layer with its tell-tale symptom, so each `grep` returns the row that owns the ticket: `Connection refused` is Layer 4 (transport), `NO-CARRIER` is Layer 1 (physical), and `ARP` failures are Layer 2 (data link).
