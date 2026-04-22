```bash
$ cat /home/dev/vpc/rfc1918.txt
$ cat /home/dev/vpc/proposed-cidrs.txt
$ grep -v "^10\." /home/dev/vpc/proposed-cidrs.txt | grep -v "^172\." | grep -v "^192.168"
11.0.0.0/16
```

The reference file establishes the three allowed leading-octet patterns. Stripping each of them in turn from the proposal leaves only `11.0.0.0/16`, which falls outside every RFC 1918 block and therefore would route to the public internet if assigned.
