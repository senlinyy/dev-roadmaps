---
title: "Patterns, Limits, and Canary Targets"
description: "Learn how Ansible host patterns form sets, how command-line limits intersect those sets, and how targeting supports safe canary rollouts."
overview: "Inventory defines the possible hosts, a play pattern defines its authorized domain, and --limit narrows one execution. This article treats patterns as set algebra, separates hosts from task tags and batch size, and builds a verify-first canary workflow."
tags: ["ansible", "patterns", "limit", "canary", "inventory"]
order: 4
id: article-infrastructure-as-code-ansible-patterns-limits-canaries
---

## Table of Contents

1. [How Does Inventory Define the Host Universe?](#how-does-inventory-define-the-host-universe)
2. [How Do Pattern Operators Build Host Sets?](#how-do-pattern-operators-build-host-sets)
3. [Why Are hosts: and --limit Separate Layers?](#why-are-hosts-and---limit-separate-layers)
4. [How Do Canary Runs Follow from Set Intersection?](#how-do-canary-runs-follow-from-set-intersection)
5. [How Do Wildcards, Regexes, and Positions Select Hosts?](#how-do-wildcards-regexes-and-positions-select-hosts)
6. [Why Are Tags and serial Different from Targeting?](#why-are-tags-and-serial-different-from-targeting)
7. [How Do You Verify Hosts and Tasks Before a Run?](#how-do-you-verify-hosts-and-tasks-before-a-run)
8. [What Is the Safest Targeting Workflow?](#what-is-the-safest-targeting-workflow)
9. [Check Your Answers](#check-your-answers)

Ansible targeting is easier to reason about when every host expression is treated as a set. Inventory defines the universe. A play's `hosts:` expression chooses the domain in which that play is allowed to operate. A command-line limit intersects the play domain for this run. Tags filter work along a separate axis.

Suppose inventory resolves to:

```ini
[web]
web01.example.com
web02.example.com
web03.example.com

[database]
db01.example.com
db02.example.com

[production:children]
web
database

[canary]
web01.example.com
```

Inventory answers which automation identities exist and how they are classified. Static files, dynamic plugins, and constructed groups may all contribute to the resolved graph. A pattern cannot select a name that is absent from that universe.

A play declares a pattern:

```yaml
- name: Configure web servers
  hosts: web
  tasks:
    - name: Keep Nginx installed
      ansible.builtin.package:
        name: nginx
        state: present
```

Keep these questions in view as you work through the lesson:

1. **How Does Inventory Define the Host Universe?**
2. **How Do Pattern Operators Build Host Sets?**
3. **Why Are `hosts:` and `--limit` Separate Layers?**
4. **How Do Canary Runs Follow from Set Intersection?**
5. **How Do Wildcards, Regexes, and Positions Select Hosts?**
6. **Why Are Tags and `serial` Different from Targeting?**
7. **How Do You Verify Hosts and Tasks Before a Run?**
8. **What Is the Safest Targeting Workflow?**

## How Does Inventory Define the Host Universe?
<!-- section-summary: Patterns can select only names and groups present in the resolved inventory, so inventory is the universe for targeting. -->

`hosts: web` means this play's domain is the set of hosts in `web`. It is not a loop over a hardcoded list. If inventory later adds `web04.example.com` to the group, the same play includes it.

This is why inventory changes are deployment changes. Adding a host to a group grants it membership in every play targeting that group. Dynamic inventory makes cloud tags or CMDB classification part of the same boundary.

Inspect the universe first:

```bash
ansible-inventory -i inventory.ini --graph
```

Then reason about patterns over the displayed names. Do not assume a hostname's DNS form or IP is the inventory identity; pattern matching normally uses inventory names.

## How Do Pattern Operators Build Host Sets?
<!-- section-summary: Union, intersection, and exclusion combine inventory groups and hosts into precise target sets. -->

Ansible patterns resemble set algebra.

**Union** selects members of either set:

```text
web:database
```

Conceptually:

```text
web union database
```

**Intersection** selects members present in both sets:

```text
web:&production
```

This asks for hosts classified as both web and production.

**Exclusion** removes a set:

```text
production:!database
```

This begins with production and removes database hosts.

Operators can combine:

```text
web:&production:!maintenance
```

The result is production web hosts excluding those currently in maintenance. Quote shell arguments containing `!`, `&`, wildcards, or other metacharacters so the shell does not transform them before Ansible receives the pattern:

```bash
ansible-playbook -i inventory.ini site.yml \
  --limit 'web:&production:!maintenance'
```

Set reasoning prevents ambiguous prose such as “all production except databases, but only in web.” Write the base set, apply intersections, then remove exceptions. Verify the actual result rather than trusting mental operator precedence for a complex expression.

Host groups can overlap. A host may belong to `web`, `production`, `eu_west`, and `canary` simultaneously. Intersection uses that membership deliberately; it does not create a new persistent group.

Patterns are evaluated against resolved inventory at run time. When dynamic membership changes, the same expression can select a different set. Keep the resolved host list as deployment evidence.

## Why Are `hosts:` and `--limit` Separate Layers?
<!-- section-summary: The play declares its intended host domain, while a limit narrows the current execution and cannot expand beyond that domain. -->

Suppose a play says:

```yaml
- name: Deploy web application
  hosts: web
```

and the command uses:

```bash
ansible-playbook -i inventory.ini deploy.yml \
  --limit web01.example.com
```

The effective hosts are:

```text
play domain intersect command limit
    web intersect {web01.example.com}
    = {web01.example.com}
```

If the same command limits to `db01.example.com`, the result is empty because that database host is not inside `hosts: web`. A limit does not replace the play pattern and cannot broaden its authorization domain.

This two-layer design is useful. The playbook records durable intent: this deployment belongs to web hosts. The operator or pipeline chooses the smaller execution slice: one canary, one region, or all eligible hosts except a known problem.

Common limits include:

```text
web
web01.example.com
web:&production
web:&production:!web03.example.com
```

Limits are patterns too, so they accept group operations. Their scope applies across plays in the playbook. A multi-play run may target web hosts in one play and database hosts in another; one limit intersects each play separately. A `--limit web01` can make the database play match zero hosts.

An empty match should be treated deliberately. In a deployment pipeline, matching zero hosts can look green while doing nothing. Verify the list and fail the workflow if the intended target set is empty.

## How Do Canary Runs Follow from Set Intersection?
<!-- section-summary: A canary is a narrow first intersection of an unchanged production play, followed by a verified expansion to the remaining eligible hosts. -->

A canary does not require a separate copy of the playbook. Keep the production play domain and narrow the first run:

```bash
ansible-playbook -i inventory.ini deploy.yml \
  --limit 'web:&production:&canary'
```

The play still says `hosts: web`. Inventory classifies production and canary membership. The command chooses their intersection for this execution.

After real mutation, verify the canary's configuration, service health, load-balancer status, metrics, and change reporting. Then target the remaining production web set:

```bash
ansible-playbook -i inventory.ini deploy.yml \
  --limit 'web:&production:!canary'
```

This flow naturally separates:

```text
same desired procedure
    + first narrow host set
    + health decision
    + remaining host set
```

Choose the canary intentionally. A designated group makes selection visible and stable. A one-off exact hostname can work when recorded by the release system. The host should represent normal production dependencies and have enough observation to reveal problems.

Canary targeting limits blast radius, not task scope. The play still runs all applicable tasks on that host. If only configuration should be tested, use tags or a separate check-mode preview as an independent task filter.

Inventory can change between stages. Resolve and record both target lists, and ensure hosts are neither skipped nor deployed twice unintentionally. A new dynamic host appearing after the canary may need a policy about whether it joins this release.

## How Do Wildcards, Regexes, and Positions Select Hosts?
<!-- section-summary: Additional pattern generators can select names or group positions, but their safety depends on stable inventory identity and verified resolution. -->

Wildcards can select inventory names:

```text
web*.example.com
```

Regular-expression patterns can express more complex name rules. They remain set generators over inventory; they do not query DNS or discover arbitrary machines.

Name matching has a subtle boundary. A host can be declared as:

```yaml
web01:
  ansible_host: 10.20.1.11
```

The inventory identity is `web01`. A pattern for `10.20.1.11` does not necessarily match it merely because that is the connection endpoint. Use `ansible_host` for routing and `inventory_hostname` for targeting identity.

Ansible can select hosts by position in a group, such as the first member. This can make a quick canary:

```text
web[0]
```

Position is only safe if inventory ordering is defined and stable. Dynamic inventory can reorder results, and “first” may not be representative. A named canary group is more reviewable for production.

Ranges can select group slices. They are convenient for batching experiments but can hide which concrete hosts receive the change. Always render the selected list before execution.

Wildcards and regexes can broaden unexpectedly when new hosts are added. A pattern based on explicit environment and role groups usually expresses intent better than a naming convention alone. Prefer classifications that inventory owners review.

## Why Are Tags and `serial` Different from Targeting?
<!-- section-summary: Host patterns select rows, tags select task columns, and serial controls how many selected hosts enter one execution batch. -->

Think of execution as a matrix:

```text
                 tasks
hosts       preflight  config  deploy  verify
web01           x        x       x       x
web02           x        x       x       x
web03           x        x       x       x
```

Host patterns and limits select rows. Tags select columns:

```bash
ansible-playbook -i inventory.ini site.yml \
  --limit 'web:&production' \
  --tags config
```

This runs config-tagged tasks only on production web hosts. Tags do not change inventory membership or the play domain.

Tags can skip prerequisites, handlers, or verification. Use `--list-tags` and design independently callable task groups with clear assertions. A task tagged `always` has special behavior; a `never` task requires explicit selection.

`serial` changes batch size after host selection:

```yaml
- name: Roll web fleet
  hosts: web
  serial: 2
```

The host set is still `web` intersected with any limit. Ansible processes two selected hosts per batch. `serial` does not choose which environment or role belongs in the play; it controls rollout concurrency.

The four dimensions are:

```text
inventory
    what host identities and groups exist

hosts pattern
    the play's allowed domain

limit
    this run's narrowed host subset

tags
    this run's selected task subset

serial
    batch shape over selected hosts
```

Keeping them separate makes command review possible.

## How Do You Verify Hosts and Tasks Before a Run?
<!-- section-summary: Listing and independently testing patterns proves the concrete host and task sets before a mutating command uses them. -->

List the play's hosts:

```bash
ansible-playbook -i inventory.ini deploy.yml --list-hosts
```

Add the exact limit:

```bash
ansible-playbook -i inventory.ini deploy.yml \
  --limit 'web:&production:!maintenance' \
  --list-hosts
```

Test a pattern independently with an ad-hoc command:

```bash
ansible -i inventory.ini \
  'web:&production:!maintenance' \
  --list-hosts
```

The output is the actual execution set. Count it, compare it with the expected inventory cohort, and store it with the deployment evidence.

Verify tasks separately:

```bash
ansible-playbook -i inventory.ini deploy.yml --list-tasks
ansible-playbook -i inventory.ini deploy.yml --list-tags
```

Then combine the command's host and tag filters and run `--check --diff` where safe and supported. Preview does not prove real execution, but it can expose a target or task-filter mistake before mutation.

Quote patterns in the shell. Exclamation marks, ampersands, brackets, and wildcards can have shell meanings. If CI builds a pattern from inputs, validate against an allowlist rather than concatenating arbitrary user text.

Verbose output can help show pattern decisions but may expose variables. Use it in a protected setting and do not print secret-bearing inventory values merely to prove scope.

## What Is the Safest Targeting Workflow?
<!-- section-summary: Safe targeting starts from reviewed inventory, proves play and run intersections, previews both host and task axes, and expands only after canary health. -->

A practical workflow is:

```text
1. Inspect resolved inventory graph.
2. State the play's intended hosts pattern.
3. Construct the narrow run limit as a set expression.
4. List the concrete host result.
5. List tasks and tags if task filtering is used.
6. Run syntax and supported check/diff preview.
7. Execute one representative canary.
8. Verify the actual service.
9. Resolve and record the remaining host set.
10. Widen through serial batches and health gates.
11. Verify that every intended host participated.
```

For staging configuration only:

```bash
ansible-playbook -i inventory.ini site.yml \
  --limit 'web:&staging' \
  --tags config \
  --check --diff
```

For the production canary:

```bash
ansible-playbook -i inventory.ini deploy.yml \
  --limit 'web:&production:&canary'
```

For the remainder:

```bash
ansible-playbook -i inventory.ini deploy.yml \
  --limit 'web:&production:!canary'
```

For production configuration without deployment tasks:

```bash
ansible-playbook -i inventory.ini site.yml \
  --limit 'web:&production' \
  --tags config
```

The model to remember is:

```text
inventory defines what exists
hosts defines the play's domain
limit narrows the current execution
tags filter work on selected hosts
serial divides selected hosts into batches
```

Every explicit targeting and filtering layer should be clearly visible in the durable run record. Safe production infrastructure host targeting is not a clever pattern; it is the ability to prove exactly which hosts and tasks receive authority before the command changes them.

Multiple plays make the intersection especially important. A deployment file may have one play on `load_balancers`, one on `web`, and one on `monitoring`. A hostname-only limit can cause the supporting plays to match nothing. If the procedure requires all three boundaries, use a limit containing the needed groups or design the orchestration so the control-plane steps are delegated from the current web host. Always inspect `--list-hosts` for every play, not only the headline application play.

Pattern syntax should remain readable to the next operator. A very dense regular expression may be correct but difficult to audit during an incident. If a set has lasting operational meaning, create a reviewed inventory group such as `production_canary` or `maintenance_excluded` and let the pattern express the relationship between named classes.

Target proof also needs time context. Dynamic inventory can cache results, and two commands may see different membership when instances start or stop. Use one controlled inventory refresh policy for the run, record the resolved hosts, and decide whether newly appearing hosts join this deployment or wait for the next one.

Finally, compare the final recap with the initial resolved set. A host can become unreachable, fail early, or skip every tagged task. Count successful and failed participation rather than treating the job's overall exit label as proof that all selected machines reached the intended condition. Targeting begins with set selection and ends with accounting for every member of that set.

For emergency repair, narrow targeting remains useful but still requires verification. Select the one drifted host, list the tasks, run check and diff where supported, apply the normal idempotent role, and confirm service health. Avoid creating a permanent one-host fork of the playbook: the repair should restore the machine to its class so the next full run stays consistent. Record exclusions too, because a host repeatedly omitted from fleet runs becomes unmanaged drift rather than a temporary exception.

Save the resolved host list with the deployment record. Inventory membership can change after a dynamic refresh, so the pattern string alone may not reconstruct which nodes were eligible at run time. A recorded list connects the reviewed expression to the concrete canary and later batches that received the change.

Pattern safety improves when group dimensions are positive and explicit. Selecting `prod:&web` states both required properties; selecting `all:!staging` assumes every non-staging host is production-ready. Exclusions are useful, but positive intersections usually make the intended boundary easier to review and less sensitive to newly added groups.

Targeting chooses hosts, not task semantics. A pattern can select Debian and Red Hat hosts together while `ansible_os_family` conditions choose different package work, and the same target set can run `ansible.builtin.template` before notifying `ansible.builtin.service`. Prove the host set first, then inspect conditions and tags separately; a correct `--limit` cannot compensate for a task condition that selects the wrong work.

## Check Your Answers

:::expand[How Does Inventory Define the Host Universe?]{kind="recap"}
Inventory supplies stable host identities and group membership. Patterns can select only from that resolved universe, whose changes alter automation scope.
:::

:::expand[How Do Pattern Operators Build Host Sets?]{kind="recap"}
Use union, intersection, and exclusion to express host membership precisely, quote the expression, and verify it against current inventory.
:::

:::expand[Why Are `hosts:` and `--limit` Separate Layers?]{kind="recap"}
`hosts:` records the durable play domain. `--limit` intersects it for one run and cannot add hosts outside that authorized domain.
:::

:::expand[How Do Canary Runs Follow from Set Intersection?]{kind="recap"}
Run the unchanged production play against a narrow representative intersection, verify it, then select the remaining eligible set.
:::

:::expand[How Do Wildcards, Regexes, and Positions Select Hosts?]{kind="recap"}
They generate sets from inventory identities. Ordering and naming can change, so explicit groups and resolved-list review are safer for production.
:::

:::expand[Why Are Tags and `serial` Different from Targeting?]{kind="recap"}
Patterns select hosts, tags select tasks, and `serial` controls batches over the already selected hosts. Each is an independent execution axis.
:::

:::expand[How Do You Verify Hosts and Tasks Before a Run?]{kind="recap"}
Use inventory graph, list-hosts, independent pattern tests, list-tasks, list-tags, and a protected preview to expose the concrete execution matrix.
:::

:::expand[What Is the Safest Targeting Workflow?]{kind="recap"}
Prove inventory, play domain, limit, tasks, and preview; mutate one canary; verify service health; then widen through recorded batches.
:::

---

**References**

- [Ansible: Patterns](https://docs.ansible.com/ansible/latest/inventory_guide/intro_patterns.html)
- [Ansible: Inventory](https://docs.ansible.com/ansible/latest/inventory_guide/intro_inventory.html)
- [Ansible: Controlling playbook execution](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_startnstep.html)
- [Ansible: Tags](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_tags.html)
- [Ansible: Delegation and rolling updates](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_delegation.html)
