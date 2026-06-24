---
title: "Targeting Host Patterns"
description: "Use host patterns and limits to keep an Ansible run inside the intended target set."
overview: "After inventory defines the map, each Ansible run still needs a precise target."
tags: ["ansible", "patterns", "limits", "rollouts"]
order: 4
id: article-infrastructure-as-code-ansible-patterns-limits-canaries
---

## Table of Contents

1. [Why Targeting Needs Two Layers](#why-targeting-needs-two-layers)
2. [Host Patterns in Playbooks](#host-patterns-in-playbooks)
3. [Runtime Limits](#runtime-limits)
4. [Canary Runs](#canary-runs)
5. [Batches, Serial, and Failure Stops](#batches-serial-and-failure-stops)
6. [Tags Choose Tasks](#tags-choose-tasks)
7. [Verifying the Target Set](#verifying-the-target-set)
8. [Failure Reading and Rollback](#failure-reading-and-rollback)
9. [Putting It All Together](#putting-it-all-together)
10. [References](#references)

## Why Targeting Needs Two Layers
<!-- section-summary: Patterns choose the normal host set, and limits narrow a specific run so the blast radius stays visible. -->

Inventory answers which machines exist. A **host pattern** answers which of those machines a playbook normally manages. A **runtime limit** narrows that normal set for one run, so an operator or pipeline can start with a canary, a region, or a single broken host.

For the orders platform, the web deploy playbook should normally manage `prod_web`. That is the real service group. During a first production rollout, the team should narrow the run to `orders-web-01`, watch the service, and then continue to the rest of `prod_web`.

This two-layer habit keeps the playbook honest. The playbook says the broad operational intent, while the command line or job template says the rollout slice for today. A targeting mistake can hurt even when every task is correct, so the target set deserves its own review before any production change starts.

With this inventory, the examples have visible boundaries:

```yaml
all:
  children:
    prod_web:
      hosts:
        orders-web-01:
        orders-web-02:
        orders-web-03:
    prod_workers:
      hosts:
        orders-worker-01:
```

`hosts: prod_web` selects the normal web fleet. `--limit orders-web-01` narrows that selection to one host. A limit cannot turn a worker host into a web host for that play because the runtime limit intersects with the play's host pattern.

## Host Patterns in Playbooks
<!-- section-summary: The hosts field is a pattern that can select groups, hosts, intersections, exclusions, and all hosts. -->

A **pattern** is Ansible's expression for selecting hosts from inventory. In a playbook, the `hosts` field is a pattern. It can name one host, one group, all hosts, or a combination of groups and hosts.

```yaml
- name: Deploy orders web application
  hosts: prod_web
  become: true
  tasks:
    - name: Install the selected orders package
      ansible.builtin.package:
        name: "orders-web-{{ orders_package_version }}"
        state: present
```

This play targets `prod_web` because the playbook manages production web hosts. The playbook should usually use a stable group that matches the service boundary. That way, adding `orders-web-03` to the inventory automatically brings it into the normal web deploy path after review.

Patterns can also express combinations. A union selects either side, an intersection requires both sides, and an exclusion removes a subset. Shell quoting matters because characters such as `!` and `&` can have meaning before Ansible receives them.

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit 'prod_web:&region_us_east_1'
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit 'prod_web:!orders-web-02'
ansible-playbook -i inventories/prod baseline.yml --limit 'prod:!prod_reporting'
```

Those examples all use the playbook's normal target and then narrow it at runtime. The first reaches production web hosts in one region, the second reaches production web hosts except one host, and the third runs a baseline across production while leaving reporting alone.

## Runtime Limits
<!-- section-summary: --limit narrows the playbook's selected hosts without editing hosts in the playbook. -->

The `--limit` option narrows the host set selected by the playbook. This is useful because the playbook should describe the service it manages, while the run command describes how far this particular rollout should go.

For the orders web deploy, the first production run can limit to one host:

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit orders-web-01
```

After the canary passes, the next run can target the rest of the group with an exclusion:

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit 'prod_web:!orders-web-01'
```

This avoids editing `hosts:` from `prod_web` to one host and then trying to remember to change it back. The playbook keeps the normal service boundary, and the deployment record shows exactly which slice was used for each run.

Automation Controller and CI systems use the same idea. A job template can carry the inventory, credential, and playbook, while a prompted limit or pipeline parameter supplies `orders-web-01` for the canary. Larger teams often make the limit visible in approval screens because the target set is part of the change request.

## Canary Runs
<!-- section-summary: A canary changes one representative host first, then uses health checks before the rollout widens. -->

A **canary** is a small representative target that receives the change first. The goal is to observe real behavior with a small blast radius. Check mode can preview supported changes, and a canary then proves the actual package install, template render, service restart, health check, and traffic path on a real host.

For the orders platform, `orders-web-01` can leave the load balancer pool, receive the new package, restart the service, pass local health checks, and then rejoin the pool. If the service fails to start or error rates rise, the team stops with one web host affected.

A practical canary run might look like this:

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml \
  --limit orders-web-01 \
  --check --diff

ansible-playbook -i inventories/prod deploy-orders-web.yml \
  --limit orders-web-01

curl -fsS https://orders.example.com/health
```

The best canary is a normal member of the group. A host with a known special `host_vars` override may test the exception path while the usual path remains untested. A forgotten low-traffic host may hide performance problems that show up on normal traffic, so teams usually choose a representative host and record the choice in the deployment notes.

## Batches, Serial, and Failure Stops
<!-- section-summary: serial and failure controls let a playbook widen gradually after the first host succeeds. -->

`--limit` controls which hosts are eligible for a run. **Serial** controls how many of those hosts Ansible processes at a time inside the play. This is useful after the canary, because the team may want to update the remaining web servers in small batches instead of all at once.

```yaml
- name: Deploy orders web application
  hosts: prod_web
  serial:
    - 1
    - 50%
    - 100%
  max_fail_percentage: 20
  become: true
  tasks:
    - name: Install the selected orders package
      ansible.builtin.package:
        name: "orders-web-{{ orders_package_version }}"
        state: present
```

With this shape, Ansible starts with one host, then moves to half of the remaining selected hosts, then finishes the rest. `max_fail_percentage` can stop the play when too many hosts fail in a batch. Teams also use `any_errors_fatal: true` for operations where one host failure should stop the whole play immediately.

Serial batches help production safety, and they still rely on a correct target set. If the playbook says `hosts: all`, serial will carefully roll through the wrong boundary. Start with the pattern and limit, then use serial to control the pace.

## Tags Choose Tasks
<!-- section-summary: Tags choose which tasks run, while patterns and limits choose where those tasks run. -->

**Tags** select tasks inside the hosts already chosen by `hosts` and `--limit`. They solve a different problem from host targeting. Patterns and limits choose where work runs; tags choose which pieces of work run there.

```yaml
- name: Render orders config
  ansible.builtin.template:
    src: orders.yml.j2
    dest: /etc/orders/orders.yml
    mode: "0640"
  tags: [config]
  become: true

- name: Restart orders service
  ansible.builtin.service:
    name: orders-web
    state: restarted
  tags: [restart]
  become: true
```

Running with `--tags config` still targets every host selected by the playbook and limit. It only narrows the task list. That distinction matters during incidents because a command such as `--tags restart` can restart the service on every selected host if the limit is broad.

Use tags after the host boundary is already correct. A config-only canary should include both the host and the tag, because the tag changes the task list while the limit keeps the host boundary small. The command should show both choices together:

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml \
  --limit orders-web-01 \
  --tags config
```

Preview the task side the same way you preview the host side:

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --tags config --list-tasks
ansible-playbook -i inventories/prod deploy-orders-web.yml --list-tags
```

Those commands help reviewers catch tag designs that select half of a dependency chain. If `--tags config` renders a file but skips the validation task that protects it, the tag set needs cleanup before teams use it as a production shortcut.

## Verifying the Target Set
<!-- section-summary: --list-hosts and inventory graph checks make the selected hosts visible before tasks run. -->

Before a production run, make the target set visible. `--list-hosts` shows which hosts the playbook would affect after applying `hosts` and `--limit`. It is one of the simplest safety checks in Ansible work.

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --list-hosts
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit orders-web-01 --list-hosts
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit 'prod_web:!orders-web-01' --list-hosts
```

The inventory graph is also useful when a pattern feels confusing. It shows group membership before the playbook layer gets involved.

```bash
ansible-inventory -i inventories/prod --graph prod_web
```

In a pipeline, make these outputs easy to see before the approval gate. A human should be able to answer: which playbook, which inventory, which limit, and which hosts? That check catches many mistakes before Ansible reaches the first task.

## Failure Reading and Rollback
<!-- section-summary: Targeting failures usually come from empty intersections, shell quoting, broad tags, or unclear rollback limits. -->

An empty or surprising target list usually points to the pattern. If Ansible warns that it could not match a supplied host pattern, check spelling, group names, dynamic inventory output, and whether the limit intersects with the playbook's `hosts` value. A host outside `prod_web` is skipped in a play that targets `prod_web`, even if the runtime limit names that host.

Shell quoting can also change the command before Ansible sees it. Quote patterns that contain `!`, `&`, commas, or colons. This is especially important in CI scripts because a shell option or environment can make a command behave differently from a local terminal.

Rollback should be targeted with the same discipline as rollout. A failed canary should roll back on the canary host first, and the command should make that small boundary visible. The rollback command should be as specific as the deploy command:

```bash
ansible-playbook -i inventories/prod rollback-orders-web.yml --limit orders-web-01
```

For a failed batch, start from the recap. Write down which hosts reported `changed`, which hosts failed, and which hosts stayed untouched. Revert the Git change or restore the previous release value, run `--list-hosts` for the changed host set, roll back one host, verify service status and load balancer health, then widen across only the hosts that received the bad change.

If the wider rollout already reached several hosts, use the deployment record and `--list-hosts` to confirm the rollback target before starting. Tags can help select rollback tasks, and a clear limit still owns the host boundary.

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml \
  --limit 'orders-web-01,orders-web-02' \
  --tags rollback \
  --list-hosts
```

That preview matters because emergency commands are still production commands. The pressure is higher, so the target set should be extra visible before the rollback starts.

## Putting It All Together
<!-- section-summary: Safe Ansible targeting uses a stable playbook pattern, visible runtime limit, canary, batches, and explicit rollback boundary. -->

The orders team now has a full targeting workflow. The playbook targets `prod_web` because that is the normal service boundary. The first production run uses `--limit orders-web-01` as a canary, and `--list-hosts` makes the selected host visible before any task runs.

After the canary passes, the team runs the remaining web hosts with an exclusion pattern or with serial batches. Tags can narrow the task list, and the host boundary still comes from `hosts` and `--limit`. Rollback uses the same targeting checks as rollout.

This is the point where inventory, variables, connection settings, and targeting connect. Inventory names the hosts, variables describe them, connection settings let Ansible reach them, and patterns decide which ones receive a change. A safe Ansible run is the result of all four pieces lining up in the open.

---

**References**

- [Patterns: targeting hosts and groups](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_patterns.html)
- [ansible-playbook command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html)
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html)
- [Tags](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_tags.html)
- [ansible-inventory command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
- [Red Hat Ansible Automation Platform job templates](https://docs.redhat.com/en/documentation/red_hat_ansible_automation_platform/2.5/html/using_automation_execution/controller-job-templates)
