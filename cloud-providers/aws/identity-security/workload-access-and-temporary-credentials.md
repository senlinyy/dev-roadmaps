---
title: "Workload Access And Temporary Credentials"
description: "Let AWS workloads call AWS APIs through runtime roles and short-lived credentials instead of hardcoded access keys."
overview: "Applications still need credentials when they call AWS APIs. The safer pattern is to attach a narrow role to the runtime so the app receives temporary credentials from AWS."
tags: ["iam", "roles", "credentials", "workloads"]
order: 3
id: article-cloud-providers-aws-identity-security-temporary-credentials-role-assumption
aliases:
  - temporary-credentials-and-role-assumption
  - cloud-providers/aws/identity-security/temporary-credentials-and-role-assumption.md
---

## Table of Contents

1. [The Bad Shortcut: Put A Key In The App](#the-bad-shortcut-put-a-key-in-the-app)
2. [The Better Shape: Give The Runtime A Role](#the-better-shape-give-the-runtime-a-role)
3. [How Temporary Credentials Change The Risk](#how-temporary-credentials-change-the-risk)
4. [ECS, EC2, And Lambda Examples](#ecs-ec2-and-lambda-examples)
5. [Debugging The Caller Identity](#debugging-the-caller-identity)
6. [Quick Recap](#quick-recap)

## The Bad Shortcut: Put A Key In The App

The receipt worker starts as a small feature.
When an order is paid, `devpolaris-receipt-worker` renders a PDF and uploads it to an S3 bucket.
On a laptop, the first version is straightforward.
The developer already has an AWS profile in the shell, the SDK finds those credentials, and the upload works.

The production review starts when someone asks a simple question:

> How should my app call AWS without storing an AWS key inside the app?

The first answer someone proposes is familiar from local development:
put the AWS key in the container environment.

```text
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
RECEIPT_BUCKET=devpolaris-receipts-prod
```

That would make the code run.
It is also the wrong lifetime for the credential.
The worker only needs access while a task is running.
The access key may live in CI secrets, image layers, shell history, crash dumps, screenshots, and old repository commits.
If it leaks, it keeps working until a human notices and disables it.

The code itself should not need to know about access keys:

```js
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

export async function saveReceipt({ orderId, pdf }) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.RECEIPT_BUCKET,
    Key: `receipts/${orderId}.pdf`,
    Body: pdf,
    ContentType: "application/pdf"
  }));
}
```

This code describes the AWS operation.
It names the bucket and key.
It does not pass `accessKeyId` or `secretAccessKey`.
That is the design we want:
application code makes the request, while the runtime supplies the AWS identity.

The questions for the review are:

- Why is a long-lived access key risky inside app code or deployment config?
- Where should an app get AWS access when it runs on ECS, EC2, or Lambda?
- What are temporary credentials?
- How does the AWS SDK find credentials without hardcoding them?
- How do we prove which AWS identity the running app is using?
- What failure tells us the runtime role or permission is wrong?

The rest of the article follows the review from the unsafe key to the runtime role that replaces it.

## The Better Shape: Give The Runtime A Role

The safer design starts by naming the worker's job.
The production receipt worker may write receipt PDFs under one S3 prefix.
It does not need access to every bucket, every secret, or every deployment action.

```text
The production receipt worker may write objects under:
s3://devpolaris-receipts-prod/receipts/
```

That sentence becomes an IAM role and a narrow policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::devpolaris-receipts-prod/receipts/*"
    }
  ]
}
```

The role also has a trust relationship.
Trust answers who is allowed to receive credentials for the role.
Permissions answer what those credentials can do after they exist.
Both questions are needed.

```text
trust:
  ECS may provide this role to tasks for the receipt worker

permissions:
  the role may write receipt objects to one S3 prefix
```

This changes the architecture of the secret.
The app no longer carries a reusable AWS key.
When AWS starts the workload, the runtime provides temporary credentials for the role.
Supported AWS SDKs know how to find those credentials through the runtime environment.

The result is not "no credentials."
AWS API calls always need credentials.
The improvement is that the credentials are delivered by AWS for the workload's current session, not copied into the app's source, image, or config bundle.

That distinction becomes important during operations.
If the worker starts using the wrong role, the team fixes role attachment.
If the role lacks `s3:PutObject`, the team fixes the role policy.
If a key appears in a build log, that is no longer how the worker is supposed to authenticate.

## How Temporary Credentials Change The Risk

Temporary credentials are still credentials.
They contain an access key ID, secret access key, and session token.
The difference is that AWS issues them for a limited session and rejects them after they expire.

That changes the review.
A leaked long-lived key can be useful months later.
A leaked role session has a shorter window.
The damage still depends on what the role can do, which is why temporary credentials and least privilege belong together.

The request story should look like this while the task is running:

```text
caller:   assumed-role/devpolaris-receipt-worker-prod-role/ecs-task-6d7a
action:   s3:PutObject
resource: arn:aws:s3:::devpolaris-receipts-prod/receipts/order-8842.pdf
result:   allowed
```

If the same task tries to write outside its area, the request should fail:

```text
caller:   assumed-role/devpolaris-receipt-worker-prod-role/ecs-task-6d7a
action:   s3:PutObject
resource: arn:aws:s3:::devpolaris-receipts-prod/manual-backups/order-8842.pdf
result:   denied
```

This is why the review does not stop at "we use roles."
A role with broad permissions can still cause broad damage during a session.
A narrow role with temporary credentials gives the team two controls:
the credential dies, and the credential can only do the workload's job while it is alive.

There is also an evidence benefit.
CloudTrail and AWS error messages can show an assumed role session for the worker.
That is much clearer than a shared IAM user named `prod-app-key`.
The session name can tie the request back to a task, function, host, or deploy run.

## ECS, EC2, And Lambda Examples

The receipt worker might run in different AWS runtimes over its life.
The access pattern should stay recognizable even when the service changes:
attach a role to the runtime, let AWS deliver temporary credentials, and keep the role permissions narrow.

For ECS, the important field is the task role:

```json
{
  "family": "devpolaris-receipt-worker",
  "taskRoleArn": "arn:aws:iam::333333333333:role/devpolaris-receipt-worker-prod-role",
  "executionRoleArn": "arn:aws:iam::333333333333:role/devpolaris-receipt-worker-execution-role",
  "containerDefinitions": [
    {
      "name": "receipt-worker",
      "environment": [
        { "name": "AWS_REGION", "value": "us-east-1" },
        { "name": "RECEIPT_BUCKET", "value": "devpolaris-receipts-prod" }
      ]
    }
  ]
}
```

The task execution role lets ECS pull images and do platform work.
The task role is what the application code uses when it calls S3.
If the worker gets `AccessDenied` from S3, adding S3 permission to the execution role is usually the wrong repair.

If the same worker ran on EC2, the role would arrive through an instance profile:

```text
instance:
  name: receipt-worker-prod-1
  instance profile: devpolaris-receipt-worker-prod-profile
  role inside profile: devpolaris-receipt-worker-prod-role
```

That is a reasonable fit for a single-purpose instance.
It becomes harder on a shared host because ordinary processes on the instance may be able to use the instance role.
If several unrelated apps need different AWS permissions, per-workload roles are easier to reason about.

If the worker becomes a Lambda function, the role is the execution role:

```json
{
  "FunctionName": "devpolaris-receipt-worker-prod",
  "Runtime": "nodejs22.x",
  "Role": "arn:aws:iam::333333333333:role/devpolaris-receipt-worker-prod-role",
  "Environment": {
    "Variables": {
      "RECEIPT_BUCKET": "devpolaris-receipts-prod"
    }
  }
}
```

Lambda assumes the execution role when the function runs.
The function code uses the SDK in the same ordinary way.

The service names differ, but the decision stays connected:
which runtime starts the code, which role does that runtime provide, and does that role match the job?

## Debugging The Caller Identity

The first production failure after the refactor is predictable.
The worker starts without a hardcoded key, tries to upload a receipt, and S3 denies the request.
The old reaction would be to paste a key back into the environment.
The better reaction is to prove the caller.

Run `aws sts get-caller-identity` from the failing runtime when possible.
Inside a correctly configured ECS task, the output should resemble a task role session:

```bash
$ aws sts get-caller-identity
{
  "UserId": "AROARECEIPTROLE:ecs-task-6d7a",
  "Account": "333333333333",
  "Arn": "arn:aws:sts::333333333333:assumed-role/devpolaris-receipt-worker-prod-role/ecs-task-6d7a"
}
```

If the ARN shows a human user, an old IAM user, a staging role, or a different workload role, the problem is credential delivery.
Fix the task role, instance profile, Lambda execution role, or deployment configuration before editing the permission policy.

If the caller is correct, read the denied action and resource:

```text
AccessDenied: User:
arn:aws:sts::333333333333:assumed-role/devpolaris-receipt-worker-prod-role/ecs-task-6d7a
is not authorized to perform: s3:PutObject
on resource:
arn:aws:s3:::devpolaris-receipts-prod/manual-backups/order-8842.pdf
```

This denial may be good news.
The worker is using the right role, but it is trying to write outside `receipts/*`.
That points to a wrong key prefix in code or configuration.
Widening the role would hide the bug.

Another failure points at missing credential delivery:

```text
Unable to locate credentials.
You can configure credentials by running "aws configure".
```

In a production runtime, that usually means the app did not receive credentials through the runtime path.
The fix is role attachment, not a copied access key.

## Quick Recap

The receipt worker review started with a tempting shortcut:
put a reusable AWS key in the container.
The safer design moved authority to the runtime.

| Question | Answer Habit |
|----------|--------------|
| Why not put a key in the app? | Long-lived keys leak and keep working until disabled |
| Where should the app get access? | From the AWS runtime role attached to ECS, EC2, or Lambda |
| What are temporary credentials? | Short-lived credentials AWS issues for a role session |
| How does the SDK find them? | Through the runtime credential provider path |
| How do we debug it? | Start with `aws sts get-caller-identity` in the failing runtime |
| What should permissions look like? | Narrow to the workload's actual AWS job |

The code still uploads a receipt.
What changed is where authority lives.
Configuration names resources, the runtime provides identity, IAM narrows the role, and evidence shows which caller made the request.

---

**References**

- [Security best practices in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) - Confirms AWS guidance to use temporary credentials with IAM roles for workloads and to apply least-privilege permissions.
- [Temporary security credentials in IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_temp.html) - Explains that temporary credentials are generated dynamically, include a limited lifetime, and avoid distributing long-term credentials with applications.
- [Use an IAM role to grant permissions to applications running on Amazon EC2 instances](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_use_switch-role-ec2.html) - Documents the EC2 instance profile pattern for giving applications temporary role credentials.
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Documents task roles, the split from task execution roles, and how ECS makes role permissions available to containers.
- [Defining Lambda function permissions with an execution role](https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html) - Documents Lambda execution roles and the trust relationship that allows Lambda to assume the role.
- [get-caller-identity](https://docs.aws.amazon.com/cli/latest/reference/sts/get-caller-identity.html) - Documents the AWS CLI command used to verify which credentials are currently making AWS requests.
