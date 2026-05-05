---
title: "Templates, Files, and Service Config"
description: "Use Ansible file modules to manage service configuration safely with templates, ownership, permissions, validation, and previewed diffs."
overview: "Service configuration is where Ansible starts to feel useful on real Linux VMs. You will learn when to use templates, static file copies, directory management, and single-line edits while keeping Nginx and systemd config reviewable."
tags: ["ansible", "template", "copy", "nginx", "jinja2"]
order: 5
id: article-infrastructure-as-code-ansible-templates-files-service-config
---

## Table of Contents

1. [Configuration Files Are Server Behavior](#configuration-files-are-server-behavior)
2. [Repository Shape for Files and Templates](#repository-shape-for-files-and-templates)
3. [Choosing copy, file, template, or lineinfile](#choosing-copy-file-template-or-lineinfile)
4. [Rendering an Nginx Template with Variables](#rendering-an-nginx-template-with-variables)
5. [Managing Static Files and Directories](#managing-static-files-and-directories)
6. [Making Small Edits with lineinfile](#making-small-edits-with-lineinfile)
7. [Previewing File Changes with Check and Diff](#previewing-file-changes-with-check-and-diff)
8. [When a Template Breaks a Service](#when-a-template-breaks-a-service)
9. [Review Habits for Service Config](#review-habits-for-service-config)

## Configuration Files Are Server Behavior

A Linux service is not only the binary that runs. It is also the files around it: the Nginx config that routes traffic, the systemd unit that starts the process, the environment file that sets the port, the directories where logs are written, and the permissions that decide which user can read each file. When one of those files changes, the server's behavior changes.

Ansible gives you file modules so those files can live in Git instead of in one person's terminal history. A module is Ansible's unit of work for a task. The file modules know how to inspect the target machine, compare the current file with the desired file, and report whether anything changed. That is the important difference between "copy this by hand" and "make the server match this reviewed configuration."

The running example is `devpolaris-orders`, a small API on Linux VMs. Nginx listens on port 80 and forwards traffic to a local systemd service called `devpolaris-orders-api`. The API listens on `127.0.0.1:8080`. Ansible will manage the Nginx config, a systemd environment file, a log directory, and a small static health file.

```text
User request
  |
  v
Nginx on port 80
  |
  v
devpolaris-orders-api on 127.0.0.1:8080
  |
  v
systemd keeps the API running
```

The goal is not to memorize every option on every module. The goal is to learn the judgment: when the whole file belongs in Git, render a template. When the file is static, copy it. When only a directory or permission matters, use `file`. When one line in an existing OS file must be controlled, use `lineinfile` carefully.

That judgment matters because file automation can be either clear or messy. A clean playbook lets a reviewer see the exact config that will land on the host. A messy playbook hides behavior in shell commands, appends duplicate lines, and makes every run look like a change even when the server already matches the repository.

## Repository Shape for Files and Templates

Before writing tasks, give the files a home that a teammate can understand. A beginner often starts by putting everything in one playbook. That works for a few lines, but service configuration quickly becomes easier to review when templates and static files live beside the playbook.

For `devpolaris-orders`, a small Ansible directory can look like this:

```text
ansible/
  inventory.ini
  site.yml
  group_vars/
    orders_web.yml
  templates/
    nginx.conf.j2
    orders-api.env.j2
  files/
    health.json
```

The `inventory.ini` file names the target VMs. The `site.yml` file contains the play. The `group_vars/orders_web.yml` file stores variables for every host in the `orders_web` group. The `templates` directory contains files that Ansible will render through Jinja2, the templating language Ansible uses for `template`. The `files` directory contains files that do not need variable substitution.

Here is a small inventory for two Linux VMs:

```ini
[orders_web]
orders-web-01 ansible_host=10.0.10.21
orders-web-02 ansible_host=10.0.10.22

[orders_web:vars]
ansible_user=ubuntu
```

The inventory says which machines Ansible should connect to. It does not describe the final config. The playbook and the files do that work.

The group variables hold values that should be the same for both web hosts:

```yaml
orders_service_name: devpolaris-orders-api
orders_api_port: 8080
orders_server_name: orders.devpolaris.internal
orders_log_dir: /var/log/devpolaris-orders
orders_owner: devpolaris
```

Think of these variables like a small config object in JavaScript. The template can read the values, but the values are still visible in one reviewable file. If staging needs a different server name or port, the team can change the variable without copying the whole Nginx template.

That split keeps intent close to the right place. The template owns the shape of the config file. The variables own the environment-specific values. The playbook owns where the file lands, which user owns it, what mode it receives, and which validation runs before replacement.

## Choosing copy, file, template, or lineinfile

Ansible has several modules that can touch files. The safest first habit is to choose the module that describes the final state most directly. If you are tempted to use `shell: echo ... >> file`, pause and ask what state you are actually trying to enforce.

Here is the small decision table for this article:

| Need | Module | Example |
|------|--------|---------|
| Render a full config from variables | `ansible.builtin.template` | `/etc/nginx/nginx.conf` |
| Copy a static file exactly | `ansible.builtin.copy` | `/var/www/orders-health/health.json` |
| Create a directory, symlink, or permission | `ansible.builtin.file` | `/var/log/devpolaris-orders` |
| Ensure one line in an existing file | `ansible.builtin.lineinfile` | `/etc/default/devpolaris-orders-api` |

The full collection name, such as `ansible.builtin.template`, is called the FQCN (fully qualified collection name). You will see short names like `template` in many examples. The longer name is clearer in teaching material and makes it easier to find the exact module docs later.

The wrong module often creates the wrong behavior on the second run. This shell task looks small, but it appends forever:

```yaml
- name: Add API port with shell
  ansible.builtin.shell: echo "ORDERS_API_PORT=8080" >> /etc/default/devpolaris-orders-api
```

Run that task three times and the file may contain the same line three times:

```text
ORDERS_API_PORT=8080
ORDERS_API_PORT=8080
ORDERS_API_PORT=8080
```

That is not a stable desired state. Ansible can still run the command, but Ansible cannot infer that you meant "one line should exist exactly once." `lineinfile` can express that state directly:

```yaml
- name: Set the orders API port
  ansible.builtin.lineinfile:
    path: /etc/default/devpolaris-orders-api
    regexp: "^ORDERS_API_PORT="
    line: "ORDERS_API_PORT=8080"
    create: true
    owner: root
    group: root
    mode: "0644"
```

Now the second run has something to compare. If the matching line already says `ORDERS_API_PORT=8080`, the task reports `ok`. If it says `ORDERS_API_PORT=3000`, the task updates that line and reports `changed`. If the file is missing, `create: true` tells Ansible that creating it is allowed.

For whole service files, prefer `template` or `copy` over a collection of small edits. A reviewer can understand one complete Nginx config faster than ten `lineinfile` tasks that modify scattered lines.

## Rendering an Nginx Template with Variables

A template is a source file on the Ansible controller that becomes a real file on the target host after variables are substituted. The source file usually ends in `.j2` because Ansible processes it with Jinja2. Jinja2 expressions use double braces, such as `{{ orders_api_port }}`, to insert values.

For this learning VM, the team owns the full `/etc/nginx/nginx.conf` file. That makes validation straightforward because Nginx can test the temporary rendered file before Ansible replaces the real config.

```nginx
user www-data;
worker_processes auto;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    access_log /var/log/nginx/access.log;
    error_log /var/log/nginx/error.log warn;

    upstream devpolaris_orders_api {
        server 127.0.0.1:{{ orders_api_port }};
    }

    server {
        listen 80;
        server_name {{ orders_server_name }};

        location /health {
            alias /var/www/orders-health/health.json;
            default_type application/json;
        }

        location / {
            proxy_pass http://devpolaris_orders_api;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

Only two values are dynamic: `orders_api_port` and `orders_server_name`. Keep templates boring when you can. A template with twenty conditionals starts to behave like a program, and service config is already hard enough to debug without hidden branches.

The task that renders this file carries the operational details:

```yaml
- name: Render nginx configuration for orders
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/nginx.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
```

The `src` path is read from the controller. The `dest` path is on the remote VM. The `owner`, `group`, and `mode` fields describe file metadata. The quoted mode matters because file modes are octal numbers, the same base-8 style you saw with `chmod`. Quoting keeps Ansible from treating the value as a normal decimal number.

The `validate` command is the safety line. Ansible renders the template to a temporary path, substitutes that path into `%s`, and runs the command before replacing the destination. If Nginx rejects the candidate config, the old `/etc/nginx/nginx.conf` remains in place. That prevents a typo from becoming the active config file.

When the variables above are applied, the rendered part of the file contains ordinary Nginx syntax:

```nginx
upstream devpolaris_orders_api {
    server 127.0.0.1:8080;
}

server {
    listen 80;
    server_name orders.devpolaris.internal;
}
```

That rendered output is what the remote service reads. Ansible and Jinja2 are only involved before the file lands on the machine. Once the file is written, Nginx does not know or care that it came from a template.

## Managing Static Files and Directories

Not every file needs a template. The health response used by Nginx can be static. It is useful as a tiny smoke check when you want to prove Nginx is serving the expected file path even if the API is not involved.

```json
{
  "service": "devpolaris-orders",
  "status": "ok"
}
```

The destination directory should exist before the file is copied. Use `file` for the directory because the desired state is about a path and its attributes, not file content.

```yaml
- name: Create health document directory
  ansible.builtin.file:
    path: /var/www/orders-health
    state: directory
    owner: root
    group: root
    mode: "0755"

- name: Copy static health document
  ansible.builtin.copy:
    src: health.json
    dest: /var/www/orders-health/health.json
    owner: root
    group: root
    mode: "0644"
```

`state: directory` means the directory should exist. If it already exists with the right metadata, Ansible reports `ok`. If the mode is wrong, Ansible fixes it and reports `changed`. The `copy` task works the same way for the file content and metadata.

The application log directory is another `file` task. This one is owned by the service user because the API process needs to write logs there.

```yaml
- name: Create orders log directory
  ansible.builtin.file:
    path: "{{ orders_log_dir }}"
    state: directory
    owner: "{{ orders_owner }}"
    group: "{{ orders_owner }}"
    mode: "0750"
```

The mode `0750` means the owner can read, write, and enter the directory; the group can read and enter; everyone else has no access. That is a better default for application logs than `0777`, which lets every local user write there.

You can verify the result from the VM:

```bash
$ ls -ld /var/www/orders-health /var/log/devpolaris-orders
drwxr-xr-x 2 root       root       4096 Apr 14 10:12 /var/www/orders-health
drwxr-x--- 2 devpolaris devpolaris 4096 Apr 14 10:12 /var/log/devpolaris-orders
```

That output is a useful habit after a first run. Ansible says what it changed, but the server view confirms what users and processes will experience.

## Making Small Edits with lineinfile

Sometimes the whole file does not belong to your playbook. A distribution package may own it. Another team may manage most of it. In that case, replacing the whole file can be rude because you may erase settings you did not intend to own.

For `devpolaris-orders`, imagine the API package creates `/etc/default/devpolaris-orders-api`, but the platform team wants Ansible to control only the port and log directory. `lineinfile` can manage those two lines without replacing the rest of the file.

```yaml
- name: Set orders API port in environment file
  ansible.builtin.lineinfile:
    path: /etc/default/devpolaris-orders-api
    regexp: "^ORDERS_API_PORT="
    line: "ORDERS_API_PORT={{ orders_api_port }}"
    create: true
    owner: root
    group: root
    mode: "0644"

- name: Set orders log directory in environment file
  ansible.builtin.lineinfile:
    path: /etc/default/devpolaris-orders-api
    regexp: "^ORDERS_LOG_DIR="
    line: "ORDERS_LOG_DIR={{ orders_log_dir }}"
    create: true
    owner: root
    group: root
    mode: "0644"
```

The `regexp` field is the key. It tells Ansible which existing line should be replaced. Without a good regular expression, Ansible may add a new line instead of updating the old one. For key-value files, anchor the pattern at the start with `^` and include the key name plus `=`.

The resulting file stays small and predictable:

```text
ORDERS_API_PORT=8080
ORDERS_LOG_DIR=/var/log/devpolaris-orders
```

Use this module for one-line ownership, not for building large config files line by line. If you find yourself writing six `lineinfile` tasks against the same file, that file probably wants a template or a package-specific drop-in file.

There is also a maintenance tradeoff. `lineinfile` preserves local settings outside the matched lines, which can be helpful. It also means the final file is partly controlled by Ansible and partly controlled by something else. A template gives stronger ownership because the whole file is visible in Git.

## Previewing File Changes with Check and Diff

File changes are easier to review when you can see the proposed before-and-after. Ansible check mode asks supported modules to predict changes without modifying the remote host. Diff mode asks supported modules to show content differences. Together they give a useful review pass before touching a VM.

```bash
$ ansible-playbook -i inventory.ini site.yml --check --diff --limit orders-web-01
```

The `--limit` flag matters in early testing. It keeps the preview focused on one host instead of every VM in the group. Check mode is a simulation, so it is not proof that every later step will work, but it is very helpful for file modules that support it.

A template diff might look like this:

```diff
TASK [Render nginx configuration for orders] ***********************************
--- before: /etc/nginx/nginx.conf
+++ after: /Users/senlin/.ansible/tmp/nginx.conf.j2
@@
     upstream devpolaris_orders_api {
-        server 127.0.0.1:3000;
+        server 127.0.0.1:8080;
     }
@@
-        server_name old-orders.internal;
+        server_name orders.devpolaris.internal;
```

The useful reading is not "Ansible will change two lines." The useful reading is "Nginx will now proxy to a different local port and answer for a different server name." Diff mode turns file content into operational evidence.

After a real run, the recap tells you whether the playbook changed the host:

```text
PLAY RECAP *********************************************************************
orders-web-01 : ok=7 changed=4 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

On the first run, `changed=4` may be expected because directories, files, and templates were created. On a second run with the same inputs, you want the count to fall:

```text
PLAY RECAP *********************************************************************
orders-web-01 : ok=7 changed=0 unreachable=0 failed=0 skipped=0 rescued=0 ignored=0
```

That second run is the idempotency check. It says Ansible inspected the VM and found that the desired file state already matched. If a file task reports changed on every run, inspect the module choice, the template content, and any generated value that changes every time.

One common culprit is putting a timestamp into a template:

```nginx
server_tokens off;
add_header X-Rendered-At "{{ ansible_date_time.iso8601 }}";
```

That looks useful for debugging, but it changes on every run. Ansible will rewrite the file each time, and any handler notified by that task will also run each time. Put changing build metadata somewhere else unless the service truly needs it.

## When a Template Breaks a Service

The most useful file automation failure is the one that stops before the service reads a bad file. The `validate` option on the Nginx template gives you that shape. It checks the candidate file first and refuses to replace the destination when the command exits with a non-zero code.

Suppose someone accidentally removes the semicolon from the upstream server line:

```nginx
upstream devpolaris_orders_api {
    server 127.0.0.1:8080
}
```

The playbook fails before writing that broken config into place:

```text
TASK [Render nginx configuration for orders] ***********************************
fatal: [orders-web-01]: FAILED! => {
    "changed": false,
    "msg": "failed to validate",
    "stderr": "nginx: [emerg] invalid number of arguments in \"server\" directive in /tmp/ansible.nginx.conf:13\nnginx: configuration file /tmp/ansible.nginx.conf test failed\n"
}
```

The first line to inspect is the Nginx error, not the Ansible wrapper text. It tells you the directive, the temporary file path, and the line number inside the candidate config. The fix is to repair the template or variable value, then rerun check mode and the playbook.

Validation is not a replacement for service verification. A config can pass `nginx -t` and still point to an API port where nothing is listening. After applying a config change, check both Nginx and the upstream service.

```bash
$ systemctl is-active nginx
active
$ curl -sS http://127.0.0.1/health
{
  "service": "devpolaris-orders",
  "status": "ok"
}
```

The first command proves systemd thinks Nginx is running. The second proves the HTTP path answers locally. If the app route returns a `502 Bad Gateway`, Nginx is running but cannot reach the upstream API. That diagnosis belongs to the service layer, not the template renderer.

```text
2026/04/14 10:18:42 [error] 1117#1117: *42 connect() failed (111: Connection refused) while connecting to upstream, client: 10.0.1.15, server: orders.devpolaris.internal, request: "GET /orders HTTP/1.1", upstream: "http://127.0.0.1:8080/orders"
```

That log line tells you Nginx accepted the request and then failed to connect to `127.0.0.1:8080`. The next check is the API service status, not the Nginx template.

## Review Habits for Service Config

A file task should make ownership clear. When a reviewer reads it, they should know which file is managed, what content or attribute is enforced, how the file is validated, and what will happen on the second run.

For the full `devpolaris-orders` file work, the playbook can stay compact:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true

  tasks:
    - name: Create health document directory
      ansible.builtin.file:
        path: /var/www/orders-health
        state: directory
        owner: root
        group: root
        mode: "0755"

    - name: Copy static health document
      ansible.builtin.copy:
        src: health.json
        dest: /var/www/orders-health/health.json
        owner: root
        group: root
        mode: "0644"

    - name: Create orders log directory
      ansible.builtin.file:
        path: "{{ orders_log_dir }}"
        state: directory
        owner: "{{ orders_owner }}"
        group: "{{ orders_owner }}"
        mode: "0750"

    - name: Render nginx configuration for orders
      ansible.builtin.template:
        src: nginx.conf.j2
        dest: /etc/nginx/nginx.conf
        owner: root
        group: root
        mode: "0644"
        validate: "nginx -t -c %s"
```

This playbook does not restart services yet. That is a separate concern, and the next article handles handlers and service restarts. Keeping file state separate in your head makes the review easier: first prove the right files will land on the host, then decide what should reload or restart when those files change.

Use this checklist when reviewing file tasks:

| Review Question | Why It Matters |
|-----------------|----------------|
| Does this module describe the final state directly? | Direct state is easier to rerun safely. |
| Is the file mode quoted? | Quoted modes avoid decimal parsing surprises. |
| Is the whole file owned by this playbook? | Whole-file ownership points toward `template` or `copy`. |
| Is only one existing line owned? | Single-line ownership points toward `lineinfile`. |
| Can the candidate config be validated before replacement? | Validation catches syntax errors before activation. |
| Does `--check --diff` show understandable evidence? | Reviewers need to see the behavior change, not only task names. |

The tradeoff is ownership versus coexistence. A template gives clear ownership and clean diffs, but it can erase manual or package-managed settings outside the template. `lineinfile` coexists with other owners, but it spreads the final file state across the playbook and the host. Choose the smallest ownership boundary that still lets a teammate understand the resulting service behavior.

---

**References**

- [ansible.builtin.template module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/template_module.html) - Official reference for rendering Jinja2 templates, setting file metadata, using validation commands, and understanding check and diff support.
- [ansible.builtin.copy module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/copy_module.html) - Official reference for copying static files and managing ownership, permissions, and file content on remote hosts.
- [ansible.builtin.file module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/file_module.html) - Official reference for directories, symlinks, file attributes, ownership, and mode handling.
- [ansible.builtin.lineinfile module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/lineinfile_module.html) - Official reference for managing one line in an existing text file without replacing the whole file.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official guide to previewing Ansible changes and reading before-and-after diffs.
