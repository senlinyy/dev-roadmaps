---
title: "Handlers and Service Restarts"
description: "Use Ansible handlers to reload or restart services only when configuration changes require it."
overview: "Handlers connect configuration changes to service operations. You will learn how Ansible queues handlers, why repeated notifications run once, and how to review Nginx reloads and systemd restarts without bouncing healthy services on every run."
tags: ["ansible", "handlers", "service", "systemd", "nginx"]
order: 6
id: article-infrastructure-as-code-ansible-handlers-service-restarts
---

## Table of Contents

1. [Restarts Should Follow Real Changes](#restarts-should-follow-real-changes)
2. [What a Handler Is](#what-a-handler-is)
3. [Reloading Nginx After Config Changes](#reloading-nginx-after-config-changes)
4. [Restarting a systemd Service After Environment Changes](#restarting-a-systemd-service-after-environment-changes)
5. [Multiple Notifications and Handler Order](#multiple-notifications-and-handler-order)
6. [When Handlers Run and When to Flush Them](#when-handlers-run-and-when-to-flush-them)
7. [Reading Recaps and Service Evidence](#reading-recaps-and-service-evidence)
8. [Common Restart Failure Modes](#common-restart-failure-modes)
9. [Review Habits for Restart Logic](#review-habits-for-restart-logic)

## Restarts Should Follow Real Changes

Restarting a Linux service is not a harmless decoration at the end of a playbook. A restart can drop in-flight requests, clear process memory, reopen sockets, reload secrets, or expose a bad config that was written earlier. A reload is usually gentler because the service tries to reread configuration without a full stop and start, but it is still an operation against a live process.

Ansible handlers exist for this exact problem. You often want to restart or reload a service only if a previous task changed the host. If the Nginx config already matches Git, Nginx should keep running. If the systemd environment file changed, the API probably needs a restart so the process reads the new values.

The running example stays with `devpolaris-orders`. The web VMs run Nginx in front of a systemd service named `devpolaris-orders-api`. Ansible manages two kinds of service-sensitive files:

```text
/etc/nginx/nginx.conf
  Changing this file should reload nginx.

/etc/default/devpolaris-orders-api
  Changing this file should restart devpolaris-orders-api.

/etc/systemd/system/devpolaris-orders-api.service
  Changing this file should make systemd reread unit files, then restart the API.
```

The important word is "should." A file change and a service operation are separate events. Writing a config file does not automatically make a process read it. A handler is the connection between those events.

The beginner mistake is to put a restart task at the end of every play:

```yaml
- name: Restart orders API
  ansible.builtin.service:
    name: devpolaris-orders-api
    state: restarted
```

The Ansible `service` module treats `state: restarted` as an action that bounces the service whenever that task runs. It does not mean "restart only if needed." If that task is in the normal task list, every playbook run restarts the API, even when every file task reported `ok`.

That makes the second run noisy and risky:

```text
PLAY RECAP *********************************************************************
orders-web-01 : ok=9 changed=1 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

If the only changed task is a restart, the playbook is not idempotent from the service's point of view. The files are stable, but the process still gets bounced. Handlers solve that by making restarts conditional on real changes.

## What a Handler Is

A handler is a task that waits in a special section of the playbook. Normal tasks can notify it. Ansible runs the handler later only if at least one notifying task reported `changed`.

The shape is small:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true

  tasks:
    - name: Render nginx configuration for orders
      ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: "0644"
        validate: "nginx -t -c %s"
      notify: Reload nginx

  handlers:
    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

Read the flow in two steps. The template task compares the current `/etc/nginx/nginx.conf` with the rendered file. If the content or metadata changes, the task reports `changed` and queues the handler named `Reload nginx`. If the file already matches, the task reports `ok` and does not queue the handler.

The handler itself is still a normal service task. The difference is when it runs. `state: reloaded` will reload Nginx when the handler runs. The handler design decides whether that service task runs at all.

Here is the first run after changing the upstream port from `3000` to `8080`:

```text
TASK [Render nginx configuration for orders] ***********************************
changed: [orders-web-01]

RUNNING HANDLER [Reload nginx] *************************************************
changed: [orders-web-01]

PLAY RECAP *********************************************************************
orders-web-01 : ok=5 changed=2 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

The second run with the same files looks different:

```text
TASK [Render nginx configuration for orders] ***********************************
ok: [orders-web-01]

PLAY RECAP *********************************************************************
orders-web-01 : ok=4 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

There is no handler line because nothing notified it. That is the behavior you want from configuration management: stable files lead to stable processes.

## Reloading Nginx After Config Changes

Nginx can usually reload configuration without a full restart. A reload asks the master process to reread config and start new workers with the new settings while old workers finish existing requests. That is a better default for many web config changes than stopping and starting the service.

The playbook still needs a validation step before the reload is even possible. If a broken file lands on disk and then a handler reloads Nginx, the handler becomes the place where the failure appears. It is better to fail before replacing the file.

```yaml
- name: Render nginx configuration for orders
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
  notify: Reload nginx

- name: Ensure nginx is enabled and running
  ansible.builtin.service:
    name: nginx
    enabled: true
    state: started

handlers:
  - name: Reload nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded
```

Notice the split between the normal service task and the handler. `state: started` is idempotent. It starts Nginx if it is stopped and reports `ok` if Nginx is already running. `state: reloaded` is an action. It should live behind a handler so it happens only when a notifying task changed something.

The order also protects the first run. If Nginx is not installed or not running yet, the playbook should render a valid config, ensure the service is enabled and running, and then reload only if a config task queued that operation. In a larger role, package installation would happen before these tasks.

After the handler runs, verify the service locally:

```bash
$ systemctl is-active nginx
active
$ curl -sS http://127.0.0.1/health
{
  "service": "devpolaris-orders",
  "status": "ok"
}
```

Those checks prove two different things. `systemctl is-active` proves the service manager sees Nginx as active. The HTTP request proves Nginx can serve the configured location. You need both because a service can be active while a route is wrong.

## Restarting a systemd Service After Environment Changes

The API process reads its environment when systemd starts it. If Ansible changes `/etc/default/devpolaris-orders-api`, the already-running process does not automatically reread that file. The next service restart is the moment when the new values become part of the process.

Here is a small environment template:

```text
ORDERS_API_PORT={{ orders_api_port }}
ORDERS_LOG_DIR={{ orders_log_dir }}
ORDERS_ENVIRONMENT=production
```

The task renders that file and notifies the API restart handler:

```yaml
- name: Render orders API environment file
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/default/devpolaris-orders-api
    owner: root
    group: root
    mode: "0644"
  notify: Restart orders API
```

The handler restarts the systemd service:

```yaml
handlers:
  - name: Restart orders API
    ansible.builtin.service:
      name: devpolaris-orders-api
      state: restarted
```

The difference between reload and restart matters. Nginx has a reload path for many config changes. A simple application process often does not. If `devpolaris-orders-api` reads environment variables only at startup, a restart is the honest operation. The process stops, starts again, and reads the new environment.

You can inspect the active process after the restart:

```bash
$ systemctl show devpolaris-orders-api --property=MainPID
MainPID=24817
$ tr '\0' '\n' < /proc/24817/environ | grep '^ORDERS_'
ORDERS_API_PORT=8080
ORDERS_LOG_DIR=/var/log/devpolaris-orders
ORDERS_ENVIRONMENT=production
```

The `/proc/<pid>/environ` file shows the environment of a running process. It is a useful diagnostic when a service appears to ignore a changed environment file. If the process still has the old value, systemd has not started a new process with the new environment.

When the systemd unit file itself changes, systemd needs to reread unit files before the restart. Use the systemd-specific module for that because `daemon_reload` is a systemd concept.

```yaml
- name: Render orders API systemd unit
  ansible.builtin.template:
    src: devpolaris-orders-api.service.j2
    dest: /etc/systemd/system/devpolaris-orders-api.service
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Restart orders API

handlers:
  - name: Reload systemd
    ansible.builtin.systemd_service:
      daemon_reload: true

  - name: Restart orders API
    ansible.builtin.service:
      name: devpolaris-orders-api
      state: restarted
```

The unit-file task notifies two handlers because two separate things must happen. First, systemd rereads unit definitions. Then the API restarts under the new definition. Handler ordering decides the exact order, which is the next topic.

## Multiple Notifications and Handler Order

A task can notify more than one handler. Several tasks can notify the same handler. Ansible queues handlers by name and runs each queued handler once. This is why handlers are such a good fit for service restarts: three file changes can lead to one restart instead of three restarts.

For `devpolaris-orders`, the API restart may be needed when any of these files change:

```yaml
- name: Render orders API environment file
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/default/devpolaris-orders-api
    owner: root
    group: root
    mode: "0644"
  notify: Restart orders API

- name: Render orders API systemd unit
  ansible.builtin.template:
    src: devpolaris-orders-api.service.j2
    dest: /etc/systemd/system/devpolaris-orders-api.service
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Restart orders API

- name: Create orders log directory
  ansible.builtin.file:
    path: "{{ orders_log_dir }}"
    state: directory
    owner: devpolaris
    group: devpolaris
    mode: "0750"
```

The log directory task does not notify the restart handler. Creating a log directory may be necessary for the service to work, but changing directory metadata does not always require a process restart. Be specific about which changes the process must reread.

Handler order comes from the order in the `handlers` section, not the order in a task's `notify` list. Put prerequisites first.

```yaml
handlers:
  - name: Reload systemd
    ansible.builtin.systemd_service:
      daemon_reload: true

  - name: Restart orders API
    ansible.builtin.service:
      name: devpolaris-orders-api
      state: restarted

  - name: Reload nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded
```

If the unit file changes, `Reload systemd` runs before `Restart orders API` because it appears first. If only the environment file changes, only `Restart orders API` runs. If only the Nginx file changes, only `Reload nginx` runs.

The output shows the once-only behavior:

```text
TASK [Render orders API environment file] **************************************
changed: [orders-web-01]

TASK [Render orders API systemd unit] ******************************************
changed: [orders-web-01]

RUNNING HANDLER [Reload systemd] ***********************************************
changed: [orders-web-01]

RUNNING HANDLER [Restart orders API] *******************************************
changed: [orders-web-01]
```

Even though two tasks notified `Restart orders API`, the handler ran once. That protects the service from needless repeated restarts during one play.

For larger roles, `listen` topics can make notifications less tightly coupled to handler names. A task can notify a topic such as `restart orders stack`, and several handlers can listen to that topic.

```yaml
tasks:
  - name: Render orders API systemd unit
    ansible.builtin.template:
      src: devpolaris-orders-api.service.j2
      dest: /etc/systemd/system/devpolaris-orders-api.service
      owner: root
      group: root
      mode: "0644"
    notify: restart orders stack

handlers:
  - name: Reload systemd for orders
    ansible.builtin.systemd_service:
      daemon_reload: true
    listen: restart orders stack

  - name: Restart orders API process
    ansible.builtin.service:
      name: devpolaris-orders-api
      state: restarted
    listen: restart orders stack
```

This can be clearer when a role has several related handlers. Keep the topic name plain and operational. A teammate should understand what kind of service action the topic represents.

## When Handlers Run and When to Flush Them

By default, handlers run near the end of the play after normal tasks finish. This is efficient because Ansible can collect all notifications and run each handler once. It also means tasks after a changed config file may run before the service reloads.

Most of the time that is fine. For example, you can write files, ensure services are enabled, create directories, and then let handlers run. But sometimes a later task depends on the new config being active. A smoke test against Nginx should not run before Nginx has reloaded.

This version has a timing bug:

```yaml
- name: Render nginx configuration for orders
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
  notify: Reload nginx

- name: Check orders health endpoint
  ansible.builtin.uri:
    url: http://127.0.0.1/health
    return_content: true
```

The health check may still be using the old Nginx config because the handler has not run yet. If this check must prove the new config, flush handlers before the check.

```yaml
- name: Render nginx configuration for orders
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
  notify: Reload nginx

- name: Apply queued service handlers before smoke checks
  ansible.builtin.meta: flush_handlers

- name: Check orders health endpoint
  ansible.builtin.uri:
    url: http://127.0.0.1/health
    return_content: true
```

Use `flush_handlers` only when the play genuinely needs the service operation before later tasks. If every config task flushes immediately, you lose the once-per-play benefit and can end up bouncing services more often than necessary.

There is one more failure timing issue to know. If a task changes a file and notifies a handler, then a later task fails on the same host, Ansible normally does not run that host's handlers. That can leave a host with a changed file that has not been loaded by the service.

For production service changes, avoid long unrelated task chains after notified config changes. Keep the play focused, validate before replacement, use smoke checks after handlers, and consider Ansible's forced handler behavior only when your team has agreed that notified handlers should still run after later failures.

## Reading Recaps and Service Evidence

The play recap tells you how much Ansible changed, but it does not prove users are healthy. Treat it as the first checkpoint, then read service evidence.

A healthy first run after changing both Nginx and the API environment might look like this:

```text
PLAY RECAP *********************************************************************
orders-web-01 : ok=12 changed=5 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
orders-web-02 : ok=12 changed=5 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

The changed count includes file updates and handler operations. A second run with no input changes should be quieter:

```text
PLAY RECAP *********************************************************************
orders-web-01 : ok=10 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
orders-web-02 : ok=10 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

If the second run still reports `changed=1`, find the task. It might be a restart left in the normal task list. It might be a template that embeds a timestamp. It might be a command task with no `changed_when` rule. Do not accept noisy change counts as normal. They hide real changes later.

After handlers run, systemd gives useful evidence:

```bash
$ systemctl status devpolaris-orders-api --no-pager
* devpolaris-orders-api.service - DevPolaris Orders API
     Loaded: loaded (/etc/systemd/system/devpolaris-orders-api.service; enabled)
     Active: active (running) since Tue 2026-04-14 10:34:18 UTC; 14s ago
   Main PID: 24817 (node)
```

The important fields are `Loaded`, `Active`, and `Main PID`. `Loaded` tells you systemd found the unit file. `Active` tells you whether the unit is running. `Main PID` gives the process ID you can inspect when you need environment or socket evidence.

Nginx logs can confirm whether the reload produced a useful route:

```text
10.0.1.15 - - [14/Apr/2026:10:35:03 +0000] "GET /health HTTP/1.1" 200 53 "-" "curl/8.5.0"
10.0.1.15 - - [14/Apr/2026:10:35:07 +0000] "GET /orders HTTP/1.1" 200 482 "-" "curl/8.5.0"
```

That log is stronger evidence than "the handler ran." The handler only tells you Ansible requested a service operation. The access log tells you Nginx served requests after that operation.

## Common Restart Failure Modes

The first failure mode is a missing handler name. A task can notify a handler that does not exist. Ansible catches that during the run.

```yaml
- name: Render nginx configuration for orders
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
  notify: Reload orders nginx

handlers:
  - name: Reload nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded
```

The task notifies `Reload orders nginx`, but the handler is named `Reload nginx`. The run fails with a message shaped like this:

```text
ERROR! The requested handler 'Reload orders nginx' was not found in either the main handlers list nor in the listening handlers list
```

The fix is not technical. Make the notification and handler names match, or use a `listen` topic when several handler names should respond to one topic.

The second failure mode is restarting before systemd rereads a changed unit file. The symptom looks like a restart that keeps using old unit settings.

```text
TASK [Restart orders API] ******************************************************
changed: [orders-web-01]

$ systemctl show devpolaris-orders-api --property=ExecStart
ExecStart={ path=/usr/bin/node ; argv[]=/usr/bin/node /opt/orders-api/old-server.js ; ... }
```

If the unit template changed `ExecStart` but systemd still reports the old command, check whether a `daemon_reload` handler ran before the restart. A unit file on disk and systemd's loaded unit definition are not the same thing until systemd rereads units.

The third failure mode is using restart when reload would do. Nginx can reload many config changes. A full restart may briefly drop listeners or make a larger change than needed. Use reload for Nginx config when a reload is supported and sufficient. Use restart for application processes that must reread startup-only values.

The fourth failure mode is believing check mode proves restart success. Check mode can predict changes for supported modules, but it does not actually reload Nginx or restart the API. Use check mode to review what would be queued, then use a controlled real run and service evidence to prove the live behavior.

```bash
$ ansible-playbook -i inventory.ini site.yml --check --diff --limit orders-web-01
$ ansible-playbook -i inventory.ini site.yml --limit orders-web-01
$ curl -sS http://orders.devpolaris.internal/health
```

That sequence has a review pass, a limited real change, and an application-level check. The exact host and URL will vary, but the shape is the same.

## Review Habits for Restart Logic

Restart logic deserves the same review care as file content. A handler can be the difference between a safe config rollout and a service bounce on every playbook run.

Here is a compact playbook shape for `devpolaris-orders`:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true

  tasks:
    - name: Render nginx configuration for orders
      ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: "0644"
        validate: "nginx -t -c %s"
      notify: Reload nginx

    - name: Render orders API environment file
      ansible.builtin.template:
        src: orders-api.env.j2
        dest: /etc/default/devpolaris-orders-api
        owner: root
        group: root
        mode: "0644"
      notify: Restart orders API

    - name: Ensure nginx is enabled and running
      ansible.builtin.service:
        name: nginx
        enabled: true
        state: started

    - name: Ensure orders API is enabled and running
      ansible.builtin.service:
        name: devpolaris-orders-api
        enabled: true
        state: started

  handlers:
    - name: Restart orders API
      ansible.builtin.service:
        name: devpolaris-orders-api
        state: restarted

    - name: Reload nginx
      ansible.builtin.service:
        name: nginx
        state: reloaded
```

The normal tasks enforce steady state. The handlers perform disruptive or semi-disruptive service operations only after a change. That split is the main habit to carry forward.

Use this checklist during review:

| Review Question | Why It Matters |
|-----------------|----------------|
| Is `state: restarted` or `state: reloaded` inside a handler? | Action states should usually depend on change. |
| Does every `notify` target exist or match a `listen` topic? | Name mismatches fail at runtime. |
| Are handlers ordered by prerequisites? | `daemon_reload` must run before restarting changed units. |
| Does the task notify only the services that must reread the changed file? | Over-notifying creates needless service operations. |
| Does a later smoke check run after handlers? | Checks should test active config, not old config. |
| Does the second run produce `changed=0`? | A clean second run proves stable automation. |

The tradeoff is timing versus batching. Letting handlers run at the end reduces repeated service operations and keeps a play efficient. Flushing handlers earlier lets you test newly active config before later tasks continue. Choose the timing based on what the next task needs to prove.

---

**References**

- [Handlers: running operations on change](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html) - Official guide to handler notifications, handler order, `listen` topics, and flushing handlers.
- [ansible.builtin.service module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/service_module.html) - Official reference for managing services with `started`, `stopped`, `restarted`, `reloaded`, and `enabled`.
- [ansible.builtin.systemd_service module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/systemd_service_module.html) - Official reference for systemd-specific operations such as `daemon_reload`.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official guide to previewing changes before a real playbook run.
- [Error handling in playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_error_handling.html) - Official guide that explains how handler behavior interacts with later task failures and forced handlers.
