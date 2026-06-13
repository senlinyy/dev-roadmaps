---
title: "Handlers and Restarts"
description: "Use Ansible handlers so services reload or restart only after relevant tasks change."
overview: "Handlers connect changed tasks to delayed service actions."
tags: ["ansible", "handlers", "services", "restarts"]
order: 3
id: article-infrastructure-as-code-ansible-handlers-service-restarts
aliases:
  - handlers-service-restarts
  - infrastructure-as-code/ansible/handlers-service-restarts.md
---

## Table of Contents

1. [Changed Files Need Service Actions](#changed-files-need-service-actions)
2. [notify and handlers](#notify-and-handlers)
3. [One Handler Run for Many Changes](#one-handler-run-for-many-changes)
4. [Reload, Restart, and daemon_reload](#reload-restart-and-daemon_reload)
5. [Handler Timing and flush_handlers](#handler-timing-and-flush_handlers)
6. [Health Checks and Failure Boundaries](#health-checks-and-failure-boundaries)
7. [Rolling Production Runs](#rolling-production-runs)
8. [Rollback and Safety](#rollback-and-safety)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Changed Files Need Service Actions
<!-- section-summary: Handlers connect changed configuration files to delayed service reloads and restarts. -->

The last two articles put files on disk. That is only half of the service story. A running process may keep the old environment, old certificate, or old Nginx route in memory until someone reloads or restarts it.

A **handler** is a delayed task that runs after another task reports `changed` and sends a notification. Handlers are most common for service actions because one playbook may update several inputs for one service. The playbook should write all related files first, then run the service action once.

Back to the orders platform. A deployment can update `/etc/orders-api/orders-api.env`, `/etc/orders-api/orders-api.yml`, `/etc/nginx/conf.d/orders-api.conf`, and a systemd drop-in. Restarting after each file would bounce the API several times. Skipping the restart would leave the process running with old settings. Handlers give the playbook a middle path: change files, queue service actions, and run those actions at controlled points.

## notify and handlers
<!-- section-summary: A task uses notify to queue a named handler when the task reports changed. -->

A normal task uses `notify` to name a handler. If the task reports `ok`, Ansible queues nothing. If the task reports `changed`, Ansible queues that handler for that host. The handler itself lives under the play's `handlers` section or inside a role's `handlers/main.yml`.

```yaml
- name: Render orders API environment file
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/orders-api/orders-api.env
    owner: root
    group: orders
    mode: "0640"
  notify: Restart orders API

handlers:
  - name: Restart orders API
    ansible.builtin.service:
      name: orders-api
      state: restarted
```

The handler name is part of the operator experience. A log line that says `RUNNING HANDLER [Restart orders API]` tells the person watching the run exactly what happened. A vague name like `restart service` forces the reader to inspect the YAML while production is changing.

Handlers can also use `listen` to separate the event topic from the concrete handler task name. This helps when several tasks need to notify a business event like `orders api config changed`, while the handler can keep a precise name.

```yaml
- name: Render orders API config
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: /etc/orders-api/orders-api.yml
    mode: "0640"
    validate: /usr/local/bin/orders-api --check-config %s
  notify: orders api config changed

handlers:
  - name: Restart orders API after config changes
    listen: orders api config changed
    ansible.builtin.service:
      name: orders-api
      state: restarted
```

## One Handler Run for Many Changes
<!-- section-summary: Ansible deduplicates handler notifications by name for each host. -->

Handlers are queued per host and deduplicated by handler name. If three tasks notify `Restart orders API` on the same host, Ansible runs that handler once for that host at the handler phase. This is one of the main reasons handlers work well for service restarts.

The orders API has several inputs that all require a restart:

```yaml
- name: Render orders API environment file
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/orders-api/orders-api.env
    mode: "0640"
  notify: Restart orders API

- name: Render orders API config file
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: /etc/orders-api/orders-api.yml
    mode: "0640"
    validate: /usr/local/bin/orders-api --check-config %s
  notify: Restart orders API

- name: Render orders API systemd limits
  ansible.builtin.template:
    src: orders-api-limits.conf.j2
    dest: /etc/systemd/system/orders-api.service.d/limits.conf
    mode: "0644"
  notify:
    - Reload systemd
    - Restart orders API
```

If all three files change, the service still restarts once. The systemd reload also runs once. That keeps the playbook efficient and keeps the service from bouncing repeatedly during one deployment.

This also makes `changed` output meaningful. A handler runs because one or more inputs changed. If the playbook reports no changes, the service stays alone. Operators can trust that a restart in the output corresponds to real configuration drift or a deliberate update.

## Reload, Restart, and daemon_reload
<!-- section-summary: Reload rereads supported config, restart replaces the process, and daemon_reload refreshes systemd unit metadata. -->

A **reload** asks a service to reread configuration while keeping the process running, if the service supports that action. A **restart** stops and starts the process. A **systemd daemon reload** tells systemd to reread unit files and drop-ins, which is separate from restarting the service process.

Nginx usually supports reloads for site configuration changes:

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders-api.nginx.conf.j2
    dest: /etc/nginx/conf.d/orders-api.conf
    mode: "0644"
    validate: /usr/local/sbin/validate-nginx-fragment %s
  notify: Reload Nginx

handlers:
  - name: Reload Nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded
```

The orders API environment file usually needs a restart because the process reads environment variables at startup. A systemd drop-in also needs systemd to reread unit metadata before the service action.

```yaml
handlers:
  - name: Reload systemd
    ansible.builtin.systemd_service:
      daemon_reload: true

  - name: Restart orders API
    ansible.builtin.service:
      name: orders-api
      state: restarted
```

Handler order follows the order handlers are defined, not the order tasks notify them. That means `Reload systemd` should appear before `Restart orders API` when a service drop-in changes. The notification names can come from several tasks, and the handler list still controls the final order.

Production playbooks should encode the service's real behavior. Reload Nginx when Nginx can reread the route safely. Restart the application when runtime settings require a new process. Reload systemd when unit files or drop-ins change. This turns service knowledge into repeatable automation instead of a checklist someone keeps in their head.

## Handler Timing and flush_handlers
<!-- section-summary: Handlers normally run after normal tasks, and flush_handlers can run queued handlers before later checks. -->

Handlers normally run after the normal tasks in a play finish for a host. That timing is useful because all related inputs can land first. It also means a later normal task may run before a queued restart or reload.

The orders deployment needs a health check after the API restarts. If the health check runs before the handler phase, it may read the old process state. The playbook can explicitly flush queued handlers before the check.

```yaml
- name: Apply queued service actions before health checks
  ansible.builtin.meta: flush_handlers

- name: Check orders API health endpoint
  ansible.builtin.uri:
    url: "http://127.0.0.1:{{ orders_api_port }}/health"
    status_code: 200
    return_content: true
  register: orders_health
  retries: 12
  delay: 5
  until: orders_health.status == 200
```

`force_handlers` belongs in the same discussion. It tells Ansible to run notified handlers even when a later task fails on that host. That can be useful when a changed config must be reloaded to leave the host consistent, and it can be risky when the changed config is the reason validation failed. Treat it as an operational decision, not a default.

This pattern gives the playbook a clean rhythm: render and validate inputs, flush handlers once, then check the running service. Frequent flushes can bring back repeated service actions, so teams usually group related file tasks and flush at the point where the new process state is needed.

## Health Checks and Failure Boundaries
<!-- section-summary: Service automation should validate inputs before replacement and check the running process after handlers run. -->

Handlers run for hosts that stay active in the play. If a later task fails before the handler phase, the queued handler for that host may stay unrun unless the play uses forced handler behavior. That matters because a config file could change on disk while the running process still has old state.

The safest production shape is to catch bad input before replacement, then check the running process after the handler. Template validation handles the first half. A health check after `flush_handlers` handles the second half.

```yaml
- name: Render orders API config file
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: /etc/orders-api/orders-api.yml
    mode: "0640"
    validate: /usr/local/bin/orders-api --check-config %s
  notify: Restart orders API

- name: Flush service changes before checking the API
  ansible.builtin.meta: flush_handlers

- name: Confirm orders API reports ready
  ansible.builtin.uri:
    url: "http://127.0.0.1:{{ orders_api_port }}/ready"
    status_code: 200
  register: ready_check
  retries: 10
  delay: 3
  until: ready_check.status == 200
```

When a handler fails, read the service logs before guessing at the Ansible task. For a systemd service, `journalctl` usually tells you whether the app rejected config, failed to bind a port, missed an environment variable, or crashed during startup.

```bash
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "systemctl status orders-api --no-pager"
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "journalctl -u orders-api -n 80 --no-pager"
```

## Rolling Production Runs
<!-- section-summary: Serial batches keep service-handler changes from restarting the whole fleet at once. -->

Handlers run per host, and production usually needs a rollout boundary around that behavior. If every host in the orders fleet restarts at the same time, the load balancer may see all backends disappear at once. A small fleet can still feel that outage if traffic is active.

Use `serial` to move through production in batches. With three orders web servers, `serial: 1` gives the clearest first rollout. Each host gets its file changes, handler actions, and health checks before the next host starts.

```yaml
- name: Configure orders web servers
  hosts: orders_web
  become: true
  serial: 1
  tasks:
    - name: Render orders API config file
      ansible.builtin.template:
        src: orders-api.yml.j2
        dest: /etc/orders-api/orders-api.yml
        mode: "0640"
        validate: /usr/local/bin/orders-api --check-config %s
      notify: Restart orders API

    - name: Apply queued service actions before health checks
      ansible.builtin.meta: flush_handlers

    - name: Confirm orders API is ready
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/ready"
        status_code: 200
      register: ready_check
      retries: 10
      delay: 3
      until: ready_check.status == 200
```

This is where handlers and rollout strategy meet. A handler controls when a service reacts on one host. `serial` controls how many hosts can be in that service-action path at the same time.

## Rollback and Safety
<!-- section-summary: Rollback uses previous source content, backups, and service logs to return the process to a known good state. -->

Rollback for handler-driven changes starts with the files that triggered the handler. If a bad config file restarted the API, revert the Git change or redeploy the previous release variables, then run the playbook again through the same `serial` boundary. That keeps disk state, process state, and repository state aligned.

For an immediate host-level recovery, restore the backup file created by `template` or `copy`, validate it, and restart or reload the service. Then follow up with the source rollback so the next Ansible run uses the corrected source instead of reapplying the bad file.

```bash
sudo cp /etc/orders-api/orders-api.yml.12345.2026-06-13@13:10:24~ /etc/orders-api/orders-api.yml
sudo /usr/local/bin/orders-api --check-config /etc/orders-api/orders-api.yml
sudo systemctl restart orders-api
sudo systemctl is-active orders-api
```

For Nginx, validate before the reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

The safety habit is simple in practice. Validate before replacement, notify handlers only from tasks that actually changed service inputs, flush before health checks, read service logs on failure, and roll through production in batches.

## Putting It All Together
<!-- section-summary: Handlers turn changed task results into controlled, verified service actions. -->

The orders fleet now has a complete file-to-service path. Template and partial-edit tasks write files. Changed tasks notify handlers. Handler notifications collapse into one reload or restart per host. `flush_handlers` gives the playbook a clear point where the service should react before health checks run.

The production rollout has a shape too. Validation protects the live file, handlers apply process changes, health checks confirm the new process, and `serial` keeps the fleet available while each host updates. If the service fails, logs and backups point to a practical rollback path.

As these tasks, templates, files, and handlers grow, copying them across playbooks becomes painful. Roles give this service automation a reusable home, and the next article starts that structure.

## What's Next

The next article covers structuring roles. Once the orders API setup has directories, templates, files, handlers, defaults, and health checks, a role gives that work a conventional directory layout and a clearer interface for staging and production.

---

**References**

- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official guide for `notify`, handler timing, handler insertion order, and handler behavior.
- [ansible.builtin.service](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/service_module.html) - Official module documentation for managing services through the generic service proxy.
- [ansible.builtin.systemd_service](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/systemd_service_module.html) - Official module documentation for systemd units, daemon reloads, and service state.
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guide for failure behavior, forced handlers, and recovery controls.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official guide for previewing changes before service actions.
