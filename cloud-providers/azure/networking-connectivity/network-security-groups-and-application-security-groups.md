---
title: "Network Security Groups and Application Security Groups"
description: "Filter Azure packet flows with NSG rules, priority order, effective rule evidence, and readable ASG targets."
overview: "Network security groups decide whether new Azure virtual network flows are allowed or denied. Application security groups make those packet rules describe application roles instead of brittle private IP lists."
tags: ["nsg", "asg", "subnets", "network-security"]
order: 4
id: article-cloud-providers-azure-networking-connectivity-network-security-groups-and-application-security-groups
---

## Table of Contents

1. [The Packet Check Before The App Listens](#the-packet-check-before-the-app-listens)
2. [One Orders API Flow To Follow](#one-orders-api-flow-to-follow)
3. [What An NSG Rule Actually Says](#what-an-nsg-rule-actually-says)
4. [Priority Numbers Decide The First Match](#priority-numbers-decide-the-first-match)
5. [Default Rules Are Already In The Room](#default-rules-are-already-in-the-room)
6. [Stateful Does Not Mean Careless](#stateful-does-not-mean-careless)
7. [Subnet NSGs And NIC NSGs Are Different Checkpoints](#subnet-nsgs-and-nic-nsgs-are-different-checkpoints)
8. [ASGs Make Packet Rules Read Like The App](#asgs-make-packet-rules-read-like-the-app)
9. [Evidence You Can Inspect](#evidence-you-can-inspect)
10. [Failure Path: The Rule Exists But The Packet Still Dies](#failure-path-the-rule-exists-but-the-packet-still-dies)
11. [A Review Habit Before You Change Rules](#a-review-habit-before-you-change-rules)

## The Packet Check Before The App Listens

An application can be healthy and still be unreachable.
The process can be running.
The health endpoint can return `200` from inside the host.
The TLS certificate can be valid.
Then a real request still times out before the app sees a byte.

That is the packet filtering problem.
Before an Azure virtual machine receives a new connection, Azure checks network security group rules on the path.
A network security group, or NSG, is a rule set that allows or denies inbound and outbound traffic for supported Azure resources in a virtual network.
The app code does not vote in that decision.
The operating system listener does not vote first either.
The packet must pass the NSG decision before the listener can answer.

Keep the model small.
An NSG rule looks at packet facts:
source, source port, destination, destination port, protocol, and direction.
It then returns one action:
allow or deny.
That is a network decision, not an application authorization decision.
An NSG does not know whether the request path is `/orders` or `/admin`.
It does not know whether a user has a valid session.
It does not know whether a deployment pipeline has permission to update the resource.

For this article, we will follow `devpolaris-orders-api`.
The API runs on virtual machines in `snet-orders-api`.
An Azure Application Gateway in `snet-app-gateway` sends HTTPS traffic to the API VMs.
The API VMs call an Azure SQL private endpoint in `snet-private-endpoints` on TCP `1433`.
Worker VMs in `snet-orders-worker` call an internal API endpoint on TCP `8443`.

The first useful habit is to write the packet sentence before reading the rule table.
Here is the sentence for public checkout traffic after it has reached the private side of the gateway:

```text
Packet sentence:
  Direction: inbound to the API VM
  Source: Application Gateway subnet 10.30.1.0/24
  Source port: ephemeral client port chosen by the gateway instance
  Destination: orders API NIC in asg-orders-api
  Destination port: TCP 443
  Desired result: allow
```

Notice the destination port.
That is the port where the API listens.
The source port is usually an ephemeral port, which means a temporary high port chosen by the caller.
Beginners often put the listener port in the source port field and create a rule that never matches normal traffic.

The same application has a different packet sentence for database access:

```text
Packet sentence:
  Direction: outbound from the API VM
  Source: orders API NIC in asg-orders-api
  Source port: ephemeral client port
  Destination: SQL private endpoint 10.30.40.7
  Destination port: TCP 1433
  Desired result: allow
```

Those two packets are related by the app workflow, but they are different network decisions.
One starts at the gateway and enters the API tier.
The other starts at the API tier and leaves toward the private endpoint.
When we read NSGs, we do not start with "the app is broken."
We start with "which packet, which direction, which port, and which checkpoint?"

## One Orders API Flow To Follow

A good NSG review has a single flow in mind.
Without that flow, rule tables become a wall of names and numbers.
For `devpolaris-orders-api`, the checkout path has two packet checks that matter for this article.

First, the gateway must reach the API VMs on HTTPS.
Second, the API VMs must reach the SQL private endpoint on the database port.
The gateway article owns load balancing and health probes.
The private access article owns Private Link and DNS.
This article owns the packet filters between those pieces.

Here is the compact path:

```text
Client
  -> Azure Application Gateway
  -> snet-orders-api
  -> vm-orders-api-01 NIC
  -> SQL private endpoint 10.30.40.7
```

Now place NSGs on the path:

```text
snet-app-gateway
  nsg-snet-app-gateway-prod

snet-orders-api
  nsg-snet-orders-api-prod
  vm-orders-api-01 NIC
    nsg-nic-orders-api-prod, only if the team has a special NIC rule set

snet-private-endpoints
  nsg-snet-private-endpoints-prod, if enabled for that subnet design
```

That inventory already gives us a debugging order.
For inbound traffic to an API VM, the subnet NSG is evaluated before the NIC NSG.
For outbound traffic from the same VM, the NIC NSG is evaluated before the subnet NSG.
If the team mostly uses subnet-level policy, the review is simpler.
If the team mixes subnet and NIC NSGs, every failure needs both association points checked.

The useful packet sentence becomes a review artifact:

```text
Review target:
  App Gateway to orders API

Packet:
  inbound TCP
  from 10.30.1.0/24
  to asg-orders-api
  destination port 443

Expected checkpoints:
  nsg-snet-orders-api-prod allows it
  nsg-nic-orders-api-prod allows it, if a NIC NSG exists
```

That is more reviewable than "open HTTPS."
Open from where?
Open to which tier?
Open on which NSG?
Open before or after a broad deny?
The packet sentence forces those answers into the change request before anyone edits production.

## What An NSG Rule Actually Says

An NSG rule is a small decision record.
It is not a policy essay.
It does not infer intent from a friendly name.
Azure evaluates the fields.

For a custom security rule, the fields you read first are:

| Field | What to ask |
|-------|-------------|
| Priority | Is this checked before or after broader rules? |
| Direction | Is the connection starting inbound or outbound from this checkpoint? |
| Source | Which caller address, range, service tag, or ASG starts the traffic? |
| Source port | Is this usually `*` because callers use ephemeral ports? |
| Destination | Which target address, range, service tag, or ASG receives the traffic? |
| Destination port | Which listener port must be reached? |
| Protocol | Is this TCP, UDP, ICMP, any, or another supported protocol? |
| Access | Does the first matching rule allow or deny the packet? |

Read the rule as a sentence:

```text
For inbound TCP traffic,
from the Application Gateway subnet,
to API NICs in asg-orders-api,
when the destination port is 443,
allow the packet,
at priority 100.
```

That sentence maps to a realistic rule excerpt:

```text
NSG: nsg-snet-orders-api-prod

Name: Allow-AppGateway-To-Orders-API-HTTPS
Priority: 100
Direction: Inbound
Source: 10.30.1.0/24
Source port ranges: *
Destination: asg-orders-api
Destination port ranges: 443
Protocol: TCP
Action: Allow
Description: Let the regional gateway reach orders API backends.
```

The rule does not say "customers may place orders."
That is application behavior.
The rule says packets from the gateway subnet may start TCP connections to API NICs on port `443`.
That precision is the whole point.

Now compare the outbound SQL rule:

```text
NSG: nsg-snet-orders-api-prod

Name: Allow-Orders-API-To-SQL-PrivateEndpoint
Priority: 120
Direction: Outbound
Source: asg-orders-api
Source port ranges: *
Destination: 10.30.40.7
Destination port ranges: 1433
Protocol: TCP
Action: Allow
Description: Let orders API reach the SQL private endpoint.
```

This rule belongs to the API subnet because the packet starts at the API VMs.
The destination is the private endpoint IP, not the public SQL name.
DNS and Private Link decide whether the app resolves the SQL hostname to `10.30.40.7`.
The NSG only sees the resulting packet facts.

This is where packet filtering earns its keep.
A rule can be narrow enough to protect the data path and still readable enough to review.
The source is the API role.
The destination is the private endpoint.
The port is the database listener.
The priority leaves space for other targeted rules.

## Priority Numbers Decide The First Match

NSG priorities run from `100` to `4096` for custom rules.
Lower numbers are processed before higher numbers.
When a packet matches a rule, evaluation stops for that NSG and direction.
The first match decides the action.

That means rule order is not decorative.
Two correct-looking rules can produce a broken result when the broad rule is earlier.
Here is the classic mistake on the API subnet:

```text
NSG: nsg-snet-orders-api-prod
Direction: Inbound

Priority  Name                                      Source        Destination      Port  Action
--------  ----------------------------------------  ------------  ---------------  ----  ------
100       Deny-Direct-Internet-To-API               Internet      asg-orders-api   *     Deny
140       Allow-AppGateway-To-Orders-API-HTTPS      10.30.1.0/24  asg-orders-api   443   Allow
65000     AllowVNetInBound                          VirtualNetwork VirtualNetwork  *     Allow
65500     DenyAllInbound                            *             *                *     Deny
```

At first glance, that table looks reasonable.
The team wants to deny direct internet traffic and allow gateway traffic.
But a packet from the gateway subnet is usually part of the virtual network, not the `Internet` service tag.
So this exact table might still allow gateway traffic.

Now change the broad rule slightly:

```text
Priority  Name                                      Source  Destination      Port  Action
--------  ----------------------------------------  ------  ---------------  ----  ------
100       Deny-All-To-Orders-API                    *       asg-orders-api   *     Deny
140       Allow-AppGateway-To-Orders-API-HTTPS      10.30.1.0/24 asg-orders-api 443 Allow
```

This version breaks the path.
The inbound packet from `10.30.1.24` to an API NIC on TCP `443` matches `Deny-All-To-Orders-API` at priority `100`.
Azure stops there.
The allow at priority `140` is never used for that packet.

The fix is not "add another allow."
The fix is to place the specific allow before the broad deny:

```text
NSG: nsg-snet-orders-api-prod
Direction: Inbound

Priority  Name                                      Source        Destination      Port  Action
--------  ----------------------------------------  ------------  ---------------  ----  ------
100       Allow-AppGateway-To-Orders-API-HTTPS      10.30.1.0/24  asg-orders-api   443   Allow
200       Deny-All-To-Orders-API                    *             asg-orders-api   *     Deny
65000     AllowVNetInBound                          VirtualNetwork VirtualNetwork  *     Allow
65500     DenyAllInbound                            *             *                *     Deny
```

Use priority gaps on purpose.
`100`, `120`, `140`, and `200` are easier to maintain than `100`, `101`, `102`, and `103`.
Gaps give you room to insert an urgent but narrow rule without renumbering the whole NSG during an incident.

The safe pattern is not "all allows first forever."
The safe pattern is more specific decisions before less specific decisions.
A deny can be specific too.
For example, a deny for a known scanner range can sit before a broader allow.
The review question is always the same:
which packet matches first?

## Default Rules Are Already In The Room

Every NSG includes default security rules.
You cannot remove them.
You can override them with custom rules because custom rule priorities are higher than the default priorities.
In Azure's numbering, higher priority means a lower number.

The default rules explain many surprises in a new VNet.
Inbound from the internet is denied unless you add an allow.
Traffic inside the virtual network is allowed by default.
Outbound internet traffic is allowed by default.
Those defaults are useful for getting started, but production teams usually tighten some of them.

Here is the beginner view:

| Default rule | Direction | Priority | Meaning |
|--------------|-----------|----------|---------|
| `AllowVNetInBound` | Inbound | `65000` | Allow traffic from virtual network sources to virtual network destinations |
| `AllowAzureLoadBalancerInBound` | Inbound | `65001` | Allow Azure load balancer traffic |
| `DenyAllInbound` | Inbound | `65500` | Deny inbound traffic not allowed earlier |
| `AllowVnetOutBound` | Outbound | `65000` | Allow virtual network destinations outbound |
| `AllowInternetOutBound` | Outbound | `65001` | Allow outbound internet destinations |
| `DenyAllOutBound` | Outbound | `65500` | Deny outbound traffic not allowed earlier |

The default `AllowVNetInBound` rule is the one to slow down on.
It means VM-to-VM or subnet-to-subnet traffic inside the VNet can work even when you did not write a custom allow.
That is convenient in a lab.
It can be too permissive in production when the database tier should accept traffic only from the API role.

For the orders SQL private endpoint, a review might choose this inbound shape on the private endpoint subnet:

```text
NSG: nsg-snet-private-endpoints-prod
Direction: Inbound

Priority  Name                                  Source           Destination  Port  Action
--------  ------------------------------------  ---------------  -----------  ----  ------
100       Allow-Orders-API-To-SQL-PE            asg-orders-api   10.30.40.7   1433  Allow
200       Deny-All-To-SQL-PE                    *                10.30.40.7   *     Deny
65000     AllowVNetInBound                      VirtualNetwork   VirtualNetwork *    Allow
65500     DenyAllInbound                        *                *            *     Deny
```

The custom deny at `200` matters because the default VNet allow at `65000` would otherwise allow more internal sources.
The rule is not saying every private endpoint subnet needs this exact policy.
It is showing why the default VNet allow must be visible during reviews.

Default outbound internet access is similar.
It is helpful when a VM needs package repositories, OS update endpoints, or external APIs.
It is risky when production egress must be limited to known dependencies.
If you add a broad outbound deny, add specific outbound allows first and test the packet path before saving.

The practical review line is:
defaults are real rules.
They are not hidden settings.
If no custom rule matches, a default rule probably decides the packet.

## Stateful Does Not Mean Careless

NSGs are stateful.
When a new outbound connection is allowed, the response traffic for that connection does not need a separate inbound allow.
When a new inbound connection is allowed, the response traffic for that connection does not need a separate outbound allow.
Azure tracks the established flow.

That saves you from writing mirror-image rules for every normal request and response.
The API can open a TCP connection to SQL on `1433`.
SQL can respond on that established flow.
You do not need to add "SQL outbound to API ephemeral ports" just for the response.

Stateful behavior does not mean "traffic can start anywhere."
The rule still matters for the side that starts the connection.
If a worker VM starts a connection to the API admin endpoint on TCP `8443`, the worker-to-API packet needs an allow.
The API response rides the established flow.
If the API later starts a different connection back to the worker, that is a new outbound decision from the API side.

State also matters during rule changes.
Changing or removing an NSG rule affects new connections.
Existing connections can continue until the flow times out or closes.
That can fool an incident review.
One engineer tests an already-open SSH session and says the rule still allows access.
Another engineer opens a new session and gets blocked.
Both observations can be true.

Use fresh tests when validating a security change.
For HTTP, start a new connection instead of trusting an existing keep-alive session.
For database testing, restart the client connection pool or run from a fresh process when you need proof that new connections match the new rule.
The point is not to make testing theatrical.
The point is to test the decision Azure will make for the next new flow.

Here is a packet sentence that includes state:

```text
New flow:
  API VM 10.30.2.14:53144
  -> SQL private endpoint 10.30.40.7:1433
  protocol TCP

Required NSG decision:
  outbound allow from the API checkpoint
  inbound allow at the private endpoint checkpoint, if that subnet filters inbound traffic

Response:
  SQL private endpoint 10.30.40.7:1433
  -> API VM 10.30.2.14:53144
  allowed as part of the established flow
```

The response source port is `1433` because the database is responding from its listener.
The response destination port is the API VM's temporary client port.
That is why blanket "source port equals service port" thinking creates bad rules.

## Subnet NSGs And NIC NSGs Are Different Checkpoints

An NSG can be associated with a subnet.
An NSG can also be associated with a network interface, or NIC.
If both are present, both can affect the same packet.
The order depends on direction.

For inbound traffic to a VM, Azure evaluates the subnet NSG first, then the NIC NSG.
If the subnet NSG denies the packet, the NIC NSG does not rescue it.
If the subnet NSG allows the packet, the NIC NSG can still deny it.

For outbound traffic from a VM, Azure evaluates the NIC NSG first, then the subnet NSG.
If the NIC NSG denies the packet, the subnet NSG does not see an allowed packet later.
If the NIC NSG allows it, the subnet NSG can still deny it.

Keep this table near your mental debugger:

| Packet direction | First checkpoint | Second checkpoint | Review habit |
|------------------|------------------|-------------------|--------------|
| Inbound to VM | Subnet NSG | NIC NSG | A subnet deny stops the packet before NIC rules matter |
| Outbound from VM | NIC NSG | Subnet NSG | A NIC deny stops the packet before subnet rules matter |
| Only subnet NSG | Subnet NSG | None | Every resource in the subnet shares the subnet policy |
| Only NIC NSG | NIC NSG | None | The rule follows that specific NIC |

Microsoft's own guidance warns that using both levels can create rule overlap that is harder to troubleshoot.
That does not mean NIC NSGs are forbidden.
It means they should have a clear reason.

For `devpolaris-orders-api`, a clean production habit is:
put the standard tier policy on the subnet NSG.
Use ASGs or narrow destination ranges to keep the subnet rules readable.
Reserve NIC NSGs for temporary exceptions or special hosts, and document why the exception exists.

Here is the confusing shape to avoid:

```text
Subnet NSG:
  nsg-snet-orders-api-prod
  100 Allow-AppGateway-To-Orders-API-HTTPS inbound 10.30.1.0/24 -> asg-orders-api 443

NIC NSG:
  nsg-nic-orders-api-prod
  100 Deny-All-Inbound inbound * -> * *
```

The subnet rule is real.
It allows the packet at the first inbound checkpoint.
Then the NIC rule denies it at the second checkpoint.
If a ticket says "the allow is right there," the answer is "yes, and a later checkpoint still denies the packet."

The engineering tradeoff is readability versus precision.
Subnet NSGs make policy easy to find and easy to review.
NIC NSGs can target one machine, but they add another place where the truth can hide.
Choose one main level for normal rules unless the exception is worth the extra inspection cost.

## ASGs Make Packet Rules Read Like The App

Application security groups, or ASGs, make NSG rules talk in application roles.
Instead of writing every private IP address into a rule, you place VM network interfaces into named groups and use those groups as NSG sources or destinations.

Without ASGs, the rule table becomes a private IP memory test:

```text
Allow 10.30.2.14,10.30.2.15 to 10.30.40.7 on TCP 1433
Allow 10.30.3.11 to 10.30.2.14,10.30.2.15 on TCP 8443
```

That may work today.
It will age badly.
When a VM is replaced, a NIC is recreated, or a new instance is added, the rule no longer tells reviewers what role the address represents.

With ASGs, the same intent is readable:

```text
Allow asg-orders-api to SQL private endpoint 10.30.40.7 on TCP 1433
Allow asg-orders-worker to asg-orders-api on TCP 8443
Deny anything else to asg-orders-api on TCP 8443
```

ASG membership lives on NICs.
A NIC can be a member of application security groups, and NSG rules that name those groups apply to member NICs.
If a NIC is not a member, the ASG rule does not match that NIC just because the rule name sounds right.

Here is realistic ASG membership evidence:

```bash
$ az network nic show \
>   --resource-group rg-devpolaris-orders-prod \
>   --name nic-vm-orders-api-01 \
>   --query "{nic:name,privateIp:ipConfigurations[0].privateIPAddress,asgs:ipConfigurations[0].applicationSecurityGroups[].id}" \
>   --output json
{
  "nic": "nic-vm-orders-api-01",
  "privateIp": "10.30.2.14",
  "asgs": [
    "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationSecurityGroups/asg-orders-api"
  ]
}
```

And here is a worker NIC:

```bash
$ az network nic show \
>   --resource-group rg-devpolaris-orders-prod \
>   --name nic-vm-orders-worker-01 \
>   --query "{nic:name,privateIp:ipConfigurations[0].privateIPAddress,asgs:ipConfigurations[0].applicationSecurityGroups[].id}" \
>   --output json
{
  "nic": "nic-vm-orders-worker-01",
  "privateIp": "10.30.3.11",
  "asgs": [
    "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationSecurityGroups/asg-orders-worker"
  ]
}
```

That output is not busywork.
It proves the source or destination group in the rule has real members.
If the new API VM is missing `asg-orders-api`, a correct-looking NSG rule will not match traffic for that VM.

ASGs have boundaries.
NICs assigned to an ASG must be in the same virtual network as the first NIC assigned to that ASG.
When a rule uses source and destination ASGs, the NICs in both groups must be in the same virtual network.
That keeps ASGs useful for app roles inside a VNet, not as a universal cross-network identity system.

The tradeoff is small operational discipline.
ASGs make rules easier to read, but deployment must keep membership correct.
If VM replacement creates a new NIC, the automation must attach the right ASG.
Otherwise the rule remains readable and the packet still misses.

## Evidence You Can Inspect

When a network ticket arrives, do not start by editing the NSG.
Collect evidence in the order the packet sees it.
You want association evidence, rule evidence, membership evidence, and packet-test evidence.

Start with subnet association:

```bash
$ az network vnet subnet show \
>   --resource-group rg-devpolaris-network-prod \
>   --vnet-name vnet-devpolaris-prod \
>   --name snet-orders-api \
>   --query "{subnet:name,addressPrefix:addressPrefix,nsg:networkSecurityGroup.id}" \
>   --output json
{
  "subnet": "snet-orders-api",
  "addressPrefix": "10.30.2.0/24",
  "nsg": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-snet-orders-api-prod"
}
```

Then check whether the NIC has another NSG:

```bash
$ az network nic show \
>   --resource-group rg-devpolaris-orders-prod \
>   --name nic-vm-orders-api-01 \
>   --query "{nic:name,privateIp:ipConfigurations[0].privateIPAddress,nsg:networkSecurityGroup.id,asgs:ipConfigurations[0].applicationSecurityGroups[].id}" \
>   --output json
{
  "nic": "nic-vm-orders-api-01",
  "privateIp": "10.30.2.14",
  "nsg": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-nic-orders-api-prod",
  "asgs": [
    "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationSecurityGroups/asg-orders-api"
  ]
}
```

That output changes the investigation.
There is a subnet NSG and a NIC NSG.
For inbound traffic, both must be inspected.

List custom rules in priority order:

```bash
$ az network nsg rule list \
>   --resource-group rg-devpolaris-network-prod \
>   --nsg-name nsg-snet-orders-api-prod \
>   --query "sort_by([].{priority:priority,name:name,direction:direction,source:sourceAddressPrefix,destination:destinationAddressPrefix,sourceAsgs:sourceApplicationSecurityGroups[].id,destinationAsgs:destinationApplicationSecurityGroups[].id,port:destinationPortRange,access:access}, &priority)" \
>   --output table
Priority    Name                                  Direction    Source       Destination    Port    Access
----------  ------------------------------------  -----------  -----------  -------------  ------  --------
100         Allow-AppGateway-To-Orders-API-HTTPS  Inbound      10.30.1.0/24                443     Allow
120         Allow-Orders-API-To-SQL-PE            Outbound                                1433    Allow
200         Deny-Direct-Internet-To-API           Inbound      Internet                   *       Deny
```

The table is helpful, but it hides nested ASG fields in many output formats.
Inspect the exact rule when ASGs matter:

```bash
$ az network nsg rule show \
>   --resource-group rg-devpolaris-network-prod \
>   --nsg-name nsg-snet-orders-api-prod \
>   --name Allow-AppGateway-To-Orders-API-HTTPS \
>   --query "{priority:priority,direction:direction,source:sourceAddressPrefix,destinationAsgs:destinationApplicationSecurityGroups[].id,port:destinationPortRange,protocol:protocol,access:access}" \
>   --output json
{
  "priority": 100,
  "direction": "Inbound",
  "source": "10.30.1.0/24",
  "destinationAsgs": [
    "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/applicationSecurityGroups/asg-orders-api"
  ],
  "port": "443",
  "protocol": "Tcp",
  "access": "Allow"
}
```

Now inspect effective security rules for the NIC.
Effective rules aggregate the subnet and NIC rules applied to the network interface.
They are useful because they show the packet's combined policy view instead of one NSG at a time.
The output below is trimmed to the associations and rules that matter for the failed packet.

```bash
$ az network nic list-effective-nsg \
>   --resource-group rg-devpolaris-orders-prod \
>   --name nic-vm-orders-api-01 \
>   --output json
[
  {
    "association": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-snet-orders-api-prod",
    "rules": [
      {
        "name": "Allow-AppGateway-To-Orders-API-HTTPS",
        "priority": 100,
        "direction": "Inbound",
        "access": "Allow",
        "source": "10.30.1.0/24",
        "destination": "*",
        "port": "443"
      },
      {
        "name": "Deny-Direct-Internet-To-API",
        "priority": 200,
        "direction": "Inbound",
        "access": "Deny",
        "source": "Internet",
        "destination": "*",
        "port": "*"
      }
    ]
  },
  {
    "association": "/subscriptions/sub-devpolaris-training/resourceGroups/rg-devpolaris-network-prod/providers/Microsoft.Network/networkSecurityGroups/nsg-nic-orders-api-prod",
    "rules": [
      {
        "name": "Deny-All-Inbound",
        "priority": 100,
        "direction": "Inbound",
        "access": "Deny",
        "source": "*",
        "destination": "*",
        "port": "*"
      }
    ]
  }
]
```

This evidence says the subnet NSG allows the gateway packet, but the NIC NSG has a broad inbound deny.
The result is not solved by adding another subnet allow.
The blocking rule is at the NIC checkpoint.

For a packet-style test, use Network Watcher IP flow verify when the target is a VM NIC:

```bash
$ az network watcher test-ip-flow \
>   --resource-group rg-devpolaris-orders-prod \
>   --vm vm-orders-api-01 \
>   --nic nic-vm-orders-api-01 \
>   --direction Inbound \
>   --protocol TCP \
>   --local 10.30.2.14:443 \
>   --remote 10.30.1.24:51020 \
>   --output table
Access    RuleName
--------  ----------------------------
Deny      UserRule_Deny-All-Inbound
```

That is the kind of evidence you want before changing production.
It names the tested packet.
It returns allow or deny.
It identifies the rule responsible for the decision.

Finally, keep application symptoms in the evidence chain without letting them replace network proof:

```text
2026-05-08T14:17:22.408Z gateway backend probe failed
backend=vm-orders-api-01
target=10.30.2.14:443
error=connection timed out

2026-05-08T14:17:23.119Z orders-api local health check
target=http://127.0.0.1:8080/health
status=200
```

The app is alive locally.
The gateway cannot start a TCP connection to the backend.
That combination points toward packet filtering, routes, host firewall, or listener binding.
The NSG evidence tells us which of those is currently blocking this packet.

## Failure Path: The Rule Exists But The Packet Still Dies

Here is a realistic failure path from a production review.
The team deploys a new API VM.
The VM joins the backend pool.
The app starts.
The local health check passes.
Application Gateway marks the backend unhealthy because TCP `443` times out.

The first engineer checks the subnet NSG and sees the allow:

```text
nsg-snet-orders-api-prod
100 Allow-AppGateway-To-Orders-API-HTTPS inbound 10.30.1.0/24 -> asg-orders-api TCP 443 Allow
```

That is a real allow, but it is not complete evidence.
The packet still has to match the destination ASG.
The packet may still hit a NIC NSG.
The listener may still be on the wrong port.
The host firewall may still block it.
The point is not to blame NSGs for everything.
The point is to prove the NSG part before moving on.

The ASG membership check shows a miss:

```bash
$ az network nic show \
>   --resource-group rg-devpolaris-orders-prod \
>   --name nic-vm-orders-api-03 \
>   --query "{nic:name,privateIp:ipConfigurations[0].privateIPAddress,asgs:ipConfigurations[0].applicationSecurityGroups[].id}" \
>   --output json
{
  "nic": "nic-vm-orders-api-03",
  "privateIp": "10.30.2.18",
  "asgs": []
}
```

The rule allows traffic to `asg-orders-api`.
The new NIC is not in `asg-orders-api`.
For that NIC, the readable rule does not match.

The team adds the NIC to the ASG and tests again.
The packet still fails.
Now effective rules show a NIC-level deny:

```text
Effective inbound rules for nic-vm-orders-api-03

Association                    Priority  Name                                  Access  Port
-----------------------------  --------  ------------------------------------  ------  ----
nsg-snet-orders-api-prod       100       Allow-AppGateway-To-Orders-API-HTTPS  Allow   443
nsg-nic-orders-api-exception   100       Deny-All-Inbound                      Deny    *
defaultSecurityRules           65500     DenyAllInbound                        Deny    *
```

This is the second miss.
The subnet rule allows the packet.
The NIC rule denies it later in the inbound path.
The fix is not a broader subnet rule.
The fix is to remove the stale NIC NSG, change the NIC NSG to allow the intended packet before its deny, or move the exception into the subnet policy if that is the team's chosen operating model.

A safe incident note might read:

```text
Failure path:
  Gateway probe from 10.30.1.24:51020 to 10.30.2.18:443 timed out.
  Subnet NSG has Allow-AppGateway-To-Orders-API-HTTPS at priority 100.
  nic-vm-orders-api-03 was missing asg-orders-api membership.
  After ASG fix, effective rules still show nsg-nic-orders-api-exception denying inbound traffic.

Fix direction:
  Remove the stale NIC NSG from nic-vm-orders-api-03.
  Keep standard API packet filtering on nsg-snet-orders-api-prod.
  Re-run IP flow verify for the same packet.
  Confirm Application Gateway backend health turns healthy.
```

The key phrase is "fix direction."
During an incident, the tempting fix is to allow `*` from `*` to `*` on `443`.
That may quiet the symptom and create a larger exposure.
A better fix changes the specific failed checkpoint and retests the same packet sentence.

There are other common failure paths:

| Symptom | Likely NSG question |
|---------|---------------------|
| API can receive checkout traffic but cannot reach SQL | Is outbound API-to-private-endpoint TCP `1433` allowed before a broad outbound deny? |
| Worker jobs time out calling the API admin endpoint | Is worker-to-API TCP `8443` allowed, and are both ASG memberships correct? |
| Direct internet traffic reaches the API subnet | Did `Deny-Direct-Internet-To-API` target the right destination and sit before permissive rules? |
| A rule looks correct but nothing changes | Is the NSG associated to the subnet or NIC the packet actually uses? |
| Existing sessions work after a deny change | Are you testing an established flow instead of a new connection? |

Those failures are different, but the reading habit stays the same.
Choose the packet.
Find the checkpoints.
Read priority order.
Inspect ASG membership.
Test the effective decision.

## A Review Habit Before You Change Rules

Before changing an NSG rule, write a short review note.
The note should make the packet visible.
It should also make rollback simple.

Here is a good note for the gateway-to-API rule:

```text
Change request:
  Allow Application Gateway instances to reach orders API backends on HTTPS.

Packet sentence:
  Inbound TCP from 10.30.1.0/24 to asg-orders-api on destination port 443.

Expected association:
  Rule lives on nsg-snet-orders-api-prod.
  API VM NICs are members of asg-orders-api.
  API NICs should not carry separate broad-deny NIC NSGs.

Guardrail:
  Deny direct Internet sources to asg-orders-api after the gateway allow.

Validation:
  az network nic list-effective-nsg for nic-vm-orders-api-01.
  az network watcher test-ip-flow for remote 10.30.1.24:51020 to local 10.30.2.14:443.
  Application Gateway backend health shows the VM healthy.
```

Here is a good note for the API-to-SQL rule:

```text
Change request:
  Allow orders API VMs to reach the SQL private endpoint.

Packet sentence:
  Outbound TCP from asg-orders-api to 10.30.40.7 on destination port 1433.

Expected association:
  Rule lives on nsg-snet-orders-api-prod for outbound API traffic.
  Private endpoint subnet policy allows the matching inbound packet if that subnet is filtered.

Guardrail:
  Keep broad outbound denies after specific dependency allows.

Validation:
  Fresh database connection from an API VM succeeds.
  IP flow verify allows 10.30.2.14:ephemeral to 10.30.40.7:1433.
```

A strong review does not need to be long.
It needs to answer the questions that catch dangerous mistakes:

| Review question | Mistake it catches |
|-----------------|--------------------|
| Who starts the connection? | Writing inbound when the needed packet is outbound |
| What is the destination listener port? | Putting `443` or `1433` in the source port field |
| Which NSG is associated to the packet's subnet or NIC? | Editing an unused NSG |
| Which rule matches first? | Shadowing a specific allow behind a broad deny |
| Which default rule would apply if custom rules did not match? | Forgetting `AllowVNetInBound` or `AllowInternetOutBound` |
| Are ASG members present and in the right VNet? | Relying on a readable target with no matching NICs |
| Is the test a new flow? | Mistaking an established connection for proof of new access |

This habit is the difference between "open it until it works" and packet filtering you can operate.
Broad rules are fast during a lab.
Narrow rules are safer in production, but they require cleaner names, consistent ASG membership, and better evidence.

For `devpolaris-orders-api`, the preferred shape is plain:
subnet NSGs carry the normal tier policy.
ASGs name VM roles where they make the rule clearer.
Specific allows sit before broad denies.
Default rules are reviewed as real fallbacks.
Effective rules and IP flow verify prove the result before the change is called done.

When an NSG review feels confusing, return to the packet sentence.
Where does this new connection start?
Where is it going?
Which destination port is listening?
Which NSGs are on the path?
Which rule is the first match?

Those five questions keep NSG work grounded in packets instead of guesses.

---

**References**

- [Azure network security groups overview](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-groups-overview) - Used for NSG rule fields, custom priority range, first-match behavior, default rules, stateful flow behavior, and the fact that new or updated rules apply to new connections.
- [How network security groups filter network traffic](https://learn.microsoft.com/en-us/azure/virtual-network/network-security-group-how-it-works) - Used for subnet and NIC evaluation order, intra-subnet behavior, and the recommendation to avoid overlapping subnet and NIC NSGs unless there is a clear reason.
- [Application security groups](https://learn.microsoft.com/en-us/azure/virtual-network/application-security-groups) - Used for ASG behavior, NIC membership, same-VNet constraints, and the pattern of placing specific ASG allows before broad denies.
- [Effective security rules overview](https://learn.microsoft.com/en-us/azure/network-watcher/effective-security-rules-overview) - Used for the effective-rule evidence model that aggregates security rules applied to a network interface.
- [IP flow verify overview](https://learn.microsoft.com/en-us/azure/network-watcher/ip-flow-verify-overview) - Used for packet-style allow or deny checks with direction, protocol, local and remote IPs, and ports.
- [Quickstart: Diagnose a virtual machine network traffic filter problem using the Azure CLI](https://learn.microsoft.com/en-us/azure/network-watcher/diagnose-vm-network-traffic-filtering-problem-cli) - Used for the Azure CLI diagnostic examples with `az network watcher test-ip-flow` and `az network nic list-effective-nsg`.
