```bash
aws ec2 describe-security-groups --group-ids sg-orders-alb sg-orders-api sg-orders-db
```

The important detail is that private hops reference another security group. The database does not need a public CIDR to receive traffic from the API.
