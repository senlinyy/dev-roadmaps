---
title: "Network Isolation"
description: "Reduce Kubernetes lateral movement with default-deny NetworkPolicies, precise workload selectors, explicit application paths, controlled DNS and egress, and verified rollout."
overview: "Follow a payments API from an open cluster network to minimum viable reachability. Learn policy selection, additive allow rules, ingress and egress independence, namespace and Pod label logic, two-sided database authorization, DNS, IP ranges, safe rollout, debugging, and the limits of L3/L4 policy."
tags: ["network-policy", "kubernetes", "networking", "cni", "firewalls"]
order: 3
id: article-devsecops-kubernetes-security-network-isolation
aliases:
  - network-policies
  - article-devsecops-kubernetes-security-network-policies
  - devsecops/kubernetes-security/network-policies.md
  - devsecops/kubernetes-security/03-network-isolation.md
  - devsecops/kubernetes-security/03-network-isolation
  - kubernetes-security/03-network-isolation
---

## Table of Contents

1. [Why Does Kubernetes Networking Need an Explicit Trust Model?](#why-does-kubernetes-networking-need-an-explicit-trust-model)
2. [How Does NetworkPolicy Select and Isolate Traffic?](#how-does-networkpolicy-select-and-isolate-traffic)
3. [How Do You Establish Default-deny Ingress and Egress?](#how-do-you-establish-default-deny-ingress-and-egress)
4. [How Do Selectors Express the Intended Application Graph?](#how-do-selectors-express-the-intended-application-graph)
5. [How Should DNS, External Egress, and IP Ranges Be Handled?](#how-should-dns-external-egress-and-ip-ranges-be-handled)
6. [How Do You Roll Out and Debug Policy Without Causing an Outage?](#how-do-you-roll-out-and-debug-policy-without-causing-an-outage)
7. [What Security Problems Does NetworkPolicy Not Solve?](#what-security-problems-does-networkpolicy-not-solve)
8. [What Does Minimum Viable Reachability Look Like?](#what-does-minimum-viable-reachability-look-like)
9. [Check Your Answers](#check-your-answers)

Kubernetes networks are commonly open by default at the Pod layer. Pods receive addresses and can often route to other Pods across nodes without application teams creating individual routes. This supports service discovery, rescheduling, and scalable application composition.

That routing model is not a security decision. The ability to deliver a packet answers “can traffic get there?” Authorization answers “should this workload be allowed to communicate with that workload?”

```text
routing       -> technical path exists
authorization -> this source may use this destination and port
```

If every Pod can reach every other Pod, one compromised application gains a large discovery and lateral-movement surface. It can scan databases, internal APIs, metrics endpoints, control-plane services, node-local interfaces, and workloads in other namespaces. Downstream services still need authentication, but broad reach gives an attacker more targets and opportunities.

The security objective is to minimize edges in the communication graph:

```text
frontend -> payments-api -> payments database
                         -> approved external payment endpoint
payments-api -> DNS
```

Keep these questions in view as you work through the lesson:

1. **Why Does Kubernetes Networking Need an Explicit Trust Model?**
2. **How Does NetworkPolicy Select and Isolate Traffic?**
3. **How Do You Establish Default-deny Ingress and Egress?**
4. **How Do Selectors Express the Intended Application Graph?**
5. **How Should DNS, External Egress, and IP Ranges Be Handled?**
6. **How Do You Roll Out and Debug Policy Without Causing an Outage?**
7. **What Security Problems Does NetworkPolicy Not Solve?**
8. **What Does Minimum Viable Reachability Look Like?**

## Why Does Kubernetes Networking Need an Explicit Trust Model?
<!-- section-summary: Kubernetes commonly provides broad Pod routing for application flexibility, but routing is not authorization and a compromised Pod should not inherit ambient reachability to every peer. -->

An unrelated debug Pod should not reach the database merely because it shares a cluster. A namespace name such as `production` should not automatically grant every Pod inside it full connectivity.

Namespaces organize and scope resources, but they are not automatically network zones. Unless policy isolates selected Pods, placing workloads in different namespaces may change names and administrative boundaries without changing packet reachability.

Network isolation matters after compromise. Application authentication and authorization may stop some attacks, but a network boundary removes whole classes of reachable destination. It can also restrict data exfiltration and make unexpected connection attempts visible.

The target is not “no network.” It is minimum necessary communication. Required dependencies must remain reachable for availability. Every allowed edge should have a source identity, destination identity or range, protocol, port, owner, and reason.

Open connectivity is convenient during early development because applications discover dependencies without coordination. The cost appears later: the actual graph is undocumented, security review cannot distinguish required from accidental traffic, and a new workload silently inherits reachability. Network isolation turns those implicit assumptions into versioned application architecture.

The graph should represent direction. “Frontend and payments communicate” is incomplete. The frontend initiates TCP connections to a listening API port; the API does not necessarily initiate connections back. The payments API initiates database sessions; the database should not initiate arbitrary connections to the API. Directional rules reduce both exposure and debugging ambiguity.

Network boundaries also reduce opportunities to exploit weak internal authentication. A database should authenticate clients, but an attacker who cannot reach its port cannot attempt passwords or protocol flaws. Defense in depth is especially useful when one service temporarily has a configuration error.

Do not infer trust from cluster location. Pods from CI jobs, debug namespaces, third-party operators, development tools, and tenant workloads can share the same routed network. A request arriving from a cluster address is not proof that it came from the intended application.

Minimum edges improve incident scope. If runtime inventory shows that a compromised API could reach only its database and payment provider, responders have fewer systems to investigate than in a flat cluster. That benefit depends on verified enforcement and accurate dependency records.

Availability remains part of the model. DNS, health paths, telemetry, and identity services can be critical even though they are not business dependencies. Classify each edge so emergency responders know which are mandatory, optional, or security-sensitive. A narrow graph that omits required infrastructure will be bypassed during the first outage.

## How Does NetworkPolicy Select and Isolate Traffic?
<!-- section-summary: NetworkPolicy is an allow-oriented L3/L4 description enforced by the cluster networking implementation; a Pod is isolated only after a policy selects it, and all matching policies contribute additive allowed traffic. -->

`NetworkPolicy` describes allowed traffic for selected Pods. A compatible networking implementation must enforce it. Creating policy objects in a cluster whose network plugin does not implement the required behavior provides configuration without a boundary.

Standard policy operates mainly at layer 3 and layer 4: source or destination IP-related identity expressed through selectors or ranges, protocol, and port. It does not normally understand HTTP routes, JSON operations, user identity, or database queries.

A policy has two different selector roles:

- `spec.podSelector` selects the Pods to which the policy applies.
- selectors under `from` or `to` select allowed peers.

At least one policy must select a Pod for the Pod to be isolated in that direction. A policy elsewhere in the namespace does not create a namespace-wide firewall automatically.

Kubernetes network policy is allow-oriented. Once isolated for a direction, traffic must be allowed by at least one applicable rule. Policies are additive: the allowed traffic is the union of every policy selecting the Pod.

There is no “last rule wins” order. Adding a second policy cannot subtract an edge allowed by the first. To remove access, find and change every matching allow path.

Ingress and egress are independent. A Pod can be isolated for inbound traffic but have open outbound traffic, or the reverse. Declare both when the threat model requires both.

For Pod-to-Pod traffic, both endpoints may matter. The source Pod's egress policy must allow the connection, and the destination Pod's ingress policy must allow it. An allow on only one side cannot override a denial caused by isolation on the other.

```text
source egress allows
        AND
destination ingress allows
        -> connection permitted
```

Policy is evaluated against labels and namespace selectors, not friendly workload-controller names. Label governance is therefore part of security. A subject able to add an allowed `role=frontend` label to its own Pod can potentially enter a trusted edge unless deployment and label mutation are controlled.

Confirm enforcement through negative tests. Create selected Pods, attempt a denied path, and observe failure. Then test one allowed path. The API accepting a policy object does not prove the data plane applies it.

Policy selection deserves careful inspection. An empty `podSelector` selects every Pod in the policy's namespace, while a selector with labels selects only matching Pods. If no policy selects a Pod for egress, its egress can remain open even beside a default-denied workload. This is why a default-deny object usually uses the empty selector.

`policyTypes` indicates which directions the policy isolates and governs. The presence of ingress or egress rule fields can influence defaults, but explicit direction is easier to review. A policy intended to protect inbound database traffic should not be assumed to restrict the database's outbound connections unless Egress is included.

Additive behavior makes naming and ownership important. Suppose one policy permits frontend access to the API and an old debugging policy permits the whole namespace. The broad debugging rule remains part of the union; adding a narrower rule does not replace it. Effective review must list every selector match and every peer path.

There is no standard explicit deny rule that overrides an allow. Default deny emerges because an isolated Pod has no matching allow for the traffic. If one policy allows a CIDR and another allows a namespace, both are usable. Removing access requires changing or deleting the policy that supplies the edge.

For a connection, source and destination evaluation happens from their respective perspectives. The source might be isolated for egress while the destination remains open for ingress; the source denial still blocks. The reverse is also true. In a fully isolated graph, both sides deliberately authorize the edge, which limits accidental exposure from a change on one endpoint.

Protocol and port are part of the edge. Allowing TCP 5432 to a database does not allow UDP or every destination port. Named ports can follow container port names under supported semantics, but the name must resolve as expected on the selected destination. Numeric ports are clearer when the service contract is fixed.

Labels are authorization inputs even though they look like organization metadata. Protect who can create or patch Pods and controller templates with trusted labels. Admission can restrict sensitive label namespaces or ensure they correspond to workload identity. Otherwise an attacker may not need to change policy; it may only need to make its Pod match an allowed peer.

Verify actual plugin support for ingress, egress, selectors, `ipBlock`, named ports, and policy behavior on each platform. A managed cluster may enable enforcement by default, while another requires choosing a specific CNI mode. Record the enforcement component and version with cluster security evidence.

## How Do You Establish Default-deny Ingress and Egress?
<!-- section-summary: Empty allow lists select workloads while permitting no traffic in a direction, creating a default-deny base to which narrowly scoped additive policies can add required edges. -->

A strong starting pattern is default deny. Select all Pods in the application namespace and allow no ingress:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Ingress
```

The empty selector matches every Pod in that namespace. The absence of ingress allow rules means selected Pods receive no allowed ingress from this policy set unless another additive policy permits it.

Default-deny egress is similar:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-egress
  namespace: payments
spec:
  podSelector: {}
  policyTypes:
    - Egress
```

You can combine both directions:

```yaml
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
```

Default deny removes ambient network authority from new workloads. A newly created Pod in the namespace does not automatically receive the namespace's previous connectivity. Required paths must be declared.

Do not deploy default deny without understanding dependencies. DNS, telemetry, identity endpoints, databases, queues, package or update services, webhooks, and control-plane communication may be required. An immediate policy can create an immediate outage.

Construct the graph before enforcement. Review application configuration, service discovery, traces, flow logs, DNS queries, and owner knowledge. Separate required runtime edges from one-time build access or operator convenience.

Default deny is a base, not the entire policy. Add separate policies named for business edges, such as `allow-ingress-from-frontend` and `allow-egress-to-payments-db`. Small policies make ownership and removal clearer than one large rule list.

New namespaces can invert rollout. If namespace creation automatically applies default deny and a standard infrastructure allow set, every new workload begins narrow. Existing namespaces can migrate gradually. This makes secure behavior the default for future applications.

Protect the base policy and namespace. If application deployers can delete all policies or move a workload into an unrestricted namespace, the boundary is optional. Admission or platform automation can require default-deny coverage.

Default deny can be split into separate ingress and egress objects so rollout and ownership remain clear. Teams may first isolate sensitive databases for ingress, then move application egress after dependencies are known. The final state still needs both directions where the threat model requires them.

Infrastructure allow rules should remain narrow and standardized. DNS may be common to every application namespace; telemetry may be common to one workload class; direct API-server access should be exceptional. Platform-owned templates can supply these edges, while application teams own business dependencies.

Be careful with monitoring-only policy assumptions. Standard NetworkPolicy is an enforcement object, not universally an audit-only rule language. If the platform provides flow observability or policy preview, use it to model effects before adding default deny. Otherwise create a representative test namespace and exercise the graph.

Rollout ordering matters. Applying default deny before its allow policies can interrupt traffic even if the desired final state is correct. Applying broad temporary allows first can reduce outage risk but must not become permanent. Use one controlled deployment, readiness checks, and an explicit cleanup step.

Controller behavior matters after enforcement. A Deployment rolling update introduces new Pods with the same stable identity labels. If policy selectors accidentally include a version label or omit the new template's labels, traffic can split between allowed old replicas and denied new replicas. Test a real rollout, not just one static Pod.

Policy should also cover jobs and maintenance paths. A migration Job may need database access but should not inherit the long-running API's Service Account and every network edge. Give it an explicit short-lived identity and policy, then remove or retain the policy according to the defined maintenance workflow.

Default deny makes undeclared dependency introduction fail visibly. A new library that calls an external telemetry endpoint cannot silently add egress; the application and policy change must be reviewed together. This is a feature of the contract, provided errors and ownership make the failure diagnosable.

## How Do Selectors Express the Intended Application Graph?
<!-- section-summary: Precise combinations of namespace and Pod labels express workload identity; understand AND versus OR structure, and apply two-sided ingress and egress rules for important service edges. -->

`podSelector` selects Pods by labels. In a policy's peer, a `podSelector` by itself normally refers to Pods in the policy's namespace.

`namespaceSelector` selects namespaces by their labels. It does not select a namespace by display name unless a stable label expresses that identity.

Combine namespace and Pod selectors in the same peer to require both:

```yaml
from:
  - namespaceSelector:
      matchLabels:
        access-class: application
    podSelector:
      matchLabels:
        app: frontend
```

That peer means a Pod labeled `app=frontend` inside a namespace labeled `access-class=application`.

Separate list entries mean OR:

```yaml
from:
  - namespaceSelector:
      matchLabels:
        access-class: application
  - podSelector:
      matchLabels:
        app: frontend
```

This allows either every Pod in matching namespaces or matching Pods in the policy namespace. Small YAML indentation differences can change a precise edge into a broad union.

Allow ingress to the payments API from the frontend class:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend-to-payments
  namespace: payments
spec:
  podSelector:
    matchLabels:
      app: payments-api
  policyTypes: ["Ingress"]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              access-class: application
          podSelector:
            matchLabels:
              app: frontend
      ports:
        - protocol: TCP
          port: 8080
```

Allow egress from the API to the database:

```yaml
spec:
  podSelector:
    matchLabels:
      app: payments-api
  policyTypes: ["Egress"]
  egress:
    - to:
        - podSelector:
            matchLabels:
              app: payments-db
      ports:
        - protocol: TCP
          port: 5432
```

The database should have its own ingress policy selecting database Pods and allowing only the payments API identity on port 5432. This two-sided model protects the edge even if one endpoint's policy changes unexpectedly.

Selectors must match actual stored labels. A typo does not select “almost the right Pod.” It may select none, leaving an intended edge denied, or a broad selector may include more than expected. List selected Pods during review and tests.

Use labels as stable workload identity, not mutable release details. A version label can change every rollout and should not usually define the enduring service edge. Keep label assignment under controller and deployment permissions consistent with the trust model.

Namespace labels used in selectors must also be governed. If `access-class=application` grants entry to sensitive services, not every namespace creator should be able to apply that label. Platform automation can set immutable or admission-protected classification based on reviewed namespace purpose.

Review the meaning of `{}` in each location. At top-level `spec.podSelector: {}`, it selects all Pods in the policy namespace. An empty peer selector can be much broader than a reviewer expects. Prefer explicit selectors in allow rules and use empty selectors intentionally for default-deny selection.

Expression-based selectors can match sets of values, but complexity increases review risk. Use a small stable label contract such as application identity, namespace class, and perhaps role. If a rule needs many exclusions and overlapping expressions, reconsider whether the namespace or workload boundary is designed clearly.

Two-sided authorization gives each owner control. The API team declares which callers may enter. The database team declares which clients may connect. The API team also declares its egress. A mistaken broad rule on one side does not automatically open the other side when both are isolated.

The destination Service is not itself the Pod identity in standard peer selection. The policy selects backend Pods and destination ports. A Service can change its selector and send traffic to a different Pod class, so service configuration and network policy should be reviewed together.

Headless Services, direct Pod connections, and controller changes can alter paths while labels remain the key policy input. Record the intended service-to-workload mapping. A policy that appears to protect `payments-db` should be tested against the actual endpoints receiving packets.

Avoid selecting by labels that untrusted processes can influence through an in-cluster controller. If a custom resource lets a tenant choose arbitrary Pod labels, the controller must filter or namespace security-sensitive keys before creating Pods. Authorization extends through automation that assigns identities.

## How Should DNS, External Egress, and IP Ranges Be Handled?
<!-- section-summary: Default-deny egress blocks DNS and external services too, so allow infrastructure narrowly, treat IP ranges and Service translation carefully, and avoid reopening the internet to repair one dependency. -->

Default-deny egress often makes applications fail because DNS disappears. DNS is ordinary network traffic to a resolver; Kubernetes does not exempt it magically.

Allow the actual DNS path narrowly, commonly UDP and TCP port 53 to the cluster's DNS Pods or resolver addresses. The exact selectors depend on how the cluster labels and routes its DNS service.

```yaml
egress:
  - to:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: kube-system
        podSelector:
          matchLabels:
            k8s-app: kube-dns
    ports:
      - protocol: UDP
        port: 53
      - protocol: TCP
        port: 53
```

Do not repair a DNS outage with unrestricted egress. Diagnose whether name lookup, resolver reachability, or the subsequent connection fails. Opening the entire internet hides the distinction and gives a compromised Pod an exfiltration path.

Egress restrictions are valuable because application compromise often leads to callback, download, scanning, or data-exfiltration attempts. Limit external payment-provider or telemetry paths to the smallest practical destination and port set, with a controlled egress gateway when policy needs richer destination governance.

`ipBlock` expresses CIDR ranges:

```yaml
to:
  - ipBlock:
      cidr: 203.0.113.0/24
      except:
        - 203.0.113.128/25
```

IP ranges are useful for external endpoints and infrastructure not selected by Kubernetes labels. They can be brittle if providers change addresses, and one CIDR that contains unrelated services may be too broad.

Service translation can make IP behavior subtle. Depending on networking implementation and traffic path, policy may observe a Service address, Pod endpoint, node address, or translated source. Test the real cluster rather than assuming a conceptual Service IP is the identity every policy engine evaluates.

Core NetworkPolicy does not normally select a Service by DNS name. If external names resolve to changing IPs, standard policy alone may not provide stable domain-based control. An egress proxy, gateway, service mesh, or network implementation extension can complement it.

DNS permission is not destination authorization. A Pod that can resolve a name still needs an allowed connection path. A Pod permitted to reach an IP still needs TLS and application authentication to know which service it is talking to.

DNS also exposes information. Query logs can reveal which services a workload attempts to contact and can provide high-value anomaly signals. Restrict who can read those logs, but use them to compare observed names with the declared graph. A new domain may indicate a feature, dependency drift, or compromise.

Cluster DNS often has several implementation details: a Service address, resolver Pods, node-local caching, and upstream recursion. A policy that selects only central DNS Pods may fail when workloads send queries to a node-local address. Inspect the actual resolver in Pod configuration and test UDP and TCP behavior, including large responses or fallback.

Do not assume permitting DNS makes domain-based egress safe. Once a name resolves, standard NetworkPolicy generally evaluates packet addresses rather than preserving the DNS name as identity. An attacker may resolve an allowed or mutable name to unexpected infrastructure depending on the surrounding controls.

External provider ranges can be large or frequently changing. Copying a broad published CIDR into every application policy may authorize unrelated services. A controlled egress gateway can authenticate workloads, enforce destination or certificate policy, centralize address updates, and produce logs, while NetworkPolicy allows only the gateway edge.

`ipBlock.except` subtracts subranges from one CIDR, but overlapping policies remain additive. An exclusion in one policy does not deny a range allowed by another policy. Compute the union of all applicable egress rules before relying on the exception.

Cloud metadata and node-local endpoints need explicit review. They may use link-local or node addresses and provide workload identity or administrative information. Block access unless the workload identity design requires it, and verify the network implementation actually enforces the intended path.

External callbacks, certificate authorities, time services, package repositories, and update endpoints often appear during incidents as “unexpected but necessary.” Separate build-time dependencies from runtime dependencies. Production application Pods should not need package download access merely because their image was built elsewhere.

## How Do You Roll Out and Debug Policy Without Causing an Outage?
<!-- section-summary: Observe and model dependencies before enforcement, stage default deny and allow rules, test positive and negative paths, and debug direction, selection, both endpoints, DNS, and implementation without deleting all policy. -->

Default deny can create an instant outage when the graph is incomplete. Rollout should be deliberate:

1. Assign workload and namespace labels with owners.
2. Observe current flows and application dependencies.
3. Write narrow allow policies as code.
4. Test selectors and rendered policy in a representative cluster.
5. Apply default deny and required infrastructure edges in a controlled namespace.
6. Test every expected connection and representative forbidden connections.
7. Monitor denials, latency, errors, and policy-engine health.
8. Expand while keeping rollback specific and auditable.

Observability reveals undocumented dependencies, but observed traffic is not automatically required traffic. A compromised or misconfigured workload may already be making unwanted connections. Confirm each edge with application ownership and purpose.

Treat policies as application code. Review them with the service change, version them, test them, and keep ownership. A new dependency requires a policy change. Removing a dependency should remove the edge.

Debug by identifying direction first. Is the failure at source egress, destination ingress, or both? Then prove Pod and namespace identities and labels. List every policy selecting each endpoint and compute the additive allowed set.

Check both endpoints. A correct source egress rule cannot overcome destination isolation. A correct destination ingress rule cannot overcome source egress denial.

Distinguish DNS failures from connection failures. Confirm resolution, then connect to the resolved destination and port. An application-level TLS or authorization error proves the network path may already be open and the problem is higher-layer.

A temporary debugging Pod can test from a controlled source identity. Give it the labels and namespace needed for the case, no broad credentials, and remove it afterward. Do not make it privileged or exempt from all policy merely for convenience.

Do not begin debugging by deleting every NetworkPolicy. That destroys the evidence about which boundary failed and exposes all workloads. Apply a narrow temporary allow with an owner and expiry if availability requires it, then continue diagnosis.

Inspect the network implementation, controller health, and node state. Policy semantics can have implementation-dependent behavior around host traffic, Services, and unsupported features. A correct object with a failed enforcement component is still an outage or security gap.

Start debugging with concrete identities: source Pod name, namespace, labels, IP, and Service Account; destination Pod or external address, namespace, labels, resolved IP, protocol, and port. Vague statements such as “payments cannot reach database” hide which replica, DNS answer, or policy direction failed.

List policies selecting the source for egress and destination for ingress. For each, expand every peer and port. Remember that matching policies form a union, while source and destination permission form an intersection. This arithmetic prevents searching for a nonexistent priority order.

Confirm endpoints behind a Service. A Service with no ready endpoints produces failure unrelated to NetworkPolicy. A changed selector can route to Pods with different labels and ingress rules. Test the Pod IP path only as a diagnostic and return to the intended Service path before concluding success.

Different failure signals suggest different layers. Name-resolution errors point toward DNS. Connection timeouts can indicate policy, routing, or an unresponsive service. Immediate connection refusal usually means the destination is reachable but nothing listens on that port. TLS errors and HTTP denials occur after network reachability and belong to identity or application policy.

Flow logs or plugin diagnostics can show denied tuples, but absence of a log is not proof of allow. Logging may be sampled, disabled, or unsupported. Combine data-plane tests, policy inspection, and enforcement health. Preserve relevant evidence before applying a temporary rule that changes behavior.

Temporary allow policies should select one debugging source and one destination port where possible. Give them a distinct name, owner, expiry, and ticket or incident reference. Monitor their use and delete them after repair. A namespace-wide `0.0.0.0/0` allow is not a neutral diagnostic tool.

Roll back the smallest change. If one new destination rule breaks production, remove or correct that rule rather than deleting default deny. If a plugin upgrade changed enforcement, use the cluster's controlled rollback path. Broad rollback loses both security and the ability to understand the fault.

After repair, rerun negative connectivity tests. Restoring the required database path can accidentally open every Pod in the namespace if a selector or list entry changed. Functional recovery alone does not prove containment.

## What Security Problems Does NetworkPolicy Not Solve?
<!-- section-summary: NetworkPolicy does not provide HTTP authorization, TLS identity, Kubernetes RBAC, Pod hardening, complete internet governance, or absolute tenant isolation; it must complement those controls. -->

Standard NetworkPolicy is not an HTTP firewall. It can allow TCP port 8080 but cannot normally distinguish `GET /health` from `POST /refund`, inspect a user token, or limit a database query. Application authorization or a suitable proxy must enforce higher-layer intent.

It does not provide TLS identity. A label-selected network path permits packets to a destination, but the application still needs encrypted transport and authenticated peers where the threat model requires them.

It does not replace RBAC. NetworkPolicy controls packet reachability; Kubernetes RBAC controls API requests. A Service Account with broad permission can remain dangerous even if application egress is narrow, especially if it can reach the API server.

It does not replace Pod hardening. A non-root, read-only, capability-dropped container is harder to use after compromise. A network-isolated privileged Pod may still threaten its node.

It may not be sufficient for internet egress governance. Standard selectors are centered on Kubernetes identities and IP ranges, not rich domain, certificate, organization, or application-layer policy. Use controlled egress infrastructure when those properties matter.

Enforcement is implementation-dependent at some edges. Host-networked Pods, node-originated traffic, Service translation, and traffic entering through different paths need testing with the chosen network plugin and cluster architecture.

Nodes can be a special reachability case. A Pod may need or receive connectivity to its node for health or platform functions depending on implementation. NetworkPolicy is not a complete host firewall.

Namespaces and network policy are only one layer of multi-tenancy. Tenants can still share nodes, kernel, control plane, storage, and cluster-scoped resources. Strong isolation may need separate clusters, nodes, runtimes, or additional policy.

Network policy does not replace service authorization. A permitted caller can be compromised. The database should still authenticate the payments API and limit its operations. NetworkPolicy reduces reachable edges; it does not make every allowed source trustworthy forever.

Standard policy also does not explain all traffic observed on the node. Health checks, node agents, host-networked components, proxies, and service translation can originate or terminate traffic outside ordinary Pod-to-Pod evaluation. Document which platform paths are exempt or handled by host firewall and provider controls.

Host-networked Pods can share the node's address and bypass assumptions based on Pod identity. Keep them in privileged workload classes with separate nodes or controls where possible. An ordinary application should not request host networking to work around one policy or port issue.

Policies do not encrypt data. A permitted connection can still carry plaintext credentials or sensitive records through infrastructure visible to other actors in the threat model. Use TLS and validate the expected service identity. A service mesh can help with workload identity and encryption, but its control plane and sidecars become part of the trust model.

Policies do not rate-limit or protect application availability by themselves. One allowed frontend can flood the payments API, and the API can overload its allowed database. Use application limits, queues, resource boundaries, and downstream protections on authorized edges.

Policies cannot infer whether a process inside an allowed Pod is legitimate. If an attacker controls the payments container, traffic still originates from the selected Pod identity. Narrow database authorization, short-lived credentials, runtime detection, and request validation constrain what the attacker can do through the unavoidable edge.

NetworkPolicy does not prove namespace ownership. A namespace selector trusts labels, so RBAC and admission must control who can create or label namespaces. The networking rule depends on control-plane authorization for its identity inputs.

Multi-cluster and hybrid paths require controls beyond one cluster's policy. Traffic leaving through a gateway, peering network, load balancer, or service mesh crosses enforcement domains. Preserve source identity and apply equivalent destination authorization rather than assuming the originating policy follows the packet.

## What Does Minimum Viable Reachability Look Like?
<!-- section-summary: Minimum viable reachability gives each workload only its explicit dependencies, proves required and forbidden paths, and combines network containment with identity, Pod, Secret, artifact, and detection controls. -->

Apply the compromised-Pod thought experiment across four authorities:

- **Local authority:** what files, processes, syscalls, capabilities, and node interfaces can the process use?
- **Kubernetes authority:** which API calls can its Service Account make?
- **Secret authority:** which external systems do mounted values authorize?
- **Network authority:** which destinations and ports can it reach?

A weak architecture gives a writable root process, a shared Service Account, broad Secrets, and open cluster networking. Compromise can discover peers, retrieve more credentials, and move laterally.

A stronger architecture gives a non-root read-only process, no unnecessary API token, one narrow database identity, and this graph:

```text
approved frontend
  -> payments-api:8080
      -> payments-db:5432
      -> cluster DNS:53
      -> approved payment egress

everything else denied
```

The unavoidable limit is that the payments API must reach its actual dependencies. If compromised, it can attempt actions those dependencies permit. Network isolation minimizes reachability; downstream authentication and authorization minimize authority on the remaining edges.

Network baselines also improve detection. If the service normally reaches three destinations, an attempt to scan another namespace or contact a new internet address is meaningful. Logs that include source workload, destination, port, policy, node, and time can turn denied behavior into security evidence.

DevSecOps makes the network contract automatic. CI can validate selectors and policy shape. Cluster tests can deploy representative workloads and probe positive and negative paths. Admission can require default-deny coverage or approved policy classes. Runtime monitoring can compare observed flows with the declared graph.

Seven invariants summarize the model:

1. Namespace placement does not imply network trust.
2. New workloads do not receive ambient reachability.
3. Only stated application dependencies are reachable.
4. Database exposure matches the application design on both sides.
5. One compromised Pod does not automatically gain lateral access.
6. DNS and required infrastructure remain reachable through narrow rules.
7. Policy changes are tested so security does not silently destroy availability.

The important distinctions are:

```text
routing is not authorization
ingress is independent from egress
policy selection is separate from peer selection
multiple policies are additive, not ordered
network identity is not application identity
```

The final model is:

```text
network isolation
  = default-deny selected workloads
  + explicit additive application edges
  + precise label and namespace identity
  + two-sided ingress and egress authorization
  + narrow DNS and external paths
  + safe rollout and negative testing
  + higher-layer identity and authorization
  + observable denied behavior
```

Test the invariants as executable connectivity cases. From an approved frontend, the API port should succeed and unrelated ports should fail. From an untrusted Pod, the API and database should fail. From the API, DNS and database should succeed, an unrelated internal service and arbitrary internet address should fail, and the database should reject traffic from every other class.

Repeat the suite during rollout and platform change. A new CNI version, Service implementation, node-local DNS feature, ingress controller, service mesh, or label template can alter traffic paths. Store the plugin and policy versions with results so later behavior can be compared meaningfully.

Map every production flow to an owner. The frontend team owns its egress request; the payments team owns API ingress and database egress; the database owner controls database ingress; the platform team owns DNS and enforcement. Shared responsibility becomes concrete at the edge rather than an abstract promise.

Review edges on removal as well as addition. Decommissioned services, migrations, temporary incident routes, and old namespace labels often leave stale allows. A future workload that reuses an otherwise dormant label can make its old policy dangerous. Delete obsolete rules and reserve security-sensitive labels.

Measure network-authority drift: namespaces without default deny, Pods selected by no policy, broad selectors, all-address egress, newly reachable destinations, policies without owners, expired debug rules, and denied traffic spikes. Metrics guide review but do not replace positive and negative path tests.

When a denied attempt occurs, ask whether it was a missing declared dependency or behavior that should never occur. Fixing every denial by adding an allow teaches the cluster to mirror accidental traffic. Keeping every denial without investigation can hide an outage. Ownership and application context turn the signal into a decision.

The deepest idea is that reachability is a form of authority. A process cannot exploit, authenticate to, or exfiltrate directly through a destination it cannot reach. Network isolation does not solve every control at the destination, but it reduces the number of systems that must withstand a compromised source.

Minimum viable reachability is maintained state, not a one-time firewall project. Application releases, scaling, namespace changes, external providers, DNS design, and platform upgrades can change the graph. Keep policy beside the workload, verify it in the real data plane, and use observed deviations to update either architecture or enforcement deliberately.

## Check Your Answers

:::expand[Why Does Kubernetes Networking Need an Explicit Trust Model?]{kind="recap"}
Kubernetes routing commonly connects Pods broadly, but reachability is not authorization and a compromised workload should receive only the application edges it needs.
:::

:::expand[How Does NetworkPolicy Select and Isolate Traffic?]{kind="recap"}
NetworkPolicy is an allow-oriented L3/L4 model enforced by the network plugin; isolation begins only when selected, and matching policies add their allowed traffic together.
:::

:::expand[How Do You Establish Default-deny Ingress and Egress?]{kind="recap"}
Select workloads with empty allow lists for each direction, then add small named policies for required infrastructure and business edges without restoring ambient access.
:::

:::expand[How Do Selectors Express the Intended Application Graph?]{kind="recap"}
Pod and namespace labels express workload peers; combined selectors mean AND, separate peers mean OR, and sensitive connections should be allowed by both source egress and destination ingress.
:::

:::expand[How Should DNS, External Egress, and IP Ranges Be Handled?]{kind="recap"}
DNS and external destinations are ordinary egress that must be allowed narrowly, while IP translation and changing ranges require implementation-aware testing and sometimes an egress gateway.
:::

:::expand[How Do You Roll Out and Debug Policy Without Causing an Outage?]{kind="recap"}
Model and observe dependencies first, stage enforcement, test required and forbidden paths, and debug selection, direction, both endpoints, DNS, and plugin behavior without deleting every policy.
:::

:::expand[What Security Problems Does NetworkPolicy Not Solve?]{kind="recap"}
L3/L4 policy does not supply HTTP authorization, TLS identity, RBAC, Pod hardening, complete egress governance, host filtering, or absolute multi-tenant isolation.
:::

:::expand[What Does Minimum Viable Reachability Look Like?]{kind="recap"}
Give each workload only its explicit service graph, prove positive and negative connectivity, and combine network containment with narrow local, Kubernetes, Secret, and downstream authority.
:::
