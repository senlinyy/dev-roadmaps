```bash
$ cat /home/dev/network-planning/cidr-cheatsheet.txt
$ grep "/20" /home/dev/network-planning/cidr-cheatsheet.txt
$ echo "selected /20 4094 usable hosts" > /home/dev/network-planning/decision.txt
$ cat /home/dev/network-planning/decision.txt
```

`/24` only buys 254 hosts and `/22` only 1022, so neither fits 4000 instances. `/20` gives 4094 usable hosts, which is the smallest prefix that covers the workload with one binary doubling of headroom.
