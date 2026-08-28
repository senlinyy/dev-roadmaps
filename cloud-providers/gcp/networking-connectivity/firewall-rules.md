---
title: "Firewall Rules and Packet Access"
description: "Learn how Google Cloud firewall rules use packet facts, direction, priority, allow and deny actions, implied rules, stateful return traffic, and targets to decide packet access."
overview: "After routing identifies a possible path, GCP firewall policy decides whether one exact connection may cross a VM network boundary. This article follows the packet facts, selectors, precedence, state, evidence, and troubleshooting order."
tags: ["gcp", "firewalls", "vpc", "network-security", "troubleshooting"]
order: 2
id: article-cloud-providers-gcp-networking-connectivity-vpcs-subnets-routes-firewall-rules
aliases:
  - firewall-rules
  - vpcs-subnets-routes-and-firewall-rules
  - cloud-providers/gcp/networking-connectivity/vpcs-subnets-routes-and-firewall-rules.md
---

## Table of Contents

1. [How Do Routes and Firewalls Decide One Packet?](#how-do-routes-and-firewalls-decide-one-packet)
2. [How Do Ingress, Egress, Sources, Destinations, and Targets Relate?](#how-do-ingress-egress-sources-destinations-and-targets-relate)
3. [How Do Priority, Allow, and Deny Work?](#how-do-priority-allow-and-deny-work)
4. [What Do Implied Rules and Stateful Tracking Do?](#what-do-implied-rules-and-stateful-tracking-do)
5. [How Do Tags and Service Accounts Select Workloads?](#how-do-tags-and-service-accounts-select-workloads)
6. [How Does Egress Control Complete the Policy?](#how-does-egress-control-complete-the-policy)
7. [How Do Commands and Terraform Express Firewall Intent?](#how-do-commands-and-terraform-express-firewall-intent)
8. [How Do Logs and Troubleshooting Prove the Decision?](#how-do-logs-and-troubleshooting-prove-the-decision)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A route says where traffic could go; firewall rules decide whether packets may pass. The VPC article gave your resources private addresses and routes. The firewall layer takes the next step and asks whether a specific packet is allowed for a specific target.

Think of the route as the road map and the firewall as the security checkpoint. The road map can show a road from the web tier to the API tier. The checkpoint still decides whether this source is allowed to enter that destination on this port. Production networking needs both; a road without permission still fails, and permission without a road also fails.

Use the raw packet `10.10.0.5:53172 → 10.20.0.8:443` over TCP. The client chose an ephemeral source port, while destination port `443` identifies the server-side service. That source IP, destination IP, source port, destination port, and protocol form the connection's **5-tuple**.

Keep these questions in view as you work through the lesson:

1. **How Do Routes and Firewalls Decide One Packet?**
2. **How Do Ingress, Egress, Sources, Destinations, and Targets Relate?**
3. **How Do Priority, Allow, and Deny Work?**
4. **What Do Implied Rules and Stateful Tracking Do?**
5. **How Do Tags and Service Accounts Select Workloads?**
6. **How Does Egress Control Complete the Policy?**
7. **How Do Commands and Terraform Express Firewall Intent?**
8. **How Do Logs and Troubleshooting Prove the Decision?**

## How Do Routes and Firewalls Decide One Packet?
<!-- section-summary: A route says where traffic could go; firewall rules decide whether packets may pass. -->

A **Google Cloud firewall rule** is an access rule evaluated for VM interfaces in a VPC network. It checks facts about a packet, chooses the highest-priority matching rule, and applies an allow or deny action. Routes and firewalls work together: the route gives a path, and the firewall decides whether a packet may use that path.

### Which Packet Facts Matter?
<!-- section-summary: Firewall debugging starts by writing down the packet facts before changing a rule. -->

A **packet fact** is a concrete detail about the traffic being checked. Useful facts include direction, source, destination, protocol, port, target, priority, and action. Writing these facts down turns "the network is broken" into a reviewable access question.

This step matters because firewall rules do not understand vague application names. They evaluate packet facts. If a support ticket says "the frontend cannot call the API," the firewall does not see "frontend" or "API" as a feeling. It sees source identity or source range, target identity or tag, protocol, port, direction, and the VPC rule set.

Write the sentence a human can understand, then translate it into packet facts. The human sentence is: "web should call API on TCP `8080`." The packet version is: ingress to API targets, source web service account, protocol TCP, port `8080`, action allow, priority chosen by the team's rule plan.

For the web-to-API path, the access sentence is clear: "API VMs accept TCP `8080` from web VMs." That sentence gives you the target, source, protocol, and port before anyone opens the console.

![A generated infographic showing packet facts such as direction, source, target, protocol, port, and action.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-vpcs-subnets-routes-firewall-rules/packet-facts.png)
*A firewall decision is easier to debug after the packet facts are written down.*

Here are the platform paths as packet facts:

| Packet | Direction | Target | Source or destination | Port |
|---|---|---|---|---:|
| Load balancer proxy to web frontend | Ingress | Web VMs | Load balancer proxy ranges | App port |
| Web frontend to API | Ingress | API VMs | Web tier identity | `8080` |
| API to private database endpoint | Egress | API VMs | Database private address | `5432` |
| Worker to API job endpoint | Ingress | API VMs | Worker tier identity | `8080` |

The target is the resource receiving the firewall rule. A rule that allows web-to-API traffic usually targets the API VMs because the packet is arriving at them. A rule that restricts API-to-database traffic targets the API VMs because the packet is leaving them.

## How Do Ingress, Egress, Sources, Destinations, and Targets Relate?
<!-- section-summary: Ingress rules control packets arriving at targets, and egress rules control packets leaving targets. -->

**Ingress** means the packet is arriving at the targeted VM interface. If the web tier calls the API tier, an ingress rule on the API target can allow TCP `8080` from the web source. The API VM is the target because it receives the connection.

**Egress** means the packet is leaving the targeted VM interface. If the API tier connects to the private database endpoint, an egress rule on the API target can allow TCP `5432` to the database range. The API VM is still the target because it sends the packet.

The easiest way to choose direction is to stand next to the target VM. If the packet is coming toward that VM, think ingress. If the packet is leaving that VM, think egress. This is why the same API VM can be the target of an ingress rule for web traffic and the target of an egress rule for database traffic.

For beginners, direction is often confusing because application diagrams use arrows between services. Firewall rules use the target interface as the point of view. The rule sentence should include that point of view: "allow ingress to API from web on TCP 8080" or "allow egress from API to database on TCP 5432."

Direction is one of the most common beginner mistakes. A rule that says "allow API from web" and uses egress on the API target describes the wrong side of the connection. A clearer rule sentence is "allow ingress to API from web on TCP `8080`."

### How Are Sources, Destinations, and Targets Different?
<!-- section-summary: Ingress rules care about sources, while egress rules care about destinations. -->

A **source** is where an ingress packet comes from. In GCP firewall rules, the source can be expressed as an IP range, source network tag, or source service account depending on the rule style. For production workloads, source service accounts often describe the workload more safely than changing IP addresses.

A **destination** is where an egress packet goes. In egress rules, destination ranges describe the IP range that the target can reach. For the API-to-database path, the destination might be `10.70.4.12/32` for one private database endpoint or a documented private range for a managed service pattern.

For the frontend-to-API flow, the roles are:

| Rule sentence | Direction | Source or destination | Target |
|---|---|---|---|
| API accepts TCP `8443` from frontend | Ingress | Frontend service account | API service account |
| API sends TCP `443` to an approved range | Egress | Approved destination CIDR | API service account |

Firewall rules belong to the VPC network and are enforced on applicable VM interfaces. They are not attached to a subnet. Two VMs in the same subnet can therefore receive different treatment when their target tags or service accounts differ.

## How Do Priority, Allow, and Deny Work?
<!-- section-summary: Lower priority numbers win, and the winning matching rule applies either an allow or deny action. -->

Every VPC firewall rule has a **priority** from `0` through `65535`. Lower numbers have higher priority. If you create a rule without an explicit priority, Google Cloud uses `1000`.

The highest-priority matching rule controls the packet. A broad deny at priority `100` can override a narrower allow at priority `800`. If two applicable rules have the same priority and different actions, deny wins. Production teams usually give important rules unique priorities so review and logs stay predictable.

An **allow** rule grants the matching packet access. A **deny** rule blocks the matching packet. A practical design uses allow rules for expected application paths and deny rules for shared guardrails, such as blocking direct SSH and RDP from the internet.

![A generated infographic showing firewall priority order from broad denies to application allow rules and implied fallback behavior.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-vpcs-subnets-routes-firewall-rules/priority-order.png)
*Lower priority numbers win, so broad guardrails need deliberate priority choices.*

A small priority plan can leave room for future rules:

| Priority | Rule idea | Why it exists |
|---:|---|---|
| `100` | Deny internet SSH and RDP | Shared safety guardrail |
| `300` | Allow admin access from VPN to break-glass targets | Narrow emergency path |
| `800` | Allow web to API on TCP `8080` | Main application path |
| `900` | Allow API to database on TCP `5432` | Private data path |
| `65535` | Implied rules | Google Cloud fallback behavior |

The exact bands are a team convention. The important behavior is fixed: lower numbers win, and the winning matching rule chooses allow or deny.

Specificity does not override priority. A broad deny for all TCP at priority `500` defeats a target-specific allow for TCP `443` at priority `1000`, even though the allow looks narrower. This differs from route selection, where a longer destination prefix is highly significant. For firewall rules, compare priority before target or port specificity. If an allow and deny match at the same priority, deny wins.

## What Do Implied Rules and Stateful Tracking Do?
<!-- section-summary: Every VPC has implied fallback behavior, and the default network may also have pre-populated ingress allows. -->

Every VPC network has two implied IPv4 firewall rules at priority `65535`. The implied ingress rule denies incoming traffic. The implied egress rule allows outgoing traffic. These implied rules exist even if you create a custom-mode VPC with no visible firewall rules.

The default network is separate from those implied rules. New projects may receive a default auto-mode VPC unless organization policy disables it. That default network can include pre-populated ingress allow rules for internal traffic, SSH, RDP, and ICMP. Production teams often delete or avoid default network rules because they want every access path reviewed.

The difference is easy to miss during a lab because both network types still have implied fallback behavior:

| Network shape | Visible rules you may inherit | Fallback behavior still present |
|---|---|---|
| Custom-mode VPC | No application ingress allows unless the team creates them | Implied ingress deny and implied egress allow at priority `65535` |
| Default network | Pre-populated ingress allows for internal traffic, SSH, RDP, and ICMP in many projects | The same implied ingress deny and implied egress allow still exist underneath |

For a reviewed production VPC, the custom-mode path is easier to audit. The firewall list starts close to empty, so an allow rule for `web` to `api` on TCP `8080` has a clear reason. In a default network, the team must first check whether an inherited SSH, RDP, ICMP, or broad internal allow already opens a path that the new application design did not ask for.

For the API target, the implied ingress deny is useful. If no rule allows internet traffic to the API VMs, direct scans from the internet have no allowed ingress path. If the team wants restricted egress, it must add higher-priority egress deny rules and narrow allow rules because implied egress allows outbound traffic by default.

An egress-lockdown design usually keeps narrow allows above one broad deny:

| Priority | Direction | Action | Destination | Purpose |
|---:|---|---|---|---|
| `700` | Egress | Allow TCP `5432` | `10.70.4.7/32` | API to private database |
| `710` | Egress | Allow TCP `443` | `10.40.30.25/32` | API to PSC endpoint for Google APIs |
| `65000` | Egress | Deny all | `0.0.0.0/0` | Override implied egress allow |

The broad deny uses priority `65000`, which is still higher precedence than the implied allow at `65535`. The narrow allow rules use lower priority numbers, so approved dependency calls match before the broad deny. Firewall logs should show accepted database and PSC traffic, while unexpected internet destinations should show deny matches on the lockdown rule.

### How Does Stateful Return Traffic Work?
<!-- section-summary: GCP firewall rules track allowed connections, so matching return traffic can flow without mirrored response rules. -->

Google Cloud VPC firewall rules are **stateful**. Stateful means Google Cloud tracks allowed connections and permits matching return traffic for that connection. If an ingress rule allows a web VM to open TCP `8080` to an API VM, the API VM's response packets can return as part of that connection.

For the packet example, a request might look like this:

| Flow | Packet facts | Rule needed |
|---|---|---|
| Request | Web `10.30.10.12:49152` to API `10.30.20.8:8080` | Ingress allow on the API target for TCP `8080` from the web source |
| Response | API `10.30.20.8:8080` to web `10.30.10.12:49152` | No mirrored ingress rule on the web target for this response packet |

The web VM uses an ephemeral source port such as `49152`. The API response returns to that temporary port as part of the same tracked connection. Google Cloud recognizes the response as related traffic and permits it through connection tracking after the original request is allowed.

This saves teams from writing mirrored response rules for every request. The first packet that initiates the connection still needs to match an allow rule. After the connection is accepted, return packets for that same connection follow connection tracking.

The state is specific to the connection. A successful web-to-API connection does not grant the API tier a new unrelated connection to the database. After the API opens `10.30.20.8:51544` to database `10.70.4.7:5432`, that is a new connection with a new source, destination, protocol, and port. The database target needs an ingress allow from the API tier, and a locked-down API tier may also need an egress allow to the database address. If that rule is missing, the user request can reach the API and still fail as the API loads application records.

An opposite-direction deny cannot be used to kill legitimate response packets for an already allowed connection. Connection tracking recognizes the reverse 5-tuple as return traffic while state remains active. That does not grant the server permission to initiate an unrelated reverse-direction connection such as TCP `22`; the new connection receives its own independent decision.

## How Do Tags and Service Accounts Select Workloads?
<!-- section-summary: Targets define which VM interfaces receive a rule, and service account targeting ties rules to workload identity. -->

A **target** defines which VM interfaces a firewall rule applies to. Without a specific target, a VPC firewall rule can apply broadly across the network. With a target, the rule applies only to selected VM interfaces.

Google Cloud commonly targets firewall rules by **network tag** or **service account**. A network tag is a text label on a VM, such as `web` or `api`. A service account is the workload identity attached to the VM, such as `api-prod@PROJECT_ID.iam.gserviceaccount.com`.

Network tags are easy for small labs and simple environments. Service account targeting is often better for production application tiers because it follows workload identity and tends to have tighter IAM review. A managed instance group can replace an API VM, and the rule still matches as long as the new VM uses the API service account.

One GCP-specific detail matters: a single VPC firewall rule supports either target service accounts or target network tags. You do not mix both target styles in one rule. Choose the style for the rule family and keep the source fields compatible with that style.

Tags and service accounts are not fields carried inside the IP packet. They are control-plane selectors that Google resolves to VM interfaces. The packet still contains addresses, ports, and protocol; Google knows which VM interface originated or received it and applies the configured selector metadata.

There is also a source-filtering trap. Combining a source CIDR with source tags or source service accounts creates a union, not an intersection. A rule containing `10.10.0.0/20` and `frontend-prod@...` matches the range **or** the service-account-selected interfaces. Do not write that combination expecting the originator to satisfy both conditions.

For the packet example, service account targets read clearly:

| Tier | VM service account | Firewall role |
|---|---|---|
| Web frontend | `web-prod@PROJECT_ID.iam.gserviceaccount.com` | Source for API ingress |
| API | `api-prod@PROJECT_ID.iam.gserviceaccount.com` | Target for API ingress and source for database egress |
| Worker | `worker-prod@PROJECT_ID.iam.gserviceaccount.com` | Source for selected API ingress |

## How Does Egress Control Complete the Policy?

Ingress policy controls who can initiate a connection to a protected VM. Egress policy controls where that VM may initiate connections. Leaving implied egress allow unchanged means a compromised workload can try arbitrary command-and-control or exfiltration endpoints.

A deliberate pattern uses a higher-priority allow for the approved HTTPS destination followed by a lower-precedence explicit deny for `0.0.0.0/0`. The broad deny still sits above the implied egress allow at priority `65535`, so everything outside the approved destination is rejected. Leave gaps between priorities so an emergency block or later exception can be inserted without renumbering the entire policy.

## How Do Commands and Terraform Express Firewall Intent?
<!-- section-summary: A practical firewall baseline turns expected application paths into reviewed rules with clear names, priorities, and logging. -->

The command examples assume one custom-mode VPC named `prod-vpc`. The first rule blocks direct internet admin access. It is a mutating command, so real teams usually apply it through infrastructure review:

```bash
gcloud compute firewall-rules create deny-ingress-admin-from-internet \
  --project=PROJECT_ID \
  --network=prod-vpc \
  --direction=INGRESS \
  --priority=100 \
  --deny=tcp:22,tcp:3389 \
  --source-ranges=0.0.0.0/0 \
  --enable-logging
```

Important fields:

- `--direction=INGRESS` checks packets arriving at targets.
- `--priority=100` makes this guardrail win over normal application allow rules.
- `--deny=tcp:22,tcp:3389` blocks SSH and RDP.
- `--source-ranges=0.0.0.0/0` covers internet IPv4 sources.

Expected output should show a completed firewall operation:

```yaml
operationType: insert
status: DONE
targetLink: projects/PROJECT_ID/global/firewalls/deny-ingress-admin-from-internet
```

The next rule allows the web tier to call the API tier:

```bash
gcloud compute firewall-rules create allow-ingress-api-from-web-tcp-8080 \
  --project=PROJECT_ID \
  --network=prod-vpc \
  --direction=INGRESS \
  --priority=800 \
  --allow=tcp:8080 \
  --source-service-accounts=web-prod@PROJECT_ID.iam.gserviceaccount.com \
  --target-service-accounts=api-prod@PROJECT_ID.iam.gserviceaccount.com \
  --enable-logging
```

Important fields:

- `--source-service-accounts` names the workload identity that starts the connection.
- `--target-service-accounts` names the API workload identity receiving the packet.
- `--allow=tcp:8080` limits the rule to the API port instead of opening every protocol.
- `--enable-logging` creates evidence for rule matches.

If the team restricts outbound traffic, add a narrow API-to-database egress rule:

```bash
gcloud compute firewall-rules create allow-egress-api-to-db-tcp-5432 \
  --project=PROJECT_ID \
  --network=prod-vpc \
  --direction=EGRESS \
  --priority=900 \
  --allow=tcp:5432 \
  --destination-ranges=10.70.4.12/32 \
  --target-service-accounts=api-prod@PROJECT_ID.iam.gserviceaccount.com \
  --enable-logging
```

Important fields:

- `--direction=EGRESS` checks packets leaving the API target.
- `--destination-ranges=10.70.4.12/32` narrows the destination to one private endpoint in this example.
- The target service account keeps the rule attached to the API workload instead of all VMs in the subnet.

Terraform keeps the same intent in reviewable code:

```hcl
resource "google_compute_firewall" "allow_ingress_api_from_web" {
  project   = var.project_id
  name      = "allow-ingress-api-from-web-tcp-8080"
  network   = google_compute_network.learn_prod.self_link
  direction = "INGRESS"
  priority  = 800

  source_service_accounts = [
    "web-prod@${var.project_id}.iam.gserviceaccount.com"
  ]

  target_service_accounts = [
    "api-prod@${var.project_id}.iam.gserviceaccount.com"
  ]

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  log_config {
    metadata = "INCLUDE_ALL_METADATA"
  }
}
```

The resource name, priority, source identity, target identity, protocol, port, and logging block should match the review sentence. That makes the rule understandable in code review and during incident response.

## How Do Logs and Troubleshooting Prove the Decision?
<!-- section-summary: Rule listings, Connectivity Tests, logging, and flow evidence help prove which rule controls a packet path. -->

The first verification command lists firewall rules in priority order:

```bash
gcloud compute firewall-rules list \
  --project=PROJECT_ID \
  --filter='network~prod-vpc' \
  --sort-by=priority \
  --format='table(name,direction,priority,disabled,allowed,denied,sourceRanges,destinationRanges,sourceServiceAccounts,targetServiceAccounts)'
```

Healthy output should show guardrails above application allows and `DISABLED` as `False`:

```console
NAME                                  DIRECTION  PRIORITY  DISABLED  ALLOWED     DENIED             SOURCE_RANGES  DESTINATION_RANGES  SOURCE_SERVICE_ACCOUNTS                  TARGET_SERVICE_ACCOUNTS
deny-ingress-admin-from-internet      INGRESS    100       False                 tcp:22,tcp:3389    0.0.0.0/0
allow-ingress-api-from-web-tcp-8080   INGRESS    800       False     tcp:8080                                      web-prod@PROJECT_ID.iam.gserviceaccount.com  api-prod@PROJECT_ID.iam.gserviceaccount.com
allow-egress-api-to-db-tcp-5432       EGRESS     900       False     tcp:5432                     10.70.4.12/32                                            api-prod@PROJECT_ID.iam.gserviceaccount.com
```

The describe command checks exact fields if the rule name is not enough:

```bash
gcloud compute firewall-rules describe allow-ingress-api-from-web-tcp-8080 \
  --project=PROJECT_ID \
  --format=yaml
```

Useful output should show direction, priority, logging, source service account, and target service account:

```yaml
allowed:
- IPProtocol: tcp
  ports:
  - '8080'
direction: INGRESS
disabled: false
logConfig:
  enable: true
priority: 800
sourceServiceAccounts:
- web-prod@PROJECT_ID.iam.gserviceaccount.com
targetServiceAccounts:
- api-prod@PROJECT_ID.iam.gserviceaccount.com
```

Connectivity Tests can simulate the expected path for supported endpoints:

```bash
gcloud network-management connectivity-tests create web-to-api-8080 \
  --project=PROJECT_ID \
  --source-instance=projects/PROJECT_ID/zones/us-central1-a/instances/web-1 \
  --source-ip-address=10.30.10.15 \
  --destination-instance=projects/PROJECT_ID/zones/us-central1-a/instances/api-1 \
  --destination-ip-address=10.30.20.8 \
  --destination-port=8080 \
  --protocol=TCP

gcloud network-management connectivity-tests describe web-to-api-8080 \
  --project=PROJECT_ID \
  --format=yaml
```

The create command stores a test definition. The describe command is the evidence. A healthy result should show reachability:

```yaml
name: projects/PROJECT_ID/locations/global/connectivityTests/web-to-api-8080
reachabilityDetails:
  result: REACHABLE
  traces:
  - endpointInfo:
      sourceIp: 10.30.10.15
      destinationIp: 10.30.20.8
      destinationPort: 8080
      protocol: TCP
```

![A generated infographic showing a firewall troubleshooting sequence with rule listing, Connectivity Tests, firewall logs, and flow evidence.](/content-assets/articles/article-cloud-providers-gcp-networking-connectivity-vpcs-subnets-routes-firewall-rules/firewall-troubleshooting.png)
*Firewall troubleshooting moves from configured rules to simulated path evidence and then to runtime logs or flow records.*

For a failed packet, keep the checks in order:

| Symptom | First useful check | What the team learns |
|---|---|---|
| Web tier cannot reach API on `8080` | Connectivity Test from web VM to API VM | Route, firewall, and policy path |
| API logs show no request | Firewall rule logging and VPC Flow Logs where enabled | Whether packets reached firewall evaluation |
| SSH works from the internet | Rule list plus default-network review | Whether a broad ingress allow exists |
| API can reach every public endpoint | Egress rules and implied egress posture | Whether outbound access is intentionally broad |

The final beginner checkpoint is this: **routes decide where a packet could go, firewall rules decide whether it may pass, priorities decide which matching rule wins, implied rules provide fallback behavior, stateful tracking permits response traffic, and targets decide which VM interfaces receive the rule**.

These examples use classic VPC firewall rules because they expose the packet model directly. Cloud NGFW can also layer hierarchical, global network, and regional network firewall policies above or alongside project VPC rules. In a larger organization, inspect the effective firewall configuration instead of assuming the VPC firewall-rule list is the entire policy universe. The same questions remain: packet, direction, target, source or destination, protocol and port, precedence, and action.

## Check Your Answers

:::expand[How Do Routes and Firewalls Decide One Packet?]{kind="recap"}
The source egress policy, destination route, and destination ingress policy are separate checks. The packet's 5-tuple identifies the flow that those controls evaluate.
:::

:::expand[How Do Ingress, Egress, Sources, Destinations, and Targets Relate?]{kind="recap"}
Ingress enters the protected target interface and uses source criteria. Egress leaves the protected target and uses destination criteria. The target always identifies which VM interfaces receive the rule.
:::

:::expand[How Do Priority, Allow, and Deny Work?]{kind="recap"}
Lower priority numbers win before specificity is considered. If allow and deny match at the same priority, deny wins.
:::

:::expand[What Do Implied Rules and Stateful Tracking Do?]{kind="recap"}
Implied IPv4 behavior denies ingress and allows egress at priority `65535`. Once a new connection is allowed, reverse 5-tuple response traffic is statefully accepted, but unrelated reverse initiation is still a new flow.
:::

:::expand[How Do Tags and Service Accounts Select Workloads?]{kind="recap"}
Tags and service accounts are control-plane selectors resolved to VM interfaces. Combining source ranges with source tags or service accounts forms an OR set, not an AND requirement.
:::

:::expand[How Does Egress Control Complete the Policy?]{kind="recap"}
Narrow egress allows followed by a broader explicit deny can restrict workloads to approved destinations and override the implied egress allow.
:::

:::expand[How Do Commands and Terraform Express Firewall Intent?]{kind="recap"}
Name the network, direction, priority, action, protocol and port, source or destination criteria, workload targets, and logging so the configuration reads like the intended connection sentence.
:::

:::expand[How Do Logs and Troubleshooting Prove the Decision?]{kind="recap"}
Troubleshoot one exact source, destination, protocol, and port. Check source egress, route, target ingress, selector applicability, destination listener, firewall logs, and Connectivity Tests in that order.
:::

## References

- [VPC firewall rules](https://docs.cloud.google.com/firewall/docs/firewalls) - Documents direction, priority, actions, implied rules, default network rules, targets, and stateful behavior.
- [Use VPC firewall rules](https://docs.cloud.google.com/firewall/docs/using-firewalls) - Shows the official workflow for creating, updating, listing, and managing firewall rules.
- [Firewall Rules Logging](https://docs.cloud.google.com/firewall/docs/firewall-rules-logging) - Explains logging for firewall rule matches and operational evidence.
- [Hierarchical firewall policies](https://docs.cloud.google.com/firewall/docs/firewall-policies) - Explains organization and folder-level firewall guardrails.
- [Connectivity Tests overview](https://docs.cloud.google.com/network-intelligence-center/docs/connectivity-tests/concepts/overview) - Describes configuration analysis and packet path simulation.
- [gcloud compute firewall-rules create](https://docs.cloud.google.com/sdk/gcloud/reference/compute/firewall-rules/create) - Documents current CLI flags for allow rules, deny rules, source service accounts, target service accounts, priorities, and logging.
