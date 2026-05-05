```bash
aws elbv2 describe-load-balancers --names devpolaris-orders-alb
aws elbv2 describe-listeners --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/devpolaris-orders-alb/50dc6c495c0c9188
aws elbv2 describe-target-groups --names devpolaris-orders-api-tg
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09
```

The key result is that the ALB is forwarding to `devpolaris-orders-api-tg`, the health check path is `/health`, and target `10.40.13.22` is unhealthy with `Target.ResponseCodeMismatch`.
