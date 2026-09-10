## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### ecs/update.json

```json
{
  "cluster": "orders",
  "service": "orders",
  "deploymentController": {
    "type": "ECS"
  },
  "deploymentConfiguration": {
    "strategy": "BLUE_GREEN",
    "bakeTimeInMinutes": 15,
    "alarms": {
      "alarmNames": [
        "orders-release-errors"
      ],
      "enable": true,
      "rollback": true
    },
    "lifecycleHooks": [
      {
        "hookTargetArn": "arn:aws:lambda:eu-west-1:222222222222:function:orders-pretraffic",
        "roleArn": "arn:aws:iam::222222222222:role/orders-hook-invoke",
        "lifecycleStages": [
          "POST_TEST_TRAFFIC_SHIFT"
        ]
      }
    ]
  },
  "loadBalancers": [
    {
      "targetGroupArn": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/orders-blue/1111111111111111",
      "containerName": "orders",
      "containerPort": 3000,
      "advancedConfiguration": {
        "alternateTargetGroupArn": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:targetgroup/orders-green/2222222222222222",
        "productionListenerRule": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:listener-rule/app/orders/1111111111111111/2222222222222222/3333333333333333",
        "testListenerRule": "arn:aws:elasticloadbalancing:eu-west-1:222222222222:listener-rule/app/orders/1111111111111111/4444444444444444/5555555555555555",
        "roleArn": "arn:aws:iam::222222222222:role/orders-elb-management"
      }
    }
  ]
}
```

### lambda/pretraffic.py

```python
import json
import os
import urllib.request

def handler(event, context):
    try:
        base = os.environ["TEST_URL"].rstrip("/")
        with urllib.request.urlopen(base + "/ready", timeout=5) as response:
            if response.status != 200:
                return {"hookStatus": "FAILED"}
        with urllib.request.urlopen(base + "/orders", timeout=5) as response:
            body = json.load(response)
            if response.status != 200 or not isinstance(body.get("orders"), list):
                return {"hookStatus": "FAILED"}
        return {"hookStatus": "SUCCEEDED"}
    except Exception as error:
        print(type(error).__name__)
        return {"hookStatus": "FAILED"}
```

## Why this works

Blue/green prepares a complete replacement revision and gives it a separate validation route. An ECS-native Lambda hook returns hookStatus rather than calling CodeDeploy's lifecycle-status API. POST_TEST_TRAFFIC_SHIFT ensures the test route is established before testing. A retained blue revision supports traffic recovery only while schema and external effects remain compatible.

## Verification and expected evidence

Deploy the Lambda code and apply the sandbox service update. Confirm the configured test listener is actually routed to green. Test a good response, malformed JSON, HTTP failure and connection timeout. Observe that failed validation preserves production blue traffic. Verify the runtime image digest separately; a functional HTTP check is not provenance.

## Self-review

- [ ] The test listener reaches green before the validation hook runs.
- [ ] A failed HTTP/response contract returns FAILED and blocks promotion.
- [ ] The prior revision remains available for the specified bake period and alarm rollback.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/lambda-lifecycle-hooks.html)
- [Official reference 2](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deploy-blue-green-service.html)
