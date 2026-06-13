---
title: "AWS Core Services by Job"
description: "Core AWS service families mapped to traffic, compute, state, access, signals, and operations."
overview: "A production AWS app is a chain of service jobs. This first article walks through networking, traffic, compute, state, access, secrets, observability, releases, budgets, backups, and a practical diagnostic path for a public ECS app."
tags: ["aws", "foundations", "ecs", "s3", "iam", "cloudwatch", "rds"]
order: 1
id: article-cloud-iac-cloud-providers-core-services
aliases:
  - cloud-iac/cloud-providers/core-services.md
  - child-cloud-providers-core-services
  - core-services
  - 04-core-services
  - cloud-providers/aws/foundations/04-core-services.md
---

## Table of Contents

1. [AWS Services by Job](#aws-services-by-job)
2. [The App We Will Follow](#the-app-we-will-follow)
3. [Networking: VPCs, Subnets, Routes, and Security Groups](#networking-vpcs-subnets-routes-and-security-groups)
4. [Traffic: Route 53, ALB, and Target Groups](#traffic-route-53-alb-and-target-groups)
5. [Compute: ECS Fargate, Task Definitions, and ECR](#compute-ecs-fargate-task-definitions-and-ecr)
6. [State: RDS and S3](#state-rds-and-s3)
7. [Access and Secrets: IAM Roles and Secrets Manager](#access-and-secrets-iam-roles-and-secrets-manager)
8. [Signals: CloudWatch and CloudTrail](#signals-cloudwatch-and-cloudtrail)
9. [Operations: Budgets and AWS Backup](#operations-budgets-and-aws-backup)
10. [A Request-Path Diagnostic Walkthrough](#a-request-path-diagnostic-walkthrough)
11. [Putting It All Together](#putting-it-all-together)
12. [References](#references)

## AWS Services by Job
<!-- section-summary: Core AWS services line up around the jobs a running application needs: traffic, compute, state, access, signals, and operations. -->

AWS has a lot of service names, and beginners often try to memorize the catalog one product at a time. That gets tiring quickly because the same application may involve Route 53, VPC, ALB, ECS, Fargate, ECR, RDS, S3, IAM, Secrets Manager, CloudWatch, CloudTrail, Budgets, and AWS Backup before it serves a single customer request.

The first pass through AWS Foundations groups those services by job. One group creates the private network boundary. One group accepts public traffic. One group runs code. One group stores state. One group grants access and delivers secrets. One group records signals. One group keeps the system affordable, recoverable, and ready for operations.

Think about what happens when a customer opens a checkout page. DNS has to find the public entry point. The load balancer has to accept the request and choose a healthy target. Compute has to run the application process. The application has to read and write data. The runtime needs permissions and secrets. Logs and audit events need to explain what happened. Budgets and backups need to protect the system outside the happy path.

That chain is the point of this article. We are going to follow one small app through the core AWS jobs, then use the same chain as a debugging runbook. After that, the module can talk about where those resources belong and how to identify the exact target during real work.

## The App We Will Follow
<!-- section-summary: A small public checkout API gives us one consistent production scenario for mapping services and debugging a request path. -->

Our scenario is Northstar Shop, a small ecommerce app with a public checkout API. Customers visit `shop.example.com`, place orders, and receive receipt PDFs. The company is small enough that one team owns the whole stack, but the app still needs normal production pieces: public traffic handling, private compute, persistent data, secrets, logs, cost alerts, and backups.

The request path looks like this in plain language. A customer browser resolves DNS through Route 53. The request reaches an Application Load Balancer in public subnets. The load balancer forwards traffic to healthy ECS Fargate tasks in private subnets. The task reads database credentials from Secrets Manager, writes order rows to RDS PostgreSQL, writes receipt objects to S3, and sends logs to CloudWatch Logs.

Around that request path, the platform has supporting services. ECR stores the container image that ECS pulls during deployment. IAM roles decide what the task and the ECS agent can do. CloudTrail records AWS API activity. Budgets alert the team before costs surprise finance. AWS Backup protects RDS and other supported data resources with central backup plans.

This app is small on purpose. A bigger company may add CloudFront, WAF, API Gateway, SQS, SNS, DynamoDB, ElastiCache, Step Functions, or multiple accounts. The same job-based map still helps because every extra service joins the request path for a reason.

![Infographic showing a Northstar Shop request moving through Route 53, an Application Load Balancer, ECS Fargate, RDS, S3, IAM, Secrets Manager, CloudWatch, CloudTrail, Budgets, and Backup](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-service-request-path.png)

*The service map keeps the application path visible: public traffic enters through DNS and the load balancer, compute runs privately, durable state lives outside the task, and signals plus operations surround the request.*

## Networking: VPCs, Subnets, Routes, and Security Groups
<!-- section-summary: Networking defines where workloads live, which routes they can use, and which private connections can reach each service. -->

The first job is the private network boundary. A **Virtual Private Cloud**, or **VPC**, is a private network space inside one AWS Region. It gives your resources IP ranges, subnets, route tables, and network controls so the application can separate public entry points from private workloads and data stores.

For Northstar, the VPC usually has at least two Availability Zones because production systems need more than one physical failure zone. Each Availability Zone has a public subnet for load balancer nodes and a private application subnet for ECS tasks. The RDS database uses private database subnets, often with route tables that have no direct internet route.

Subnets are ranges of IP addresses inside the VPC. A **public subnet** has a route to an internet gateway and hosts resources that need public entry, such as an Application Load Balancer. A **private application subnet** hosts resources such as ECS tasks that initiate outbound connections through a NAT gateway or VPC endpoints. A **database subnet** hosts RDS and accepts traffic only from the application layer.

Route tables decide where network traffic goes. The public subnet route table has a default route to the internet gateway. The private application route table may send internet-bound traffic to a NAT gateway, or send AWS service traffic through VPC endpoints where the team has configured them. The database subnet route table usually keeps routing narrow so the database only participates in private VPC traffic.

Security groups act like stateful firewalls around resources. The ALB security group allows inbound HTTPS from the internet. The ECS task security group allows inbound traffic from the ALB security group on the application port. The RDS security group allows inbound PostgreSQL only from the ECS task security group. That chain gives the database a private path from the app while keeping public clients away from it.

Here are the kinds of CLI checks an on-call engineer uses during a networking question:

```bash
aws ec2 describe-subnets \
  --filters "Name=tag:Application,Values=northstar-shop" \
  --query 'Subnets[].{SubnetId:SubnetId,Az:AvailabilityZone,Cidr:CidrBlock,Name:Tags[?Key==`Name`].Value|[0]}' \
  --output table

aws ec2 describe-route-tables \
  --filters "Name=tag:Application,Values=northstar-shop" \
  --query 'RouteTables[].{RouteTableId:RouteTableId,Routes:Routes[].{Destination:DestinationCidrBlock,Target:GatewayId || NatGatewayId || VpcEndpointId}}'

aws ec2 describe-security-groups \
  --group-ids sg-0123456789abcdef0 \
  --query 'SecurityGroups[].IpPermissions'
```

Networking sets the stage. Once the private boundary exists, the next job is getting a public browser request to the right private workload without exposing every workload directly to the internet.

## Traffic: Route 53, ALB, and Target Groups
<!-- section-summary: Traffic services turn a public name into a healthy private application target through DNS, listeners, rules, and health checks. -->

The traffic job starts with DNS. **Amazon Route 53** can host DNS records for a domain, and those records tell a customer browser where `shop.example.com` should go. In many web apps, the record points to an Application Load Balancer rather than to one fixed server IP, because the load balancer has multiple nodes and AWS manages their addresses.

An **Application Load Balancer**, or **ALB**, accepts HTTP and HTTPS traffic. It has listeners, rules, certificates, and target groups. A listener receives traffic on a port such as 443. A rule decides where to send the request based on host, path, or other HTTP details. A target group contains the private targets that can serve the request.

For Northstar, the ALB might listen on HTTPS port 443 and forward `/api/checkout/*` to an ECS target group. ECS registers each running Fargate task with the target group by private IP and port. The ALB sends health checks to a path such as `/healthz`, and only healthy targets receive normal traffic.

Health checks deserve extra attention because they connect traffic and compute. A container can start successfully and still fail ALB health checks if the target group uses the wrong port, the health path returns `500`, the security group blocks the ALB, or the app needs too long to warm up. ECS service events usually tell you when the service keeps replacing tasks because the load balancer marks them unhealthy.

Common traffic checks look like this:

```bash
dig +short shop.example.com

aws elbv2 describe-load-balancers \
  --names northstar-prod-alb \
  --query 'LoadBalancers[].{Arn:LoadBalancerArn,DNS:DNSName,Scheme:Scheme,VpcId:VpcId,State:State.Code}' \
  --output table

aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/northstar-checkout/abc123 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}' \
  --output table
```

If DNS and the ALB look healthy, the investigation moves inward. The load balancer can only forward to tasks that exist, listen on the expected port, and pass health checks. That takes us to compute.

## Compute: ECS Fargate, Task Definitions, and ECR
<!-- section-summary: Compute services run the application process, and ECS Fargate connects container images, task definitions, services, and deployments. -->

**Compute** means the part of AWS that runs your code. AWS gives teams several compute styles. EC2 gives virtual servers. Lambda runs event-driven functions. ECS runs containers, and **AWS Fargate** lets ECS run those containers without your team managing the underlying EC2 hosts.

Northstar uses ECS Fargate because the checkout API is a long-running container service. The team builds a Docker image, pushes it to Amazon ECR, and points an ECS task definition at that image. ECS then starts tasks from the task definition and keeps the service at the desired number of running tasks.

An **ECS task definition** is the blueprint for a task. It names the container image, CPU, memory, container port, environment variables, log configuration, task role, and execution role. A **task** is a running copy of that blueprint. An **ECS service** keeps a chosen number of tasks running, replaces failed tasks, and coordinates deployments with the load balancer.

Amazon ECR stores the container image. During deployment, the ECS agent uses the task execution role to pull the image from ECR and send logs to CloudWatch. The application code uses the task role to call services such as S3, Secrets Manager, or DynamoDB. Those two roles are easy to confuse, and the difference matters during incidents.

The compute runbook checks image, service, task, and event state together:

```bash
aws ecr describe-images \
  --repository-name northstar/checkout-api \
  --image-ids imageTag=2026-06-13.1 \
  --query 'imageDetails[].{Digest:imageDigest,Pushed:imagePushedAt,Size:imageSizeInBytes}' \
  --output table

aws ecs describe-services \
  --cluster northstar-prod \
  --services checkout-api \
  --query 'services[].{Status:status,Desired:desiredCount,Running:runningCount,Pending:pendingCount,TaskDefinition:taskDefinition,Events:events[0:5].message}' \
  --output table

aws ecs list-tasks \
  --cluster northstar-prod \
  --service-name checkout-api \
  --desired-status RUNNING
```

When the running tasks list looks wrong, task details show stopped reasons, container exit codes, network attachments, and health status. That is where image pull errors, app boot errors, missing secrets, and failing health checks often surface.

```bash
aws ecs describe-tasks \
  --cluster northstar-prod \
  --tasks arn:aws:ecs:us-east-1:123456789012:task/northstar-prod/0123456789abcdef0 \
  --query 'tasks[].{LastStatus:lastStatus,Health:healthStatus,StoppedReason:stoppedReason,Containers:containers[].{Name:name,ExitCode:exitCode,Reason:reason,Health:healthStatus}}'
```

Compute can run perfectly and still fail the customer request if the app cannot persist data. That is why the next job is state.

## State: RDS and S3
<!-- section-summary: State services store durable business data outside ephemeral compute tasks, with RDS for relational data and S3 for objects. -->

**State** means data that must survive after a task stops. ECS tasks come and go during deployments, scaling, health check failures, and host maintenance. Customer orders, receipt files, session records, and audit exports need services that persist beyond the life of one running container.

Northstar uses **Amazon RDS for PostgreSQL** for order rows. RDS is a managed relational database service, so AWS handles the database infrastructure while the team still chooses engine type, instance size, storage, networking, backups, maintenance windows, and high availability settings. The application connects to a database endpoint over the private network and uses SQL transactions for checkout writes.

Northstar uses **Amazon S3** for receipt PDFs and batch exports. S3 stores objects inside buckets, and each object has a key. This shape fits files and exports well because the app writes a complete receipt object such as `receipts/2026/06/order-12345.pdf`, then later reads that object by key.

The state checks ask different questions for each service. For RDS, the team checks instance status, endpoint, Multi-AZ setting, backup retention, storage, recent events, and connection-related CloudWatch metrics. For S3, the team checks bucket existence, location, encryption, public access block, lifecycle rules, and whether the task role can access the expected prefix.

```bash
aws rds describe-db-instances \
  --db-instance-identifier northstar-orders-prod \
  --query 'DBInstances[].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port,MultiAZ:MultiAZ,BackupRetention:BackupRetentionPeriod,Storage:AllocatedStorage}' \
  --output table

aws s3api head-bucket --bucket northstar-receipts-prod

aws s3api get-bucket-encryption \
  --bucket northstar-receipts-prod

aws s3api get-public-access-block \
  --bucket northstar-receipts-prod
```

A real production habit is to check state from both directions. The infrastructure team confirms that RDS and S3 look healthy from AWS. The application team checks logs for connection pool errors, timeout errors, `AccessDenied`, missing object keys, and database migration errors. Both sides matter because a healthy database can still reject traffic from the wrong security group or bad password.

State leads naturally into permissions and secrets. The checkout task needs a database password, and it needs permission to read that secret and write to the receipt bucket. Those are access jobs.

## Access and Secrets: IAM Roles and Secrets Manager
<!-- section-summary: IAM roles grant short-lived AWS permissions to workloads, while Secrets Manager stores sensitive values such as database credentials. -->

**IAM roles** give AWS workloads permissions without embedding long-lived access keys in the application. In ECS, the task role is the identity your application code uses when it calls AWS APIs. If the checkout container writes receipts to S3 or reads a secret from Secrets Manager, those permissions belong on the task role.

The **task execution role** has a different job. ECS and Fargate use it to pull the container image from ECR, fetch some configured secrets, and send logs through the configured driver. The application code should rely on the task role for its own AWS calls. Keeping those roles separate makes policy review cleaner because infrastructure plumbing and business logic use different permissions.

**AWS Secrets Manager** stores sensitive values such as database passwords, API keys, OAuth client secrets, and rotation metadata. The app should receive a reference to a secret, not a plain password stored in a repository or container image. For a database-backed app, the task role can receive permission to read one secret ARN, and the application can load that value at startup or through the SDK.

Here is a small task-role policy for the Northstar checkout API. It grants access to one secret and one S3 bucket prefix, which matches the app's real job.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadDatabaseSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:northstar/prod/orders-db-AbCdEf"
    },
    {
      "Sid": "WriteReceiptObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::northstar-receipts-prod/receipts/*"
    },
    {
      "Sid": "ListReceiptPrefix",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::northstar-receipts-prod",
      "Condition": {
        "StringLike": {
          "s3:prefix": "receipts/*"
        }
      }
    }
  ]
}
```

During a permission incident, the team checks the role ARNs, attached policies, secret metadata, and policy simulation results. They avoid printing secret values into terminals and tickets because the goal is to prove access, rotation, and ARN scope without spreading the sensitive value.

```bash
aws iam get-role \
  --role-name northstar-checkout-task-prod \
  --query 'Role.{Arn:Arn,RoleId:RoleId,Path:Path}'

aws secretsmanager describe-secret \
  --secret-id arn:aws:secretsmanager:us-east-1:123456789012:secret:northstar/prod/orders-db-AbCdEf \
  --query '{Name:Name,ARN:ARN,RotationEnabled:RotationEnabled,LastChangedDate:LastChangedDate}'

aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/service/northstar-checkout-task-prod \
  --action-names secretsmanager:GetSecretValue s3:PutObject \
  --resource-arns arn:aws:secretsmanager:us-east-1:123456789012:secret:northstar/prod/orders-db-AbCdEf arn:aws:s3:::northstar-receipts-prod/receipts/test.pdf
```

![Infographic separating the ECS task execution role from the application task role, with ECR pulls and log delivery on one side and secret reads plus S3 writes on the other](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/task-role-boundary.png)

*The split between the execution role and the task role keeps platform plumbing separate from the permissions the application code uses during normal business work.*

Permissions and secrets explain whether the app can do its job. When something still fails, signals tell us what the app and AWS APIs actually did.

## Signals: CloudWatch and CloudTrail
<!-- section-summary: CloudWatch shows workload metrics and logs, while CloudTrail shows AWS API activity and control-plane changes. -->

**Signals** are the evidence a system leaves while it runs. Without signals, debugging turns into guessing. In AWS, the two beginner services to know first are Amazon CloudWatch and AWS CloudTrail, because together they answer many application and platform questions.

**Amazon CloudWatch** collects metrics, logs, alarms, dashboards, and events from many AWS services. For ECS Fargate, the task definition can use the `awslogs` log driver so container stdout and stderr go to CloudWatch Logs. The team can then tail logs during an incident, search error text, and connect application errors with deployment times.

```bash
aws logs tail /aws/ecs/northstar/checkout-api \
  --since 30m \
  --follow
```

CloudWatch metrics help with service-level symptoms. ALB metrics can show `HTTPCode_Target_5XX_Count` or target response time. ECS metrics can show CPU and memory pressure. RDS metrics can show database connections, CPU, storage, and latency. A dashboard brings those signals together so the team can see whether the problem lives at the edge, compute, database, or downstream service.

**AWS CloudTrail** records AWS API activity. If someone changed a security group, updated an ECS service, edited a secret, or modified a bucket policy, CloudTrail helps identify the API call, caller, time, source IP, and request details. CloudTrail is especially useful when the symptom appears right after a deployment or manual console change.

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=UpdateService \
  --start-time 2026-06-13T08:00:00Z \
  --end-time 2026-06-13T12:00:00Z \
  --max-results 20
```

CloudWatch and CloudTrail answer different questions. CloudWatch tells the team what the workload experienced. CloudTrail tells the team what AWS control-plane actions happened. Good incident response usually checks both because an application error and a platform change often line up in time.

Signals help during incidents, and operations services help outside incidents. The next job is keeping the platform financially visible and recoverable.

## Operations: Budgets and AWS Backup
<!-- section-summary: Operations services keep the application sustainable by alerting on cost risk and centralizing backup plans for supported resources. -->

Operations work keeps the app healthy after the first deployment. For a small team, two services deserve early attention: **AWS Budgets** and **AWS Backup**. They do different jobs, but both protect the team from painful surprises.

AWS Budgets tracks cost and usage against thresholds. Northstar might create one monthly cost budget for the production account, another budget filtered to `Application=northstar-shop`, and alerts at 50, 80, and 100 percent of the expected monthly spend. Budget alerts help the team notice runaway logs, oversized NAT gateway traffic, accidental test clusters, or a database class that someone scaled up and forgot.

```bash
aws budgets describe-budgets \
  --account-id 123456789012 \
  --query 'Budgets[].{Name:BudgetName,Type:BudgetType,Limit:BudgetLimit.Amount,Unit:BudgetLimit.Unit,TimeUnit:TimeUnit}' \
  --output table
```

AWS Backup centralizes backup plans for supported services. A backup plan defines rules such as schedule, retention, backup vault, and copy behavior. For Northstar, the team may rely on RDS automated backups for point-in-time recovery and also use AWS Backup for central policy, reporting, cross-account copy, or compliance workflows where those requirements apply.

```bash
aws backup list-backup-plans \
  --query 'BackupPlansList[].{Name:BackupPlanName,PlanId:BackupPlanId,Version:VersionId}' \
  --output table

aws backup list-backup-jobs \
  --by-resource-arn arn:aws:rds:us-east-1:123456789012:db:northstar-orders-prod \
  --query 'BackupJobs[0:5].{State:State,Created:CreationDate,Completed:CompletionDate,Resource:ResourceArn}'
```

Backups need restore practice. A green backup job only proves AWS created a recovery point. The team still needs a periodic restore exercise in a non-production environment, a documented recovery time objective, and a tested application-level validation step. For an ecommerce app, that might mean restoring a database snapshot, running migrations, checking a sample order query, and confirming the app can start against the restored endpoint.

These operations services round out the service map. Now we can use the whole chain as a diagnostic path when the public app fails.

## A Request-Path Diagnostic Walkthrough
<!-- section-summary: A request-path runbook follows the customer request from DNS to ALB, ECS, state, access, secrets, signals, image release, cost, and backup evidence. -->

The incident starts at 09:18. Customers report that checkout returns `503 Service Unavailable`. The team has one goal: follow the request path in order and stop at the first layer that shows evidence. This keeps the debugging conversation grounded because every check asks, "Can the request move to the next job?"

First, the team checks DNS and the load balancer. If DNS points to the wrong load balancer, every deeper service can look healthy while customers still fail. If the ALB exists but target health is failing, the investigation moves to target group health instead of RDS or S3.

```bash
dig +short shop.example.com

aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/northstar-checkout/abc123 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}' \
  --output table
```

The target group says every target is unhealthy with a health check timeout. That points inward to ECS tasks and networking. The responder checks whether the ECS service has running tasks, recent deployment events, and task stopped reasons.

```bash
aws ecs describe-services \
  --cluster northstar-prod \
  --services checkout-api \
  --query 'services[].{Desired:desiredCount,Running:runningCount,Pending:pendingCount,TaskDefinition:taskDefinition,Events:events[0:8].message}'

aws ecs list-tasks \
  --cluster northstar-prod \
  --service-name checkout-api \
  --desired-status STOPPED \
  --query 'taskArns[0:5]'
```

The ECS service shows a new task definition revision and repeated messages about failing load balancer health checks. The team describes one stopped task and sees the container exited after a database connection error. Now the request path has moved from traffic to compute to state.

```bash
aws logs tail /aws/ecs/northstar/checkout-api \
  --since 45m \
  --filter-pattern '"database connection"'
```

The logs show `password authentication failed`. That suggests a secret, configuration, or database credential change. The team checks the secret metadata without printing the secret value, then checks CloudTrail for recent secret changes.

```bash
aws secretsmanager describe-secret \
  --secret-id northstar/prod/orders-db \
  --query '{ARN:ARN,RotationEnabled:RotationEnabled,LastChangedDate:LastChangedDate,LastRotatedDate:LastRotatedDate}'

aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=UpdateSecret \
  --start-time 2026-06-13T08:30:00Z \
  --end-time 2026-06-13T09:30:00Z \
  --max-results 10
```

CloudTrail shows an approved secret rotation at 09:03. The next question is whether the database accepted the new credential and whether the running task loaded the expected secret. The RDS check shows the database is available, so the team checks task definition environment and secret references.

```bash
aws rds describe-db-instances \
  --db-instance-identifier northstar-orders-prod \
  --query 'DBInstances[].{Status:DBInstanceStatus,Endpoint:Endpoint.Address,Port:Endpoint.Port}'

aws ecs describe-task-definition \
  --task-definition northstar-checkout-api:42 \
  --query 'taskDefinition.containerDefinitions[].secrets'
```

The task definition still references the old secret path. The fix is a deployment change, not a database repair. The team updates the task definition through IaC, deploys the new ECS service revision, and watches target health move from unhealthy to healthy.

```bash
aws ecs describe-services \
  --cluster northstar-prod \
  --services checkout-api \
  --query 'services[].deployments[].{Status:status,TaskDefinition:taskDefinition,Desired:desiredCount,Running:runningCount}'

aws elbv2 describe-target-health \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/northstar-checkout/abc123 \
  --query 'TargetHealthDescriptions[].TargetHealth.State'
```

After customer traffic recovers, the team finishes the operational checks. They confirm the deployed image digest from ECR, verify no unusual budget spike came from the incident, and confirm the latest RDS backup or recovery point exists before closing the incident. Those checks may sound separate from the 503, but they catch the side effects that incidents often leave behind.

```bash
aws ecr describe-images \
  --repository-name northstar/checkout-api \
  --image-ids imageTag=2026-06-13.2 \
  --query 'imageDetails[].{Digest:imageDigest,Pushed:imagePushedAt}'

aws budgets describe-budgets \
  --account-id 123456789012 \
  --query 'Budgets[?BudgetName==`northstar-prod-monthly`]'

aws backup list-recovery-points-by-backup-vault \
  --backup-vault-name prod-primary \
  --by-resource-arn arn:aws:rds:us-east-1:123456789012:db:northstar-orders-prod \
  --query 'RecoveryPoints[0:3].{Status:Status,Created:CreationDate,Resource:ResourceArn}'
```

This walkthrough shows why the service map is practical. The team did not jump randomly between services. They followed the request through traffic, compute, state, access, secrets, signals, release evidence, cost, and backup evidence until the failing link showed itself.

## Putting It All Together
<!-- section-summary: The core AWS services form one production chain, and each service family has a clear job during build, deploy, debug, and recovery work. -->

Northstar Shop uses many AWS services, and each one has a job in the production chain. VPC, subnets, route tables, and security groups create the private network boundary. Route 53, ALB, listeners, and target groups move public requests to healthy private targets.

ECS Fargate runs the checkout container. ECR stores the image that ECS deploys. RDS stores order records, and S3 stores receipt objects. IAM roles grant the workload scoped AWS permissions, while Secrets Manager stores the database credential. CloudWatch shows logs and metrics, and CloudTrail shows API activity. Budgets and AWS Backup protect cost visibility and recovery.

The same map helps during incidents. A `503` starts at DNS and ALB health, then moves to ECS tasks, logs, database connectivity, secrets, IAM, CloudTrail, and release evidence. A receipt upload failure starts at application logs, S3 permissions, bucket settings, task role policy, and CloudTrail. A surprise bill starts at tags, Cost Explorer, Budgets, and the resources attached to the service chain.

That is the working pattern for AWS foundations. The service names matter because each name points to a job the application needs. After the service jobs are clear, the next question is placement: which account, Region, Availability Zones, and subnets should hold each piece of the app. Then resource identity gives the team exact ARNs, service IDs, names, and tags for safe production changes.

![Six-panel summary infographic for AWS core services by job: traffic, compute, state, access, signals, and operations](/content-assets/articles/article-cloud-iac-cloud-providers-core-services/core-services-summary.png)

*The article summary groups the core services by production job so a new AWS service name lands inside a working category instead of a loose catalog list.*

## References

- [Amazon VPC route tables](https://docs.aws.amazon.com/vpc/latest/userguide/VPC_Route_Tables.html) - Documents route tables, destinations, and route targets for VPC networking.
- [NAT gateways](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-nat-gateway.html) - Explains public and private NAT gateway behavior for private subnet egress.
- [What is Amazon Route 53](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html) - Defines Route 53 DNS service concepts, hosted zones, and routing support.
- [Use load balancing to distribute Amazon ECS service traffic](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/service-load-balancing.html) - Explains ECS service integration with Elastic Load Balancing.
- [Health checks for Application Load Balancer target groups](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/target-group-health-checks.html) - Documents ALB target group health checks and target health.
- [Troubleshooting service load balancers in Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/troubleshoot-service-load-balancers.html) - Covers common ECS load balancer configuration problems.
- [Amazon ECS task definitions](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definitions.html) - Defines task definitions, tasks, and task configuration.
- [What is Amazon ECR](https://docs.aws.amazon.com/AmazonECR/latest/userguide/what-is-ecr.html) - Defines Amazon Elastic Container Registry repositories, image storage, and container image distribution.
- [IAM roles for Amazon ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/security-ecs-iam-role-overview.html) - Explains ECS task roles, task execution roles, and related ECS role types.
- [Amazon ECS task IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-iam-roles.html) - Documents how containers receive permissions from the ECS task role.
- [Amazon ECS task execution IAM role](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_execution_IAM_role.html) - Documents the role ECS agents use to pull images, publish logs, and access required AWS services.
- [Send Amazon ECS logs to CloudWatch](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/using_awslogs.html) - Documents ECS log delivery to CloudWatch Logs with the `awslogs` driver.
- [What is AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) - Defines Secrets Manager secret storage, retrieval, rotation, and access behavior.
- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html) - Defines S3 buckets, objects, and object storage concepts.
- [What is Amazon RDS](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Welcome.html) - Defines Amazon RDS managed relational database engines and service responsibilities.
- [Introduction to Amazon RDS backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html) - Explains RDS automated backups and point-in-time recovery concepts.
- [Logging Amazon CloudWatch API and console operations with AWS CloudTrail](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/logging_cw_api_calls.html) - Explains CloudTrail logging for CloudWatch API and console operations and data-event notes.
- [Managing your costs with AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-managing-costs.html) - Documents AWS Budgets cost and usage tracking.
- [What is AWS Backup?](https://docs.aws.amazon.com/aws-backup/latest/devguide/whatisbackup.html) - Explains AWS Backup as a centralized backup service across supported resources.
