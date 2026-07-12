```bash
aws elbv2 describe-load-balancers --names devpolaris-orders-alb
aws ec2 describe-subnets --subnet-ids subnet-public-a subnet-private-a
aws ec2 describe-security-groups --group-ids sg-orders-alb sg-orders-api
```
