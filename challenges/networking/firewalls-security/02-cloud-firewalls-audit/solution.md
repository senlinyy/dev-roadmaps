```bash
$ cd /var/log/aws
$ cat security-group.describe
$ grep -n "8080" security-group.describe network-acl.describe
$ grep "Egress: true" network-acl.describe
$ cat network-acl.describe
$ echo "NACL blocks 8080 responses because 1024-65535 egress is missing" > /home/dev/reports/reachability.note
$ cat /home/dev/reports/reachability.note
```

The Security Group already allows inbound 8080, so it is not the remaining blocker. The stateless NACL still lacks an egress allow rule for the ephemeral `1024-65535` return range, so responses to the new inbound connection never make it back out.
