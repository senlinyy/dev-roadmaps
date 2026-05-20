---
title: "What Is Ansible"
description: "Understand what Ansible is, what problem it solves, and how it changes machines without a permanent agent."
overview: "Ansible is an automation tool for configuring machines and running repeatable operations before the roadmap moves into inventories and safer run workflows."
tags: ["ansible", "configuration", "modules", "idempotency"]
order: 1
id: article-cloud-iac-infrastructure-as-code-config-mgmt-ansible
aliases:
  - config-mgmt-ansible
  - infrastructure-as-code/ansible/config-mgmt-ansible.md
  - cloud-iac/infrastructure-as-code/config-mgmt-ansible.md
  - child-infrastructure-as-code-config-mgmt-ansible
---

## Table of Contents

1. [The Problem](#the-problem)
2. [What Ansible Is](#what-ansible-is)
3. [The Main Pieces](#the-main-pieces)
4. [Control Nodes and Managed Nodes](#control-nodes-and-managed-nodes)
5. [Playbooks and Modules](#playbooks-and-modules)
6. [Idempotency](#idempotency)
7. [Reading Ansible Output](#reading-ansible-output)
8. [Where Ansible Fits](#where-ansible-fits)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem

The orders service starts small. One Linux machine runs Nginx, a systemd service called `orders-api`, and a config file under `/etc/orders/`. A person can set that up by hand and remember most of the steps.

Then the service grows. There are two web hosts, a staging environment, and a production environment. A security update lands. Nginx needs the same proxy timeout everywhere. The `orders-api` service must be enabled after every rebuild. A new engineer needs to know whether the host they are looking at is correct or just lucky.

Manual setup begins to fail in ordinary ways:

- `orders-web-01` has the new Nginx config, but `orders-web-02` still has the old one.
- A production host was rebuilt, but nobody reran the service setup steps.
- A hotfix changed a file during an incident, and the change was never written down.
- A command worked in staging, but someone ran a slightly different command in production.

The problem is not that people are careless. The problem is that a server is a collection of many small states: packages, files, users, directories, permissions, services, and scheduled jobs. When those states live only in terminal history or a runbook, they drift.

Runbook memory has the same weakness as console memory in cloud infrastructure. It can describe what someone thinks they did, but it rarely proves the exact file content, service enablement, package version, target host, privilege path, or review that approved the change.

Ansible gives the team a way to write those states down, run them against real machines, and ask whether each machine already matches the description.

## What Ansible Is

Ansible is an automation tool for configuring machines and running repeatable operations. You write files that describe what should be true. Ansible connects to the machines in an inventory, performs the requested work, and reports what happened on each host.

For the orders service, an Ansible project might describe these facts:

- The `nginx` package should be installed.
- `/etc/nginx/conf.d/orders.conf` should contain the reviewed proxy config.
- The `orders-api` service should be enabled and running.
- `/var/log/orders` should exist with the right owner and permissions.

Those sentences are the important part. Ansible is useful because the desired state moves out of memory and into files the team can read, review, and rerun.

That file boundary is why Ansible belongs in infrastructure as code work. A playbook turns machine configuration into a reviewed artifact before it touches hosts. Inventory shows which machines can be reached. Variables show which values change by group or environment. The recap then gives run evidence: which hosts already matched, which changed, which failed, and which could not be reached.

Ansible is commonly called agentless. For Linux hosts, that usually means the managed machines do not need a permanent Ansible service running in the background. The control machine connects over SSH, runs the work needed for the current task, receives a result, and moves on.

Agentless does not mean nothing runs on the remote host. A task still has to check packages, write files, render templates, or restart services. The difference is that Ansible does that work through the connection for the current run instead of depending on a long-running agent process.

## The Main Pieces

Most beginner Ansible work uses a small vocabulary.

| Piece | Meaning | Orders example |
| --- | --- | --- |
| Control node | The machine where Ansible runs | A developer laptop or CI runner |
| Managed node | A machine Ansible connects to and changes | `orders-web-01` |
| Inventory | The host map Ansible reads before a run | `inventory/prod.yml` |
| Group | A named set of hosts | `orders_web` |
| Playbook | A YAML file that describes work | `playbooks/orders-web.yml` |
| Play | One target and its tasks inside a playbook | Configure `orders_web` |
| Task | One named step | Install Nginx |
| Module | Code that knows how to do one kind of work | `ansible.builtin.apt` |

The inventory is the map. It says which machines exist and how Ansible should reach them.

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.40.10.21
        orders-web-02:
          ansible_host: 10.40.10.22
      vars:
        ansible_user: deploy
```

The names `orders-web-01` and `orders-web-02` are Ansible's names for the hosts. The `ansible_host` values are the addresses used for the SSH connection. The group `orders_web` lets a playbook target both machines without listing them again.

The playbook is the work description. It says which hosts should receive the work and which tasks should run.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: nginx
        state: present

    - name: Keep nginx running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```

This play selects the `orders_web` group. `become: true` tells Ansible to use privilege escalation for tasks that need it, usually through sudo. Each task calls a module.

## Control Nodes and Managed Nodes

The control node is where Ansible starts. It reads the inventory, reads the playbook, opens connections, and collects results. The managed nodes are the hosts that receive the work.

For a simple Linux fleet, the path looks like this:

```text
control node
  reads inventory
  reads playbook
  connects over SSH
  runs task work
        |
        v
managed nodes
  orders-web-01
  orders-web-02
  return results
```

This split explains several failures that look confusing at first. If Ansible says a host is `UNREACHABLE`, the playbook task has not started. The control node could not connect to the managed node. The cause is usually the address, DNS, SSH user, key, network path, bastion, firewall, or host key.

If Ansible reaches the host and then a task fails, the connection layer worked. The next question is the task itself: the package name, file path, service name, module arguments, privilege escalation, or remote operating system.

That separation is one of the first useful habits in Ansible. Do not debug a package task until the connection works. Do not debug SSH when the failure is actually a sudo error.

## Playbooks and Modules

A playbook is a YAML file that Ansible can run. A playbook contains one or more plays. Each play chooses hosts and then runs tasks against those hosts.

A module is the unit of work behind a task. The `apt` module knows how to manage Debian and Ubuntu packages. The `template` module knows how to render a Jinja2 template into a file. The `service` module knows how to start, stop, enable, or disable services.

This matters because a module usually understands state. A package module can check whether a package is already installed. A service module can check whether a service is already running. A file module can check ownership and permissions before changing them.

A task using a module reads like this:

```yaml
- name: Create orders log directory
  ansible.builtin.file:
    path: /var/log/orders
    state: directory
    owner: orders
    group: orders
    mode: "0750"
```

The task does not say "run `mkdir`, then run `chown`, then run `chmod`." It says what the directory should look like. The module decides whether anything has to change.

Ansible can also run raw commands and shell commands. Those are useful when no module fits, but they are easier to misuse. A shell command often describes an action, not a final state. That distinction becomes important when the same playbook runs again.

## Idempotency

Idempotency means running the same task many times leaves the host in the same final state as running it once. In configuration work, this is a practical safety property. It lets the orders team rerun a playbook after a failed deployment, a rebuild, or a suspected manual change.

This task is idempotent because it describes a desired package state:

```yaml
- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present
```

If Nginx is missing, Ansible installs it and reports `changed`. If Nginx is already installed, Ansible reports `ok`. The second run should not reinstall the package just because the task appeared in the playbook.

Now compare that with a shell task:

```yaml
- name: Add proxy timeout
  ansible.builtin.shell: echo "proxy_read_timeout 30s;" >> /etc/nginx/conf.d/orders.conf
```

This appends a line every time the playbook runs. After five runs, the file may have five copies of the same setting. The task changed the file, but it did not describe the final shape of the file.

A better task describes the line that should exist:

```yaml
- name: Set proxy timeout
  ansible.builtin.lineinfile:
    path: /etc/nginx/conf.d/orders.conf
    regexp: "^proxy_read_timeout"
    line: "proxy_read_timeout 30s;"
```

This gives Ansible enough information to search for the existing setting, replace it if needed, and avoid adding duplicates. The practical surprise is that the safer task is often less about the command you would type by hand and more about the state you want the host to settle into.

## Reading Ansible Output

Ansible reports a result for each task on each host. The result words are small, but they tell you which layer to inspect.

```text
TASK [Install nginx] changed: [orders-web-01]
TASK [Install nginx] ok: [orders-web-02]

PLAY RECAP
orders-web-01 : ok=6 changed=1 unreachable=0 failed=0
orders-web-02 : ok=6 changed=0 unreachable=0 failed=0
```

This output says `orders-web-01` needed a package change and `orders-web-02` already matched the task.

| Result | Meaning |
| --- | --- |
| `ok` | The task ran and the host already matched the requested state. |
| `changed` | The task ran and changed the host. |
| `failed` | Ansible reached the host, but the task did not finish successfully. |
| `unreachable` | Ansible could not connect to the host. |
| `skipped` | Ansible did not run the task because a condition or mode skipped it. |

The recap is a short report about drift. Treat it as more than a green or red ending. If a stable playbook changes the same file on every run, the task may be rewriting content with a timestamp, appending data, or using a command that cannot tell whether the desired state already exists.

## Where Ansible Fits

Ansible is strongest when you need to configure systems you can reach. It is commonly used for packages, users, files, templates, services, scheduled jobs, release steps, and operational checks.

Terraform usually works at a different layer. It creates and manages infrastructure resources through provider APIs: networks, virtual machines, load balancers, DNS records, buckets, databases, and IAM policies.

For the orders service, a common split is:

| Tool | Typical job |
| --- | --- |
| Terraform | Create the network, virtual machines, load balancer, DNS, and firewall rules. |
| Ansible | Configure Nginx, service files, users, directories, and `orders-api` on the machines. |

The tools can overlap. Ansible has cloud modules. Terraform can pass startup scripts to machines. The simple model is still useful: Terraform often shapes the infrastructure, and Ansible often configures what runs inside the machines after they exist.

Ansible also has limits. It depends on a connection path. It needs credentials and privilege rules. A task can be accurate for Ubuntu and wrong for RHEL. A broad host pattern can reach too many machines. A shell task can look harmless but change the host every time. These limits do not make Ansible weak; they explain why inventory, workflow, variables, privilege, and targeting deserve their own articles.

## Putting It All Together

The orders team started with hosts that could drift:

- One host could have the new Nginx config while another kept the old file.
- A rebuilt host could miss the `orders-api` service setup.
- An incident hotfix could disappear from the team's written process.
- A repeated command could slowly make a file worse.

Ansible answers those problems by putting the host map in inventory and the desired machine state in playbooks. The control node connects to managed nodes, modules inspect current state, and task results show whether each host changed, failed, or already matched.

The useful mental model is simple: inventory says where the orders hosts are, playbooks say what should be true on them, modules do the state-aware work, and the recap tells you what actually happened.

## What's Next

The next article turns this model into a safe first workflow. It starts by reading the inventory, then tests remote execution, previews supported changes, applies the playbook, reads the recap, and runs again to see whether the hosts settled.

---

**References**

- [Getting started with Ansible](https://docs.ansible.com/projects/ansible/latest/getting_started/index.html)
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Creating a playbook](https://docs.ansible.com/projects/ansible/latest/getting_started/get_started_playbook.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
