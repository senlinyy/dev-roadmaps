---
title: "Files and Templates"
description: "Use Ansible to manage directories, static files, rendered templates, ownership, and file modes."
overview: "Many service changes are file changes. Ansible can manage the bytes on disk and the metadata around them."
tags: ["ansible", "files", "templates", "jinja2"]
order: 1
id: article-infrastructure-as-code-ansible-templates-files-service-config
aliases:
  - templates-files-service-config
  - infrastructure-as-code/ansible/templates-files-service-config.md
---

## Table of Contents

1. [Files Are Service State](#files-are-service-state)
2. [Directories](#directories)
3. [Static Files](#static-files)
4. [Templates](#templates)
5. [Ownership and Modes](#ownership-and-modes)
6. [Validation](#validation)
7. [Check Mode and Diff](#check-mode-and-diff)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Files Are Service State

Most services do not start with code alone. They start with files that tell the operating system where the service lives, which port it uses, who can read its secrets, and what should happen when a request arrives.

For an `orders` service, the important files might be spread across the machine:

- `/etc/nginx/conf.d/orders.conf` tells Nginx how to proxy traffic to the service.
- `/etc/systemd/system/orders-api.service` tells systemd how to start the process.
- `/etc/orders/orders.env` holds environment values the process reads at startup.
- `/var/log/orders` gives the service a place to write logs.

If those files drift, the service drifts. One web server might proxy to port `8080`, another to `8081`, and a third might still have an old hostname. The service can look deployed while each host behaves a little differently.

Ansible file work is about making the desired file state explicit. The playbook says which path should exist, which bytes should be inside it, which user should own it, and which permissions should protect it. When Ansible runs again, it compares that desired state with the current host and changes only what is different.

That last detail matters. File tasks are not shell commands that blindly overwrite things every time. The usual Ansible pattern is declarative: describe the final state, let the module inspect the remote host, and let the task report `changed` only when the host actually moved toward that state.

## Directories

A directory is more than a path string. It has an owner, a group, and a mode just like a file. If the `orders` process writes logs as the `orders` user, the log directory must allow that user to write there. If the directory is missing, the process may start and then fail only when the first log line is written.

The `ansible.builtin.file` module manages filesystem objects and their metadata. For a directory, `state: directory` tells Ansible that the path should exist as a directory.

```yaml
- name: Create orders log directory
  ansible.builtin.file:
    path: /var/log/orders
    state: directory
    owner: orders
    group: orders
    mode: "0750"
```

This task does a few separate things. It creates `/var/log/orders` if the directory is missing. It sets the owner and group to `orders`. It sets the mode to `0750`, which means the owner can read, write, and enter the directory; the group can read and enter it; everyone else has no access.

The task is still useful after the first run. If someone changes the directory owner by hand, a later playbook run can put it back. If the directory already matches, the task reports `ok`.

Do not treat `mode` as a decoration. Directory execute permission controls whether a user can enter the directory and resolve names inside it. A log directory with `0640` would look restrictive, but it would also be unusable as a directory because users need execute permission on directories to traverse them.

## Static Files

Some files do not need variables. A health check document, a static Nginx snippet, or a small service banner may be the same on every host. For those files, use `ansible.builtin.copy`.

```yaml
- name: Copy orders health document
  ansible.builtin.copy:
    src: health.json
    dest: /var/www/orders-health/health.json
    owner: root
    group: root
    mode: "0644"
```

The `src` file lives with the playbook or role on the control node. The `dest` path is on the managed host. Ansible reads the local file, compares it with the remote file, and updates the remote file when the content or metadata does not match.

Static files work best when the file really is static. If a file contains `orders.example.com`, a port number, or an environment-specific path, it is probably not a static file. Putting production values into a copied file makes reuse harder because the file quietly becomes tied to one environment.

There is also a scale surprise here. The copy module can copy directories, but it is not the right tool for large release trees with thousands of files. At that point you usually want packaging, artifact deployment, synchronization, or a service-specific release process. For configuration and small support files, `copy` is clear and easy to review.

## Templates

A template is a file with variables in it. Ansible renders the template through Jinja2 before writing the final file to the managed host. The host does not receive a Jinja file. It receives normal configuration text.

Here is a small Nginx template for the `orders` service:

```jinja2
server {
  listen 80;
  server_name {{ orders_server_name }};

  location / {
    proxy_pass http://127.0.0.1:{{ orders_api_port }};
    proxy_read_timeout {{ orders_proxy_timeout }};
  }
}
```

The variables come from inventory, play vars, role defaults, or other Ansible variable sources. The template file describes the shape of the config, while the variables describe the values that change between environments.

The task that renders it looks like this:

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    owner: root
    group: root
    mode: "0644"
```

On a staging host, `orders_server_name` might be `orders.staging.example.com`. On a production host, it might be `orders.example.com`. The task stays the same. The rendered file changes because the host variables are different.

This separation is the main reason templates are safer than copying slightly different files for each environment. You can review one template and then review the small set of variables that feed it.

Templates can also hide drift if they include unstable values. A timestamp, random token, or changing comment in a template can make Ansible report `changed` on every run. That matters because changed template tasks often notify handlers. A file that changes every run can become a service that reloads every run.

## Ownership and Modes

File content and file metadata are part of the same desired state. A perfect environment file with the wrong mode can leak a secret. A correct systemd unit with the wrong owner may be harder to audit. A script without execute permission may be present but unusable.

For an `orders` environment file, the application group may need read access while other users should not see it:

```yaml
- name: Render orders environment file
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders/orders.env
    owner: root
    group: orders
    mode: "0640"
```

The owner `root` can write the file. Members of the `orders` group can read it. Other users cannot read it. If the file contains database connection settings, that distinction is not cosmetic.

Quote numeric modes. File modes are octal permission values, not ordinary decimal numbers. Ansible's documentation recommends quoted octal strings such as `"0644"` or `"0750"` so the module can parse the permission value consistently. An unquoted number can be treated as decimal in some situations, especially in loops, and the resulting permissions can surprise you.

If you leave `mode` out, Ansible may preserve an existing file's mode or use the remote system's default umask for a new file. That can be fine for a throwaway file. It is weak for service configuration. A reader should not have to inspect the host's umask to know who can read `/etc/orders/orders.env`.

## Validation

Some files should be checked before they replace the live file. Nginx configuration is a common example. A broken site file can make reload fail or prevent a later restart from coming up cleanly.

The `template` and `copy` modules support `validate`. Ansible writes the candidate content to a temporary file first, runs the validation command against that temporary file, and only then replaces the destination.

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
```

The `%s` is replaced with the temporary file path. The important point is that Nginx checks the candidate file before it becomes `/etc/nginx/conf.d/orders.conf`.

Validation is not a full integration test. It can tell you whether the file is syntactically acceptable to a command. It cannot prove that the upstream service is healthy, that DNS points to the right place, or that users can complete checkout. It is still worth using because it catches bad files at the moment Ansible is about to write them.

There is one practical surprise: the validation command is not passed through a shell. Shell features such as pipes and variable expansion do not work in the simple `validate` string. If validation needs several commands, put that logic in a script and validate with the script.

## Check Mode and Diff

When a file task is ready for review, check mode and diff mode make the change visible before it lands. Check mode asks Ansible what it would change. Diff mode shows the file differences for modules that support it.

```bash
ansible-playbook -i inventory.yml orders-web.yml --check --diff
```

For a template change, the useful output is often only a few lines:

```diff
-    proxy_pass http://127.0.0.1:8080;
+    proxy_pass http://127.0.0.1:8081;
```

That diff tells a reviewer exactly what behavior changed. The service will proxy to a different local port.

Diff output can also leak secrets. If `/etc/orders/orders.env` contains a database password, `--diff` can print that value into a terminal, a CI log, or a ticket. For secret-bearing tasks, use secret handling and disable diff output on that task:

```yaml
- name: Render orders environment file
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders/orders.env
    owner: root
    group: orders
    mode: "0640"
  diff: false
```

This keeps normal file review useful without treating every file as safe to print.

## Putting It All Together

The `orders` service needed several files before it could behave consistently. The log directory needed the right owner and directory permissions. The health document was static, so `copy` was enough. The Nginx site and environment file needed host-specific values, so templates were the better fit. The Nginx file deserved validation before replacement. The environment file needed stricter permissions and should not appear in shared diff logs.

That is the basic decision path for Ansible file work:

| Need | Usual module | Reason |
|------|--------------|--------|
| A directory, symlink, or metadata-only change | `ansible.builtin.file` | It manages filesystem object state and properties. |
| A file that is the same everywhere | `ansible.builtin.copy` | It copies known bytes and can still set ownership and mode. |
| A file with environment-specific values | `ansible.builtin.template` | It renders Jinja2 variables into a normal remote file. |
| A risky config format | `validate` on `copy` or `template` | It checks the candidate file before replacement. |

The practical habit is to make the boundary obvious. If Ansible owns the whole file, manage the whole file. If the file affects a service, make the ownership, mode, validation, and handler notification part of the same review.

## What's Next

Sometimes Ansible should not own the whole file. The next article covers small edits for shared files where one line or one marked block is the safer boundary.

---

**References**

- [ansible.builtin.file module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/file_module.html)
- [ansible.builtin.copy module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/copy_module.html)
- [ansible.builtin.template module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/template_module.html)
- [Check mode and diff mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
