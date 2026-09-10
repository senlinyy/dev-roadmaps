---
id: article-cicd-safe-delivery-workshop
title: "Safe Delivery and Recovery"
description: "Worked production delivery patterns, complete reference files and explicit operational verification."
order: 7
tags: ["cicd", "deployment-strategies", "production-workflows"]
---

## Table of Contents

1. [Keep requests alive during a rolling release](#keep-requests-alive-during-a-rolling-release)
2. [Validate green before production traffic moves](#validate-green-before-production-traffic-moves)
3. [Fail closed when a canary lacks trustworthy evidence](#fail-closed-when-a-canary-lacks-trustworthy-evidence)
4. [Rename customer data without breaking the old release](#rename-customer-data-without-breaking-the-old-release)
5. [Process old and new queue messages without duplicate effects](#process-old-and-new-queue-messages-without-duplicate-effects)
6. [Copy the approved image across accounts without changing its digest](#copy-the-approved-image-across-accounts-without-changing-its-digest)
7. [Configure environments without baking secrets into images](#configure-environments-without-baking-secrets-into-images)
8. [Resume a deployment from durable release identity](#resume-a-deployment-from-durable-release-identity)
9. [Recover the intended artifact after a green but incorrect release](#recover-the-intended-artifact-after-a-green-but-incorrect-release)
10. [Check Your Answers](#check-your-answers)
11. [References](#references)

This chapter implements deployment and recovery decisions using ECS, ALB, PostgreSQL and real scripts. It assumes an already provisioned training service and a known immutable image; it does not provision networking or authorize a live production mutation. Availability, artifact identity and data compatibility are separate acceptance conditions. An API waiter or successful traffic shift cannot prove all three.

This chapter answers four connected questions:

- What keeps traffic safe during replacement?
- When is canary evidence sufficient?
- What determines rollback safety?
- What makes promotion and resumption traceable?

### Before running the examples

The linked editor workspaces contain full independent starting snapshots and reference solutions. Local editing and self-review create no infrastructure. Use disposable repositories and isolated training accounts for optional live verification; configure credentials outside source control, budget for cloud resources, and remove only resources you created after collecting evidence. Do not run recovery scripts against an existing production system.

Use an isolated AWS training account and existing ECR repository, ECS Fargate orders service, ALB and IAM runtime roles. Example account IDs and acme/orders are explicit sample identifiers: substitute your own consistently. AWS CLI v2, jq, curl and Docker are required on the selected runner. The build environment defines ECR_REPOSITORY and AWS_ROLE_ARN; staging/production additionally define ECS_CLUSTER, ECS_SERVICE and HEALTH_URL. Protect production with required reviewers, prevent self-review and restrict deployment branches to main; configure these in GitHub Settings, not imaginary workflow YAML. Only the dedicated deployment roles may update the service. Live runs cost money; do not use production accounts. No live AWS changes run in this editor.

Action references are immutable reviewed commits in the challenge fixtures. Container and tool versions remain explicit operating assumptions: resolve approved digests and test compatibility before deployment rather than copying mutable tags into a production policy.

## Keep requests alive during a rolling release

Readiness removes an instance from traffic selection; graceful shutdown lets existing work finish. The application drains for at most 25 seconds and ECS allows 30 seconds before forced termination. ALB draining is separately bounded. A 100/200 rolling budget preserves desired healthy capacity while allowing replacement tasks, provided quotas and capacity can satisfy it. Health grace periods delay failure handling during startup, but must not make readiness always succeed.

The operational question is whether the repaired system can demonstrate all of the following:

- Healthy capacity stays at the desired count while replacements start.
- The application stops accepting new requests and allows bounded in-flight work to finish.
- ALB drain, ECS stopTimeout and application timeout are coherent; unhealthy candidates trigger rollback.

Here is the central implementation file, `src/server.js`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```yaml
import http from 'node:http';
const port = Number(process.env.PORT || 3000);
let ready = true;
const server = http.createServer((req, res) => {
  if (req.url === '/ready') {
    res.writeHead(ready ? 200 : 503).end(ready ? 'ready' : 'draining');
  } else if (req.url === '/version') {
    res.end(process.env.RELEASE_ID || 'development');
  } else if (req.url === '/orders') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({orders: []}));
  } else {
    res.writeHead(404).end();
  }
});
server.listen(port, '0.0.0.0');
process.on('SIGTERM', () => {
  ready = false;
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 25000).unref();
});
```

In the sandbox register ecs/task.json, update the service with the resulting ARN plus ecs/update.json, configure the target group's health-check path to /ready and apply alb/attributes.json with modify-target-group-attributes. Verify actual account capacity before rollout. Send bounded long-running requests in a workload-enabled build and replace tasks; check resets, healthy capacity and rollback for an unhealthy candidate. The minimal supplied HTTP fixture does not itself generate 20-second requests.

[Open the keep requests alive during a rolling release challenge](/challenges/cicd/safe-delivery-workshop?step=d1-rolling-health).

## Validate green before production traffic moves

Blue/green prepares a complete replacement revision and gives it a separate validation route. An ECS-native Lambda hook returns hookStatus rather than calling CodeDeploy's lifecycle-status API. POST_TEST_TRAFFIC_SHIFT ensures the test route is established before testing. A retained blue revision supports traffic recovery only while schema and external effects remain compatible.

The operational question is whether the repaired system can demonstrate all of the following:

- The test listener reaches green before the validation hook runs.
- A failed HTTP/response contract returns FAILED and blocks promotion.
- The prior revision remains available for the specified bake period and alarm rollback.

Here is the central implementation file, `ecs/update.json`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Deploy the Lambda code and apply the sandbox service update. Confirm the configured test listener is actually routed to green. Test a good response, malformed JSON, HTTP failure and connection timeout. Observe that failed validation preserves production blue traffic. Verify the runtime image digest separately; a functional HTTP check is not provenance.

[Open the validate green before production traffic moves challenge](/challenges/cicd/safe-delivery-workshop?step=d2-blue-green-validation).

## Fail closed when a canary lacks trustworthy evidence

Canary safety depends on measuring a meaningful cohort over enough time. Compare candidate and baseline over the same complete minutes; a sparse sample is inability to decide, not success. Business success and latency can reveal regressions hidden by HTTP status. Native ECS canary pauses recur before traffic shifts, so the operator must distinguish initial exposure from the final shift and bind the decision to the active deployment.

The operational question is whether the repaired system can demonstrate all of the following:

- Healthy, degraded and insufficient-data outcomes are distinguishable.
- The gate compares the same bounded observation window for the two release cohorts.
- An unhealthy or incomplete result never authorizes full traffic.

Here is the central implementation file, `scripts/gate.py`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```python
import json
import sys
import math
from datetime import datetime

def evaluate(data):
    if data.get("NextToken"):
        return "insufficient-data"
    rows = {row["Id"]: row for row in data.get("MetricDataResults", [])}
    values = {}
    window = None
    for release in ("baseline", "candidate"):
        for metric in ("requests", "success", "latency"):
            key = release + "_" + metric
            row = rows.get(key, {})
            samples = row.get("Values", [])
            timestamps = row.get("Timestamps", [])
            if row.get("StatusCode") != "Complete" or len(samples) < 5 or len(samples) != len(timestamps):
                return "insufficient-data"
            try:
                times = sorted(datetime.fromisoformat(t.replace('Z', '+00:00')).timestamp() for t in timestamps)
            except (ValueError, TypeError):
                return 'insufficient-data'
            if len(set(times)) != len(times) or any(b - a != 60 for a, b in zip(times, times[1:])):
                return 'insufficient-data'
            if window is None:
                window = times
            elif times != window:
                return 'insufficient-data'
            if any(not isinstance(x, (int, float)) or not math.isfinite(x) or x < 0 for x in samples):
                return "insufficient-data"
            values[key] = sum(samples) if metric != "latency" else max(samples)
        if values[release + "_requests"] < 100:
            return "insufficient-data"
        if values[release + "_success"] > values[release + "_requests"]:
            return "insufficient-data"
    baseline = values["baseline_success"] / values["baseline_requests"]
    candidate = values["candidate_success"] / values["candidate_requests"]
    if candidate < 0.99 or candidate < baseline - 0.01:
        return "degraded"
    if values["candidate_latency"] > max(300, values["baseline_latency"] * 1.2):
        return "degraded"
    return "healthy"

if __name__ == "__main__":
    with open(sys.argv[1]) as source:
        outcome = evaluate(json.load(source))
    print(outcome)
    sys.exit(0 if outcome == "healthy" else 1)
```

Query cloudwatch get-metric-data with the supplied queries and explicit start/end times covering complete minutes after the 10% shift; replace cohort labels with actual release IDs. Run `python3 scripts/gate.py metrics.json`. The recurring pause happens before each shift: authorize the first shift after preflight, and authorize the full shift only with healthy canary evidence via ContinueServiceDeployment for that deployment's hook ID. Never auto-continue a nonzero gate. Replay a lowered success count, too few requests and missing minutes.

[Open the fail closed when a canary lacks trustworthy evidence challenge](/challenges/cicd/safe-delivery-workshop?step=d3-canary-gates).

## Rename customer data without breaking the old release

An additive schema lets old and new applications coexist. This bridge explicitly makes name authoritative until cutover, avoiding ambiguous two-way synchronization. Contract is a separate irreversible boundary: old queries and writes stop working after column removal. A tested rollback before contract does not establish rollback safety afterward.

The operational question is whether the repaired system can demonstrate all of the following:

- Old writes populate the new column during coexistence.
- New reads work before and after backfill while old queries remain valid.
- Dropping the old column is delayed until old binaries and writers are retired.

Here is the central implementation file, `db/expand.sql`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```sql
BEGIN;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS display_name text;
CREATE OR REPLACE FUNCTION mirror_customer_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.display_name := NEW.name;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS customers_name_bridge ON customers;
CREATE TRIGGER customers_name_bridge BEFORE INSERT OR UPDATE OF name ON customers
FOR EACH ROW EXECUTE FUNCTION mirror_customer_name();
UPDATE customers SET display_name = name WHERE display_name IS NULL;
COMMIT;
```

Load evidence/schema.sql in a disposable PostgreSQL database, apply expand.sql, insert/update through name, and run read-customer.sql. Confirm the old SELECT name query still works. For contract, first stop old writers, deploy a final query using only display_name and switch all writes to display_name; then run contract.sql during the approved cutover. The training table is tiny; large production backfills need batching and lock/statement timeouts.

[Open the rename customer data without breaking the old release challenge](/challenges/cicd/safe-delivery-workshop?step=d4-expand-contract).

## Process old and new queue messages without duplicate effects

At-least-once delivery requires idempotency at the business effect, not just in memory. Recording the event and inserting the order in one database transaction closes the crash gap between them. Version compatibility handles messages already queued before deployment. This transaction covers PostgreSQL only; external payments require an outbox/idempotency design rather than claiming one SQL transaction controls every side effect.

The operational question is whether the repaired system can demonstrate all of the following:

- Legacy and version-2 payloads produce the same order representation.
- Duplicate event IDs cannot repeat the transactional database effect.
- Failed parsing or database work does not acknowledge the message.

Here is the central implementation file, `db/worker.sql`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```sql
CREATE TABLE IF NOT EXISTS processed_events(event_id text PRIMARY KEY, processed_at timestamptz NOT NULL DEFAULT now());
```

Install the pinned psycopg dependency in a local virtual environment, create the supplied orders table and worker table, and call process using a psycopg connection opened with autocommit=True. Feed each evidence message; there must be two orders. Raise a database error and confirm neither event marker nor order commits. In the existing queue poller call DeleteMessage only after process returns; errors must leave the message unacknowledged. Keep visibility timeout above bounded processing time and configure a dead-letter policy.

[Open the process old and new queue messages without duplicate effects challenge](/challenges/cicd/safe-delivery-workshop?step=d5-message-compatibility).

## Copy the approved image across accounts without changing its digest

A registry transfer need not change content. skopeo --all copies the manifest list and platform images; --preserve-digests rejects conversions that alter identity. Separate role profiles scope the two sides. Image copying does not automatically establish runtime pull permission or transfer every signature/referrer. Those are explicit promotion preconditions.

The operational question is whether the repaired system can demonstrate all of the following:

- Copy selects a source digest and preserves all platform manifests.
- Destination digest matches the approved digest before deployment.
- Source reads and destination writes are repository-scoped.

Here is the central implementation file, `scripts/promote-image.sh`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${SOURCE_PROFILE:?}" "${DESTINATION_PROFILE:?}" "${DIGEST:?}"
[[ "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]
source_repo=111111111111.dkr.ecr.eu-west-1.amazonaws.com/orders
destination=222222222222.dkr.ecr.eu-west-1.amazonaws.com/orders
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
aws --profile "$SOURCE_PROFILE" ecr get-login-password --region eu-west-1 | skopeo login --authfile "$work/auth.json" --username AWS --password-stdin "${source_repo%%/*}"
aws --profile "$DESTINATION_PROFILE" ecr get-login-password --region eu-west-1 | skopeo login --authfile "$work/auth.json" --username AWS --password-stdin "${destination%%/*}"
tag="release-${DIGEST#sha256:}"
skopeo copy --all --preserve-digests --authfile "$work/auth.json" "docker://$source_repo@$DIGEST" "docker://$destination:$tag"
skopeo inspect --raw --authfile "$work/auth.json" "docker://$destination:$tag" > "$work/manifest.json"
actual=$(skopeo manifest-digest "$work/manifest.json")
[[ "$actual" == "$DIGEST" ]]
printf '%s\n' "$destination@$actual"
```

Supply approved profiles and a real multi-platform digest. Compare raw manifest digests and deploy the destination@digest output. Confirm unrelated repositories are denied. If an immutable destination tag already exists, inspect and verify it rather than overwrite it. Verify provenance subject-name policy separately when the registry name changes.

[Open the copy the approved image across accounts without changing its digest challenge](/challenges/cicd/safe-delivery-workshop?step=d6-cross-account-image).

## Configure environments without baking secrets into images

Runtime configuration changes independently of image content. ECS uses the execution role to inject secrets at startup; the task role governs application AWS calls. Rotation does not mutate existing process environments. A safe rotation therefore includes replacement and a period during which old and new credentials remain compatible with the database.

The operational question is whether the repaired system can demonstrate all of the following:

- Dockerfile contains no environment-specific credentials.
- Task definition refers to the approved secret without embedding its value.
- Rotation uses task replacement and connection verification without rebuilding.

Here is the central implementation file, `Dockerfile`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node","dist/server.js"]
```

Rotate any genuinely exposed credential and restrict old image access. Register the new task definition and deploy under the rolling safety policy. After rotating the secret, force replacement of tasks using the same image, check task start times and database operations without printing credentials. A customer-managed KMS key additionally needs scoped decrypt authorization.

[Open the configure environments without baking secrets into images challenge](/challenges/cicd/safe-delivery-workshop?step=d7-runtime-configuration).

## Resume a deployment from durable release identity

An API operation can outlive its caller. Durable candidate identity lets retry observe rather than recreate work. Conditional ownership binds mutation to the approved desired release. This design depends on coordinator write policy and CI serialization, including same-release retries; it is not a universal distributed transaction. A failed waiter must not release ownership and let another deployment blindly proceed.

The operational question is whether the repaired system can demonstrate all of the following:

- Retry reuses the candidate without building or registering another task definition.
- Superseded desired releases and unexpected service revisions are rejected.
- Failure retains the claim; success records completion.

Here is the central implementation file, `scripts/resume.py`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

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

Install requirements in a virtual environment; substitute real sandbox task ARNs and seed the table. Set RELEASE_TABLE and workload AWS credentials. Run `python scripts/resume.py release.json`, interrupt after UpdateService and resume serially. Change desiredRelease or service revision in separate tests and confirm rejection. Failure keeps owner; an administrator must inspect ECS before clearing it. Run application smoke checks separately from stabilization.

[Open the resume a deployment from durable release identity challenge](/challenges/cicd/safe-delivery-workshop?step=d8-resume-deployment).

## Recover the intended artifact after a green but incorrect release

Green checks referred to one artifact while production received another. Recovery selects an already verified task definition and checks current state before mutation. The state check requires shared deployment serialization to avoid a concurrent writer. Data compatibility remains an independent prerequisite: a traffic rollback cannot reverse incompatible schema or external side effects.

The operational question is whether the repaired system can demonstrate all of the following:

- Evidence identifies the rebuild after staging approval.
- Recovery rejects unexpected current state and selects verified known-good bytes.
- Future deployment rejects tags and does not rebuild during recovery.

Here is the central implementation file, `scripts/recover-release.sh`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${EXPECTED_CURRENT:?Full incident task ARN}" "${KNOWN_GOOD:?Verified task ARN}" "${KNOWN_GOOD_IMAGE:?Verified full image digest}"
current=$(aws ecs describe-services --cluster orders --services orders --query 'services[0].taskDefinition' --output text)
[[ "$current" == "$EXPECTED_CURRENT" ]]
image=$(aws ecs describe-task-definition --task-definition "$KNOWN_GOOD" --query "taskDefinition.containerDefinitions[?name=='orders'].image | [0]" --output text)
[[ "$image" == "$KNOWN_GOOD_IMAGE" ]]
IMAGE="$image" bash scripts/validate-image.sh
aws ecs update-service --cluster orders --service orders --task-definition "$KNOWN_GOOD" > recovery-start.json
aws ecs wait services-stable --cluster orders --services orders
actual=$(aws ecs describe-services --cluster orders --services orders --query 'services[0].taskDefinition' --output text)
[[ "$actual" == "$KNOWN_GOOD" ]]
```

Preserve CloudTrail and release receipts; confirm database compatibility with the migration owner. Acquire the same deployment serialization used by normal releases, set full ARNs/digest and run recovery. Check readiness, real order behavior and task images afterward. Integrate validate-image.sh before future service mutations and promote the build output without rebuilding.

[Open the recover the intended artifact after a green but incorrect release challenge](/challenges/cicd/safe-delivery-workshop?step=d9-wrong-release).

## Check Your Answers

:::expand[What keeps traffic safe during replacement?]{kind="recap"}

Readiness, bounded draining, adequate replacement capacity and validation before increasing exposure must agree.

:::

:::expand[When is canary evidence sufficient?]{kind="recap"}

Comparable complete observation windows, enough requests and acceptable business/latency results are needed; missing data does not authorize promotion.

:::

:::expand[What determines rollback safety?]{kind="recap"}

Application, database and queued-message compatibility define the recovery boundary, not only the availability of the previous image.

:::

:::expand[What makes promotion and resumption traceable?]{kind="recap"}

Immutable artifact identity, scoped authorization and durable candidate/current-state evidence prevent reconstruction or accidental replacement of a different release.

:::

## References

- [Official implementation reference 1](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-type-ecs.html)
- [Official implementation reference 2](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-target-group-attributes.html)
- [Official implementation reference 3](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/lambda-lifecycle-hooks.html)
- [Official implementation reference 4](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deploy-blue-green-service.html)
- [Official implementation reference 5](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deploy-canary-service.html)
- [Official implementation reference 6](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/pause-lifecycle-hooks.html)
- [Official implementation reference 7](https://docs.aws.amazon.com/AmazonCloudWatch/latest/APIReference/API_GetMetricData.html)
- [Official implementation reference 8](https://www.postgresql.org/docs/current/sql-altertable.html)
- [Official implementation reference 9](https://www.postgresql.org/docs/current/sql-createtrigger.html)
- [Official implementation reference 10](https://www.psycopg.org/psycopg3/docs/basic/transactions.html)
- [Official implementation reference 11](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/standard-queues-at-least-once-delivery.html)
- [Official implementation reference 12](https://github.com/containers/skopeo/blob/main/docs/skopeo-copy.1.md)
- [Official implementation reference 13](https://docs.aws.amazon.com/AmazonECR/latest/userguide/repository-policy-examples.html)
- [Official implementation reference 14](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-secrets-manager.html)
- [Official implementation reference 15](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)
- [Official implementation reference 16](https://boto3.amazonaws.com/v1/documentation/api/latest/reference/services/ecs/waiter/ServicesStable.html)
- [Official implementation reference 17](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/deployment-failure-detection.html)
