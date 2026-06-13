---
title: "VPC Endpoints and PrivateLink"
description: "Use VPC endpoints and AWS PrivateLink to give private workloads controlled access to S3, AWS service APIs, and provider services."
overview: "Private subnets still need useful service access. This article explains gateway endpoints, interface endpoints, endpoint services, PrivateLink provider and consumer flows, private DNS, endpoint policies, and the production checks that keep private service access understandable."
tags: ["aws", "vpc", "privatelink", "vpc-endpoints", "private-networking"]
order: 5
id: article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink
aliases:
  - vpc-endpoints-and-privatelink
  - private-aws-service-access
  - private-link
---

## Table of Contents

1. [The Payments App Service Access Problem](#the-payments-app-service-access-problem)
2. [What a VPC Endpoint Gives You](#what-a-vpc-endpoint-gives-you)
3. [Gateway Endpoints for S3 and DynamoDB](#gateway-endpoints-for-s3-and-dynamodb)
4. [How to Wire an S3 Gateway Endpoint](#how-to-wire-an-s3-gateway-endpoint)
5. [Interface Endpoints for AWS Service APIs](#interface-endpoints-for-aws-service-apis)
6. [Private DNS for Interface Endpoints](#private-dns-for-interface-endpoints)
7. [Endpoint Policies and Resource Policies](#endpoint-policies-and-resource-policies)
8. [Endpoint Services for PrivateLink Providers](#endpoint-services-for-privatelink-providers)
9. [PrivateLink Consumers and Partner Services](#privatelink-consumers-and-partner-services)
10. [Designing the Payments Endpoint Set](#designing-the-payments-endpoint-set)
11. [Common Production Mistakes](#common-production-mistakes)
12. [Putting It All Together](#putting-it-all-together)
13. [References](#references)

## The Payments App Service Access Problem
<!-- section-summary: Private application subnets need service access, and endpoints let that access stay narrow while avoiding general internet egress. -->

Imagine a payments platform running in private ECS tasks. ECS runs containers on AWS. The application receives payment events through an internal API, stores receipt files in Amazon S3, pulls container images from Amazon ECR, writes audit logs to CloudWatch Logs, reads API keys from Secrets Manager, and calls a fraud-scoring partner service that another company exposes privately.

The workloads sit in private subnets because customers should never connect directly to the containers. That placement is good, but the containers still need to talk to services. A private subnet with a NAT gateway can reach many public AWS service endpoints, but that path treats service calls like general outbound internet traffic. It also mixes highly predictable AWS service traffic with whatever else the application might call.

**Private service access** means the workload can reach a specific AWS service or provider service through a private path from the VPC. The goal is narrow reachability. The payment worker should reach the receipt bucket, the ECR APIs it needs for image pulls, the logging service, Secrets Manager, and the partner fraud service. The team wants that list to stay deliberate, with broad outbound access kept out of the default path.

That is where **VPC endpoints** and **AWS PrivateLink** enter the story. They give the VPC a service-shaped path, where private resources reach a named service through a controlled access point while the wider networks stay separate.

## What a VPC Endpoint Gives You
<!-- section-summary: A VPC endpoint is a private connection from a VPC to a supported service or resource, and the endpoint type depends on the target. -->

A **VPC endpoint** is a private access point that resources in your VPC use to reach a supported AWS service, endpoint service, resource, or service network. In plain terms, the endpoint is the doorway that your private subnet uses for one kind of service access. The caller stays in the VPC, and the destination is reached through AWS-managed private connectivity while broad public egress stays reserved for other approved paths.

AWS has several endpoint types, but two are the daily building blocks for most beginner AWS networking work:

| Endpoint type | Main target | How traffic finds it | Common payments example |
| --- | --- | --- | --- |
| **Gateway endpoint** | Amazon S3 and DynamoDB | A route table entry points service prefixes to the endpoint | Private workers write receipt PDFs to S3. |
| **Interface endpoint** | AWS service APIs, endpoint services, partner services, and other PrivateLink targets | DNS resolves a service name to private endpoint network interface IPs | ECS tasks call Secrets Manager, ECR, CloudWatch Logs, and a partner fraud API. |

This split matters because the operational work is different. A gateway endpoint lives in the route-table story. You associate it with the route tables used by the caller subnets. An interface endpoint lives in the DNS and network-interface story. AWS creates endpoint network interfaces in selected subnets, those interfaces receive private IPs, and security groups control which callers can connect to them.

**AWS PrivateLink** is the private connectivity technology behind interface endpoints and provider endpoint services. It lets a consumer VPC connect to a service through private IP addresses as though the service were available locally in the consumer's VPC. The consumer reaches the service through the endpoint, and the provider side stays outside the consumer's general VPC routing table.

![Endpoint type chooser infographic showing a private ECS task reaching S3 or DynamoDB through a gateway endpoint, AWS service APIs through an interface endpoint, and partner services through PrivateLink](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/endpoint-type-chooser.png)

*Choose the endpoint type from the target service. S3 and DynamoDB fit gateway endpoints, AWS service APIs fit interface endpoints, and partner services use the PrivateLink provider-consumer shape.*

The useful habit is to name the target before choosing the endpoint type. S3 and DynamoDB usually point you toward gateway endpoints. AWS service APIs and partner services usually point you toward interface endpoints. A service that your own team exposes to other accounts points you toward a PrivateLink endpoint service.

## Gateway Endpoints for S3 and DynamoDB
<!-- section-summary: Gateway endpoints give selected route tables a private service route for S3 or DynamoDB, which keeps that traffic off the NAT path. -->

A **gateway endpoint** is a VPC endpoint type for Amazon S3 and Amazon DynamoDB. It adds an AWS-managed service-prefix route to the route tables you select. A service prefix list is a managed list of IP prefixes for an AWS service in a Region. The route table can then send traffic for that service to the gateway endpoint before generic NAT or internet gateway routing would be needed.

For the payments app, the clearest gateway endpoint is S3. Every payment event creates a receipt object in `payments-receipts-prod`. The receipt worker runs in private subnets. If S3 traffic goes through NAT, every receipt upload shares the general outbound path and can add avoidable NAT processing cost. With a gateway endpoint, S3 traffic follows the endpoint route from the private route table.

![S3 gateway endpoint route infographic showing private worker traffic matching an S3 prefix route to a gateway endpoint while generic outbound traffic keeps the NAT default route](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/s3-gateway-endpoint-route.png)

*The S3 gateway endpoint is a route-table feature. S3 traffic matches the service prefix route and skips NAT, while unrelated outbound traffic can still use the default NAT path.*

The gateway endpoint path has a few important pieces:

| Piece | What it controls |
| --- | --- |
| **VPC** | The private network where the endpoint exists. |
| **Service name** | The regional S3 or DynamoDB endpoint, such as `com.amazonaws.us-east-1.s3`. |
| **Route table associations** | The subnet route tables that receive the service-prefix route. |
| **Endpoint policy** | A resource-based policy on the endpoint that can limit which principals and actions use that endpoint path. |
| **Service resource policy** | For S3, the bucket policy can require traffic to come from a specific VPC endpoint. |

Gateway endpoints are regional. The S3 gateway endpoint in `us-east-1` supports private access to the regional S3 service from that VPC. If the same architecture runs in `eu-west-1`, that Region gets its own endpoint and route-table associations.

The route-table association is the practical detail people miss. Creating an S3 gateway endpoint in the VPC only creates the resource. The private app route tables must be associated with that endpoint so AWS can add the S3 prefix-list route to each selected table.

## How to Wire an S3 Gateway Endpoint
<!-- section-summary: The S3 gateway endpoint is built by selecting the VPC, selecting the S3 service, associating the private route tables, and tightening policies. -->

The payments app has two private app subnets, one in each Availability Zone. Each subnet has its own route table because the team keeps zonal routing explicit. The S3 gateway endpoint should be associated with both private app route tables so workers in either zone use the private S3 path.

A small AWS CLI shape can look like this:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc1234payments \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0appaz1 rtb-0appaz2 \
  --policy-document file://s3-endpoint-policy.json
```

The endpoint policy can start narrow. This example allows the payment task role to list one bucket and read or write objects in that bucket through the endpoint. The role still needs matching IAM permissions, and the bucket can still have its own policy.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/payments-ecs-task-role"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::payments-receipts-prod",
        "arn:aws:s3:::payments-receipts-prod/*"
      ]
    }
  ]
}
```

The private route tables then show an AWS-managed prefix-list route. The exact prefix list ID varies by Region and service. The important shape is that the S3 prefix list points to the VPC endpoint, while other outbound traffic can still point somewhere else.

| Destination | Target |
| --- | --- |
| `10.40.0.0/16` | `local` |
| S3 prefix list | `vpce-0s3gateway` |
| `0.0.0.0/0` | NAT gateway |

A Terraform version usually keeps this close to the route tables:

```hcl
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.payments.id
  service_name      = "com.amazonaws.us-east-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids = [
    aws_route_table.private_app_a.id,
    aws_route_table.private_app_b.id
  ]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          AWS = aws_iam_role.payments_task.arn
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket"
        ]
        Resource = [
          aws_s3_bucket.receipts.arn,
          "${aws_s3_bucket.receipts.arn}/*"
        ]
      }
    ]
  })
}
```

This is the gateway endpoint pattern in daily language: associate the route tables that private callers actually use, confirm the service-prefix route appears, and then use IAM, endpoint policy, and the bucket policy together.

## Interface Endpoints for AWS Service APIs
<!-- section-summary: Interface endpoints place private endpoint network interfaces in your subnets so workloads can call AWS service APIs through PrivateLink. -->

An **interface endpoint** is a VPC endpoint that creates one or more endpoint network interfaces in your VPC. An endpoint network interface, often called an endpoint ENI, is a private network interface managed by AWS. It receives private IP addresses from the selected subnets and acts as the entry point for traffic headed to the service.

The payments app needs several AWS APIs during normal operation. ECS tasks pull container images from ECR, the application retrieves secrets from Secrets Manager, and the logging driver sends logs to CloudWatch Logs. Those APIs can use interface endpoints so the private tasks connect to private IPs in the VPC, with NAT left out of those API calls.

An interface endpoint has five pieces worth checking every time:

| Piece | What it means in production |
| --- | --- |
| **Service name** | The exact AWS service API, such as `com.amazonaws.us-east-1.secretsmanager` or `com.amazonaws.us-east-1.logs`. |
| **Subnets** | The Availability Zones where endpoint ENIs are created. Most production apps use at least two zones. |
| **Endpoint security group** | The inbound rule set for the endpoint ENIs. It should allow HTTPS from the workload security groups that need the service. |
| **Private DNS** | The setting that lets standard AWS service hostnames resolve to endpoint private IPs inside the VPC. |
| **Endpoint policy** | The policy guardrail on the endpoint for AWS services that support endpoint policies. |

A small CLI example for Secrets Manager looks like this:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc1234payments \
  --service-name com.amazonaws.us-east-1.secretsmanager \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-0appaz1 subnet-0appaz2 \
  --security-group-ids sg-0endpointsecrets \
  --private-dns-enabled
```

The endpoint security group is part of the data path. A common rule allows TCP 443 from the payments task security group:

| Direction | Protocol | Port | Source |
| --- | --- | --- | --- |
| Inbound | TCP | 443 | `sg-payments-tasks` |
| Outbound | TCP | 443 | Service default or controlled egress, depending on the endpoint design |

The caller security group also needs outbound HTTPS to the endpoint. Many teams allow egress from application tasks broadly at first, then reduce it with security group references or prefix-list patterns after they understand every private service dependency. The endpoint security group should stay tighter because it represents a specific service door in the VPC.

ECR image pulls need special attention. A private ECS task commonly needs the ECR API endpoint, the ECR Docker registry endpoint, CloudWatch Logs for task logs, and S3 access for image layers and other service-owned objects depending on the runtime path. That usually means the endpoint design includes `ecr.api`, `ecr.dkr`, `logs`, and an S3 gateway endpoint together.

## Private DNS for Interface Endpoints
<!-- section-summary: Private DNS lets normal AWS service names resolve to endpoint private IPs inside the VPC, so applications can keep standard SDK configuration. -->

**DNS** is the system that turns names into IP addresses. Application code usually starts with a name such as `secretsmanager.us-east-1.amazonaws.com`, then the network uses the returned IP address. Interface endpoints depend heavily on this name-to-address step.

**Private DNS** for an interface endpoint lets standard AWS service hostnames resolve to the private IPs of the endpoint ENIs inside the VPC. The payments code can keep using the normal Secrets Manager SDK client for `us-east-1`. Inside the VPC, the VPC resolver returns private endpoint IPs. Outside the VPC, a developer laptop still receives the normal public AWS answer.

This is why private DNS matters so much for operations. The application can keep standard service configuration for every service. The same service name can lead to different answers based on where the query comes from, and the private answer keeps the packet path inside the VPC endpoint design.

The flow is small but important:

1. The ECS task asks DNS for `secretsmanager.us-east-1.amazonaws.com`.
2. The VPC resolver returns private IPs for the Secrets Manager endpoint ENIs.
3. The task opens HTTPS to one of those private IPs.
4. The endpoint ENI carries the request to Secrets Manager through PrivateLink.
5. IAM and the endpoint policy still decide whether the API call is authorized.

Private DNS requires the VPC DNS settings to support this behavior. In practice, the VPC should have DNS resolution and DNS hostnames enabled. If workloads use custom DNS servers, those servers need forwarding rules that send AWS service names back to the VPC resolver when the private endpoint answer is expected.

## Endpoint Policies and Resource Policies
<!-- section-summary: Endpoint policies control use of the endpoint path, while IAM policies and resource policies still control the actual service permission. -->

An **endpoint policy** is a resource-based policy attached to a VPC endpoint. It controls which AWS principals can use that endpoint to access an AWS service. The default endpoint policy allows all actions by all principals on all resources through that endpoint, so production teams often replace it with a narrower policy for sensitive services.

Endpoint policies sit beside other AWS permission systems. IAM identity policies, S3 bucket policies, KMS key policies, Secrets Manager resource policies, and service-specific controls still apply. A request must pass every relevant layer.

For the payments receipt bucket, a high-level access design might look like this:

| Layer | Example control |
| --- | --- |
| **Task role IAM policy** | Allows `s3:PutObject` and `s3:GetObject` for `payments-receipts-prod`. |
| **S3 gateway endpoint policy** | Allows the payments task role to use the endpoint for that bucket. |
| **S3 bucket policy** | Requires production writes to arrive through the expected VPC endpoint. |

The bucket policy can use the global condition key `aws:SourceVpce` to require a specific endpoint path for selected access. The exact policy needs careful rollout because admins, replication jobs, analytics tools, and emergency access paths may use different routes. The high-level pattern looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyReceiptAccessOutsideExpectedEndpoint",
      "Effect": "Deny",
      "Principal": "*",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::payments-receipts-prod/*",
      "Condition": {
        "StringNotEquals": {
          "aws:SourceVpce": "vpce-0s3gateway"
        }
      }
    }
  ]
}
```

The important beginner idea is the direction of the check. IAM says the task role may use S3. The endpoint policy says the endpoint path may be used for that S3 action. The bucket policy can say the bucket expects selected access from that endpoint. When an access denied error appears, any one of those layers can be the reason.

## Endpoint Services for PrivateLink Providers
<!-- section-summary: A PrivateLink provider exposes one service through an endpoint service, usually behind a load balancer, and grants specific consumers permission to connect. -->

Now the payments company has a second requirement. A partner bank wants to call the payments company's risk-decision API privately from the bank's AWS account. VPC peering would connect whole VPC address spaces. Transit Gateway would create a broader routing relationship. The product team only wants to expose one service: `risk-api`.

An **endpoint service** is the provider-side PrivateLink object that makes a service available to consumers. A **service provider** is the AWS account or organization that owns the service. A **service consumer** is the account or VPC that creates an endpoint to use the provider's service.

The provider flow looks like this:

1. The provider runs the service in private subnets.
2. The provider places a supported load balancer in front of the service, commonly a Network Load Balancer for TCP service traffic.
3. The provider creates an endpoint service that points to the load balancer.
4. The provider grants selected AWS principals permission to create endpoints to that service.
5. The provider chooses whether endpoint connection requests require manual acceptance.
6. The provider shares the service name with approved consumers.

The endpoint service has a service name that looks like `com.amazonaws.vpce.us-east-1.vpce-svc-0123456789abcdef0`. Consumers use that value when they create their interface endpoint. The provider shares it as the PrivateLink service identifier, while application traffic usually uses service DNS names or provider-approved private names.

Provider-side security still matters. The load balancer target groups need healthy targets. The service should authenticate requests at the application layer, usually with mTLS, signed requests, OAuth, or another partner-grade control. PrivateLink narrows network reachability, and application authentication still proves the business identity of the caller inside the HTTP request.

A provider also needs an operational process for connection requests. If manual acceptance is enabled, new consumers remain in a pending state until the provider accepts them. That is useful for partner onboarding because the platform team can match each endpoint request to a contract, account ID, and expected environment before allowing traffic.

## PrivateLink Consumers and Partner Services
<!-- section-summary: A PrivateLink consumer creates an interface endpoint in its own VPC, attaches endpoint security groups, and uses DNS to reach the provider service. -->

From the consumer side, PrivateLink feels like creating an interface endpoint. The payments app now consumes a fraud-scoring service from a partner. The partner gives the platform team a service name and, if they support a private DNS name, the domain that application code should use.

The consumer flow looks like this:

1. The consumer creates an interface endpoint using the provider's service name.
2. AWS creates endpoint ENIs in the selected consumer subnets.
3. The consumer attaches a security group to those endpoint ENIs.
4. The provider accepts the connection if the service requires acceptance.
5. The consumer configures DNS so the application reaches the endpoint private IPs.
6. The application connects to the partner service over the PrivateLink path.

A small CLI shape can look like this:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc1234payments \
  --service-name com.amazonaws.vpce.us-east-1.vpce-svc-0123456789abcdef0 \
  --vpc-endpoint-type Interface \
  --subnet-ids subnet-0appaz1 subnet-0appaz2 \
  --security-group-ids sg-0endpointpartner
```

The endpoint creates private DNS names automatically, even when the provider has no custom private DNS name. Those generated names are useful for testing because they point directly at the endpoint. For production applications, many teams create an internal name such as `fraud.partner.internal` in a private hosted zone and point it at the endpoint DNS name. That gives the app a stable business name while the infrastructure keeps the provider-specific endpoint details underneath.

The consumer still owns the local security posture. The endpoint ENI security group should allow HTTPS only from the application task security group. The application task role or application credentials should authorize the business call. The partner should log and authenticate every request because PrivateLink proves the network path, while application controls prove the final business action.

## Designing the Payments Endpoint Set
<!-- section-summary: A useful endpoint design starts from real application dependencies, then adds the gateway and interface endpoints that match those dependencies. -->

For the payments app, the endpoint list comes from the startup and request path. The containers pull images, load configuration, write logs, store receipt files, and call a partner service. Each dependency maps to a specific endpoint decision.

| Dependency | Endpoint choice | Notes |
| --- | --- | --- |
| Receipt files in S3 | **S3 gateway endpoint** | Associate the private app route tables and use endpoint plus bucket policies. |
| Container image pulls from ECR | **ECR interface endpoints plus S3 access** | Use ECR API and Docker endpoints, and keep S3 private for image-layer paths. |
| Application logs | **CloudWatch Logs interface endpoint** | Allow HTTPS from the task security group to the logs endpoint security group. |
| Payment secrets | **Secrets Manager interface endpoint** | Keep private DNS enabled and use IAM on the task role. |
| KMS decrypt operations | **KMS interface endpoint** | Needed when secrets, logs, or application data use customer managed KMS keys. |
| Partner fraud API | **Partner endpoint service through interface endpoint** | Consumer endpoint security group plus application-level authentication. |

The route table remains clean. S3 gets a service-specific gateway route. Same-VPC traffic uses the local route. Any remaining internet-bound traffic is explicit, either through a NAT gateway for allowed external APIs or blocked entirely in more isolated subnets.

The security group design also stays readable. Workload security groups describe which application components initiate connections. Endpoint security groups describe which workload groups may use each service door. Provider services add a second boundary: the provider controls endpoint-service permissions and acceptance, while the consumer controls the endpoint ENIs inside its VPC.

For cost and resilience, the team usually places interface endpoints in the same Availability Zones as the workloads. Interface endpoints have hourly and data processing costs, so the endpoint set should match real dependencies, with unused AWS services left out. At the same time, routing critical logs, secrets, and image pulls through private endpoints often pays back in simpler egress control and clearer audit evidence.

## Common Production Mistakes
<!-- section-summary: Most endpoint failures come from missing route-table associations, wrong DNS answers, loose endpoint policies, or incomplete service dependencies. -->

The first common mistake is creating an S3 gateway endpoint and forgetting the route tables. The endpoint exists while the private app route table has no S3 prefix-list route. The worker still uses NAT, or it fails if no NAT path exists. The fix is to check the route table associated with the caller subnet and the endpoint list in the VPC console.

The second mistake is treating an interface endpoint like a route-table target. Interface endpoints usually work through DNS and local VPC routing to endpoint ENI private IPs. If the hostname resolves to a public AWS IP, the route table will follow the public egress path. DNS evidence matters as much as route evidence.

The third mistake is leaving endpoint security groups too open. An endpoint ENI is a service door inside the VPC. For sensitive APIs such as Secrets Manager, KMS, or a partner service, the endpoint security group should allow only the workload security groups that need that service.

The fourth mistake is expecting endpoint policies to grant service permissions. The task role still needs IAM permissions. The bucket or secret may still have a resource policy. KMS keys may still need a key policy. Endpoint policies only control the use of that endpoint path.

The fifth mistake is missing one dependency in a private startup path. ECR image pulls, logging, secret retrieval, and object storage often happen before the app is ready to serve traffic. A private task can fail to start because one required endpoint is missing even though the business API endpoint is correct.

The sixth mistake is confusing PrivateLink with full private networking. A consumer endpoint lets the consumer connect to a provider service through a service-specific connection. Ports, protocols, naming, and application authentication still need their own design. That narrow shape is valuable, and it also means the design must name every service intentionally.

## Putting It All Together
<!-- section-summary: Gateway endpoints, interface endpoints, endpoint policies, and PrivateLink provider flows give private workloads narrow service access without broad network merging. -->

VPC endpoints solve a practical production problem: private workloads need service access without turning every service call into generic outbound internet traffic. The payments app needs S3, ECR, CloudWatch Logs, Secrets Manager, KMS, and a partner fraud service. Each target gets the endpoint type that matches how the target is reached.

**Gateway endpoints** are route-table endpoints for S3 and DynamoDB. The important work is associating the route tables used by private caller subnets and tightening access with endpoint and resource policies.

**Interface endpoints** are PrivateLink-powered endpoints with endpoint ENIs in your subnets. The important work is selecting the right service name, placing endpoint ENIs in the right Availability Zones, attaching restrictive security groups, enabling private DNS where appropriate, and keeping IAM permissions separate from endpoint policies.

**Endpoint services** are the provider-side PrivateLink shape. A provider exposes one service, grants specific consumers permission, and accepts or rejects connection requests. A consumer creates an interface endpoint in its own VPC and reaches the service through private IPs.

![Private service access summary board covering dependency list, endpoint type, private DNS, endpoint policy, security group, and Flow Log proof](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/private-service-access-summary.png)

*A private service access review starts with real dependencies, then checks endpoint type, DNS, policy, security group, and packet evidence for each service path.*

The next layer is DNS. PrivateLink designs often succeed or fail based on the name answer the application receives. The service path may be perfect, but if `secretsmanager.us-east-1.amazonaws.com` or `fraud.partner.internal` resolves to the wrong place, the packets follow the wrong story.

**References**

- [What is AWS PrivateLink? - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html)
- [AWS PrivateLink concepts - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/privatelink/concepts.html)
- [Gateway endpoints - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)
- [Access an AWS service using an interface VPC endpoint - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)
- [Control access to VPC endpoints using endpoint policies - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)
- [Understanding Amazon DNS - Amazon VPC](https://docs.aws.amazon.com/vpc/latest/userguide/AmazonDNS-concepts.html)
