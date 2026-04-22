```bash
$ cat /srv/requests/marketing-vpc.cidrs
$ grep -v "^10\." /srv/requests/marketing-vpc.cidrs | grep -v "^172\." | grep -v "^192.168"
$ echo "REJECT 11.0.0.0/16 public range" > /home/dev/reports/marketing-vpc-review.note
$ cat /home/dev/reports/marketing-vpc-review.note
```

The first, second, and fourth proposals are private ranges. `11.0.0.0/16` is outside RFC 1918 space, so approving it would create a publicly routable VPC CIDR and should be rejected.
