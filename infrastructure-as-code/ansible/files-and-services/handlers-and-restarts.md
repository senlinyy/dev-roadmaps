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

1. [Why Handlers Exist](#why-handlers-exist)
2. [Notify and Handler](#notify-and-handler)
3. [Reload or Restart](#reload-or-restart)
4. [When Handlers Run](#when-handlers-run)
5. [Multiple Notifications](#multiple-notifications)
6. [Failure and Flush Points](#failure-and-flush-points)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Handlers Exist

The previous articles changed files. A file change does not always change a running service. Nginx reads its configuration when it starts and when it reloads. A systemd service often reads an environment file only when the process starts. If Ansible writes a new file and then leaves the process alone, the host can contain the desired file while the running service still uses the old settings.

The simple answer would be to restart the service at the end of every playbook run. That is usually too noisy. Restarting `orders-api` when no relevant file changed creates needless downtime, resets connections, and makes every run look risky. Reloading Nginx every time can also hide whether a config task is stable.

Handlers solve this problem. A normal task can notify a handler when that task reports `changed`. The handler runs later and performs the service action. If the task reports `ok`, the handler is not notified.

This makes the file task the source of truth. The service action happens because a relevant file changed, not because the playbook happened to run.

## Notify and Handler

A handler is a task with a special timing rule. It is defined in a `handlers` section and named so other tasks can notify it.

The `orders` Nginx site should reload Nginx only when the rendered file changes:

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
  notify: Reload nginx
```

The handler uses the same normal module syntax as any other task:

```yaml
handlers:
  - name: Reload nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded
```

If the template task changes the remote file, Ansible queues `Reload nginx`. If the remote file already matches the rendered template, the task reports `ok` and the handler is not queued.

The `notify` name must match the handler name or a topic the handler listens to. Treat handler names as part of the role interface. A vague name such as `Restart service` becomes hard to follow when a playbook manages Nginx, `orders-api`, and a worker process in the same run.

## Reload or Restart

Reload and restart are different service actions.

A reload asks a service to reread configuration without fully stopping the process. Nginx usually handles reloads well. It can check the new config, start new workers, and retire old workers without dropping the entire service.

A restart stops the service and starts it again. That is heavier, but sometimes it is required. If `orders-api` reads `/etc/orders/orders.env` only at process startup, changing that file will not affect the running process until the service restarts.

```yaml
handlers:
  - name: Reload nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded

  - name: Restart orders-api
    ansible.builtin.service:
      name: orders-api
      state: restarted
```

Choose the action based on how the service reads the changed state. Nginx config usually points to a reload. Application code, environment files, and systemd unit changes often point to a restart. Some services do not support reload at all. Others accept reload but do not reread every setting.

There is a practical systemd surprise. If Ansible changes a systemd unit file, systemd may need to reload its manager configuration before the service action uses the new unit definition. The `ansible.builtin.systemd_service` module has `daemon_reload` for that.

```yaml
handlers:
  - name: Restart orders-api
    ansible.builtin.systemd_service:
      name: orders-api
      state: restarted
      daemon_reload: true
```

That is different from reloading the application. `daemon_reload: true` tells systemd to reread unit files. `state: restarted` restarts the service process.

## When Handlers Run

Handlers do not run immediately when they are notified. Ansible queues them and normally runs them after the regular tasks in the play have finished.

This delayed timing is useful. The `orders` role might render the Nginx site, change an upstream include, and copy a TLS snippet. All three tasks can notify `Reload nginx`. Nginx should reload once after all related files are in place, not three times while the configuration is still being assembled.

The delayed timing also means a task that depends on the service already having reloaded may need special care. If a play renders the Nginx file and then immediately performs an HTTP check through Nginx, that check may still hit the old config because the handler has not run yet.

For that case, Ansible supports `meta: flush_handlers`. It tells Ansible to run queued handlers at that point in the play.

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    validate: "nginx -t -c %s"
  notify: Reload nginx

- name: Apply service changes before checking through Nginx
  ansible.builtin.meta: flush_handlers

- name: Check orders endpoint through Nginx
  ansible.builtin.uri:
    url: http://127.0.0.1/orders/health
```

Use flush points sparingly. They are helpful when later tasks need the service action to have happened. If every change is flushed immediately, handlers lose their main benefit: collecting related changes into one service action.

## Multiple Notifications

A handler runs once even if several tasks notify it. This is one of the biggest benefits of handlers.

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
  notify: Reload nginx

- name: Manage orders upstream block
  ansible.builtin.blockinfile:
    path: /etc/nginx/conf.d/upstreams.conf
    marker: "# {mark} ANSIBLE MANAGED ORDERS UPSTREAM"
    block: |
      upstream orders_api {
        server 127.0.0.1:8080;
      }
  notify: Reload nginx
```

If both tasks change, `Reload nginx` still runs once at the handler point.

Handlers run in the order they are defined, not in the order tasks notify them. That can surprise people reading a playbook from top to bottom. If `Reload nginx` and `Restart orders-api` both matter, put the handlers in the order that makes operational sense and keep the names specific.

Ansible also supports listening topics. A handler can listen for a topic such as `orders service changed`, while tasks notify that topic. This is useful when handler names should stay private but task notifications should describe the event.

```yaml
handlers:
  - name: Restart orders-api after config change
    ansible.builtin.service:
      name: orders-api
      state: restarted
    listen: orders service changed
```

The task can then use `notify: orders service changed`. The reader sees why the task notifies, and the handler can still have a precise name.

## Failure and Flush Points

Handlers are tied to successful play execution for a host. If a later task fails before handlers run, a queued handler may not run for that host. This can leave a host with a changed config file and an old running process.

That behavior is usually sensible because Ansible stops when the host is in an uncertain state. It can still surprise you during service changes. Imagine the play renders `/etc/orders/orders.env`, queues `Restart orders-api`, then fails while checking a different file. The environment file changed, but the restart did not happen.

There are a few ways to handle this:

- Put validation on risky file tasks so bad files fail before they are written.
- Keep unrelated risky work out of the same critical service-change path.
- Use `meta: flush_handlers` before a task that might fail when the service must already be updated.
- Consider Ansible's forced handler behavior only when the operational tradeoff is understood.

The safest pattern is to keep service file changes and their handlers close in purpose. A play that changes Nginx config, validates it, reloads Nginx, and then checks the endpoint is easier to reason about than a play that queues reloads while doing many unrelated operations.

## Putting It All Together

The `orders` service needed file changes to become running behavior. A rendered Nginx site should notify a reload. A changed application environment file should notify an application restart. A changed systemd unit should restart the service and tell systemd to reread unit files.

Handlers give those actions a clear rule:

| If this changes | Notify | Why |
|-----------------|--------|-----|
| `/etc/nginx/conf.d/orders.conf` | `Reload nginx` | Nginx must reread proxy configuration. |
| `/etc/orders/orders.env` | `Restart orders-api` | The process reads environment at startup. |
| `/etc/systemd/system/orders-api.service` | `Restart orders-api` with `daemon_reload` | systemd must reread the unit and restart the process. |

The surprises are mostly about timing. Handlers run later. Multiple notifications become one handler run. Handler order comes from handler definition order. A failed later task can prevent a queued handler from running unless the play is designed around that risk.

Once you understand those rules, handlers stop feeling like a special Ansible trick. They are the connection between "the file changed" and "the service is now using that file."

## What's Next

The next group moves from single playbooks into reusable structure. Roles keep related tasks, files, templates, defaults, and handlers together so the `orders` service can be managed as one unit.

---

**References**

- [Handlers: running operations on change](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html)
- [ansible.builtin.service module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/service_module.html)
- [ansible.builtin.systemd_service module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/systemd_service_module.html)
