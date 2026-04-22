```bash
$ cd /home/dev/cloud-audit
$ cat security-group.txt
$ grep -n "8080" security-group.txt network-acl.txt
$ grep "Egress: true" network-acl.txt
$ cat network-acl.txt
```

The SG only opens ports 22 and 443, so port 8080 is blocked at the instance bodyguard regardless of the NACL. Even after fixing the SG, the stateless NACL has Egress rules only for ports 80 and 443 — no ephemeral `1024-65535` allow rule, so reply packets from any new inbound port (including 8080) get dropped on the way out. Both layers need a change.
