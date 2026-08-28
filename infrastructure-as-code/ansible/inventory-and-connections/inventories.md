---
title: "Inventories"
description: "Understand Ansible inventory as the host map that separates names, addresses, and groups."
overview: "Inventory is the map Ansible reads before it can run work on any machine."
tags: ["ansible", "inventory", "hosts", "groups"]
order: 1
id: article-infrastructure-as-code-ansible-inventories-and-connection-targets
aliases:
  - inventories-and-connection-targets
  - infrastructure-as-code/ansible/inventories-and-connection-targets.md
---

## Table of Contents

1. [What Problem Does Inventory Solve?](#what-problem-does-inventory-solve)
2. [How Do Names and Connection Addresses Differ?](#how-do-names-and-connection-addresses-differ)
3. [How Do Groups Create Useful Target Sets?](#how-do-groups-create-useful-target-sets)
4. [When Should Inventory Be Static?](#when-should-inventory-be-static)
5. [How Does Dynamic Inventory Work?](#how-does-dynamic-inventory-work)
6. [How Do You Inspect Loaded Inventory?](#how-do-you-inspect-loaded-inventory)
7. [How Does Inventory Protect a Real Run?](#how-does-inventory-protect-a-real-run)
8. [What Makes Inventory Maintainable?](#what-makes-inventory-maintainable)
9. [Check Your Answers](#check-your-answers)

An **inventory** is the list of machines Ansible knows about, plus the groups and connection details that describe those machines. Before Ansible can install a package, restart a service, or render a config file, it needs a clear answer to a simple question: which managed nodes are in scope for this work?

In daily production work, inventory acts as the shared map between people and automation. Operators talk about `prod_web`, the deployment pipeline runs against `application_workers`, and an incident note names `application-web-02` as the first host to check. Those names only stay useful when the inventory has a careful shape.

Inventory also sets up the rest of the Ansible workflow. **Patterns** choose hosts from inventory, **limits** narrow a run, **group variables** describe shared values, and **host variables** describe one-machine exceptions. If the host map is hard to read, every later playbook command carries extra risk.

The first-principles problem is a separation problem. A playbook should describe a reusable procedure such as “configure the web service.” The changing topology—today's hosts, their addresses, their environments, and their roles—belongs elsewhere. Hard-coding addresses in the playbook couples procedure to one moment in the fleet and forces code edits as membership changes.

Keep these questions in view as you work through the lesson:

1. **What Problem Does Inventory Solve?**
2. **How Do Names and Connection Addresses Differ?**
3. **How Do Groups Create Useful Target Sets?**
4. **When Should Inventory Be Static?**
5. **How Does Dynamic Inventory Work?**
6. **How Do You Inspect Loaded Inventory?**
7. **How Does Inventory Protect a Real Run?**
8. **What Makes Inventory Maintainable?**

## What Problem Does Inventory Solve?
<!-- section-summary: Inventory is the host map Ansible uses before it can choose targets, connect, and run tasks. -->

```text
playbook = procedure
inventory = topology and execution context
```

You can think of inventory as a small queryable database. Each host record has an Ansible identity, connection details, group memberships, and variables. Groups create indexes over those records. A play's `hosts:` pattern queries that database, and `--limit` intersects the result with another query. This is why inventory is more than an SSH address book.

Ansible handles inventory in two conceptual phases. First it **loads** one or more inventory sources, expands plugins, merges groups and variables, and builds a graph. Then it **selects** a target set from that graph using the play pattern and any command-line limit. A valid source can still lead to the wrong run if the selection expression is wrong; a correct pattern can still lead to the wrong run if Ansible loaded the wrong source.

A useful inventory should answer four questions without requiring a playbook reader to guess:

1. **Identity:** What stable name does Ansible and the operations team use for this managed node?
2. **Reachability:** Which address, port, user, transport, and interpreter let Ansible reach it?
3. **Classification:** Which roles, environments, regions, platforms, or rollout cohorts contain it?
4. **Context:** Which non-secret values apply to that host through group and host data?

Inventory is related to DNS and a configuration-management database, but it is not identical to either. DNS maps names to network locations. A CMDB may model ownership, lifecycle, hardware, and applications. Inventory adapts the subset of identity, reachability, classification, and context that Ansible needs for execution. A plugin may read a CMDB or cloud API, but the compiled inventory is still Ansible's execution model.

### A small application platform fleet
<!-- section-summary: A small production fleet gives the inventory examples a concrete shape. -->

Let's use a small application platform as the running example. The platform has two production web servers, one production worker, one read-only reporting host, and a matching staging environment. The names are boring on purpose because production names should help humans move quickly during a deployment or an incident.

The team wants one playbook that can configure all web servers, another that can configure workers, and a shared baseline playbook for users, time sync, log shipping, and security packages. Nobody wants to copy host lists into every playbook because copied lists drift after the first rebuild or scaling event.

The inventory gives the fleet stable automation names. The web playbook can target `prod_web`, the baseline playbook can target `prod`, and a first production run can narrow to `application-web-01`. That shape lets people say what they mean without editing task files every time the host list changes.

This separation pays off as the fleet changes. Replacing a failed instance should update topology, not fork the application procedure. Adding a reporting tier should add a meaningful group rather than duplicate a baseline play. Moving staging to new addresses should not require editing every task that applies to staging.

Inventory is not limited to conventional servers. A managed node can be a network device, container endpoint, virtual machine, appliance, or a logical API target supported by a connection plugin. `localhost` can also participate when work intentionally runs on the controller. The common requirement is that inventory gives Ansible an identity and enough context to select and reach the target.

## How Do Names and Connection Addresses Differ?
<!-- section-summary: The inventory name is the stable Ansible name, while ansible_host is the address Ansible connects to. -->

An inventory host has an **inventory name**. That name is what Ansible shows in play output, what templates can read as `inventory_hostname`, and what operators usually put in runbooks. The inventory name can stay stable even when the IP address or DNS record changes.


![Inventory Name Address Group Map](/content-assets/articles/article-infrastructure-as-code-ansible-inventories-and-connection-targets/inventory-name-address-group-map.png)

*The inventory map separates stable Ansible names, connection addresses, groups, children, slices, and host variables so target selection feels less abstract.*

The actual network target lives in `ansible_host`. This variable tells Ansible where to connect for that inventory name. For a rebuilt instance, the team can update `ansible_host` and keep the meaningful name `application-web-01`.

```yaml
all:
  children:
    prod_web:
      hosts:
        application-web-01:
          ansible_host: 10.42.10.11
        application-web-02:
          ansible_host: 10.42.10.12
    prod_workers:
      hosts:
        application-worker-01:
          ansible_host: application-worker-01.internal.example.com
    prod_reporting:
      hosts:
        application-report-01:
          ansible_host: 10.42.30.21
```

This separation matters in real operations. Logs and deployment notes can keep using `application-web-01`, while the private IP can change after an instance replacement. The playbook output stays readable because Ansible reports the inventory name instead of asking every human to remember which IP belonged to which server yesterday.

Connection variables can appear beside the host when they describe how to reach that host. A legacy reporting server might use a different SSH port, and an older image might need a specific Python interpreter path. Keep those connection facts close to the host, then move shared values into group files when several hosts need the same setting.

```yaml
prod_reporting:
  hosts:
    application-report-01:
      ansible_host: 10.42.30.21
      ansible_port: 2222
      ansible_python_interpreter: /usr/bin/python3
```

The distinction between identity and address is deliberate. An inventory name may encode a stable operational role—`application-web-01`—while `ansible_host` points to a private IP that changes after replacement. That stable name becomes the key for `host_vars`, `hostvars`, cached facts, output, and references from other hosts. Renaming it is therefore more consequential than changing the connection address.

A host alias also creates a separate Ansible identity. If the same machine appears twice under two inventory names, Ansible can treat it as two hosts, run tasks twice, and maintain two variable contexts. Aliases are sometimes intentional, but they should not be used casually as alternate spellings for one server. Prefer one stable identity with a changing `ansible_host`.

Connection variables include more than addresses:

```yaml
application-report-01:
  ansible_host: 10.42.30.21
  ansible_user: automation
  ansible_port: 2222
  ansible_connection: ssh
  ansible_python_interpreter: /usr/bin/python3
```

These values tell Ansible how to execute. They are not task instructions. `ansible_user` can also override a `remote_user` play keyword or ordinary CLI choice, which is why unexpected connection behavior should be debugged from the resolved host data rather than the command alone.

Do not turn inventory into a password file. A username, private address, or interpreter path is ordinary connection context; a password, private key, privilege-escalation password, or cloud credential needs an approved credential store, Ansible Vault, or controller secret mechanism. Inventory must be shareable enough to review targeting without exposing the credentials that make targeting possible.

Inventory names should usually remain stable across rebuilds. They are an operational naming system used by deployment logs, incident notes, limits, host-specific variables, and sometimes monitoring. A good name answers “which managed role is this?” while the address answers “where can Ansible reach it now?” Keeping those questions separate reduces the blast radius of routine infrastructure replacement.

## How Do Groups Create Useful Target Sets?
<!-- section-summary: Groups let the same inventory support role-based, environment-based, and rollout-based targeting. -->

A **group** is a named set of hosts. Groups let a playbook say `hosts: prod_web` instead of listing every web server by hand. A host can belong to several groups, which lets the same server be selected by role, environment, region, or operating system.

Child groups let a larger group contain smaller groups. For the application platform, `prod` can contain `prod_web`, `prod_workers`, and `prod_reporting`. The staging environment can follow the same shape, so playbooks and deployment jobs use consistent names across environments.

```yaml
all:
  children:
    prod:
      children:
        prod_web:
          hosts:
            application-web-01:
              ansible_host: 10.42.10.11
            application-web-02:
              ansible_host: 10.42.10.12
        prod_workers:
          hosts:
            application-worker-01:
              ansible_host: 10.42.20.11
        prod_reporting:
          hosts:
            application-report-01:
              ansible_host: 10.42.30.21
    staging:
      children:
        staging_web:
          hosts:
            application-stg-web-01:
              ansible_host: 10.52.10.11
        staging_workers:
          hosts:
            application-stg-worker-01:
              ansible_host: 10.52.20.11
```

This structure gives the team several clean target shapes. A baseline hardening play can target `prod`, a web deploy can target `prod_web`, and a staging smoke test can target `staging_web`. The playbook describes the kind of work, while the inventory carries the current fleet shape.

It also makes production review easier. When a pull request adds `application-web-03` under `prod_web`, reviewers can see that the new host will receive every play that targets production web servers. The host joined the automation boundary through one visible inventory change.

Groups answer “what kind of target is this?” A host can simultaneously belong to `web`, `prod`, `eu_west`, `ubuntu`, and `canary`. Those memberships are not contradictory because each group represents a different dimension. They let playbooks express intent: a web configuration targets `web`, production monitoring targets `prod`, and an operating-system-specific task can target or condition on `ubuntu`.

Parent and child groups describe set inclusion. If `prod` contains `prod_web` and `prod_workers`, every host in either child is also a member of `prod`. Children do not declare execution order. Ansible groups are sets, not a workflow graph; ordering belongs in plays, roles, tasks, and rollout controls.

Two special groups always help define the graph. `all` contains every inventory host. `ungrouped` contains hosts that are not members of another user-defined group besides `all`. A growing `ungrouped` set is often a useful review signal: those hosts may lack the classification that lets normal playbooks reach them intentionally.

Patterns turn the group graph into a query language. Examples include:

```text
prod_web                  all production web hosts
prod:&web                 intersection of prod and web
prod:!reporting           production except reporting
web[0]                    one host from the ordered web pattern result
application-web-01        one inventory identity
```

The set-theory model is helpful. If `P` is the set of production hosts and `W` is the set of web hosts, `prod:&web` selects `P ∩ W`. `prod:!reporting` selects `P` minus the reporting set. A command-line `--limit canary` intersects the play's result with the canary set rather than replacing the play's safety boundary.

For example:

```text
play pattern: prod:&web
loaded result: {web01, web02, web03}
limit: canary
effective result: {web01}
```

This two-stage selection is why `--limit` is safe only after the underlying play pattern is safe. A limit can narrow a target set; it should not be treated as the sole mechanism preventing a broadly written play from reaching the wrong environment.

Groups can also carry variables, while individual hosts can carry exceptions. The usual inheritance model moves from broad to specific:

```text
all → parent group → child group → host
```

Ansible eventually flattens inventory variables into a host context. A `prod` group might define a log-retention policy, `prod_web` might define the application port, and one canary host might temporarily override a feature flag. These values are inputs to reusable automation, not instructions about which tasks should exist.

Choose group dimensions deliberately. Environment, service role, region, platform, and rollout cohort often answer useful operational questions. A random tag soup—groups for temporary tickets, individual commands, historical owners, and overlapping spellings—makes patterns hard to predict. Before adding a dimension, ask which stable query or policy it enables.

Useful slices should emerge naturally. An operator should be able to ask for all production web servers, one region's workers, a canary cohort, or a staging environment without maintaining duplicated host lists. If the same host set must be copied into several groups by hand, the model may be missing a stable dimension or a parent-child relationship.

Host-level variables and group-level variables solve a related context problem. Suppose all web hosts use the same service port, while one migration canary temporarily uses another:

```yaml
all:
  children:
    web:
      vars:
        application_port: 443
      hosts:
        application-web-01:
        application-web-02:
        application-web-canary:
          application_port: 8443
```

The group value states the normal rule and the host value states a specific exception. The variable does not tell Ansible to render a file or restart a service; tasks and roles decide how to consume it. This prevents inventory from turning into an alternate playbook language.

Group variables work best when group membership and policy mean the same thing. If `prod` defines production endpoints, every host in `prod` inherits those inputs. A mistaken membership is therefore not only a targeting error—it can also be a configuration error. Reviewing the graph and resolved host variables together reveals both effects.

Pattern operators are easiest to reason about when written from a safe broad set toward a narrow result. `prod:&web:&canary` reads as production intersected with web intersected with canary. Exclusions such as `prod:!retired` can be useful, but they should not substitute for removing a retired host from normal deployment groups. Negative selection assumes the excluded classification is always correct.

Hosts can also be selected by explicit comma-separated names for a controlled exceptional run. Before doing so, remember that a trailing comma can make a CLI value behave as an inline host list rather than a reference to an inventory source. For routine operations, named inventory groups and verified limits provide a more reviewable path than ad hoc address lists.

The `all` and `ungrouped` groups provide useful invariants. A baseline play aimed at `all` really does span every loaded host, including new plugin results. A play aimed at `ungrouped` can reveal unmanaged classification gaps, but production automation should generally classify hosts deliberately rather than treating `ungrouped` as a durable application tier.

The central rule is that membership should answer operational questions naturally. “Which hosts run the web tier?”, “which are production?”, “which can receive the canary first?”, and “which use a given platform?” are useful. “Which hosts did someone happen to type into last Tuesday's command?” is not stable inventory information.

## When Should Inventory Be Static?
<!-- section-summary: Static inventory works well when the host list is small, stable, and worth reviewing in version control. -->

A **static inventory** is written as files in the automation project. It works well for small fleets, lab environments, stable bare-metal servers, and production systems where each host addition should go through code review. YAML inventory is usually easier to maintain than INI once groups, children, and host-level variables grow.

For a small application fleet, the reviewed file might live at `inventories/prod/hosts.yml`. The pull request that adds `application-web-03` shows both the host name and the group it joins. Reviewers can ask whether the host should receive every `prod_web` play, whether its `ansible_host` points to the right private address, and whether it needs a temporary canary group before it joins the normal rollout group.

A practical project layout often keeps one inventory directory per environment. The `hosts.yml` file describes membership, while `group_vars` and `host_vars` hold values that the next article covers in detail.

```yaml
inventories/
  staging/
    hosts.yml
    group_vars/
    host_vars/
  prod/
    hosts.yml
    group_vars/
    host_vars/
```

This layout gives reviewers quick answers. The path says which environment changed, `hosts.yml` says which machines changed, and the variable directories say which values changed. In a small team, that clarity matters more than clever inventory generation.

Static inventory also has a simple rollback story. If a host was added to the wrong group, revert the inventory commit and inspect the graph again before launching another playbook. The inventory change itself usually leaves servers untouched; the risk comes from running automation against the wrong target set after the bad map is loaded.

Static inventory is infrastructure data in source control. Its strengths come from visibility: a reviewer sees an identity, address, group membership, and deliberate exception in one change. Git history shows when the model changed and why. The source does not need a cloud API or live credential merely to answer which hosts the repository expects.

The same strengths define its limits. Humans must add, remove, and update entries. In an autoscaled fleet, the file can become stale between commit and run. A replaced instance can leave an old address behind, while a newly created instance may receive no automation until someone updates the repository. Static inventory is safest when membership changes slowly enough that review can remain the source of truth.

Inventory sources can be combined. A project may keep stable network appliances and bare-metal databases in static YAML while discovering ephemeral application instances through a cloud plugin. The compiled graph is what matters, so inspect collisions, shared group names, and precedence when multiple sources contribute hosts or variables.

A fuller static source can keep membership and connection context readable while moving policy into variable files:

```yaml
all:
  children:
    prod:
      children:
        web:
          hosts:
            application-web-01:
              ansible_host: 10.42.10.11
            application-web-02:
              ansible_host: 10.42.10.12
        workers:
          hosts:
            application-worker-01:
              ansible_host: 10.42.20.11
      vars:
        environment_name: production
```

The file says which nodes exist and how they are classified. `group_vars/prod.yml` can then hold environment policy, while `host_vars/application-web-01.yml` stays reserved for a real host exception. This keeps topology review separate from large configuration documents.

## How Does Dynamic Inventory Work?
<!-- section-summary: Dynamic inventory builds the host map from a source such as a cloud API, usually using tags or metadata. -->

A **dynamic inventory** is generated by a plugin or script from another system. Cloud fleets often need this because instances can be replaced by autoscaling, image refreshes, blue-green deployments, or disaster recovery work. The host map should follow the live infrastructure as the provisioning system changes it.


![Static Dynamic Inventory Flow](/content-assets/articles/article-infrastructure-as-code-ansible-inventories-and-connection-targets/static-dynamic-inventory-flow.png)

*The source flow shows static files and cloud metadata both becoming a reviewable inventory graph before a playbook run touches hosts.*

In AWS, the `amazon.aws.aws_ec2` inventory plugin can query EC2 and build groups from instance tags. The application team might tag instances with `App=application`, `Environment=prod`, and `Tier=web`, then let the plugin create groups from those tags.

```yaml
plugin: amazon.aws.aws_ec2
regions:
  - us-east-1
filters:
  tag:App: application
  instance-state-name: running
hostnames:
  - tag:Name
compose:
  ansible_host: private_ip_address
keyed_groups:
  - key: tags.Environment
    prefix: env
  - key: tags.Tier
    prefix: tier
```

With that configuration, a host tagged `Environment=prod` and `Tier=web` can appear in groups like `env_prod` and `tier_web`. The playbook can target a stable group expression while the plugin refreshes which instances currently match the cloud metadata.

Dynamic inventory moves the review point from a host list to the plugin configuration and the resource tags. That is a real production tradeoff. If a new instance has the wrong tag, Ansible can place it in the wrong group, so teams usually protect tags through infrastructure code, cloud policy, deployment checks, or a review step in the provisioning pipeline.

The plugin setup also needs a normal dependency path. The repo can pin the collection in `requirements.yml`, the CI job can run `ansible-galaxy collection install -r requirements.yml`, and the inventory plugin file can stay in source control beside the static inventory. Cloud credentials should come from the runner or controller credential system, not from values committed next to inventory. When hosts appear or disappear quickly, the runbook should include an inventory refresh step so cached inventory does not send a playbook toward retired hosts.

An inventory plugin is an adapter between an external source and Ansible's host graph. It authenticates, queries records, filters them, chooses host identities and addresses, composes variables, and turns metadata into groups. The result still behaves like inventory: plays select groups, host variables resolve, and `ansible-inventory` can display the compiled view.

Dynamic inventory prevents two systems from independently claiming to be the live host list. If infrastructure provisioning already owns instance lifecycle and tags, copying every instance into YAML creates a second source that can lag. A plugin can ask the authoritative API immediately before execution. This is especially useful for autoscaling, image rotations, blue-green pools, and short-lived workers.

The tradeoff is that correctness now depends on more moving parts. Credentials can expire, APIs can throttle, a region filter can omit hosts, cache data can go stale, and tags can be misspelled. Changing a display name can also alter an identity expression. A successful plugin query is not proof that its selection model is safe.

Dynamic metadata should therefore be filtered deliberately. A broad query for every running instance in an account is rarely a sufficient production boundary. Filter by the application, environment, account or project, and lifecycle state that the automation actually supports. Then use `keyed_groups` to create stable dimensions from reviewed metadata.

Tags can model lifecycle states such as `canary`, `active`, `draining`, or `retired`, but only when the provisioning and deployment workflows own those transitions consistently. A temporary free-form label should not silently become the only guard around a destructive play. Cloud policy and infrastructure code can help protect the tags that determine Ansible membership.

Static and dynamic inventory solve different change rates and can coexist. A static source offers explicit review for durable nodes. A dynamic source follows a fast-changing control plane. Both must converge into one understandable graph, and both need a stable naming rule so a host does not appear under surprising or duplicate identities.

Dynamic inventory also shifts the rollback question. Reverting the plugin configuration may restore an earlier query, but it does not undo a cloud tag or bring a terminated instance back. Treat plugin code, infrastructure metadata, credentials, and cache behavior as one operational system. When a target set is wrong, fix the upstream source first and inspect the refreshed graph before rerunning automation.

The plugin's `hostnames` choice deserves special care. A mutable display tag may be readable but can rename Ansible's identity when an operator edits the tag. A provider instance ID is stable across tag changes but less friendly in output. Teams can choose either model, but they should understand how the choice affects `host_vars`, fact caches, limits, logs, and duplicate detection. The connection address can remain independently composed from a private address.

Composed groups should also avoid accidental characters or unstable values. Normalize the environment and tier metadata that form group names, document the resulting prefixes, and test the graph in CI. If a missing tag sends a host to no useful group, decide whether the plugin should exclude it, place it in a quarantine group, or make validation fail. Silent partial classification is dangerous because the host exists but may miss baseline policy.

Inventory refresh timing forms part of rollout design. A job that discovers hosts once and then spends an hour deploying may operate on an outdated snapshot as autoscaling replaces instances. A job that refreshes between every task can change the target population mid-rollout. Choose a deliberate boundary: capture and review the target set for one rollout, then start a new run when membership materially changes.

When an API is temporarily unavailable, failing closed is usually safer than falling back to a surprising empty or cached production set. Operators need to know whether the graph is current, cached, or incomplete. Make that state visible in controller logs and deployment approvals.

## How Do You Inspect Loaded Inventory?
<!-- section-summary: ansible-inventory shows the compiled host map after inventory files, plugins, and variable sources have loaded. -->

Ansible compiles inventory before it runs a command or playbook. The compiled view includes inventory sources, groups, child groups, host variables, group variables, and plugin output. That compiled view is the one to trust because it shows what Ansible will actually use.

For a visual group graph, run:

```bash
ansible-inventory -i inventories/prod --graph
```

For the full inventory in JSON, run:

```bash
ansible-inventory -i inventories/prod --list
```

For one host's final variables, run:

```bash
ansible-inventory -i inventories/prod --host application-web-01
```

These commands are the first verification step after changing inventory. If `application-web-03` should be in `prod_web`, the graph should show it there. If Ansible should connect to `10.42.10.13`, the host output should show that value before a playbook tries to use it.

The compiled view also helps with common failures. An empty graph usually means the wrong inventory path was selected or a plugin failed to parse. A host in the wrong group usually points to a YAML indentation issue, a copied host entry, or a cloud tag problem. A strange SSH target often shows up as an unexpected `ansible_host`, `ansible_port`, or `ansible_user` value.

For dynamic inventory, add the plugin source to the same inspection habit:

```bash
ansible-inventory -i inventories/prod/aws_ec2.yml --list --yaml
ansible-inventory -i inventories/prod/aws_ec2.yml --graph env_prod
```

If a host is missing, fix the tag, filter, credential, or region before running the playbook. If a retired host still appears, refresh the inventory cache or check the cloud source before trusting the target list.

Never assume Ansible loaded the source you intended. A default inventory configured in `ansible.cfg`, an environment variable, a repository directory, and an explicit `-i` option can lead different shells or CI jobs to different graphs. Make the inventory source visible in commands and pipeline logs, especially where staging and production have similar group names.

`--graph` answers membership questions: which parents, children, and hosts were loaded? `--list` answers structural questions across the complete compiled inventory. `--host` answers context questions for one identity after inventory variables have been processed. Use the view that matches the uncertainty rather than reading source YAML and mentally simulating every merge.

Resolved values matter because a host may inherit from `all`, several groups, a child group, and its own host file. When a connection goes to the wrong user or a template receives the wrong environment name, inspect the host output that Ansible computed. Source files show candidates; the compiled host view shows the effective context.

Multiple inventory sources make inspection even more important. If two sources define the same inventory identity, their data can merge in ways that are hard to notice from either source alone. If they use different aliases for one physical node, Ansible may execute twice. Stable naming, explicit source order, and graph inspection prevent these identity problems from becoming task failures.

Inventory errors are upstream errors. A missing host, wrong group, unexpected address, or stale lifecycle tag changes everything that follows: variable inheritance, target selection, connection, and playbook effect. Debug the graph before debugging a task that never should have reached the host.

A good inspection sequence is small and repeatable:

```bash
ansible-inventory -i inventories/prod --graph
ansible-inventory -i inventories/prod --host application-web-01
ansible-playbook -i inventories/prod deploy-application-web.yml --list-hosts
```

The first command validates classification, the second validates identity and context, and the third validates the selection phase. Together they cover both inventory loading and play targeting without changing a managed node.

## How Does Inventory Protect a Real Run?
<!-- section-summary: A safe inventory workflow proves the host map, proves connectivity, and narrows the first production run. -->

Inventory review should happen before a production playbook changes anything. Start by inspecting the graph, then inspect one representative host, then run a harmless module to confirm Ansible can reach the selected hosts.

```bash
ansible-inventory -i inventories/prod --graph prod_web
ansible-inventory -i inventories/prod --host application-web-01
ansible -i inventories/prod prod_web -m ansible.builtin.ping
```

The `ping` module is an Ansible connectivity test. It checks that Ansible can connect, transfer and run a small module, and receive a response. It proves the inventory and basic connection path enough to move to the next check, while sudo, application health, and playbook behavior still need their own checks.

For a playbook, preview the selected hosts before running tasks. This is especially useful in pipelines because a human approver can see the target set in the job output before the deploy step starts.

```bash
ansible-playbook -i inventories/prod deploy-application-web.yml --list-hosts
ansible-playbook -i inventories/prod deploy-application-web.yml --limit application-web-01 --list-hosts
```

If the target list is wrong, stop at the inventory layer. Fix the map, inspect it again, and then rerun the preview. A playbook can be perfectly written and still cause an outage when it runs against the wrong hosts.

Inventory is one of Ansible's main safety boundaries because it determines the universe from which targets can be selected. A production command should make that boundary explicit. The safest pre-run sequence separates seven questions:

1. Did Ansible load the intended inventory sources?
2. Does the graph contain the expected groups and hosts?
3. Does one representative host resolve to the expected address and variables?
4. Which hosts does the play pattern select before a limit?
5. Which smaller set remains after the limit?
6. Can Ansible connect and execute a harmless module there?
7. Does an independent environment signal agree that these are the intended systems?

The final question matters because a group name alone is not proof. A source can accidentally place a staging address under `prod_web`. Check a trusted environment variable, cloud account or project, hostname convention, instance tag, or service endpoint where the risk warrants it. The point is to compare inventory classification with independent identity evidence.

Use a limit to narrow a verified set, not to repair an unverified one. `--limit application-web-01` is a useful canary after the play reports the expected production web set. If the play pattern unexpectedly includes databases, adding a web-server limit to the command hides a design flaw that can return in the next automated run.

Dynamic sources need one additional safety question: which live API query and filters produced this graph at this time? Record or display the plugin source, account, region, and relevant filters in the job. Refresh caches deliberately before a sensitive run, and stop when the API response is incomplete rather than silently treating missing hosts as success.

Connectivity is proof of reachability, not proof of authorization or desired behavior. `ansible.builtin.ping` does not prove that privilege escalation works, that the correct application owns the host, or that a later task is safe. Follow it with check mode, diff review, a canary, application verification, and a bounded rollout as the playbook requires.

The effective target set can be expressed as an intersection:

```text
loaded inventory
  ∩ play pattern
  ∩ command limit
  ∩ reachable hosts
= hosts that can receive task execution
```

Failures at each layer mean different things. An empty loaded graph points to a source or plugin problem. An empty play result points to a pattern or membership problem. An unreachable host points to connection context. Keeping those layers separate shortens diagnosis and prevents a task rewrite from masking an inventory defect.

A practical pre-run sequence can be written directly into a runbook or pipeline:

```bash
ansible-inventory -i inventories/prod --graph
ansible-inventory -i inventories/prod --host application-web-01
ansible-playbook -i inventories/prod deploy-application-web.yml --list-hosts
ansible-playbook -i inventories/prod deploy-application-web.yml \
  --limit application-web-01 --list-hosts
ansible -i inventories/prod application-web-01 -m ansible.builtin.ping
ansible-playbook -i inventories/prod deploy-application-web.yml \
  --limit application-web-01 --check --diff
```

Each command answers one question and stops before broad mutation. The graph validates classification. The host view validates connection context and effective variables. The two list operations validate the broad and canary selections. Ping validates module execution. Check and diff mode preview the playbook's likely effect where the modules support it.

After the canary runs for real, verify application health and then widen with a bounded rollout. Inventory validation does not replace application verification; it ensures that the later verification applies to the machines the team intended to change. Record the compiled target list with the deployment so an incident review can reconstruct exactly which identities were eligible at run time.

## What Makes Inventory Maintainable?
<!-- section-summary: Reliable inventory gives stable names, current connection targets, useful groups, and a verification path. -->

The application platform now has a clear host map. Inventory names such as `application-web-01` stay stable for humans, `ansible_host` stores the current connection address, and groups such as `prod_web` and `staging_web` let playbooks target useful slices without copied host lists.


![Inventories Summary](/content-assets/articles/article-infrastructure-as-code-ansible-inventories-and-connection-targets/inventories-summary.png)

*The summary turns inventory design into six habits: name, address, group, source, verify, and limit.*

The team can start with static inventory while the fleet is small. As production moves toward autoscaling or frequent instance replacement, dynamic inventory can pull from cloud metadata, provided the team treats tags and plugin filters as deployment boundaries.

The daily habit stays the same in both cases. Inspect the compiled graph, check one host's final variables, prove basic connectivity, and preview the playbook host list before changing production. Inventory is the map, so the safest automation work starts by making the map visible.

Maintainable inventory models stable facts and useful operational questions, not fleeting procedures. `web`, `prod`, `eu_west`, and `canary` can represent durable classifications. A group named `restart_these_tonight` encodes a one-time command into topology and will become misleading after the event. Put procedure in a playbook and select a reviewed stable group or explicit limit for the one-time run.

A repository can make the boundary visible:

```text
inventories/
├── staging/
│   ├── hosts.yml
│   ├── group_vars/
│   └── host_vars/
├── prod/
│   ├── hosts.yml
│   ├── cloud.yml
│   ├── group_vars/
│   └── host_vars/
playbooks/
├── baseline.yml
└── deploy-application.yml
requirements.yml
ansible.cfg
```

The static `hosts.yml` and dynamic `cloud.yml` may both contribute to production. `requirements.yml` pins the plugin collection. The playbooks consume groups without knowing whether each host came from a file or an API. That is a useful abstraction: inventory sources own topology discovery, while playbooks own procedure.

Avoid cleverness in critical inventory. A short explicit group hierarchy is easier to review than layers of generated aliases and opaque regular expressions. Dynamic composition should use stable metadata keys, and a human should be able to predict the resulting group name. The goal is not the fewest lines of YAML; it is a target model that an operator can verify under pressure.

When Ansible starts a play, the conceptual sequence is:

```text
load every selected source
        ↓
parse static data and call plugins
        ↓
build hosts, groups, children, and variables
        ↓
resolve the play pattern
        ↓
apply --limit if present
        ↓
connect to each selected inventory identity
        ↓
execute tasks with that host's context
```

An upstream inventory error changes every downstream step. A wrong identity can select the wrong `host_vars`; a wrong group can add policy; a wrong address can reach another machine; a stale plugin result can include a retired node. This is why inventory correctness deserves the same review seriousness as task correctness.

A good inventory should make common operational questions cheap. Which hosts would receive the production baseline? Which web nodes are in one region? Which identity is the canary? Which connection address and user will Ansible use? Which environment values reach that host? If each answer requires reading several unrelated files or running an undocumented generator, the model is too opaque for safe routine work.

The safest way to think before a real run is to separate certainty from assumption. The repository path may suggest production, but the compiled source proves what loaded. A group name may suggest web servers, but the graph proves membership. An inventory name may look correct, but the resolved host view proves its address and variables. A playbook name may suggest a narrow deploy, but `--list-hosts` proves the selection. The canary command then proves that the limit intersects the intended set.

Inventory also influences variable design. Values shared by an environment need an environment group; values shared by a role need a role group; true exceptions need a stable host identity. Poor classification forces duplication into host files or awkward conditional logic. Good classification lets variables describe policy once and lets playbooks remain reusable.

The first-principles definition is therefore broader than “a file containing servers”:

> Inventory is the loaded, queryable model Ansible uses to assign stable identities, connection context, classifications, and input values before selecting managed nodes for execution.

That definition works for one INI file, a directory of YAML sources, several cloud plugins, network devices, or a mixed fleet. The source format can change while the contract stays the same. Operators must be able to load the model deliberately, query it, inspect one host's context, and predict the effective target set.

When inventory is treated this way, changes have an obvious review path. Identity changes are reviewed for continuity, address changes for reachability, membership changes for targeting and inherited policy, variable changes for configuration impact, and plugin changes for query scope. That review discipline is what keeps a dynamic or multi-source inventory understandable as the fleet grows.

Static and dynamic examples ultimately produce the same execution contract. A static file parses host records directly. A plugin queries an API and synthesizes records. An inventory directory may combine both. Ansible then constructs one graph, associates variables with each identity, and evaluates the same play patterns. Playbooks should depend on that contract rather than on source-specific details. A play that targets `web:&prod` should not care whether the current members came from reviewed YAML or correctly filtered cloud metadata.

This abstraction does not remove the need to understand provenance. During an incident, the operator still needs to answer which source contributed a host and why it joined a group. Keep source names, plugin configuration, and relevant metadata available in inspection output or runbooks. If two sources disagree, resolve the disagreement upstream instead of adding increasingly clever playbook conditions.

Finally, remember that inventory describes eligibility, not execution order. A group containing three web hosts does not say whether they change simultaneously, one at a time, or by canary. `serial`, limits, and play structure own rollout behavior. Keeping classification separate from sequencing prevents temporary rollout mechanics from polluting the long-lived host model.

The same boundary applies to facts. Inventory says what the organization knows or intends before connection: identity, membership, address, and configured context. Facts say what Ansible observes after reaching the node: operating system, interfaces, memory, and other runtime properties. Do not duplicate changing machine observations into inventory merely to avoid gathering facts, and do not use discovered facts as a substitute for reviewed environment membership. Each source should answer the kind of question it can own reliably.

Once the host map is readable, values start showing up. Web ports, service users, package names, feature flags, data paths, and environment labels all need homes. The next article shows how group variables and host variables keep those values close to the machines they describe.

Inventory review should include retirement. Remove decommissioned identities from active groups, clear stale host variables and fact caches, and verify dynamic filters exclude terminated lifecycle states. Otherwise old context can reappear under a reused name or send a recovery command toward an address that now belongs to another node.

Retirement is part of inventory correctness.

Inventory may also supply connection variables, but sensitive ones need a protected source. A plaintext `ansible_password` beside hostnames turns the inventory repository into a credential store. Keep passwords in Vault or a controller credential binding, then let ordinary role tasks such as `ansible.builtin.template` and `ansible.builtin.service` consume nonsecret host and group values from the resolved inventory.

## Check Your Answers

:::expand[What Problem Does Inventory Solve?]{kind="recap"}
Inventory separates reusable procedure from changing topology. It answers identity, reachability, classification, and context before a play selects any host.
:::

:::expand[How Do Names and Connection Addresses Differ?]{kind="recap"}
The inventory name is Ansible's stable host identity; `ansible_host` is the current network destination. Connection values belong in context, while secrets belong in protected credential systems.
:::

:::expand[How Do Groups Create Useful Target Sets?]{kind="recap"}
Groups are sets that model stable dimensions such as role and environment. Patterns query those sets, child groups provide inclusion, and `--limit` narrows the play result.
:::

:::expand[When Should Inventory Be Static?]{kind="recap"}
Static inventory fits small or slowly changing fleets where membership should be explicit and reviewed. Static inventory is risky once manual files can no longer keep pace with live lifecycle changes.
:::

:::expand[How Does Dynamic Inventory Work?]{kind="recap"}
An inventory plugin adapts an external API into hosts, variables, and groups. Filters, tags, credentials, identity rules, and caching all become part of its correctness boundary.
:::

:::expand[How Do You Inspect Loaded Inventory?]{kind="recap"}
Use `--graph` for membership, `--list` for the complete compiled model, and `--host` for one host's effective context. Trust the processed view rather than assumptions about source files.
:::

:::expand[How Does Inventory Protect a Real Run?]{kind="recap"}
Prove the source, graph, host context, play result, limit, reachability, and independent environment identity before a sensitive run. A correct playbook cannot compensate for a wrong target set.
:::

:::expand[What Makes Inventory Maintainable?]{kind="recap"}
Use stable identities, meaningful group dimensions, predictable plugins, explicit source paths, and a repeatable inspection sequence. Keep temporary procedures out of the topology model.
:::

---

**References**

- [Ansible inventory guide](https://docs.ansible.com/projects/ansible/latest/inventory_guide/index.html)
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Working with dynamic inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_dynamic_inventory.html)
- [Inventory plugins](https://docs.ansible.com/projects/ansible/latest/plugins/inventory.html)
- [amazon.aws.aws_ec2 inventory plugin](https://docs.ansible.com/projects/ansible/latest/collections/amazon/aws/aws_ec2_inventory.html)
- [ansible-inventory command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
- [Introduction to ad hoc commands](https://docs.ansible.com/projects/ansible/latest/command_guide/intro_adhoc.html)
