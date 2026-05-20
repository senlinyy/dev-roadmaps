---
title: "Patterns, Limits, and Canaries"
description: "Use host patterns and limits to keep an Ansible run inside the intended target set."
overview: "After inventory defines the map, each Ansible run still needs a precise target."
tags: ["ansible", "patterns", "limits", "rollouts"]
order: 4
id: article-infrastructure-as-code-ansible-patterns-limits-canaries
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Host Patterns](#host-patterns)
3. [Limits](#limits)
4. [List Before You Run](#list-before-you-run)
5. [Canary Runs](#canary-runs)
6. [Batches and Blast Radius](#batches-and-blast-radius)
7. [Common Targeting Mistakes](#common-targeting-mistakes)
8. [Putting It All Together](#putting-it-all-together)

## The Problem

Inventory defines the map, but every Ansible run still needs a target. A playbook can say `hosts: orders_web`. A command can add `--limit orders-web-01`. An ad hoc command can name a group directly. The final host set comes from how these pieces combine.

For the orders service, targeting is a safety control. The same Nginx playbook might be useful for:

- Previewing one production host before a rollout.
- Updating both orders web hosts after the first host is healthy.
- Excluding a host that is already drained for maintenance.
- Running only against staging while production remains untouched.

The task content may be correct, but a broad target can still cause damage. A playbook that reloads Nginx on every web host in every service is not safe just because the template is valid.

## Host Patterns

A host pattern is the expression Ansible uses to select hosts from inventory. In a playbook, the pattern appears in `hosts`.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  tasks:
    - name: Check connectivity
      ansible.builtin.ping:
```

Here, `orders_web` is the pattern. It tells Ansible to run the play on every host in that group.

Ad hoc commands also use patterns. This command targets one host:

```bash
ansible orders-web-01 -i inventory/prod.yml -m ansible.builtin.ping
```

This command targets the group:

```bash
ansible orders_web -i inventory/prod.yml -m ansible.builtin.ping
```

Patterns can do more than name a host or group. Ansible supports combinations such as intersections and exclusions. For example, a team may want orders web hosts in production except the current maintenance host.

Those expressions are powerful, but readability matters. A clear group name like `orders_web` is easier to review than a clever pattern that only one person understands. If a pattern is hard to explain out loud, it is risky during an incident or deployment.

## Limits

`--limit` narrows the host set for the current command. It cannot add hosts outside the play's pattern. It can only reduce what the play already selected.

If the playbook says:

```yaml
hosts: orders_web
```

then this command runs the play only on `orders-web-01`:

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders-web-01
```

The limit is useful for first-host runs, checks, and careful rollouts. It also makes the operator's intent visible in shell history and CI logs.

The practical surprise is that `--limit` is not a replacement for good playbook targets. A playbook with `hosts: all` and a remembered `--limit orders_web` is fragile. One missed limit can turn a service change into a fleet-wide change. The playbook should start narrow, and the limit should narrow it further when needed.

## List Before You Run

Before a risky run, ask Ansible to print the matched hosts. This resolves the play pattern, inventory, and limit into the actual host list.

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders-web-01 \
  --list-hosts
```

Example output:

```text
play #1 (orders_web): Configure orders web hosts
  hosts (1):
    orders-web-01
```

This command does not run the tasks. It shows the target set. If the list is wrong, stop before changing machines.

Use the same habit when widening the rollout:

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders_web \
  --list-hosts
```

Example:

```text
play #1 (orders_web): Configure orders web hosts
  hosts (2):
    orders-web-01
    orders-web-02
```

The resolved list is the truth. The command line may look safe, but the host list tells you what Ansible will actually touch.

## Canary Runs

A canary run applies a change to a small part of the target set before the rest. For the orders service, that usually means one web host.

The first real run might be:

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders-web-01
```

After the run, the team checks the host:

- Does Nginx reload cleanly?
- Does `/health` return success?
- Are orders requests still reaching `orders-api`?
- Do logs show unexpected errors?

If the canary host is healthy, the team widens the run:

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml \
  --limit orders_web
```

A canary is a targeting habit. The first blast radius is one host. The evidence from that host informs the next run.

Canaries work best when inventory names are meaningful. `orders-web-01` tells the reader which service and tier is changing. A raw IP address tells the reader much less.

## Batches and Blast Radius

For two orders web hosts, a one-host canary followed by the group may be enough. Larger groups need batching. Ansible playbooks can use `serial` to control how many hosts run through a play at a time.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  serial: 1
  tasks:
    - name: Render nginx config
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
```

With `serial: 1`, Ansible completes the play for one host before moving to the next. This can reduce blast radius when a service has several hosts behind a load balancer.

Batching does not replace health checks. If a task renders a bad config and the service reload fails, you still need the run to stop, report the failure, and leave enough capacity healthy. Batching controls how quickly the change spreads.

Use the simplest control that matches the risk:

| Situation | Targeting habit |
| --- | --- |
| New playbook | Run one explicit host first. |
| Routine two-host service change | Canary one host, then the service group. |
| Larger service tier | Use a narrow group and consider `serial`. |
| Emergency one-host fix | Limit to the exact host and list hosts first. |

## Common Targeting Mistakes

The most common targeting mistake is trusting the name of a group without checking its members. A group called `canary` may be stale. A group called `web` may include unrelated services. A group called `prod` may be too broad for a service-level change.

Another mistake is using `--limit` as the only safety layer. Limits are useful, but the playbook's `hosts` pattern should still describe the intended service or tier. A narrow playbook plus a narrower limit is safer than a broad playbook plus a habit people must remember.

Pattern syntax can also become too clever. Intersections and exclusions are useful when they make the target clearer. They are risky when readers cannot quickly predict the host list. If you need an advanced pattern, use `--list-hosts` and show the resolved list in review or deployment logs.

Finally, remember that targeting controls where tasks run. It does not make the tasks themselves safe. A canary run with a non-idempotent shell command can still damage the canary host. Targeting, idempotent tasks, check mode, and readable output work together.

## Putting It All Together

The orders team uses inventory to define `orders_web`, but each run still needs a precise target.

The safe targeting model is:

- Use narrow group names such as `orders_web`.
- Keep playbook `hosts` patterns aligned with the service or tier being changed.
- Use `--limit` to narrow a specific run.
- Use `--list-hosts` before important changes.
- Start with a canary host when the change is new or risky.
- Use batching, such as `serial`, when a larger group should change gradually.

Inventory says what exists. Patterns say what a play can select. Limits narrow the current run. The resolved host list is what Ansible will touch.

---

**References**

- [Patterns: targeting hosts and groups](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_patterns.html)
- [ansible-playbook command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html)
