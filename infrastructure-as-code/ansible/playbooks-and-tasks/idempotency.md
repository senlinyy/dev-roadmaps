---
title: "Idempotency"
description: "Understand why repeated Ansible runs should settle when hosts already match the playbook."
overview: "Idempotency is the behavior that lets Ansible configure hosts repeatedly without stacking the same change again."
tags: ["ansible", "idempotency", "changed"]
order: 3
id: article-infrastructure-as-code-ansible-playbooks-tasks-idempotency
aliases:
  - playbooks-tasks-idempotency
  - infrastructure-as-code/ansible/playbooks-tasks-idempotency.md
---

## Table of Contents

1. [What Idempotency Means](#what-idempotency-means)
2. [Desired State](#desired-state)
3. [The Second Run](#the-second-run)
4. [Files, Services, and Handlers](#files-services-and-handlers)
5. [Commands Need Extra Care](#commands-need-extra-care)
6. [When Change Is Correct](#when-change-is-correct)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Idempotency Means

An idempotent operation can run more than once and still settle on the same final result. In Ansible, this means a task should change a host when the host does not match the requested state, then report `ok` on later runs when the host already matches.

This behavior is central to configuration management. The same playbook may build a new orders web host, repair a host that drifted, and confirm that an old host still matches the expected configuration. If the playbook stacks a new change every time, it becomes unsafe to rerun.

For the orders service, installing Nginx should be a settled state. The host either has the package or it does not. Running the playbook again should not reinstall Nginx, duplicate configuration lines, or restart services without a reason.

## Desired State

Idempotency works best when a task describes the desired final state instead of a blind action.

This task describes final package state:

```yaml
- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present
```

If Nginx is missing, the task changes the host. If Nginx is already installed, the task can report `ok`. The module has enough knowledge to ask the package manager what is currently true.

The same idea applies to files and services:

```yaml
- name: Render orders site config
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    owner: root
    group: root
    mode: "0644"

- name: Keep nginx running
  ansible.builtin.service:
    name: nginx
    state: started
    enabled: true
```

The template task can compare rendered content and file attributes. The service task can check current service state and boot enablement. These modules can decide whether they need to act.

## The Second Run

The easiest idempotency check is a second run against the same host.

The first run against a fresh orders host may look like this:

```text
PLAY RECAP
orders-web-01 : ok=9 changed=4 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

That result can be healthy. A fresh host needed packages, files, and service state.

The second run should usually be quieter:

```text
PLAY RECAP
orders-web-01 : ok=13 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

This is the shape you want for a settled host. The playbook still inspected the host. It found that the requested state was already there.

If the second run still reports changes, the next question is specific: which task changed, and should that task change every time? A template change after editing `orders.conf.j2` is expected. A shell task that appends the same line on every run is usually a bug.

## Files, Services, and Handlers

Configuration files and service restarts are where idempotency becomes visible during real deployments.

An orders Nginx config should be written only when the rendered content or file attributes differ. If the config file changes, Nginx should reload. If the config file does not change, Nginx should keep running without a reload.

Handlers exist for this pattern. A normal task notifies a handler only when the task reports `changed`:

```yaml
- name: Render orders site config
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    mode: "0644"
  notify: Reload nginx

handlers:
  - name: Reload nginx
    ansible.builtin.service:
      name: nginx
      state: reloaded
```

This keeps restarts tied to actual file changes. If the template task reports `ok`, the handler is not notified. If several template tasks notify the same handler, Ansible can run the handler once at the end of the play instead of bouncing the service repeatedly.

The practical surprise is that change reporting is now more than cosmetic. A task that falsely reports `changed` can trigger handlers and restart services every run. A task that falsely reports `ok` can hide a change that should have caused a reload.

## Commands Need Extra Care

Command and shell tasks are the common place where idempotency breaks. The command may be safe, but Ansible cannot always know that from the outside.

This task is unsafe because it appends the same line every run:

```yaml
- name: Add orders proxy timeout
  ansible.builtin.shell: echo "proxy_read_timeout 30s;" >> /etc/nginx/conf.d/orders.conf
```

The file grows each time the playbook runs. The task is not idempotent because the second run creates a different final state from the first run.

A better task describes the managed line:

```yaml
- name: Set orders proxy timeout
  ansible.builtin.lineinfile:
    path: /etc/nginx/conf.d/orders.conf
    regexp: "^proxy_read_timeout"
    line: "proxy_read_timeout 30s;"
```

Sometimes a command is still the right tool. In that case, give Ansible a state check or define the result clearly.

If a command creates a marker file after successful initialization, use `creates`:

```yaml
- name: Initialize orders search index
  ansible.builtin.command:
    cmd: /opt/orders-api/bin/init-search-index
    creates: /var/lib/orders-api/search/.initialized
  become: true
  become_user: orders
```

If a command only reads state, mark it as unchanged:

```yaml
- name: Check orders API health
  ansible.builtin.command: curl -fsS http://127.0.0.1:3000/health
  register: orders_health
  changed_when: false
```

This tells Ansible that a successful health check should not count as a host change and should not trigger handlers.

## When Change Is Correct

`changed=0` is not always the right result. What matters is truthful change reporting.

A deployment that renders a new orders config should report change on the template task. A package upgrade should report change when a package actually changes. A migration task may report change when it applies new database migrations.

The warning sign is repeated unexpected change. If a settled host changes every run, one of these is often true:

- A command or shell task has no guard.
- A template includes a value that changes every render, such as a timestamp.
- A file task omits ownership or mode, and another process keeps correcting it back.
- A task marks itself changed with `changed_when: true`.
- A handler is tied to a task whose change result is too broad.

Fix the task that reports the wrong state. Do not hide real changes just to make the recap look clean. A quiet recap is useful only when it is honest.

## Putting It All Together

For the orders service, idempotency means the playbook can be used throughout the host's life:

- On day one, it installs packages, writes files, and starts services.
- On later days, it confirms those things still match.
- When a real edit happens, it reports the exact task that changed.
- When no edit happens, it settles without duplicate lines or unnecessary restarts.

This is why Ansible tasks should prefer state-aware modules. The module gives Ansible a way to compare current state with desired state. The recap then becomes a useful signal instead of a rough guess.

## What's Next

The next article explains how to read Ansible run results. Idempotency tells you what a healthy repeat run should look like, but the output is where you confirm which hosts changed, failed, skipped, or settled.

---

**References**

- [Ansible playbooks: desired state and idempotency](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html#desired-state-and-idempotency)
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html)
- [Error handling in playbooks: defining changed](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html#defining-changed)
- [ansible.builtin.command module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/command_module.html)
