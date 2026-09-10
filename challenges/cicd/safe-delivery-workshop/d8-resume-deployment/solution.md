## Reference solution

This is a reviewable implementation for the stated fixture, not an execution-verified production deployment. Substitute environment-specific identifiers consistently before any live use. Keep unchanged fixture files alongside the files below.

### scripts/resume.py

```python
import json
import os
import sys
import boto3

ecs = boto3.client("ecs")
table = boto3.resource("dynamodb").Table(os.environ["RELEASE_TABLE"])
with open(sys.argv[1]) as source:
    release = json.load(source)
cluster, service = release["cluster"], release["service"]
key = cluster + "/" + service
release_id = release["release"]
candidate, previous = release["candidate"], release["previous"]
table.update_item(
    Key={"service": key},
    UpdateExpression="SET #owner = :release",
    ConditionExpression="desiredRelease = :release AND (attribute_not_exists(#owner) OR #owner = :release)",
    ExpressionAttributeNames={"#owner": "owner"},
    ExpressionAttributeValues={":release": release_id},
)
definition = ecs.describe_task_definition(taskDefinition=candidate)["taskDefinition"]
images = [c["image"] for c in definition["containerDefinitions"] if c["name"] == "orders"]
if images != [release["image"]]:
    raise RuntimeError("Candidate does not contain approved image")
response = ecs.describe_services(cluster=cluster, services=[service])
if response["failures"] or len(response["services"]) != 1:
    raise RuntimeError("Service unavailable")
current = response["services"][0]
if current["taskDefinition"] not in (previous, candidate):
    raise RuntimeError("Service changed by another deployment")
if current["taskDefinition"] != candidate:
    ecs.update_service(cluster=cluster, service=service, taskDefinition=candidate)
ecs.get_waiter("services_stable").wait(cluster=cluster, services=[service], WaiterConfig={"Delay":15,"MaxAttempts":80})
after = ecs.describe_services(cluster=cluster, services=[service])["services"][0]
if after["taskDefinition"] != candidate or after["runningCount"] != after["desiredCount"] or after["desiredCount"] < 1:
    raise RuntimeError("Candidate did not stabilize; inspect rollback before retry")
table.update_item(
    Key={"service": key},
    UpdateExpression="SET completedRelease = :release REMOVE #owner",
    ConditionExpression="desiredRelease = :release AND #owner = :release",
    ExpressionAttributeNames={"#owner": "owner"},
    ExpressionAttributeValues={":release": release_id},
)
print(json.dumps({"release":release_id,"taskDefinition":candidate,"image":release["image"]}))
```

## Why this works

An API operation can outlive its caller. Durable candidate identity lets retry observe rather than recreate work. Conditional ownership binds mutation to the approved desired release. This design depends on coordinator write policy and CI serialization, including same-release retries; it is not a universal distributed transaction. A failed waiter must not release ownership and let another deployment blindly proceed.

## Verification and expected evidence

Install requirements in a virtual environment; substitute real sandbox task ARNs and seed the table. Set RELEASE_TABLE and workload AWS credentials. Run `python scripts/resume.py release.json`, interrupt after UpdateService and resume serially. Change desiredRelease or service revision in separate tests and confirm rejection. Failure keeps owner; an administrator must inspect ECS before clearing it. Run application smoke checks separately from stabilization.

## Self-review

- [ ] Retry reuses the candidate without building or registering another task definition.
- [ ] Superseded desired releases and unexpected service revisions are rejected.
- [ ] Failure retains the claim; success records completion.

Equivalent implementations are welcome when they preserve these outcomes and failure boundaries. Do not widen permissions or suppress failures to match a green result.

## References

- [Official reference 1](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Official reference 2](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ecs/waiter/ServicesStable.html)
