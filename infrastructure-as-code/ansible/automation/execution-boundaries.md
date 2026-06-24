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

1. [Where a Task Runs](#where-a-task-runs)
2. [The Default Remote Boundary](#the-default-remote-boundary)
3. [Running on the Control Node](#running-on-the-control-node)
4. [Delegating to Another Host](#delegating-to-another-host)
5. [run_once and Batch Behavior](#run_once-and-batch-behavior)
6. [delegate_facts](#delegate_facts)
7. [Security and Capacity Boundaries](#security-and-capacity-boundaries)
8. [Verification and Failure Reading](#verification-and-failure-reading)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Where a Task Runs
<!-- section-summary: An execution boundary is the place where a task actually runs: the selected host, the control node, or another delegated host. -->

Ansible playbooks read as one flow. Each task still has a location, and that location controls which files, network routes, Python packages, command-line tools, and credentials are available. A package task may run on a web host. A release artifact check may run on the CI runner. A load balancer API call may run from a bastion host.

Let's use the orders platform again. A deployment updates `orders-web-01`, drains it from the load balancer, copies a new config file, restarts the app, checks local health, and then adds the host back to the pool. The file and service tasks belong on `orders-web-01`. The load balancer command may belong on `lb-admin-01`, because that host has the `lbctl` tool and the right network path.

An **execution boundary** names where one task runs and which inventory host receives the result. Many confusing Ansible failures come from this choice, especially "file not found", "command not found", and "permission denied" errors that appear even when the YAML syntax is fine.

There are three common locations. The default is the current managed host selected by the play. Local execution runs on the control node, which may be a laptop, CI runner, or automation controller execution environment. Delegation runs a task on another host while keeping the task associated with the current inventory host.

| Symptom | First place to check |
|---|---|
| `No such file or directory` | The filesystem of the machine where the task ran |
| `command not found` | The PATH and installed tools on the execution machine |
| `permission denied` | The user and credentials at the execution boundary |
| Missing API access | The control node or delegated host credentials |
| Wrong fact value | Whether the fact belongs to the current host or delegated host |

## The Default Remote Boundary
<!-- section-summary: By default, Ansible runs each task on the current host selected by the play, which fits host-local state. -->

The default Ansible boundary is remote execution on the current managed host. If a play targets `orders_web`, Ansible connects to each orders web host and runs the task there.

```yaml
- name: Install orders package
  ansible.builtin.package:
    name: orders-web
    state: present
```

This is the right boundary for host-local state. Packages, files, users, groups, systemd services, directories, local health endpoints, and host-specific commands usually belong on the managed host. The task changes or checks the machine that the play is currently processing.

The default boundary also controls where paths are resolved. If a command task says `cmd: /usr/local/bin/ordersctl status`, that path must exist on the managed host. If a `stat` task checks `/tmp/release.tar.gz`, it checks the remote host's `/tmp`, and the control node workspace is a different filesystem.

That last point catches many beginners. The CI runner may have `build/orders-web.tar.gz`, but a remote `stat` task will look for that file on `orders-web-01`. If the file exists only in the checked-out repository on the runner, the task should be local or delegated.

## Running on the Control Node
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

`run_once` is important here because the release artifact is shared. Without it, Ansible would run the same delegated `stat` once for each selected orders host, all on localhost. That is harmless for a quick `stat`, but noisy and confusing in deployment logs.

You can also run an entire play locally:

```yaml
- name: Validate orders release metadata locally
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

## Delegating to Another Host
<!-- section-summary: delegate_to runs the task somewhere else while keeping the result attached to the current host in the rollout. -->

`delegate_to` points a task at another execution host. The current inventory host remains the host being processed, but the module runs on the delegated host. This is perfect for orchestration around a target host.

For the orders platform, the load balancer admin tool exists on `lb-admin-01`. The rollout still needs a per-web-host story: disable this web host, update this web host, check this web host, enable this web host. Delegation gives you that story.

```yaml
- name: Disable current host in load balancer
  ansible.builtin.command:
    cmd: "lbctl disable --service orders --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01

- name: Restart orders service on current host
  ansible.builtin.service:
    name: orders
    state: restarted

- name: Enable current host in load balancer
  ansible.builtin.command:
    cmd: "lbctl enable --service orders --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
```

The task result appears under the current orders host in output, because the operation is part of that host's rollout. The command itself runs on `lb-admin-01`, so `lbctl`, API credentials, network routes, and config files need to exist there.

Delegating to a host that is in inventory is usually clearer than delegating to a raw IP or hostname that Ansible has never seen. Inventory gives the delegated host variables, connection settings, Python interpreter settings, and a name people recognize in logs.

Task names should make delegation obvious. A name like `Disable current host in load balancer` tells the reader why the command runs somewhere else and why `inventory_hostname` still refers to the web host.

## run_once and Batch Behavior
<!-- section-summary: run_once reduces repeated work, and serial batches change whether run_once means once per play or once per batch. -->

`run_once: true` tells Ansible to run a task once for the current host set instead of once per host. It is useful for shared checks, release metadata reads, one-time notifications, and global API calls.

```yaml
- name: Announce orders deployment start
  ansible.builtin.uri:
    url: "{{ deploy_events_url }}"
    method: POST
    body_format: json
    body:
      service: orders
      version: "{{ orders_release_version }}"
      status: started
  delegate_to: localhost
  run_once: true
```

With rolling updates, `serial` changes the story. A `run_once` task inside a play with `serial: 2` runs once for each batch. That behavior is useful for batch-level notifications or checks. It can surprise people when the task was meant to run only once for the whole deployment.

For a truly global task, use a separate localhost play before the rolling play, or add a condition that selects one stable host from the full play:

```yaml
- name: Run one global preflight for the full orders rollout
  ansible.builtin.command:
    cmd: ordersctl deployment-preflight --version "{{ orders_release_version }}"
  delegate_to: localhost
  run_once: true
  when: inventory_hostname == ansible_play_hosts_all[0]
  changed_when: false
```

The separate-play option is often easier for beginners to read. Use the conditional pattern when the task needs variables from the rolling play and the team understands how `serial` affects execution.

## delegate_facts
<!-- section-summary: delegate_facts decides whether facts gathered through delegation attach to the current host or to the host that produced them. -->

Facts are host data that Ansible stores in `hostvars`. CPU details, IP addresses, OS information, and custom discovered values can all become facts. Delegation makes facts tricky because the task runs on one host while the play is processing another host.

By default, facts gathered by a delegated task are assigned to the current inventory host. `delegate_facts: true` tells Ansible to assign those facts to the delegated host instead.

Imagine an orders web play that needs database host information, even though the database group is outside the current play. The play can gather facts from database hosts and store them with the database hosts. Later tasks can then read database facts from the place readers expect:

```yaml
- name: Gather facts from orders database hosts
  ansible.builtin.setup:
  delegate_to: "{{ item }}"
  delegate_facts: true
  loop: "{{ groups['orders_db'] }}"
  run_once: true
```

After this task, `hostvars` for the database hosts contain the gathered facts. That lets later tasks read values like `hostvars['orders-db-01']['ansible_default_ipv4']['address']` even though the play targets `orders_web`.

Use this feature when the fact belongs to the delegated host. If the fact describes the current web host's rollout state, keep the default behavior. The point is to make `hostvars` match reality so later tasks and future readers can tell which machine a value describes.

## Security and Capacity Boundaries
<!-- section-summary: Execution location controls which credentials, tools, network paths, and shared resources a task can use, so delegation changes the risk profile. -->

Execution boundaries are also security boundaries. A task running on an orders web host can use files and credentials available to that host. A task delegated to localhost can use CI secrets, repository files, and runner environment variables. A task delegated to `lb-admin-01` can use load balancer credentials and network paths available there.

That difference should be deliberate. If every app host can call the load balancer API directly, a compromised app host may gain control-plane reach. If only `lb-admin-01` can call it, the playbook has a tighter operational path, and the delegated task acts as the controlled bridge.

Capacity matters too. Ten app hosts delegating work to one admin host can overload the admin host or trip an API rate limit. Combine delegation with `serial` and `throttle` when many hosts share the same delegated execution point.

```yaml
- name: Check load balancer target health through admin host
  ansible.builtin.command:
    cmd: "lbctl target-health --service orders --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
  throttle: 1
  register: lb_health
  changed_when: false
```

The same idea applies to cloud APIs, DNS updates, ticketing systems, and deployment event systems. The task may be logically attached to each app host, while the actual execution point is a shared control-plane location.

## Verification and Failure Reading
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

Rollback follows the same boundary. If a load balancer disable succeeded on `lb-admin-01` and the app update failed on `orders-web-02`, the recovery task may also need to run on `lb-admin-01` to keep the failed host out of rotation or to restore its previous state. The task location is part of the incident response.

## Putting It All Together
<!-- section-summary: A clear deployment separates local preflight, delegated load balancer control, remote host changes, and delegated recovery. -->

Here is a full orders rollout shape with clear boundaries:

```yaml
- name: Validate orders release on control node
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

- name: Roll orders web hosts
  hosts: orders_web
  become: true
  serial: 1
  any_errors_fatal: true
  tasks:
    - name: Disable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

    - name: Render orders service config
      ansible.builtin.template:
        src: orders.yml.j2
        dest: /etc/orders/orders.yml
        owner: root
        group: orders
        mode: "0640"
      notify: Restart orders app

    - name: Flush restart before checks
      ansible.builtin.meta: flush_handlers

    - name: Check local orders health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
      changed_when: false

    - name: Enable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl enable --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

  handlers:
    - name: Restart orders app
      ansible.builtin.service:
        name: orders
        state: restarted
```

The first play runs on the control node because it checks the release artifact in the runner workspace. The second play runs host-local config and service work on each orders web host. The load balancer operations delegate to `lb-admin-01` because that is where the control-plane tool and credentials live.

That structure makes failures easier to read. If the artifact check fails, fix the CI workspace or release packaging. If the service restart fails, inspect the app host. If the load balancer command fails, inspect the admin host, its credentials, or the load balancer API.

## What's Next

Once the execution boundary is clear, CI has a familiar role in the deployment. A CI runner is a control node with a clean workspace, short-lived credentials, job logs, and approval gates. The next article shows how to make that runner predictable and safe.

---

**References**

- [Controlling where tasks run: delegation and local actions](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_delegation.html) - Official guide for `delegate_to`, local actions, delegated facts, and local playbooks.
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html) - Documents `serial`, `run_once`, `throttle`, and related execution behavior.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Covers failure behavior, handlers, rescue blocks, and stop conditions that interact with execution boundaries.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Command reference for playbook execution, connection, inventory, and limit options.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertions used for local and delegated preflight checks.
