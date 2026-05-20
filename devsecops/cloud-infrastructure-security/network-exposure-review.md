---
title: "Network Exposure Review"
description: "Review public and private paths, routes, firewall rules, and evidence before a service becomes reachable."
overview: "Network exposure review asks who can reach a service and through which path. This article follows a Terraform change that accidentally opens an admin listener and uses the Capital One incident as a reminder that exposure and IAM scope combine."
tags: ["networking", "firewalls", "exposure"]
order: 2
id: article-devsecops-cloud-infrastructure-security-network-exposure-review
---

## Table of Contents

1. [What Exposure Means](#what-exposure-means)
2. [Start With Reachability](#start-with-reachability)
3. [Public CIDRs](#public-cidrs)
4. [Routes and Addresses](#routes-and-addresses)
5. [Case Study: Capital One](#case-study-capital-one)
6. [Review Evidence](#review-evidence)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Exposure Means

Network exposure means a path exists from one place to another. The place may be the internet, a corporate VPN, another VPC, a Kubernetes namespace, or a cloud service. The target may be a load balancer, API, database, admin port, or metadata endpoint.

The beginner mistake is to review only the port number. A port is just one part of the path. Exposure depends on source, destination, route, address, firewall rule, and application listener.

For `devpolaris-orders-api`, the review question is:

```text
Which sources can reach the orders service, and should they?
```

## Start With Reachability

Draw the path before reading every rule.

```text
Internet
  -> public load balancer
  -> private app subnet
  -> orders-api service
  -> database subnet
```

The public load balancer is expected to receive internet traffic. The app subnet should receive traffic from the load balancer. The database subnet should receive traffic from the app. An admin listener should not be reachable from the internet.

Now map the rule under review.

```text
Change: allow TCP 9000 from 0.0.0.0/0 to orders-api-admin
```

`0.0.0.0/0` means every IPv4 address. That does not automatically prove the service is reachable from the internet, but it is a strong exposure signal. The reviewer should check whether the target also has a public path through routes, addresses, and load balancers.

## Public CIDRs

CIDR ranges describe source or destination address space. In security reviews, these ranges are worth reading carefully.

| CIDR | Meaning in review |
|------|-------------------|
| `0.0.0.0/0` | Any IPv4 source |
| `::/0` | Any IPv6 source |
| `10.0.0.0/8` | Private IPv4 range, still broad |
| `10.40.12.0/24` | Narrower private subnet |
| Corporate VPN range | Intended human access path |

Broad private ranges can still be risky. "Internal" may include many services, teams, or environments. A production database rule that allows an entire private network may be broader than one that allows the app security group or app subnet.

## Routes and Addresses

A firewall rule is only one layer. A public route and public address can make a rule reachable from outside. A private route may keep the same rule internal.

Review these fields together:

```text
Target: orders-api-admin
Listener: TCP 9000
Source rule: 0.0.0.0/0
Public address: yes
Route to internet gateway: yes
Authentication: internal admin token
Decision: block, admin listener must use VPN-only path
```

The `Authentication` line does not make the network exposure safe by itself. Authentication can fail, leak, or be misconfigured. If an admin listener has no reason to be public, remove the public path.

## Case Study: Capital One

The 2019 Capital One incident is often discussed because it involved application exposure, cloud infrastructure behavior, and access to data through cloud permissions. The public facts include unauthorized access to cloud-hosted data and a path involving a misconfigured application-layer component.

For network exposure review, the lesson is that an exposed path and a powerful identity can combine. A reachable application bug is bad. A reachable application bug that can also reach cloud credentials or broad data access is worse.

Read it as a chain:

```text
reachable application path
  -> request reaches internal capability
  -> cloud identity or metadata path
  -> data access
```

The network fix and IAM fix are both important. Reducing public exposure lowers the chance of reaching the path. Narrowing IAM reduces what the path can do if reached.

## Review Evidence

A network exposure review should record the full path as well as the rule that changed.

```text
Change: admin listener TCP 9000
Source: 0.0.0.0/0
Target: orders-api-admin
Public address: yes
Internet route: yes
Expected path: corporate VPN only
Decision: reject public rule, replace with VPN source range
Owner: platform-team
```

This record explains the decision. If someone later asks why the broad rule was rejected, the answer is in the path.

## Putting It All Together

Network exposure review asks who can reach what. Start with reachability, then inspect source ranges, routes, public addresses, firewall rules, and listeners together.

For `devpolaris-orders-api`, public access belongs at the load balancer. App and database paths stay private. Admin paths use VPN or another controlled access path. The Capital One case shows why exposure review and IAM review belong together: a reachable path and broad authority can turn one weakness into a data incident.

## What's Next

Manual review catches many issues, but repeated infrastructure mistakes should become automated checks. The next article covers IaC security scanning.

---

**References**

- [Capital One 2019 cyber incident facts](https://www.capitalone.com/digital/facts2019/) - Capital One summarizes the incident and affected data.
- [U.S. Department of Justice announcement on the Capital One data theft case](https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company) - DOJ describes the alleged unauthorized access path.
- [AWS VPC security groups](https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html) - AWS documents security group behavior for VPC resources.
- [Azure network security groups](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview) - Microsoft documents Azure NSG filtering behavior.
