## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### iam/deploy-policy.json

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecs:RegisterTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:DescribeTaskDefinition"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices"
      ],
      "Resource": "arn:aws:ecs:eu-west-1:222222222222:service/orders/orders"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::222222222222:role/orders-task",
        "arn:aws:iam::222222222222:role/orders-execution"
      ],
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "ecs-tasks.amazonaws.com"
        }
      }
    }
  ]
}
```

## Why this works

The deploy role registers a task definition and requests ECS to run it. PassRole authorizes handing existing runtime roles to ECS; it is not the same as assuming them. The execution role lets ECS pull images and deliver logs; the task role authorizes application API calls. RegisterTaskDefinition and DescribeTaskDefinition use wildcard resources in this baseline; service mutation and PassRole can be narrowly constrained.

## Verification and expected evidence

Apply in a training account through the IAM administrator. Run the real deployment helper from the AWS walkthrough. Attempt an unrelated task role and service and confirm denial. IAM simulation is useful preflight, but validate effective policies including boundaries and organization controls with actual sandbox calls.

## Self-review

- [ ] Only orders-task and orders-execution can be passed to ecs-tasks.amazonaws.com.
- [ ] Service update and inspection are scoped to orders/orders.
- [ ] The reference explains operations that require wildcard resources rather than pretending every action supports ARN scoping.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://github.com/aws-actions/amazon-ecs-deploy-task-definition)
- [Official reference 2](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_passrole.html)
