```bash
$ cat /home/dev/vpc/existing.txt
$ cat /home/dev/vpc/peering-request.txt
$ grep "10.0" /home/dev/vpc/peering-request.txt
atlas-edge    10.0.128.0/17    requested by team Atlas
$ echo "OVERLAP 10.0.128.0/17 conflicts with 10.0.0.0/16" > /home/dev/vpc/overlap-report.txt
$ cat /home/dev/vpc/overlap-report.txt
```

`vpc-prod` already owns the entire `10.0.0.0/16` (every `10.0.x.x` address). Atlas's `10.0.128.0/17` block sits squarely inside that range, so AWS will refuse the peering connection until Atlas renumbers it onto a different `/16`.
