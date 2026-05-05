```bash
aws ec2 describe-vpcs --vpc-ids vpc-orders-prod
aws ec2 describe-subnets --subnet-ids subnet-public-a subnet-private-a subnet-private-b
```

The VPC is the address boundary. The subnet output tells you where each smaller network slice lives and whether it behaves like a public or private subnet.
