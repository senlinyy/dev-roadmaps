```bash
aws elbv2 describe-load-balancers --names devpolaris-orders-alb
aws ec2 describe-subnets --subnet-ids subnet-public-a subnet-private-a
aws ec2 describe-security-groups --group-ids sg-orders-alb sg-orders-api
```

The useful habit is reading the path in layers: public entry point, subnet placement, and packet rules.
