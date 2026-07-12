```bash
aws ec2 describe-route-tables --route-table-ids rtb-public-orders rtb-private-orders
aws ec2 describe-internet-gateways --internet-gateway-ids igw-orders-prod
aws ec2 describe-nat-gateways --nat-gateway-ids nat-orders-a
```
