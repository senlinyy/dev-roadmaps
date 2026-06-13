---
title: "Rolling Updates and Serial Execution"
description: "Use --limit, serial batches, and health checks to keep Ansible changes inside a deliberate blast radius."
overview: "After previewing a change, the next safety layer is execution scope: one selected host, measured batches, and health checks between them."
tags: ["ansible", "limits", "serial", "rollouts"]
order: 4
id: article-infrastructure-as-code-ansible-safe-rollouts-check-mode-limits
aliases:
  - safe-rollouts-check-mode-limits
  - infrastructure-as-code/ansible/safe-rollouts-check-mode-limits.md
---

## Table of Contents

1. [The Rollout Boundary](#the-rollout-boundary)
2. [Start with --limit](#start-with---limit)
3. [Use serial for Batches](#use-serial-for-batches)
4. [Health Checks Between Batches](#health-checks-between-batches)
5. [Failure Thresholds and Handler Timing](#failure-thresholds-and-handler-timing)
6. [Concurrency Controls](#concurrency-controls)
7. [Rollback and Recovery](#rollback-and-recovery)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## The Rollout Boundary
<!-- section-summary: Safe rollouts control target selection, batch size, validation, and stop conditions before a bad change can affect the whole service. -->

Preview tells you what a playbook is likely to change. The next question is how much production you want to expose to the first real run. A playbook that updates every host at once can turn a small template mistake into a full service incident.

Let's keep the orders platform. The service runs behind a load balancer on six web hosts: `orders-web-01` through `orders-web-06`. A change updates the Nginx timeout, renders a new environment file, and restarts the app. The team wants one canary first, then two hosts at a time, with a health check before each batch finishes.

That rollout boundary has four parts. `--limit` chooses the first slice of inventory. `serial` controls how many hosts the play processes together. Health checks decide whether the current batch is safe. Failure thresholds decide when Ansible should stop instead of pushing onward.

This is operational safety in plain form. The YAML can still describe the whole desired state for `orders_web`, while the run command and play keywords decide how fast production receives it.

## Start with --limit
<!-- section-summary: --limit narrows a playbook run to a canary host, a subset, or an emergency target without changing the playbook's normal host pattern. -->

The playbook should usually target the honest service group:

```yaml
- name: Configure orders web fleet
  hosts: orders_web
  become: true
```

The first production apply can narrow that target with `--limit`. This keeps the playbook reusable while the operator controls the first slice at runtime.

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@prompt
```

That canary run proves real behavior on one host. It writes files, triggers handlers, restarts services, calls health checks, and exposes any host-specific surprises. If the run fails, the team investigates one host instead of a whole fleet.

After the canary succeeds, you can run the same playbook against the remaining group:

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit 'orders_web:!orders-web-01' \
  --vault-id prod@prompt
```

Inventory patterns can express intersections and exclusions, so keep the command visible in deployment records. A reviewer should be able to see whether the run selected one host, the whole group, or the whole group minus the canary.

Use `--limit` for emergency repair too. If `orders-web-03` drifted after a manual fix, a narrow run can restore that host without touching the healthy fleet. The playbook remains the same, and the target set carries the operational intent.

## Use serial for Batches
<!-- section-summary: serial tells Ansible how many selected hosts should move through the play together before the next batch starts. -->

`serial` controls batch size inside the play. If the play targets six hosts and `serial: 2`, Ansible processes two hosts through the play, then moves to the next two. This is the core Ansible rolling-update tool.

```yaml
- name: Configure orders web fleet
  hosts: orders_web
  become: true
  serial: 2
  tasks:
    - name: Render orders Nginx site
      ansible.builtin.template:
        src: orders-nginx.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
        owner: root
        group: root
        mode: "0644"
      notify: Reload nginx
```

For a six-host service, `serial: 2` keeps four hosts serving traffic while two restart. That assumes the service has enough capacity, the load balancer drains traffic correctly, and the health check catches broken hosts before the next batch starts. Batch size is a capacity decision as well as an Ansible setting.

A simple capacity check helps. If six equal web hosts each carry about 17% of traffic, a batch of two removes about a third of capacity during restart. If normal peak traffic already uses 75% of fleet capacity, that batch may overload the remaining hosts. A safer first rollout might use `serial: 1`, drain one host from the load balancer, wait for healthy traffic, and then continue.

`serial` can also use staged lists. This pattern starts with one host, moves to two hosts, and then takes larger batches after the first evidence is good. It writes the rollout shape directly into the play:

```yaml
serial:
  - 1
  - 2
  - "50%"
```

That shape fits production changes where the first host is the highest-risk moment. Once the canary and the first small batch pass, the team may accept a larger batch for the rest of the fleet.

One detail matters with `run_once`. When `run_once` appears inside a play using `serial`, Ansible runs it once per batch. That is useful for batch-level checks, and surprising for one-time global actions like a database migration. For truly global work, use a separate play or a condition that targets one specific host from the full play host list.

## Health Checks Between Batches
<!-- section-summary: Batch safety depends on checks that prove the current hosts are healthy before Ansible continues to the next hosts. -->

A batch boundary only helps when the playbook validates the batch before continuing. A service restart followed by no health check is just slower risk. The play should prove that the app is running and ready before the next batch starts.

For local service health, call the host's own endpoint:

```yaml
- name: Flush restart before health check
  ansible.builtin.meta: flush_handlers

- name: Check local orders health
  ansible.builtin.uri:
    url: "http://127.0.0.1:8080/health"
    status_code: 200
    return_content: false
  register: orders_health
  changed_when: false
```

`meta: flush_handlers` matters because handlers normally run later. If a template changed and notified a restart, the health check should observe the restarted service after it has consumed the new config.

For load-balanced services, local health may be only half of the story. The load balancer also needs to see the host as healthy before traffic can return. That check often runs from the control node or a dedicated admin host because the app host may not have credentials or network access to query the load balancer API.

Production teams often pair local checks with an outside signal. The playbook can prove `http://127.0.0.1:8080/health`, while the release checklist checks load balancer health, error-rate dashboards, or a synthetic checkout request. Local readiness tells you the process is up. External health tells you users can reach it through the real path.

```yaml
- name: Wait for current host to be healthy in the load balancer
  ansible.builtin.command:
    cmd: "lbctl target-health --service orders --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
  register: lb_health
  changed_when: false
  failed_when: lb_health.stdout != "healthy"
```

This task belongs to the current app host in the output, but it runs on `lb-admin-01`. That gives the rollout a clean per-host story: update this host, restart this host, prove the local app is healthy, prove the load balancer sees it as healthy, then move to the next host.

## Failure Thresholds and Handler Timing
<!-- section-summary: Failure controls decide when the play should stop, and handler timing decides whether changed hosts finish their restart path before validation. -->

By default, Ansible stops running tasks on a host after a task fails on that host and continues with other hosts. During a production rollout, that default may be too loose. If one host in a small batch fails a health check, continuing to the next batch can spread the same bad change.

Use `any_errors_fatal: true` when one host failure should stop the whole play. This fits changes where a single failure suggests a shared playbook or artifact problem.

```yaml
- name: Configure orders web fleet
  hosts: orders_web
  become: true
  serial: 2
  any_errors_fatal: true
```

Use `max_fail_percentage` when a small number of failures is acceptable but a larger rate should stop the rollout. Be careful with small batches because percentages can be unintuitive. With `serial: 2`, one failed host is already half the batch.

```yaml
- name: Configure orders web fleet
  hosts: orders_web
  become: true
  serial: 2
  max_fail_percentage: 0
```

Handlers deserve attention in failure paths. A task can render a config file and notify a handler, then a later task can fail before handlers run. That can leave a host with changed files and an old service process. Use `meta: flush_handlers` before health checks, and consider `force_handlers` only when the team understands that it can run notified handlers even after later task failures.

```yaml
- name: Validate Nginx config before reload
  ansible.builtin.command:
    cmd: nginx -t
  register: nginx_validate
  changed_when: false
  failed_when: nginx_validate.rc != 0

- name: Flush safe reload after validation
  ansible.builtin.meta: flush_handlers
```

This ordering gives the rollout a better failure story. Render the file, validate the config, then reload and check health. If validation fails, Ansible stops before reloading Nginx with a broken config.

## Concurrency Controls
<!-- section-summary: forks, throttle, order, and delegation shape how much work Ansible attempts at once inside and around serial batches. -->

`serial` controls host batch size. Other controls shape concurrency inside that batch. The most visible one is `forks`, which controls how many hosts Ansible can work on in parallel from the control node.

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders_web \
  --forks 10
```

If `serial: 2`, the serial batch still caps that play at two hosts at once. The serial batch is the tighter boundary. Forks still matter across broader plays and across tasks that target larger host sets.

`throttle` limits a specific task or block. This helps when a task calls a rate-limited API, uses a shared admin host, or performs a heavier operation than the rest of the play.

```yaml
- name: Query load balancer target health
  ansible.builtin.command:
    cmd: "lbctl target-health --service orders --host {{ inventory_hostname }}"
  delegate_to: lb-admin-01
  throttle: 1
  register: lb_health
  changed_when: false
```

`order` controls which hosts Ansible chooses first from the selected set. This can be useful when you want a stable or sorted order, but a named canary through `--limit` is usually clearer than relying on inventory ordering for the first production host.

Delegation can create hidden concurrency. If every app host delegates a load balancer task to the same admin host, that admin host receives multiple operations. `serial` and `throttle` keep that from becoming an accidental burst.

## Rollback and Recovery
<!-- section-summary: Rollback needs a prepared previous state, a target limit, and verification that the recovered hosts are healthy before the rollout resumes. -->

Rollback should be planned before the first apply. For the orders Nginx config, rollback might mean reverting the config change commit and rerunning the playbook against the failed host or batch. For a package deployment, rollback may mean pinning the previous package version and rerunning the role. For a database migration, rollback may require a separate database recovery plan.

A simple config rollback command uses the same narrow target:

```bash
git revert <change-commit>

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@prompt
```

If a batch fails after two hosts changed, keep the rollback target to that batch first. Restore those hosts, verify health, then decide whether to pause the rollout or fix forward. Avoid jumping straight back to the whole group while the failure cause is still unclear.

Ansible blocks can make local recovery clearer. A block can drain a host, update it, and re-add it to the load balancer. A rescue section can try to re-enable the host or leave a clear failure message when the update fails.

```yaml
- name: Update one orders host with load balancer recovery
  block:
    - name: Disable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01

    - name: Render orders Nginx site
      ansible.builtin.template:
        src: orders-nginx.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
      notify: Reload nginx

    - name: Flush reload before validation
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
  rescue:
    - name: Keep failed host out of load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
```

The rescue path should match your service design. Some teams prefer leaving a failed host out of rotation until a person investigates. Others prefer rolling back the local config and re-enabling the host automatically. The playbook should make that policy visible.

## Putting It All Together
<!-- section-summary: A production rollout combines a canary limit, serial batches, handler flushes, service checks, load balancer checks, and stop conditions. -->

Here is a complete rollout shape for the orders web fleet:

```yaml
- name: Roll orders web safely
  hosts: orders_web
  become: true
  serial:
    - 1
    - 2
    - "50%"
  any_errors_fatal: true
  tasks:
    - name: Disable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl disable --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

    - name: Render orders Nginx site
      ansible.builtin.template:
        src: orders-nginx.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
        owner: root
        group: root
        mode: "0644"
      notify: Reload nginx

    - name: Validate Nginx config
      ansible.builtin.command:
        cmd: nginx -t
      register: nginx_validate
      changed_when: false
      failed_when: nginx_validate.rc != 0

    - name: Flush reload before health checks
      ansible.builtin.meta: flush_handlers

    - name: Check local orders health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
        return_content: false
      changed_when: false

    - name: Enable current host in load balancer
      ansible.builtin.command:
        cmd: "lbctl enable --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      throttle: 1

    - name: Confirm load balancer sees current host healthy
      ansible.builtin.command:
        cmd: "lbctl target-health --service orders --host {{ inventory_hostname }}"
      delegate_to: lb-admin-01
      register: lb_health
      changed_when: false
      failed_when: lb_health.stdout != "healthy"

  handlers:
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

The first command can still use a narrow canary limit:

```bash
ansible-playbook -i inventories/prod orders.yml --limit orders-web-01 --vault-id prod@prompt
```

After the canary passes, the same playbook can continue through the group with its own serial stages:

```bash
ansible-playbook -i inventories/prod orders.yml --limit 'orders_web:!orders-web-01' --vault-id prod@prompt
```

That is the safety stack in order. Preview the change, apply it to one host, roll through controlled batches, validate each batch, and stop when the evidence says stop. Ansible gives you the controls, and the production process decides how strict they should be.

## What's Next

So far the safety discussion has focused on what Ansible changes and how quickly it changes hosts. The next article asks where a task actually runs. That matters because load balancer calls, artifact checks, API updates, and local validation often belong on the control node or a delegated host rather than on the app server being updated.

---

**References**

- [Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html) - Documents `serial`, `throttle`, `order`, `run_once`, and execution strategy behavior.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Command reference for `--limit`, `--forks`, inventory selection, and playbook execution flags.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Covers `any_errors_fatal`, `max_fail_percentage`, handler behavior, `failed_when`, and block rescue handling.
- [Controlling where tasks run: delegation and local actions](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_delegation.html) - Explains `delegate_to`, load balancer orchestration examples, and delegated task behavior.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Provides the preview step that usually comes before a controlled rollout.
