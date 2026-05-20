---
title: "Limits, Serial, and Rollouts"
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

1. [Why Scope Matters](#why-scope-matters)
2. [Limit](#limit)
3. [Serial](#serial)
4. [Handlers Before Health Checks](#handlers-before-health-checks)
5. [Health Checks](#health-checks)
6. [Failure Boundaries](#failure-boundaries)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Scope Matters

The previous article used check mode and diff mode to preview the `orders` port change. Preview output can catch a wrong host list, a wrong text change, or an accidental secret leak. It still does not change the service. At some point, Ansible has to run for real.

That is where execution scope matters. Ansible applies the same instructions to every selected host. If the selected host set is too wide, one mistake can reach every web server. If the batch size is too large, several hosts can break before the team sees the first failure.

The `orders` service has four production web hosts:

```text
orders-web-01
orders-web-02
orders-web-03
orders-web-04
```

Each host runs Nginx and `orders-api`. A safe rollout changes one host first, proves the service works, then moves through the rest in small batches. Three controls work together:

- `--limit` narrows which inventory hosts are included in this run.
- `serial` controls how many included hosts run in one batch.
- Health checks decide whether the playbook should continue after the service changes.

Limit and serial answer different questions. Limit asks, "Which hosts are eligible for this run?" Serial asks, "How many eligible hosts move together?"

## Limit

`--limit` is a command-line host boundary. It filters the playbook's normal host pattern down to a smaller set. If the playbook says `hosts: orders_web`, the inventory group might contain all four production web hosts. A limit can narrow that to one canary.

Before applying the change, list the hosts:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --list-hosts \
  --limit orders-web-01
```

The output should name exactly one host:

```text
playbook: playbooks/orders.yml

  play #1 (orders_web): Roll out orders-api
    pattern: ['orders_web']
    hosts (1):
      orders-web-01
```

Now the team has visible evidence of the target set. The inventory path is `inventories/prod.ini`. The playbook pattern is `orders_web`. The limit reduced the run to `orders-web-01`.

After the host list is correct, the real canary run uses the same limit without `--list-hosts`:

```bash
ansible-playbook -i inventories/prod.ini playbooks/orders.yml \
  --limit orders-web-01
```

This changes only the canary host. That makes the first real run easier to reason about. If the canary fails, the other production hosts have not been changed by this command.

`--limit` can also target a group, a comma-separated set, or a pattern expression. That flexibility is useful and dangerous. `--limit orders_web` includes the whole group. `--limit 'orders_web:!orders-web-04'` includes the group except one host. These expressions should be easy to read in release notes or CI logs. A clever limit expression is a poor place to hide production scope.

## Serial

`serial` belongs in the playbook. It controls batch size inside the selected host set. If the run includes four hosts and the play uses `serial: 1`, Ansible completes the play for one host before starting the next.

```yaml
- name: Roll out orders-api
  hosts: orders_web
  become: true
  serial: 1
  tasks:
    - name: Render nginx site
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/nginx/sites-available/orders.conf
      notify: Reload nginx
```

With `serial: 1`, the hosts move like this:

```text
Batch 1: orders-web-01
Batch 2: orders-web-02
Batch 3: orders-web-03
Batch 4: orders-web-04
```

This is different from `--limit orders-web-01`. A limit of one host means only one host is eligible. `serial: 1` means one eligible host runs at a time. They are often used together during a first canary, then separately during the wider rollout.

For a larger service, `serial` can be a number, a percentage, or a list of batch sizes. A list lets a rollout grow gradually:

```yaml
- name: Roll out orders-api
  hosts: orders_web
  become: true
  serial:
    - 1
    - 2
    - "50%"
```

That pattern starts with one host, then two hosts, then half of the remaining host set per batch. The exact values should match the service's tolerance for failure. If the load balancer needs at least three healthy `orders` hosts during peak traffic, a batch size of three may be too large.

## Handlers Before Health Checks

Many Ansible playbooks use handlers for restarts and reloads. A task changes a file and notifies a handler. Ansible normally runs notified handlers at the end of the play. That default avoids repeated restarts when several tasks notify the same handler.

For a rollout, the health check needs the changed service to be running before the play moves on. If the template changes the `orders-api` environment but the restart handler waits until later, a health check can accidentally test the old process.

Use `meta: flush_handlers` when the play needs notified handlers to run before the next task:

```yaml
- name: Render orders-api environment
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders-api/orders.env
    owner: root
    group: orders-api
    mode: "0640"
  no_log: true
  diff: false
  notify: Restart orders-api

- name: Flush handlers before health check
  ansible.builtin.meta: flush_handlers
```

That tells Ansible to run the restart handler now if it was notified. In a serial rollout, this is important. The current host should restart and pass health before Ansible starts the next batch.

## Health Checks

A task can succeed while the service is broken. A template can render correctly. Systemd can accept a restart command. Nginx can still point at the wrong port, the process can fail after startup, or the app can run but fail to reach the database.

The health check should answer the service question instead of stopping at the process question. For the `orders` canary, a local check might call the service on the port Nginx uses:

```yaml
- name: Check local orders-api health
  ansible.builtin.uri:
    url: http://127.0.0.1:8081/healthz
    status_code: 200
    return_content: false
  register: orders_health
  changed_when: false
  retries: 6
  delay: 5
  until: orders_health.status == 200
```

The retries matter because a service may need a few seconds after restart. The task is marked `changed_when: false` because checking health does not change the host. If the endpoint does not return HTTP 200 after the retries, the task fails and the rollout should stop.

For a load-balanced service, a local check may not be enough. The safer rollout can have several checks:

| Check | What It Proves |
| --- | --- |
| Local `orders-api` health | The process answers on the host |
| Local Nginx health | Nginx reaches the local process |
| Load balancer target health | The load balancer can reach the host |
| External smoke check | A user-like request reaches the service |

Start with the strongest check the environment supports. Improve it when failures show a gap. A process check alone is weak if most real failures come from database connectivity or load balancer registration.

## Failure Boundaries

By default, when a task fails on a host, Ansible stops running further tasks on that host and continues with other hosts that are still active. With `serial: 1`, that usually stops the rollout before later hosts are changed, because there is only one host in the current batch.

Do not hide a rollout health failure with `ignore_errors`. If `orders-web-01` cannot serve `/healthz` after the port change, the playbook should fail loudly. The right response is to inspect the host, fix the playbook or service, and decide how to recover the canary.

Unreachable hosts and failed tasks mean different things:

| Result | Meaning | First Place To Look |
| --- | --- | --- |
| `unreachable` | Ansible could not connect | Inventory, DNS, SSH, network path |
| `failed` during template | Ansible reached the host but a task failed | Variables, permissions, paths, template syntax |
| `failed` during restart | The service manager rejected the operation | Unit file, service logs, permissions |
| `failed` during health check | The changed service did not prove healthy | Port, app logs, dependencies, load balancer |

For wider batches, Ansible also has failure controls such as `any_errors_fatal` and `max_fail_percentage`. They change when a failure stops the whole play. Use them deliberately. The main habit remains the same: keep the first batch small, make health checks meaningful, and stop when the evidence is bad.

## Putting It All Together

The `orders` team previewed the port change first. Then they made the real rollout small and observable. `--list-hosts` showed the canary. `--limit orders-web-01` changed one host. `serial: 1` kept later hosts out of the current batch. `meta: flush_handlers` restarted the service before the check. The health check decided whether the playbook could continue.

That is the safe rollout path. Choose the hosts on purpose. Move through them in batches the service can tolerate. Test the changed behavior before widening the run. Stop when the evidence says the service is not healthy.

## What's Next

The next module moves Ansible into CI. The same ideas still apply there: review evidence should be visible, secrets should stay bounded, and production authority should sit behind protected jobs and deliberate rollout steps.

---

**References**

- [Ansible documentation: ansible-playbook command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html)
- [Ansible documentation: Patterns: targeting hosts and groups](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_patterns.html)
- [Ansible documentation: Controlling playbook execution: strategies and more](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_strategies.html)
- [Ansible documentation: Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html)
- [Ansible documentation: Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html)
