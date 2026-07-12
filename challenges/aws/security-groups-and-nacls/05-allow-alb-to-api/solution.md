```bash
aws ec2 describe-security-groups --group-ids sg-orders-api
aws ec2 authorize-security-group-ingress --group-id sg-orders-api --protocol tcp --port 3000 --source-group sg-orders-alb
aws ec2 describe-security-groups --group-ids sg-orders-api
```
