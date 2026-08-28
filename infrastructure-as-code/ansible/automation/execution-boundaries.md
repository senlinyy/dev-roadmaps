---
title: "Execution Boundaries"
description: "Define the operational boundaries between local execution on the control node and remote execution on managed targets."
overview: "Ansible playbooks normally execute tasks on remote hosts over SSH, but developers can bypass this transport layer to execute tasks directly on the control plane using local execution and delegation."
tags: ["ansible", "automation", "local", "delegation"]
order: 1
id: article-infrastructure-as-code-ansible-execution-boundaries
aliases:
  - ansible-execution-boundaries
  - infrastructure-as-code/ansible/execution-boundaries.md
---

## Table of Contents

1. [Where Does a Task Run by Default?](#where-does-a-task-run-by-default)
2. [When Should a Task Run on the Control Node?](#when-should-a-task-run-on-the-control-node)
3. [How Does Delegation Move One Task?](#how-does-delegation-move-one-task)
4. [How Do runonce and Serial Batches Interact?](#how-do-runonce-and-serial-batches-interact)
5. [Who Owns Facts Gathered Through Delegation?](#who-owns-facts-gathered-through-delegation)
6. [How Do Boundaries Change Security and Capacity?](#how-do-boundaries-change-security-and-capacity)
7. [How Do You Diagnose the Wrong Boundary?](#how-do-you-diagnose-the-wrong-boundary)
8. [How Do You Design a Multi-Boundary Rollout?](#how-do-you-design-a-multi-boundary-rollout)
9. [Check Your Answers](#check-your-answers)

Ansible playbooks read as one flow. Each task still has a location, and that location controls which files, network routes, Python packages, command-line tools, and credentials are available. A package task may run on a web host. A release artifact check may run on the CI runner. A load balancer API call may run from a bastion host.

![Execution Location Map](/content-assets/articles/article-infrastructure-as-code-ansible-execution-boundaries/execution-location-map.png)

*The location map shows the difference between remote host work, control-node work, delegated work, run_once, and delegate_facts.*

Let's use the application platform again. A deployment updates `application-web-01`, drains it from the load balancer, copies a new config file, restarts the app, checks local health, and then adds the host back to the pool. The file and service tasks belong on `application-web-01`. The load balancer command may belong on `lb-admin-01`, because that host has the `lbctl` tool and the right network path.

An **execution boundary** names where one task runs and which inventory host receives the result. Many confusing Ansible failures come from this choice, especially "file not found", "command not found", and "permission denied" errors that appear even when the YAML syntax is fine.

Keep these questions in view as you work through the lesson:

1. **Where Does a Task Run by Default?**
2. **When Should a Task Run on the Control Node?**
3. **How Does Delegation Move One Task?**
4. **How Do run_once and Serial Batches Interact?**
5. **Who Owns Facts Gathered Through Delegation?**
6. **How Do Boundaries Change Security and Capacity?**
7. **How Do You Diagnose the Wrong Boundary?**
8. **How Do You Design a Multi-Boundary Rollout?**

## Where Does a Task Run by Default?
<!-- section-summary: An execution boundary is the place where a task actually runs: the selected host, the control node, or another delegated host. -->

There are three common locations. The default is the current managed host selected by the play. Local execution runs on the control node, which may be a laptop, CI runner, or automation controller execution environment. Delegation runs a task on another host while keeping the task associated with the current inventory host.

Start with Ansible's host loop. A play selects several inventory hosts, and Ansible evaluates each task in the variable context of each current host. Without delegation, the current host is both the **subject** of the automation and the **executor** of the module:

```text
current inventory host → resolve its values → run module there → attach result there
```

“The task runs remotely” is useful shorthand, but incomplete. Action-plugin work, template rendering preparation, file lookup, and connection handling can involve the control node before a module executes on the managed host. The operational question remains: which machine's filesystem, network, tools, identity, and credentials does the module or command actually use?

The default boundary protects an important abstraction. A package task about `application-web-01` normally runs on `application-web-01`; its path, service manager, and installed package database refer to that host. Readers can reason locally without annotating every ordinary task with a destination.

| Symptom | First place to check |
|---|---|
| `No such file or directory` | The filesystem of the machine where the task ran |
| `command not found` | The PATH and installed tools on the execution machine |
| `permission denied` | The user and credentials at the execution boundary |
| Missing API access | The control node or delegated host credentials |
| Wrong fact value | Whether the fact belongs to the current host or delegated host |

### Why remote execution is the default boundary
<!-- section-summary: By default, Ansible runs each task on the current host selected by the play, which fits host-local state. -->

The default Ansible boundary is remote execution on the current managed host. If a play targets `application_web`, Ansible connects to each application web host and runs the task there.

```yaml
- name: Install application package
  ansible.builtin.package:
    name: application-web
    state: present
```

This is the right boundary for host-local state. Packages, files, users, groups, systemd services, directories, local health endpoints, and host-specific commands usually belong on the managed host. The task changes or checks the machine that the play is currently processing.

The default boundary also controls where paths are resolved. If a command task says `cmd: /usr/local/bin/applicationctl status`, that path must exist on the managed host. If a `stat` task checks `/tmp/release.tar.gz`, it checks the remote host's `/tmp`, and the control node workspace is a different filesystem.

That last point catches many beginners. The CI runner may have `build/application-web.tar.gz`, but a remote `stat` task will look for that file on `application-web-01`. If the file exists only in the checked-out repository on the runner, the task should be local or delegated.

The inverse mistake also happens. `localhost` is not a synonym for the application host. A local `uri` call to `http://127.0.0.1:8080/health` checks the controller's loopback interface, not the selected web server. Boundary choices change viewpoint as well as location.

## When Should a Task Run on the Control Node?
<!-- section-summary: delegate_to localhost and local connection run selected work on the control node, which is useful for artifacts, APIs, and one-time orchestration. -->

The **control node** is the machine running Ansible. In local development, that may be your laptop. In CI, it is the pipeline runner. In Red Hat Ansible Automation Platform, the practical execution environment may be an execution node or container image running the job.

Use `delegate_to: localhost` when one task should run on the control node while the rest of the play targets remote hosts. This fits artifact checks, local repository reads, API calls from the runner, and one-time validation.

```yaml
- name: Check release artifact exists on control node
  ansible.builtin.stat:
    path: "{{ release_artifact_path }}"
  delegate_to: localhost
  run_once: true
  register: release_artifact
  changed_when: false
```

`run_once` is important here because the release artifact is shared. Without it, Ansible would run the same delegated `stat` once for each selected application host, all on localhost. That is harmless for a quick `stat`, but noisy and confusing in deployment logs.

You can also run an entire play locally:

```yaml
- name: Validate application release metadata locally
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Read release manifest
      ansible.builtin.slurp:
        src: "{{ playbook_dir }}/release/manifest.json"
```

Local execution inherits the control node's tools and credentials. That is useful when the CI runner has cloud credentials, a checked-out repository, or an API client. It also creates drift risk because a task that works on one laptop can fail in CI when the Python package, collection, CLI tool, or environment variable is missing.

Production teams reduce that drift with pinned dependencies, execution environments, and explicit variables. The playbook should define its control-node dependencies clearly instead of inheriting whatever happens to be installed on one engineer's machine.

`delegate_to: localhost` moves one task while keeping the surrounding play's current host context. `hosts: localhost` with `connection: local` moves an entire play and makes localhost the play's subject. Use the second form for a coherent preflight or orchestration phase rather than decorating every task with delegation.

Local execution changes network perspective. The controller may reach a cloud API and artifact repository that managed hosts cannot, while it may be unable to reach a service bound only to a host's loopback address. It also changes credential exposure: environment variables and mounted secret files in the execution environment become available to local tasks.

Pin Python libraries, Ansible collections, and external command versions required by local tasks. In Automation Platform, the execution environment image is the practical control node; installing a CLI on the controller VM does not automatically make it available inside that container.

## How Does Delegation Move One Task?
<!-- section-summary: delegate_to runs the task somewhere else while keeping the result attached to the current host in the rollout. -->

`delegate_to` points a task at another execution host. The current inventory host remains the host being processed, but the module runs on the delegated host. This is perfect for orchestration around a target host.


![Delegate Run Once Flow](/content-assets/articles/article-infrastructure-as-code-ansible-execution-boundaries/delegate-run-once-flow.png)

*The delegate flow shows per-host work, one shared task, a delegated load balancer update, and fact storage as separate execution choices.*

For the application platform, the load balancer admin tool exists on `lb-admin-01`. The rollout still needs a per-web-host story: disable this web host, update this web host, check this web host, enable this web host. Delegation gives you that story.

```yaml
- name: Disable current host in load balancer
  ansible.builtin.command:
    cmd: "lbctl disable --service application --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01

- name: Restart application service on current host
  ansible.builtin.service:
    name: application
    state: restarted

- name: Enable current host in load balancer
  ansible.builtin.command:
    cmd: "lbctl enable --service application --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
```

The task result appears under the current application host in output, because the operation is part of that host's rollout. The command itself runs on `lb-admin-01`, so `lbctl`, API credentials, network routes, and config files need to exist there.

Delegating to a host that is in inventory is usually clearer than delegating to a raw IP or hostname that Ansible has never seen. Inventory gives the delegated host variables, connection settings, Python interpreter settings, and a name people recognize in logs.

Task names should make delegation obvious. A name like `Disable current host in load balancer` tells the reader why the command runs somewhere else and why `inventory_hostname` still refers to the web host.

Delegation deliberately separates subject from executor:

```text
subject:  application-web-02
executor: lb-admin-01
result:   attached to application-web-02's rollout
```

`inventory_hostname` does not change to `lb-admin-01`; it remains the current web host. That is exactly what makes a command such as `lbctl disable ... {{ inventory_hostname }}` useful. Variables specifically associated with the delegated connection can be reached through delegated context, but task logic should make the two identities obvious.

Delegating to one shared host does not serialize the calls. If ten web hosts run the delegated task in parallel, the admin host may receive ten concurrent commands. This can race on shared files, exceed CPU or connection capacity, or trip API rate limits. `serial`, `throttle`, or a separately designed one-time task controls concurrency; delegation alone controls only location.

Delegation can target another managed host, not only localhost. This supports database administration nodes, bastions, DNS controllers, and load-balancer managers with narrow network access. It can improve least privilege by keeping control-plane credentials away from application hosts.

Some actions cannot meaningfully be delegated because they operate on Ansible's own play flow or controller-side state rather than through a normal target connection. Treat delegation as a property supported by the action, not a universal wrapper that can relocate every keyword.

## How Do run_once and Serial Batches Interact?
<!-- section-summary: run_once reduces repeated work, and serial batches change whether run_once means once per play or once per batch. -->

`run_once: true` tells Ansible to run a task once for the current host set instead of once per host. It is useful for shared checks, release metadata reads, one-time notifications, and global API calls.

```yaml
- name: Announce application deployment start
  ansible.builtin.uri:
    url: "{{ deploy_events_url }}"
    method: POST
    body_format: json
    body:
      service: application
      version: "{{ application_release_version }}"
      status: started
  delegate_to: localhost
  run_once: true
```

With rolling updates, `serial` changes the story. A `run_once` task inside a play with `serial: 2` runs once for each batch. That behavior is useful for batch-level notifications or checks. It can surprise people when the task was meant to run only once for the whole deployment.

For a truly global task, use a separate localhost play before the rolling play, or add a condition that selects one stable host from the full play:

```yaml
- name: Run one global preflight for the full application rollout
  ansible.builtin.command:
    cmd: applicationctl deployment-preflight --version "{{ application_release_version }}"
  delegate_to: localhost
  run_once: true
  when: inventory_hostname == ansible_play_hosts_all[0]
  changed_when: false
```

The separate-play option is often easier for beginners to read. Use the conditional pattern when the task needs variables from the rolling play and the team understands how `serial` affects execution.

`run_once`, delegation, and `serial` answer different dimensions:

```text
delegate_to → where does this task execute?
run_once    → how many current hosts initiate it?
serial      → how many play hosts are in the current batch?
```

A delegated task without `run_once` remains per-host work at another location. A `run_once` task without delegation runs on one representative host from the current batch. With `serial`, that representative is chosen again for each batch. “Exactly once globally” is therefore a workflow requirement best represented by a separate play or a condition tied to the full play host list.

Be careful when the selected host supplies variables. A `run_once` result can be applied across the batch even though the task evaluated one host's context. Shared release metadata is appropriate; a host-specific path or address may not be.

## Who Owns Facts Gathered Through Delegation?
<!-- section-summary: delegate_facts decides whether facts gathered through delegation attach to the current host or to the host that produced them. -->

Facts are host data that Ansible stores in `hostvars`. CPU details, IP addresses, OS information, and custom discovered values can all become facts. Delegation makes facts tricky because the task runs on one host while the play is processing another host.

By default, facts gathered by a delegated task are assigned to the current inventory host. `delegate_facts: true` tells Ansible to assign those facts to the delegated host instead.

Imagine an application web play that needs database host information, even though the database group is outside the current play. The play can gather facts from database hosts and store them with the database hosts. Later tasks can then read database facts from the place readers expect:

```yaml
- name: Gather facts from application database hosts
  ansible.builtin.setup:
  delegate_to: "{{ item }}"
  delegate_facts: true
  loop: "{{ groups['application_db'] }}"
  run_once: true
```

After this task, `hostvars` for the database hosts contain the gathered facts. That lets later tasks read values like `hostvars['application-db-01']['ansible_default_ipv4']['address']` even though the play targets `application_web`.

Use this feature when the fact belongs to the delegated host. If the fact describes the current web host's rollout state, keep the default behavior. The point is to make `hostvars` match reality so later tasks and future readers can tell which machine a value describes.

Delegated facts reveal a three-axis model:

1. Which inventory host is the task about?
2. On which machine does the module execute?
3. Under which host identity should discovered data be stored?

Most tasks use the same host for all three. `delegate_to` changes the second axis. `delegate_facts: true` changes the third so discovery belongs to the executor rather than the subject.

This exists because a play can need information from hosts outside its active target set. A web rollout may query database nodes without configuring them. Storing database facts under each web host would duplicate and mislabel the observations; attaching them to the database identities makes later `hostvars` access consistent.

Do not use `delegate_facts` merely to move an arbitrary registered result. Decide what the data describes. Rollout evidence about the current web host should remain attached to that host even if an admin node performed the API query on its behalf.

## How Do Boundaries Change Security and Capacity?
<!-- section-summary: Execution location controls which credentials, tools, network paths, and shared resources a task can use, so delegation changes the risk profile. -->

Execution boundaries are also security boundaries. A task running on an application web host can use files and credentials available to that host. A task delegated to localhost can use CI secrets, repository files, and runner environment variables. A task delegated to `lb-admin-01` can use load balancer credentials and network paths available there.

That difference should be deliberate. If every app host can call the load balancer API directly, a compromised app host may gain control-plane reach. If only `lb-admin-01` can call it, the playbook has a tighter operational path, and the delegated task acts as the controlled bridge.

Capacity matters too. Ten app hosts delegating work to one admin host can overload the admin host or trip an API rate limit. Combine delegation with `serial` and `throttle` when many hosts share the same delegated execution point.

```yaml
- name: Check load balancer target health through admin host
  ansible.builtin.command:
    cmd: "lbctl target-health --service application --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
  throttle: 1
  register: lb_health
  changed_when: false
```

The same idea applies to cloud APIs, DNS updates, ticketing systems, and deployment event systems. The task may be logically attached to each app host, while the actual execution point is a shared control-plane location.

Delegation changes privilege boundaries too. `become` and connection variables now apply to the delegated execution path, so a task may log in to the admin host and escalate there even though the play is about a web host. Review the delegated host's account and sudo policy rather than the subject host's policy.

Credential boundaries move with execution. A local API task can consume CI environment secrets. A delegated admin task can consume credentials installed on the admin host. This can enforce least privilege, but it also means moving a task to localhost may enlarge controller risk by exposing high-value secrets to task code and logs.

Capacity moves in the same direction. CPU, disk, open files, subprocesses, network egress, and API quotas are consumed where the task executes. A rollout that is modest across fifty web hosts can become a burst of fifty operations against one controller or delegated node.

## How Do You Diagnose the Wrong Boundary?
<!-- section-summary: Most execution-boundary failures come from looking for files, tools, credentials, or facts on the wrong machine. -->

When a delegated or local task fails, read the error through the execution location. `No such file or directory` means the file is missing on the machine where the task ran. `command not found` means the command is missing on that machine. `permission denied` means the executing identity on that machine lacks access.

You can make boundaries visible with safe debug messages during development. Print the current inventory host and the intended execution host, then remove or quiet noisy debug output before production if it adds clutter.

```yaml
- name: Show rollout execution context
  ansible.builtin.debug:
    msg: "Rolling {{ inventory_hostname }} through {{ ansible_delegated_vars['lb-admin-01']['inventory_hostname'] | default('local task') }}"
  when: false
```

For real verification, prefer task names, registered metadata, and assertions. Check that the release artifact exists on localhost before the remote rollout starts. Check that `lbctl` exists on the delegated admin host. Check that the app host's local health endpoint passes after the service restarts.

```yaml
- name: Verify lbctl exists on admin host
  ansible.builtin.command:
    cmd: lbctl --version
  delegate_to: lb-admin-01
  register: lbctl_version
  changed_when: false

- name: Assert lbctl is available
  ansible.builtin.assert:
    that:
      - lbctl_version.rc == 0
```

Rollback follows the same boundary. If a load balancer disable succeeded on `lb-admin-01` and the app update failed on `application-web-02`, the recovery task may also need to run on `lb-admin-01` to keep the failed host out of rotation or to restore its previous state. The task location is part of the incident response.

## How Do You Design a Multi-Boundary Rollout?
<!-- section-summary: A clear deployment separates local preflight, delegated load balancer control, remote host changes, and delegated recovery. -->

Here is a full application rollout shape with clear boundaries:


![Execution Boundaries Summary](/content-assets/articles/article-infrastructure-as-code-ansible-execution-boundaries/execution-boundaries-summary.png)

*The summary keeps boundary decisions concrete: where the task runs, who it runs as, whether it runs once, whether it delegates, and how to verify.*

```yaml
- name: Validate application release on control node
  hosts: localhost
  connection: local
  gather_facts: false
  tasks:
    - name: Check release artifact exists
      ansible.builtin.stat:
        path: "{{ release_artifact_path }}"
      register: release_artifact
      changed_when: false

    - name: Assert release artifact is present
      ansible.builtin.assert:
        that:
          - release_artifact.stat.exists

- name: Roll application web hosts
  hosts: application_web
  become: true
  serial: 1
  any_errors_fatal: true
  tasks:
    - name: Disable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

    - name: Render application service config
      ansible.builtin.template:
        src: application.yml.j2
        dest: /etc/application/application.yml
        owner: root
        group: application
        mode: "0640"
      notify: Restart application app

    - name: Flush restart before checks
      ansible.builtin.meta: flush_handlers

    - name: Check local application health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
      changed_when: false

    - name: Enable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl enable --service application --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

  handlers:
    - name: Restart application app
      ansible.builtin.service:
        name: application
        state: restarted
```

The first play runs on the control node because it checks the release artifact in the runner workspace. The second play runs host-local config and service work on each application web host. The load balancer operations delegate to `lb-admin-01` because that is where the control-plane tool and credentials live.

That structure makes failures easier to read. If the artifact check fails, fix the CI workspace or release packaging. If the service restart fails, inspect the app host. If the load balancer command fails, inspect the admin host, its credentials, or the load balancer API.

Read the deployment as a series of viewpoints. The controller sees the repository artifact. Each web host sees its local files, service, and loopback endpoint. The admin host sees the load-balancer control plane. `inventory_hostname` keeps the subject stable while delegation moves the viewpoint used to act on that subject.

The deepest model is:

```text
task subject
  + execution location
  + execution identity and credentials
  + repetition and batch scope
  + fact ownership
  + recovery location
= the task's real operational boundary
```

Once the execution boundary is clear, CI has a familiar role in the deployment. A CI runner is a control node with a clean workspace, short-lived credentials, job logs, and approval gates. The next article shows how to make that runner predictable and safe.

Boundary-aware task names improve incident response. Include the subject and delegated purpose—such as “remove current web host from load balancer through admin node”—without embedding secret values. The output then tells operators which system to inspect even when the underlying command error mentions only a missing local path or denied API request.

Recovery may cross boundaries too. A failed application host can be rebuilt from the controller, kept drained through the admin node, and verified through an external synthetic check. Name and credential each recovery step according to its executor; do not assume the host that failed remains capable of repairing itself.

Module names do not change the default execution host. Package work such as `ansible.builtin.apt`, file ownership through `ansible.builtin.file`, and partial edits through `ansible.builtin.lineinfile` normally operate in each current host's context. A task becomes local only through an explicit local play, `connection: local`, `delegate_to: localhost`, or a local action pattern. Make that boundary visible because local mutation changes the controller, not the managed fleet.

## Check Your Answers

:::expand[Where Does a Task Run by Default?]{kind="recap"}
The current managed host is normally both subject and executor. Paths, tools, network access, and permissions therefore belong to that host unless the task explicitly moves.
:::

:::expand[When Should a Task Run on the Control Node?]{kind="recap"}
Use local execution for controller files, APIs, and shared preflight work. Pin the controller's dependencies and remember that its network and credentials differ from managed hosts.
:::

:::expand[How Does Delegation Move One Task?]{kind="recap"}
`delegate_to` moves execution while `inventory_hostname` remains the subject. The delegated machine needs the tools, routes, credentials, and capacity for the operation.
:::

:::expand[How Do run_once and Serial Batches Interact?]{kind="recap"}
`run_once` reduces initiators within the current batch; `serial` defines that batch. Use a separate play when a task must run exactly once for the whole rollout.
:::

:::expand[Who Owns Facts Gathered Through Delegation?]{kind="recap"}
By default, delegated facts attach to the current subject. `delegate_facts: true` stores observations under the delegated host when that host is what the data describes.
:::

:::expand[How Do Boundaries Change Security and Capacity?]{kind="recap"}
Execution location controls privilege, secrets, network reach, tools, and resource use. Delegation can reduce application-host privilege while concentrating risk on a shared executor.
:::

:::expand[How Do You Diagnose the Wrong Boundary?]{kind="recap"}
Interpret missing files, commands, permissions, APIs, and facts on the machine that actually executed the task. Verify prerequisites and design recovery at that same boundary.
:::

:::expand[How Do You Design a Multi-Boundary Rollout?]{kind="recap"}
Separate local preflight, per-host state changes, delegated control-plane work, fact ownership, concurrency, and recovery so every failure points to the correct system.
:::

---

**References**

- [Controlling where tasks run: delegation and local actions](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_delegation.html) - Official guide for `delegate_to`, local actions, delegated facts, and local playbooks.
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html) - Documents `serial`, `run_once`, `throttle`, and related execution behavior.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Covers failure behavior, handlers, rescue blocks, and stop conditions that interact with execution boundaries.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Command reference for playbook execution, connection, inventory, and limit options.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertions used for local and delegated preflight checks.
