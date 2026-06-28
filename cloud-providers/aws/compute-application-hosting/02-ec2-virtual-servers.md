---
title: "EC2 Virtual Servers"
description: "Understand EC2 instances, AMIs, instance types, network access, instance roles, user data, systemd, Auto Scaling groups, and the operating work your team owns."
overview: "EC2 is AWS server-shaped compute. This article follows one orders API from a single private instance to a replaceable, load-balanced fleet with clear boot, access, deployment, patching, and incident evidence."
tags: ["ec2", "virtual-servers", "ami", "systemd", "aws"]
order: 2
id: article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers
aliases:
  - ec2-virtual-servers
  - cloud-providers/aws/compute-application-hosting/ec2-virtual-servers.md
---

## Table of Contents

1. [A Server-Shaped Runtime](#a-server-shaped-runtime)
2. [AMIs, Instance Types, and Volumes](#amis-instance-types-and-volumes)
3. [Network Access and Instance Roles](#network-access-and-instance-roles)
4. [Booting the App with User Data and systemd](#booting-the-app-with-user-data-and-systemd)
5. [From One Instance to a Fleet](#from-one-instance-to-a-fleet)
6. [Deploying, Patching, and Rolling Back](#deploying-patching-and-rolling-back)
7. [An EC2 Incident Path](#an-ec2-incident-path)
8. [References](#references)

## A Server-Shaped Runtime
<!-- section-summary: EC2 gives you a virtual server, so the application runs in a familiar operating system environment with real server responsibilities. -->

Suppose `orders-api` already runs on Ubuntu with Node.js, Nginx, a native PDF package, and a host-level monitoring agent. The team knows the server workflow: install packages, write an environment file, run a `systemd` service, read logs, and patch the operating system. **Amazon EC2** is the AWS compute service that matches that server-shaped workflow.

An **EC2 instance** is one virtual server launched from a recipe. The recipe includes an Amazon Machine Image, an instance type, storage, subnet, security groups, an IAM instance profile, tags, and optional user data. AWS runs the physical data center, networking, storage platform, and virtualization layer. Your team runs the guest operating system, installed packages, users, agents, app process, attached disks, and host-level security posture.

For this article, `orders-api` listens on port `3000`, reads one database secret, writes receipt PDFs to S3, and sends logs to CloudWatch. EC2 fits today because the PDF renderer needs native Linux packages and the monitoring agent needs host access. The production goal is to keep that control while making each server replaceable.

A replaceable EC2 service has a few named pieces:

| Piece | What it answers |
|---|---|
| **AMI** | Which operating system, agents, and base packages boot? |
| **Instance type** | How much CPU, memory, network, and storage performance does one server get? |
| **EBS volume** | Which block devices attach to the instance, and how large are they? |
| **Subnet and security groups** | Where does the server live, and which traffic can reach it? |
| **Instance role** | Which AWS APIs can code on the instance call? |
| **User data and systemd** | How does a fresh instance start the app every time? |
| **Launch template and Auto Scaling group** | How does the fleet replace, scale, and roll servers safely? |
| **Logs and metrics** | Which evidence survives after an instance disappears? |

The rest of the article builds those pieces in the order a team usually meets them. First the server shape, then access, then boot, then replacement, then operations.

![The runtime stack shows the layers a team owns when it chooses a virtual server: network, instance, operating system, role, boot script, and app process](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers/ec2-runtime-stack.png)

*The runtime stack shows the layers a team owns when it chooses a virtual server: network, instance, operating system, role, boot script, and app process.*


## AMIs, Instance Types, and Volumes
<!-- section-summary: AMIs, instance types, and EBS volumes define what the server starts with and how much capacity it has. -->

An **Amazon Machine Image**, usually called an **AMI**, is the starting disk image for an EC2 instance. It includes the operating system and any baked-in software. A team might build a base AMI with Ubuntu, security hardening, CloudWatch Agent, SSM Agent, company CA certificates, and the PDF package required by `orders-api`.

An **instance type** chooses the virtual hardware shape. A small burstable instance can support a test environment. A production API might use a general-purpose instance family such as `m7i` or a memory-focused family if the process keeps large caches. The instance type affects CPU, memory, network throughput, and sometimes EBS performance.

Most EC2 instances use **Amazon EBS** for block storage. The root EBS volume holds the operating system and app files. Extra EBS volumes can hold data, but production business data often belongs in a managed service such as RDS, DynamoDB, S3, or EFS so replacement instances do not carry unique state.

During a review or incident, inspect the real instance before changing it:

```bash
aws ec2 describe-instances \
  --instance-ids i-0123456789abcdef0 \
  --region eu-west-2 \
  --query 'Reservations[].Instances[].{State:State.Name,Type:InstanceType,Image:ImageId,Subnet:SubnetId,PrivateIp:PrivateIpAddress,Profile:IamInstanceProfile.Arn,SecurityGroups:SecurityGroups[].GroupId,Metadata:MetadataOptions.HttpTokens}'
```

Example output:

```json
[
  {
    "State": "running",
    "Type": "m7i.large",
    "Image": "ami-0abc1234def567890",
    "Subnet": "subnet-0a111111111111111",
    "PrivateIp": "10.20.14.73",
    "Profile": "arn:aws:iam::123456789012:instance-profile/prod-orders-api",
    "SecurityGroups": ["sg-0ordersapi"],
    "Metadata": "required"
  }
]
```

This output tells you which server recipe is actually running. `Image` is the AMI ID, so you can compare it with the approved release record. `Type` is the server size. `Subnet` and `PrivateIp` show placement. `Profile` shows the IAM wrapper attached to the instance. `SecurityGroups` shows the network boundary. `Metadata: "required"` means IMDSv2 is required for instance metadata calls, which is the safer setting for modern EC2 fleets.

Teams often build AMIs with EC2 Image Builder, Packer, or a CI pipeline. A useful image pipeline installs packages, applies hardening, verifies agents, starts a smoke-test instance, and publishes the AMI ID. The deployment record should keep the AMI ID, launch template version, app version, and rollback version together because incidents often ask which of those changed.

The AMI gives the server a consistent base. The next production question is who can reach that server and what the app can call after it starts.

## Network Access and Instance Roles
<!-- section-summary: Security groups and IAM instance roles decide who can reach the instance and what the code on the instance can call. -->

An EC2 instance sits in a subnet inside a VPC. For a private web API, the usual path is an Application Load Balancer in public subnets and EC2 instances in private subnets. Users reach the load balancer over HTTPS. The load balancer reaches the instances on the application port. The instances reach private databases, AWS APIs, and logging endpoints through controlled outbound paths.

A **security group** is a stateful firewall attached to the instance network interface. For `orders-api`, the instance security group should accept TCP port `3000` from the load balancer security group, rather than from the whole internet.

```bash
aws ec2 authorize-security-group-ingress \
  --group-id sg-0ordersapi \
  --protocol tcp \
  --port 3000 \
  --source-group sg-0ordersalb \
  --region eu-west-2
```

Example output:

```json
{
  "Return": true,
  "SecurityGroupRules": [
    {
      "SecurityGroupRuleId": "sgr-0123ordersapi",
      "GroupId": "sg-0ordersapi",
      "IpProtocol": "tcp",
      "FromPort": 3000,
      "ToPort": 3000,
      "ReferencedGroupInfo": {
        "GroupId": "sg-0ordersalb"
      }
    }
  ]
}
```

`--group-id` is the instance security group receiving the inbound rule. `--protocol tcp` and `--port 3000` describe the application listener. `--source-group sg-0ordersalb` means the source must be the load balancer security group. The output rule confirms that the permission is security-group-to-security-group, which is much tighter than opening port `3000` to `0.0.0.0/0`.

The app also needs AWS permissions. Use an **instance role** through an **instance profile** instead of putting access keys on disk. The instance profile attaches the IAM role to the instance, and the AWS SDK retrieves temporary credentials from the Instance Metadata Service.

Here is a scoped permission policy for the `orders-api` instance role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadRuntimeSecret",
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:eu-west-2:123456789012:secret:prod/orders-api/runtime-*"
    },
    {
      "Sid": "WriteReceipts",
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::prod-orders-receipts/receipts/*"
    }
  ]
}
```

`Version` names the IAM policy language version. Each `Statement` grants one narrow job. `Sid` gives the statement a readable name for review. `Effect: "Allow"` grants the listed actions. `Action` names the AWS API calls. `Resource` limits those calls to one secret pattern and one S3 prefix. The app can read its runtime secret and write receipt files, while a stolen role session has a smaller blast radius than a broad account-wide policy.

Network rules and IAM roles work together. The security group decides whether packets can reach the server. The instance role decides whether code on the server can call AWS APIs. Once those boundaries are in place, the next question is how a fresh server turns into a running application host.

## Booting the App with User Data and systemd
<!-- section-summary: User data and systemd turn a newly launched EC2 instance into a repeatable application host. -->

When an EC2 instance starts, **user data** can run a bootstrap script. Use it for small, deterministic startup work: fetch the release artifact, unpack it, write a config file, and start the app. Put slow baseline work such as installing large package sets into the AMI so replacement instances do not depend on a long public-internet install during every boot.

```bash
#!/bin/bash
set -euo pipefail
install -d -o orders -g orders /opt/orders-api/releases/2026-06-24
aws s3 cp s3://prod-orders-artifacts/orders-api/2026-06-24/orders-api.tar.gz /tmp/orders-api.tar.gz
tar -xzf /tmp/orders-api.tar.gz -C /opt/orders-api/releases/2026-06-24
ln -sfn /opt/orders-api/releases/2026-06-24 /opt/orders-api/current
systemctl enable orders-api
systemctl restart orders-api
```

Here is what each line does:

| Line | Why it matters |
|---|---|
| `#!/bin/bash` | Runs the script with Bash. |
| `set -euo pipefail` | Stops the script when a command fails, an unset variable is used, or a pipeline fails. |
| `install -d ...` | Creates the release directory with the app user as owner. |
| `aws s3 cp ...` | Downloads the versioned release artifact from S3 using the instance role. |
| `tar -xzf ...` | Unpacks the release into the versioned directory. |
| `ln -sfn ... current` | Points the stable `current` path at this release. |
| `systemctl enable ...` | Makes the app service start again after reboot. |
| `systemctl restart ...` | Starts this release through the same process manager used later. |

`systemd` is the Linux service manager that keeps the app process supervised:

```ini
[Unit]
Description=Orders API
After=network-online.target
Wants=network-online.target

[Service]
User=orders
WorkingDirectory=/opt/orders-api/current
EnvironmentFile=/etc/orders-api/runtime.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

The `[Unit]` section describes startup ordering. `After=network-online.target` and `Wants=network-online.target` ask Linux to wait for network readiness before starting the app. The `[Service]` section describes the process. `User=orders` avoids running the app as root. `WorkingDirectory` points at the current release. `EnvironmentFile` loads runtime settings such as `DATABASE_URL`. `ExecStart` is the app command. `Restart=on-failure` restarts the process after a crash, and `RestartSec=5` waits five seconds before trying again. The `[Install]` section lets `systemctl enable` attach the service to normal multi-user boot.

When a fresh instance fails to serve traffic, check bootstrap logs and service state:

```bash
sudo tail -n 80 /var/log/cloud-init-output.log
sudo systemctl status orders-api --no-pager
sudo journalctl -u orders-api -n 120 --no-pager
```

Example `systemctl` output:

```bash
orders-api.service - Orders API
   Loaded: loaded (/etc/systemd/system/orders-api.service; enabled)
   Active: failed (Result: exit-code) since Wed 2026-06-24 10:17:42 UTC
  Process: 1842 ExecStart=/usr/bin/node server.js (code=exited, status=1/FAILURE)
 Main PID: 1842 (code=exited, status=1/FAILURE)
```

`cloud-init-output.log` shows user data activity. `systemctl status` shows whether the service is active, failed, or restarting. `journalctl` shows the app logs and stack traces from the service. In this sample, the process exited with status `1`, so the next useful evidence is the app log around that timestamp.

Bootstrapping gets one server ready. Production needs the same process across several servers so replacement and deployment become normal operations.

## From One Instance to a Fleet
<!-- section-summary: Load balancers and Auto Scaling groups make EC2 instances replaceable instead of precious. -->

One instance can teach the runtime shape, but production traffic needs replacement and Availability Zone spread. The common EC2 web pattern uses an Application Load Balancer, a target group, a launch template, and an Auto Scaling group across at least two private subnets.

A **launch template** records the instance recipe: AMI ID, instance type, security groups, IAM instance profile, user data, EBS settings, and tags. An **Auto Scaling group** uses that template to keep a desired number of instances running. A **target group** connects the load balancer to the instances and runs health checks such as `GET /health`.

The service now has two health layers. EC2 status checks tell you whether the virtual server and host path look healthy. Load balancer target health tells you whether the application endpoint is accepting traffic. Both matter because a server can pass EC2 status checks while the app process fails.

Inspect target health like this:

```bash
aws elbv2 describe-target-health \
  --target-group-arn "$TG_ARN" \
  --region eu-west-2 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,Port:Target.Port,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}'
```

Example output:

```json
[
  {
    "Target": "i-0123456789abcdef0",
    "Port": 3000,
    "State": "healthy",
    "Reason": null,
    "Description": null
  },
  {
    "Target": "i-0fedcba9876543210",
    "Port": 3000,
    "State": "unhealthy",
    "Reason": "Target.ResponseCodeMismatch",
    "Description": "Health checks failed with these codes: [500]"
  }
]
```

The first target is healthy and can receive normal traffic. The second target returns `500` from the health check path, so the load balancer stops using it. This output points the investigation toward the application process, config, or dependency health on that instance, rather than the whole load balancer.

Fleet design also affects shutdown. When Auto Scaling terminates an instance, the load balancer should drain existing requests before the instance disappears. The app should handle termination signals by closing the listener, finishing in-flight requests for a short window, and then exiting.

Now the servers are replaceable. That gives the team a safer deployment and patching path.

![The fleet view shows how a load balancer, health checks, launch template, desired capacity, and replacement instances work together](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers/ec2-fleet-autoscaling.png)

*The fleet view shows how a load balancer, health checks, launch template, desired capacity, and replacement instances work together.*


## Deploying, Patching, and Rolling Back
<!-- section-summary: EC2 releases usually move through launch template versions, AMI updates, instance refresh, and rollback to a previous recipe. -->

EC2 deployments work best when the release path changes the recipe and replaces instances. A team can bake the app into a new AMI, or it can keep the base AMI stable and use user data or a deployment agent to fetch a versioned app artifact. Both patterns can work. The important rule is that the new server can launch from scratch without a human logging in.

An Auto Scaling **instance refresh** replaces instances in controlled waves. The group launches new instances from the current launch template, waits for warmup and health checks, then terminates old instances.

```bash
aws autoscaling start-instance-refresh \
  --auto-scaling-group-name prod-orders-api \
  --region eu-west-2 \
  --preferences '{"MinHealthyPercentage":90,"InstanceWarmup":120}'
```

Example output:

```json
{
  "InstanceRefreshId": "8b4a7f9e-3e2a-4f62-a8d8-11d3d8d1c931"
}
```

`MinHealthyPercentage: 90` tells Auto Scaling to keep at least 90 percent of desired capacity healthy during the refresh. `InstanceWarmup: 120` gives each new instance 120 seconds to boot, start the app, and pass health checks before the rollout continues. The output ID lets you track this refresh later.

Track progress with:

```bash
aws autoscaling describe-instance-refreshes \
  --auto-scaling-group-name prod-orders-api \
  --region eu-west-2 \
  --query 'InstanceRefreshes[0].{Status:Status,PercentageComplete:PercentageComplete,StatusReason:StatusReason}'
```

Example output:

```json
{
  "Status": "InProgress",
  "PercentageComplete": 40,
  "StatusReason": "Waiting for instances to warm up before continuing."
}
```

`Status` shows the rollout state. `PercentageComplete` shows how far the replacement has moved. `StatusReason` gives the first useful sentence when the refresh pauses. If new instances fail health checks, pause the rollout, inspect target health and bootstrap logs, then roll back the launch template or app artifact version.

Rollback should use the same replacement path. If launch template version `14` caused the issue and version `13` was healthy, update the Auto Scaling group back to version `13` and start a new refresh:

```bash
aws autoscaling update-auto-scaling-group \
  --auto-scaling-group-name prod-orders-api \
  --launch-template LaunchTemplateName=orders-api,Version=13 \
  --region eu-west-2
```

This command changes the recipe the group uses for new instances. Running instances keep their current recipe until replacement, so follow it with an instance refresh when the rollback needs to roll through the fleet. The deployment record should state which AMI, launch template version, and app artifact version were restored.

Patching follows the same discipline. Bake a patched AMI or apply a managed patch workflow, then prove that fresh instances can enter service. A patch that exists only on one old instance will vanish during replacement and will create drift before the next incident.

## An EC2 Incident Path
<!-- section-summary: EC2 debugging follows load balancer health, instance health, process logs, bootstrap history, scaling events, and recent AWS changes. -->

At 10:20, users receive `502` responses from the load balancer. Start with the traffic path. Target health tells you whether every instance is bad or only part of the fleet is reduced.

```bash
aws elbv2 describe-target-health \
  --target-group-arn "$TG_ARN" \
  --region eu-west-2 \
  --query 'TargetHealthDescriptions[].{Target:Target.Id,State:TargetHealth.State,Reason:TargetHealth.Reason,Description:TargetHealth.Description}'
```

If one target is unhealthy and the rest are healthy, the service may still be serving users with less capacity. If every target is unhealthy, the incident likely involves a shared change: bad release, security group update, health check path, database outage, or expired secret.

Next check EC2 status for one failing instance:

```bash
aws ec2 describe-instance-status \
  --instance-ids i-0fedcba9876543210 \
  --include-all-instances \
  --region eu-west-2 \
  --query 'InstanceStatuses[].{Instance:InstanceId,State:InstanceState.Name,System:SystemStatus.Status,InstanceCheck:InstanceStatus.Status}'
```

Example output:

```json
[
  {
    "Instance": "i-0fedcba9876543210",
    "State": "running",
    "System": "ok",
    "InstanceCheck": "ok"
  }
]
```

`System` covers the AWS host and network path. `InstanceCheck` covers the guest operating system. Both are `ok` in this sample, so the failed load balancer health check probably comes from the app process, port, health endpoint, local disk, memory, or config.

Use Session Manager or another approved access path to inspect the instance:

```bash
sudo systemctl status orders-api --no-pager
sudo journalctl -u orders-api -n 120 --no-pager
df -h
free -m
```

Example log lines:

```bash
Jun 24 10:16:08 ip-10-20-14-81 node[2214]: Error: DATABASE_URL is missing
Jun 24 10:16:08 ip-10-20-14-81 systemd[1]: orders-api.service: Main process exited, status=1/FAILURE
Jun 24 10:16:13 ip-10-20-14-81 systemd[1]: orders-api.service: Scheduled restart job, restart counter is at 5.
```

These lines explain the target health failure. The server is alive, but the app cannot start because its database setting is missing. `df -h` and `free -m` still matter because disk and memory pressure can create similar restart loops.

Then check recent fleet activity:

```bash
aws autoscaling describe-scaling-activities \
  --auto-scaling-group-name prod-orders-api \
  --region eu-west-2 \
  --max-items 10
```

Example output:

```json
{
  "Activities": [
    {
      "StartTime": "2026-06-24T10:11:42.128000+00:00",
      "StatusCode": "Successful",
      "Cause": "At 2026-06-24T10:10:58Z an instance was taken out of service in response to an ELB health check failure.",
      "Description": "Terminating EC2 instance: i-0fedcba9876543210"
    },
    {
      "StartTime": "2026-06-24T10:12:10.419000+00:00",
      "StatusCode": "Successful",
      "Cause": "Launching a new EC2 instance. Status Reason: New instance started.",
      "Description": "Launching EC2 instance: i-0123replacement"
    }
  ]
}
```

Scaling activity shows launches, terminations, health-check replacements, and failed lifecycle events. In this output, Auto Scaling replaced one instance because the load balancer marked it unhealthy. If several new instances launched minutes before the outage, compare their launch template version and user data path with the last known-good version.

CloudTrail helps connect human or automation changes to the incident window:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=prod-orders-api \
  --start-time 2026-06-24T09:30:00Z \
  --end-time 2026-06-24T10:30:00Z \
  --region eu-west-2
```

Example output:

```json
{
  "Events": [
    {
      "EventTime": "2026-06-24T10:03:19+00:00",
      "EventName": "UpdateAutoScalingGroup",
      "Username": "release-bot",
      "SourceIPAddress": "203.0.113.42",
      "Resources": [
        { "ResourceName": "prod-orders-api", "ResourceType": "AWS::AutoScaling::AutoScalingGroup" }
      ]
    }
  ]
}
```

CloudTrail uses UTC timestamps. In this sample, `EventName` says the Auto Scaling group changed, `Username` says the release automation made the call, `EventTime` places it just before the outage, `SourceIPAddress` gives another audit clue, and `Resources` confirms the changed target. Events such as `CreateLaunchTemplateVersion`, `UpdateAutoScalingGroup`, `AuthorizeSecurityGroupIngress`, or `PutSecretValue` near the incident time give the next layer to inspect.

The response should match the evidence. If one instance is bad and replacements work, terminate the bad instance and let Auto Scaling replace it. If every new instance fails, roll back the launch template or artifact version. If a missing secret or bad config caused the failure, fix the config source and redeploy through the normal path so every future instance receives the same repair.

![The incident ladder shows where to look as evidence moves from target health to instance checks, logs, scaling activity, and audit events](/content-assets/articles/article-cloud-providers-aws-compute-application-hosting-ec2-virtual-servers/ec2-incident-path.png)

*The incident ladder shows where to look as evidence moves from target health to instance checks, logs, scaling activity, and audit events.*


## References

- [Amazon EC2 concepts](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html)
- [Amazon EC2 best practices](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-best-practices.html)
- [Use instance metadata to manage your EC2 instance](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ec2-instance-metadata.html)
- [Configure the Instance Metadata Service](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html)
- [Auto Scaling launch templates](https://docs.aws.amazon.com/autoscaling/ec2/userguide/launch-templates.html)
- [Amazon EC2 Auto Scaling health checks](https://docs.aws.amazon.com/autoscaling/ec2/userguide/ec2-auto-scaling-health-checks.html)
- [Use an instance refresh to update instances in an Auto Scaling group](https://docs.aws.amazon.com/autoscaling/ec2/userguide/asg-instance-refresh.html)
- [AWS Systems Manager Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html)
