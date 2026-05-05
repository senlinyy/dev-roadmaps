```bash
aws ecs describe-services --cluster devpolaris-orders-prod --services devpolaris-orders-api
aws elbv2 describe-target-health --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/devpolaris-orders-api-tg/6d0ecf831eec9f09
aws cloudwatch describe-alarms --alarm-names devpolaris-orders-api-alb-5xx
aws logs filter-log-events --log-group-name /ecs/devpolaris-orders-api --filter-pattern rollback
```

Recovery is supported by four pieces of evidence: revision 57 is running, all targets are healthy, the alarm is `OK`, and the application logs record the rollback.
