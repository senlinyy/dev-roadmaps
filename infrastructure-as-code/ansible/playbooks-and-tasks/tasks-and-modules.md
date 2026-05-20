---
title: "Tasks and Modules"
description: "Learn how Ansible tasks call modules that inspect and change host state."
overview: "A task is the visible step in a playbook. A module does the work behind that step."
tags: ["ansible", "tasks", "modules", "collections"]
order: 2
id: article-infrastructure-as-code-ansible-tasks-modules
---

## Table of Contents

1. [What a Task Is](#what-a-task-is)
2. [Modules](#modules)
3. [State-Aware Work](#state-aware-work)
4. [Command and Shell](#command-and-shell)
5. [Collections and FQCNs](#collections-and-fqcns)
6. [Choosing the Module](#choosing-the-module)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What a Task Is

The previous article showed the outer shape of a playbook: plays choose hosts, and tasks list the work for those hosts. This article zooms in on one task.

A task is one instruction inside a play. It has a human name and an action for Ansible to perform. The human name appears in run output. The action is usually a module call with arguments.

For the orders service, a task might install the web server package:

```yaml
- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present
```

Read the task as a sentence: on each selected host, make the `nginx` package present by using the `apt` module. The task name says the intent. The module name says which Ansible tool will do the work. The arguments say the desired state.

The task is the unit you review in a playbook and the unit you see in output. If a run says `TASK [Install nginx]`, everyone reading the terminal should know what that step was trying to manage.

## Modules

A module is the code Ansible runs to do a particular kind of work. Package modules manage packages. File modules manage files and directories. Template modules render files from Jinja templates. Service modules start, stop, enable, or disable services.

Modules matter because they know the domain they manage. The `apt` module can ask the package manager whether Nginx is already installed. The `template` module can compare the rendered content with the file already on the host. The `service` module can check whether a service is running.

That knowledge is what makes Ansible different from a list of remote shell commands. A shell command can execute a line of text. A module can often inspect the current host state, compare it with the requested state, and decide whether anything needs to change.

For the orders web host, these three tasks call three different modules because they manage three different kinds of state:

```yaml
- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present

- name: Render orders site config
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    mode: "0644"

- name: Keep nginx running
  ansible.builtin.service:
    name: nginx
    state: started
    enabled: true
```

The module choice tells Ansible how to reason about the task. If the package is already installed, the package task can report `ok`. If the rendered file content differs, the template task can report `changed`. If the service is already started and enabled, the service task can settle without doing work.

## State-Aware Work

Most useful Ansible tasks describe final state. They say what should be true after the task finishes.

This package task does not say "run `apt install` every time." It says the package should be present:

```yaml
- name: Install nginx
  ansible.builtin.apt:
    name: nginx
    state: present
```

On a new orders host, the task may install Nginx and report:

```text
changed: [orders-web-02]
```

On a settled orders host, the same task may report:

```text
ok: [orders-web-01]
```

The playbook did not change between those two results. The host state changed the outcome. This is why module output is evidence about the managed machine.

Some module arguments also affect how precise the state is. A template task that sets `mode: "0644"` manages file permissions as well as content. A service task with `enabled: true` manages startup behavior as well as the current running state. If those details matter to the service, put them in the module arguments instead of leaving them as assumptions.

## Command and Shell

Ansible also has modules for running commands. `ansible.builtin.command` runs a command without a shell. `ansible.builtin.shell` runs through a shell, so shell features such as pipes, redirects, and environment expansion are available.

Command-style tasks are useful when the system exposes an operation as a command and there is no better module. An orders migration might look like this:

```yaml
- name: Run orders database migration
  ansible.builtin.command:
    cmd: /opt/orders-api/bin/migrate
    chdir: /opt/orders-api
  become: true
  become_user: orders
```

That task may be a reasonable part of a deployment, but it has less built-in state knowledge than a package or service module. Ansible can see the command return code and captured output. It usually cannot know whether the migration was already applied unless the command itself handles that safely.

Command and shell tasks should be made explicit when they are read-only. A health check should not count as a host change:

```yaml
- name: Check orders API health
  ansible.builtin.command: curl -fsS http://127.0.0.1:3000/health
  register: orders_health
  changed_when: false
```

If a command creates a file as its main effect, `creates` can help Ansible skip the command when that file already exists:

```yaml
- name: Initialize orders cache directory
  ansible.builtin.command:
    cmd: /opt/orders-api/bin/init-cache
    creates: /var/cache/orders-api/.initialized
```

That guard is still weaker than a purpose-built module, but it gives Ansible a concrete state check. Without a guard, command and shell tasks often report `changed` every run.

Use `command` when you do not need shell features. Use `shell` when you do need shell features. If you use `shell`, quote carefully because the shell will interpret special characters.

## Collections and FQCNs

Modern Ansible content is organized into collections. A collection packages modules, plugins, roles, and documentation under a namespace. The module name `ansible.builtin.apt` is a fully qualified collection name, often shortened to FQCN.

The FQCN has three parts:

| Part | Example | Meaning |
|------|---------|---------|
| Namespace | `ansible` | The collection namespace |
| Collection | `builtin` | The collection name |
| Module | `apt` | The module inside the collection |

Using FQCNs makes playbooks easier to read and safer to maintain. A short name like `copy` or `user` might exist in more than one collection. The FQCN says exactly which module you intend.

For first-party built-in modules, the common prefix is `ansible.builtin`. In an orders playbook, that gives names like `ansible.builtin.template`, `ansible.builtin.service`, and `ansible.builtin.debug`.

## Choosing the Module

Start by naming the state you want to manage. Then choose the module that understands that state.

| Desired state | Better module | Usually weaker approach |
|---------------|---------------|-------------------------|
| Package is installed | `ansible.builtin.apt` or another package module | `command: apt install ...` |
| File content is rendered from variables | `ansible.builtin.template` | `shell: echo ... > file` |
| One managed line exists in a file | `ansible.builtin.lineinfile` | `shell: echo ... >> file` |
| Service is running and enabled | `ansible.builtin.service` or `ansible.builtin.systemd_service` | `command: systemctl start ...` |
| Path exists with owner and mode | `ansible.builtin.file` | `command: mkdir ... && chmod ...` |

The weaker approach may still work once. The stronger module usually gives better repeat behavior, clearer output, and safer change reporting.

For example, this shell task appends a line every time it runs:

```yaml
- name: Add orders proxy timeout
  ansible.builtin.shell: echo "proxy_read_timeout 30s;" >> /etc/nginx/conf.d/orders.conf
```

This task describes the final line instead:

```yaml
- name: Set orders proxy timeout
  ansible.builtin.lineinfile:
    path: /etc/nginx/conf.d/orders.conf
    regexp: "^proxy_read_timeout"
    line: "proxy_read_timeout 30s;"
```

The second version gives Ansible something stable to inspect. It can find the existing line, replace it if needed, or report `ok` if the file already matches.

## Putting It All Together

Tasks are the readable steps in the playbook. Modules are the state-aware tools behind those steps.

For the orders service, a good task usually has four qualities:

- The task name says the managed state in plain English.
- The module matches the thing being managed.
- The arguments describe the final state clearly.
- Command-style tasks explain their change and failure behavior when the default result would mislead.

When a playbook is built this way, the run output becomes useful evidence. `ok` means the module found the host already matched. `changed` means the module changed something. `failed` means the module could not complete the requested state.

## What's Next

The next article covers idempotency, the repeat behavior that makes Ansible useful for both first-time setup and later maintenance. Tasks and modules are where idempotency either becomes clear or starts to break.

---

**References**

- [Ansible playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_intro.html)
- [Using collections in a playbook](https://docs.ansible.com/projects/ansible/latest/collections_guide/collections_using_playbooks.html)
- [ansible.builtin.command module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/command_module.html)
- [ansible.builtin.shell module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/shell_module.html)
- [Error handling in playbooks](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_error_handling.html)
