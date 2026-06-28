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

1. [The Private App Still Needs Services](#the-private-app-still-needs-services)
2. [What Private Service Access Solves](#what-private-service-access-solves)
3. [Gateway Endpoints for S3 and DynamoDB](#gateway-endpoints-for-s3-and-dynamodb)
4. [Interface Endpoints for Service APIs](#interface-endpoints-for-service-apis)
5. [Private DNS Keeps App Code Simple](#private-dns-keeps-app-code-simple)
6. [Endpoint Policies, IAM, and Resource Policies](#endpoint-policies-iam-and-resource-policies)
7. [PrivateLink for Provider Services](#privatelink-for-provider-services)
8. [Design and Troubleshooting Checklist](#design-and-troubleshooting-checklist)
9. [References](#references)

## The Private App Still Needs Services
<!-- section-summary: Private subnets reduce direct exposure, while applications still need a controlled way to reach AWS services and partner services. -->

The receipts API now runs in private subnets. That placement is useful because no one can connect straight to the application from the public internet. The app still has real work to do, though. It writes receipt files to S3, reads database credentials from Secrets Manager, sends logs to CloudWatch Logs, pulls container images from ECR, and calls a partner fraud-scoring API during checkout.

Without a private service path, teams usually send outbound IPv4 traffic through a NAT gateway. NAT gives private subnets a way to reach public endpoints, and many production VPCs still use NAT for approved public destinations. The problem is scope. If the receipts API only needs S3, Secrets Manager, CloudWatch Logs, ECR, and one partner API, a broad default route to the internet gives the workload a wider network path than its dependency list requires.

The first job is to write down the actual dependencies. For the receipts API, that list might include S3 for uploaded receipts, Secrets Manager for database credentials, CloudWatch Logs for application logs, ECR API and ECR Docker for container image pulls, STS for role sessions, and a private partner endpoint for fraud checks. Once the dependency list exists, each service can get the smallest practical network path.

This is the problem **VPC endpoints** solve. A VPC endpoint lets resources in a VPC reach a supported AWS service, endpoint service, or resource through private AWS networking. The app keeps using normal AWS SDK calls in most cases, while the VPC route tables and DNS settings send the traffic through a private path.

## What Private Service Access Solves
<!-- section-summary: VPC endpoints give private workloads service access without turning every service call into broad internet egress. -->

A **VPC endpoint** is a private entry point from your VPC to a supported service. The endpoint sits in your network design, so you can review routes, subnet placement, security groups, DNS, endpoint policies, and logs as part of the same change. The application still needs IAM permission to use the AWS service. The endpoint gives the request a controlled network path.

Two endpoint types show up most often at the beginning. A **gateway endpoint** is a route-table based endpoint for S3 and DynamoDB. A route table gets a service prefix-list route, and traffic for that service goes to the endpoint. An **interface endpoint** creates private network interfaces, also called ENIs, inside selected subnets. Workloads connect to those private IP addresses, and AWS PrivateLink carries the request to the supported service API.

For the receipts API, S3 receipt uploads fit a gateway endpoint. Secrets Manager, CloudWatch Logs, ECR, STS, and many other AWS service APIs fit interface endpoints. A partner fraud API can also use PrivateLink if the provider exposes an endpoint service. The endpoint type follows the service and the data path.

| Endpoint type | Good fit | How traffic finds it | Main review items |
| --- | --- | --- | --- |
| Gateway endpoint | S3 or DynamoDB | Route table sends service-prefix traffic to the endpoint | Route table associations, endpoint policy, bucket or table policy, IAM |
| Interface endpoint | AWS service APIs, Marketplace services, partner services, internal provider services | DNS resolves a service name to endpoint ENI private IPs | Subnet placement, endpoint security group, private DNS, endpoint policy, IAM |

That difference matters during incidents. Gateway endpoint failures usually start with route tables, endpoint policies, or resource policies. Interface endpoint failures usually start with DNS, endpoint ENIs, endpoint security groups, or service-specific permissions.

## Gateway Endpoints for S3 and DynamoDB
<!-- section-summary: Gateway endpoints give selected route tables a private route to S3 or DynamoDB, so service traffic can avoid NAT. -->

A **gateway endpoint** attaches to the route tables you choose. AWS adds a route that targets the endpoint for the service prefix list. A prefix list is an AWS-managed list of network prefixes for a service. AWS manages the S3 address ranges for you, and the route uses the managed prefix list for the regional S3 service.

For the receipts API, the private app subnets use route tables named `rtb-app-private-a` and `rtb-app-private-b`. Those route tables should receive the S3 gateway endpoint route because the app writes objects to `s3://receipts-prod-uploads/`. Add the endpoint association to public subnet route tables or unrelated analytics route tables only when workloads there also need the same private S3 path.

The CLI call to create the endpoint looks like this:

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-0abc1234receipts \
  --service-name com.amazonaws.us-east-1.s3 \
  --vpc-endpoint-type Gateway \
  --route-table-ids rtb-0privatea rtb-0privateb
```

`--service-name` selects the regional S3 endpoint service. `--vpc-endpoint-type Gateway` chooses the route-table based endpoint type. `--route-table-ids` selects the private route tables that should send S3 traffic through this endpoint. The response should include a VPC endpoint ID and the route table IDs you associated.

```json
{
  "VpcEndpoint": {
    "VpcEndpointId": "vpce-0s3receipts",
    "VpcEndpointType": "Gateway",
    "VpcId": "vpc-0abc1234receipts",
    "ServiceName": "com.amazonaws.us-east-1.s3",
    "State": "available",
    "RouteTableIds": [
      "rtb-0privatea",
      "rtb-0privateb"
    ]
  }
}
```

This output tells you three useful things. The endpoint reached `available`, so AWS created it successfully. The endpoint type is `Gateway`, so you should debug route table associations rather than endpoint ENI security groups. The route table IDs match the private app route tables, so the app subnets have the intended S3 path.

A route table check can prove the S3 route exists:

```bash
aws ec2 describe-route-tables \
  --route-table-ids rtb-0privatea \
  --query 'RouteTables[0].Routes[*].{Destination:DestinationPrefixListId,Target:VpcEndpointId,State:State}'
```

```json
[
  {
    "Destination": "pl-63a5400a",
    "Target": "vpce-0s3receipts",
    "State": "active"
  },
  {
    "Destination": null,
    "Target": null,
    "State": "active"
  }
]
```

The important row is the one with a `Destination` that starts with `pl-` and a `Target` of `vpce-0s3receipts`. That row means the route table sends S3 prefix-list traffic to the gateway endpoint. If the app subnet uses a different route table, or this row points to a different endpoint, fix the route table association before changing IAM policies.

Many teams also add a bucket policy that requires requests to arrive through the endpoint:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::receipts-prod-uploads",
        "arn:aws:s3:::receipts-prod-uploads/*"
      ],
      "Condition": {
        "StringNotEquals": {
          "aws:SourceVpce": "vpce-0s3receipts"
        }
      }
    }
  ]
}
```

This policy uses an explicit `Deny` with the `aws:SourceVpce` condition. Requests to the bucket must arrive through `vpce-0s3receipts`, or S3 denies them. That protects the bucket from access over other network paths, but it also affects administrators, migration jobs, and cross-account roles that use a different path. Test every expected principal before applying this to a production bucket.

![The S3 gateway endpoint route shows how private subnets can reach S3 through route tables without sending that traffic through NAT](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/s3-gateway-endpoint-route.png)

*The S3 gateway endpoint route shows how private subnets can reach S3 through route tables without sending that traffic through NAT.*


## Interface Endpoints for Service APIs
<!-- section-summary: Interface endpoints place private endpoint ENIs in selected subnets, and workloads reach service APIs through those private addresses. -->

An **interface endpoint** creates one endpoint ENI in each selected subnet. Each ENI has private IP addresses and one or more security groups. Workloads connect to those private IPs over TCP `443` for most AWS service APIs, and AWS PrivateLink carries the request from the endpoint to the service.

For the receipts API, Secrets Manager is a clear example. The ECS task needs database credentials at startup. Instead of sending the Secrets Manager API call through NAT, the VPC can create an interface endpoint for `com.amazonaws.us-east-1.secretsmanager` in the private application Availability Zones. The endpoint security group allows HTTPS from the application task security group.

A review command for all endpoints in the VPC can look like this:

```bash
aws ec2 describe-vpc-endpoints \
  --filters Name=vpc-id,Values=vpc-0abc1234receipts \
  --query 'VpcEndpoints[*].{id:VpcEndpointId,type:VpcEndpointType,service:ServiceName,state:State,subnets:SubnetIds,privateDns:PrivateDnsEnabled,groups:Groups[*].GroupId}'
```

```json
[
  {
    "id": "vpce-0s3receipts",
    "type": "Gateway",
    "service": "com.amazonaws.us-east-1.s3",
    "state": "available",
    "subnets": [],
    "privateDns": false,
    "groups": []
  },
  {
    "id": "vpce-0secretsreceipts",
    "type": "Interface",
    "service": "com.amazonaws.us-east-1.secretsmanager",
    "state": "available",
    "subnets": [
      "subnet-0apppriv-a",
      "subnet-0apppriv-b"
    ],
    "privateDns": true,
    "groups": [
      "sg-0endpointsecrets"
    ]
  }
]
```

The interface endpoint row should match the service the workload calls, show `available`, list subnets in the same Availability Zones as the callers, and show `privateDns` as `true` when the app uses the normal AWS service hostname. The security group ID gives you the next place to check if DNS resolves correctly and the SDK call still times out.

The endpoint security group acts like a front door for the private service path. For the Secrets Manager endpoint, a common inbound rule allows TCP `443` from `sg-0receipts-api`. If the API resolves the service name to a private endpoint IP while the endpoint security group lacks an allow rule for the task security group, the call can hang until the SDK times out.

Interface endpoints have hourly and data processing charges, so production teams usually create them from the real dependency list rather than enabling every service. A container path often needs several endpoints together: ECR API, ECR Docker, S3 for image layers, CloudWatch Logs, Secrets Manager, and STS depending on how the runtime starts and authenticates.

![The endpoint chooser separates gateway endpoints, interface endpoints, and PrivateLink provider services by the job each one solves](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/endpoint-type-chooser.png)

*The endpoint chooser separates gateway endpoints, interface endpoints, and PrivateLink provider services by the job each one solves.*


## Private DNS Keeps App Code Simple
<!-- section-summary: Private DNS maps normal AWS service names to endpoint private IPs inside the VPC, which keeps endpoint details out of application code. -->

**Private DNS** lets a normal AWS service hostname resolve to interface endpoint private IPs inside the VPC. With private DNS enabled for the Secrets Manager endpoint, the app can keep calling `secretsmanager.us-east-1.amazonaws.com`. Inside the VPC, Route 53 Resolver returns the endpoint ENI addresses.

This design keeps endpoint knowledge in infrastructure rather than application code. The app uses the standard AWS SDK client for Secrets Manager. The VPC DNS settings decide that the standard service name should use the private endpoint path from inside the VPC.

A useful runtime check resolves the service name from the same subnet and runtime style as the app:

```bash
getent hosts secretsmanager.us-east-1.amazonaws.com
```

Example output:

```console
10.20.14.83 secretsmanager.us-east-1.amazonaws.com
10.20.28.91 secretsmanager.us-east-1.amazonaws.com
```

Those private `10.20.x.x` answers tell you the workload sees the interface endpoint path. A public answer from inside the app subnet points toward the endpoint private DNS setting, VPC DNS attributes, DHCP options, or custom DNS forwarding. At that point, focus on DNS first because the app still resolves a public service address.

Private DNS depends on VPC DNS settings. `enableDnsSupport` and `enableDnsHostnames` should both be enabled for private hosted zones and interface endpoint private DNS. Custom DNS servers also need a forwarding path back to Route 53 Resolver for AWS private names. If a corporate DNS server answers every query itself, it may return public AWS service records even though the endpoint exists.

## Endpoint Policies, IAM, and Resource Policies
<!-- section-summary: Endpoint policies limit what can pass through the endpoint path, while IAM and resource policies still decide service authorization. -->

Endpoint policies add a network-path authorization layer. They control which service actions and resources callers can use through a specific endpoint. IAM policies still control what the workload role can do. Resource policies still control access to resources such as S3 buckets, KMS keys, SQS queues, or Secrets Manager secrets.

For the receipts app, the ECS task role should have permission to write only the receipt bucket prefix it needs. The S3 bucket policy can require the VPC endpoint. The endpoint policy can narrow which bucket actions can travel through that endpoint. These layers should line up around the same application flow.

A compact S3 endpoint policy might allow only one bucket path through the endpoint:

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::receipts-prod-uploads/*"
    }
  ]
}
```

This endpoint policy narrows the endpoint path to `GetObject` and `PutObject` on objects inside `receipts-prod-uploads`. The caller still needs IAM permission for those actions, and the bucket policy can still deny the request. If the SDK returns `AccessDenied`, read the error message and CloudTrail event before assuming the network path failed.

A healthy review writes the layers next to each other:

| Layer | Receipts app decision |
| --- | --- |
| Network route or DNS | App subnet reaches S3 through gateway endpoint and Secrets Manager through interface endpoint |
| Endpoint policy | Endpoint allows only the expected service actions and resources |
| IAM role policy | ECS task role can read the secret and write the receipt object |
| Resource policy | Bucket or secret policy trusts the workload path and account |
| KMS key policy | Encryption key allows the same workload role when customer-managed keys are used |

That table helps during incidents because different failures look similar in the application. A missing route often looks like a timeout. A denied endpoint policy, IAM policy, bucket policy, or KMS key policy usually produces an AWS service error such as `AccessDeniedException` or `AccessDenied`.

## PrivateLink for Provider Services
<!-- section-summary: PrivateLink lets one provider expose one service privately to selected consumers without opening full VPC-to-VPC routing. -->

AWS PrivateLink also supports private access to services provided by another VPC, another AWS account, AWS Marketplace, or a partner. The provider exposes an **endpoint service**, often backed by a Network Load Balancer. The consumer creates an interface endpoint in their own VPC and connects to that service privately.

For the receipts company, the fraud-scoring partner can expose `fraud-api` through PrivateLink. Your VPC creates an interface endpoint, attaches a security group, and uses a private DNS name such as `fraud.partner.internal`. The receipts API reaches the fraud service, while the partner's wider VPC network stays separate.

That limited relationship is the main value. PrivateLink exposes one service endpoint rather than a full routed network relationship. This can fit partner APIs, internal platform services, and shared services where consumers need one private API rather than broad access to every subnet behind it.

Provider and consumer teams own different pieces. The provider owns the Network Load Balancer, endpoint service permissions, allowed principals, acceptance settings, target health, and service logs. The consumer owns the interface endpoint, endpoint security group, private DNS name, application timeout behavior, and client logs. Provider target health still needs provider ownership, so both sides need a clear escalation path.

## Design and Troubleshooting Checklist
<!-- section-summary: Endpoint troubleshooting starts with the dependency list, then checks route or DNS, endpoint state, security groups, and authorization layers in order. -->

Build endpoints from an application dependency list. For each dependency, write the service name, endpoint type, route table association or subnet placement, security group, private DNS setting, IAM policy, resource policy, and expected logs. This turns a broad private service failure into a list of named flows.

For gateway endpoints, start with route table association. The endpoint can be healthy while the app subnet uses a route table that lacks the service prefix-list route. For interface endpoints, start with endpoint state, subnet placement, DNS answers, and endpoint security groups. Then check endpoint policies, IAM policies, resource policies, and KMS key policies.

A single endpoint inspection command gives a compact starting point:

```bash
aws ec2 describe-vpc-endpoints \
  --vpc-endpoint-ids vpce-0secretsreceipts \
  --query 'VpcEndpoints[0].{State:State,Type:VpcEndpointType,Service:ServiceName,PrivateDns:PrivateDnsEnabled,Subnets:SubnetIds,Groups:Groups[*].GroupId,Policy:PolicyDocument}'
```

```json
{
  "State": "available",
  "Type": "Interface",
  "Service": "com.amazonaws.us-east-1.secretsmanager",
  "PrivateDns": true,
  "Subnets": [
    "subnet-0apppriv-a",
    "subnet-0apppriv-b"
  ],
  "Groups": [
    "sg-0endpointsecrets"
  ],
  "Policy": "{\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":\"*\",\"Action\":\"secretsmanager:GetSecretValue\",\"Resource\":\"arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/receipts/db-*\"}]}"
}
```

This output says the endpoint exists, the service and endpoint type match the dependency, private DNS is enabled, and the endpoint policy allows only `GetSecretValue` for the expected secret path. If the app still times out, the next action is the endpoint security group, DNS from the app runtime, and route or NACL evidence. If the app receives `AccessDeniedException`, the next action is IAM, secret resource policy, KMS key policy, and the endpoint policy resource pattern.

Separate network access from service authorization. A Flow Log `ACCEPT` to an interface endpoint can still end with `AccessDenied` from IAM, endpoint policy, secret policy, bucket policy, table policy, or KMS key policy. Packet evidence tells you the request reached the endpoint path. AWS service errors tell you the service rejected the action or resource.

For the receipts app, a clean production design uses endpoints for routine AWS service dependencies, NAT only for approved public destinations that need it, and PrivateLink for the partner fraud API. Each path has an owner, a policy layer, and an inspection command the on-call team can use during an incident.

![The private access summary connects endpoint type, DNS, route tables, security groups, endpoint policy, IAM, and service logs](/content-assets/articles/article-cloud-providers-aws-networking-connectivity-vpc-endpoints-privatelink/private-service-access-summary.png)

*The private access summary connects endpoint type, DNS, route tables, security groups, endpoint policy, IAM, and service logs.*


## References

- [AWS PrivateLink documentation: What is AWS PrivateLink?](https://docs.aws.amazon.com/vpc/latest/privatelink/what-is-privatelink.html)
- [Amazon VPC documentation: Gateway endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/gateway-endpoints.html)
- [Amazon VPC documentation: Gateway endpoints for Amazon S3](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-s3.html)
- [Amazon VPC documentation: Interface endpoints](https://docs.aws.amazon.com/vpc/latest/privatelink/create-interface-endpoint.html)
- [Amazon VPC documentation: Endpoint policies](https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html)
