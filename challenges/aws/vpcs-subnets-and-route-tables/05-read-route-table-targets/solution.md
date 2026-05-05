```bash
aws ec2 describe-route-tables --route-table-ids rtb-public-orders rtb-private-orders
aws ec2 describe-internet-gateways --internet-gateway-ids igw-orders-prod
aws ec2 describe-nat-gateways --nat-gateway-ids nat-orders-a
```

The destination is only half the route. The target tells you whether traffic stays local, goes to the internet gateway, or leaves privately through NAT.
