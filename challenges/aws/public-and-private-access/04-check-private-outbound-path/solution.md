```bash
aws ec2 describe-route-tables --route-table-ids rtb-private-orders
aws ec2 describe-nat-gateways --nat-gateway-ids nat-orders-a
aws ec2 describe-vpc-endpoints --vpc-endpoint-ids vpce-secretsmanager vpce-logs
```

Private does not mean isolated. This design gives the app a default outbound path through NAT and private AWS API paths through VPC endpoints.
