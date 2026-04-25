```bash
$ cat /srv/requests/payments-vpc.plan
$ grep "az-b" /srv/requests/payments-vpc.plan
$ cat /var/lib/ipam/payments-vpc.allocations
$ echo "FAIL subnet-private-az-b proposed 10.0.40.0/20 expected 10.0.48.0/20" > /home/dev/reports/payments-vpc-review.note
$ cat /home/dev/reports/payments-vpc-review.note
```

The public and private AZ-a entries match IPAM, but `subnet-private-az-b` drifted from its reserved block. The plan proposes `10.0.40.0/20`, while IPAM reserved `10.0.48.0/20`, so the review should fail until the proposal is corrected.
