---
title: "Files and Templates"
description: "Use Ansible to manage directories, static files, rendered templates, ownership, and file modes."
overview: "Many service changes are file changes. Ansible can manage the bytes on disk and the metadata around them."
tags: ["ansible", "files", "templates", "jinja2"]
order: 1
id: article-infrastructure-as-code-ansible-templates-files-service-config
aliases:
  - files-and-services/files-and-templates.md
  - infrastructure-as-code/ansible/files-and-services/files-and-templates.md
---

## Table of Contents

1. [Why File State Matters](#why-file-state-matters)
2. [The Orders Web Fleet](#the-orders-web-fleet)
3. [Directories and Metadata with file](#directories-and-metadata-with-file)
4. [Static Files with copy](#static-files-with-copy)
5. [Rendered Files with template](#rendered-files-with-template)
6. [Validation Before Replacement](#validation-before-replacement)
7. [Verification and Failure Reading](#verification-and-failure-reading)
8. [Rollback and Safety](#rollback-and-safety)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Why File State Matters
<!-- section-summary: Ansible file work turns service configuration, permissions, and ownership into repeatable state. -->

A lot of Linux operations come down to files. Nginx reads a site config, systemd reads a unit file, an application reads an environment file, and a monitoring agent reads a YAML file. When a team says "deploy the new service configuration," the actual work often means putting the right bytes in the right path with the right owner, group, and mode.

Ansible gives us a clean way to describe that state. The playbook says which directory should exist, which static files should land on the host, which templates should render from variables, and which validation command should approve the candidate file before it replaces the live one. That matters in production because a tiny permission or syntax drift can turn one host in a fleet into the odd server that fails during the next incident.

The key beginner idea is **ownership boundary**. When Ansible owns the whole file, the repository should contain the whole desired file through `copy` or `template`. When Ansible owns only one line or one section inside a shared file, the next article's smaller edit modules are the right tool. This article stays with full-file ownership because it gives beginners the clearest starting point.

## The Orders Web Fleet
<!-- section-summary: A small production scenario connects the file modules into one service path. -->

Imagine a small orders platform with three web servers behind a load balancer. Each host runs Nginx in front of an `orders-api` systemd service. The service needs a config directory, a rendered environment file, an Nginx virtual host, a static internal CA certificate, and a systemd drop-in directory for service limits.

Manual SSH edits feel quick on day one. By day thirty, one server has an old timeout, one has a different certificate file mode, and one has a hand-edited environment variable that nobody can find in Git. Ansible fixes that by making the repository the source of truth for files that the platform team owns.

Here is the playbook shape we will build around:

```yaml
- name: Configure orders web servers
  hosts: orders_web
  become: true
  vars:
    orders_api_env: production
    orders_api_port: 8080
    orders_api_region: us-east-1
    orders_api_config_dir: /etc/orders-api
  tasks:
    - name: Prepare orders API config directory
      ansible.builtin.file:
        path: "{{ orders_api_config_dir }}"
        state: directory
        owner: root
        group: orders
        mode: "0750"
```

That first task already shows the pattern. We name the desired state, use the fully qualified module name, and quote the file mode. The rest of the article fills in the other file operations around the same service.

In a real repo, the file sources usually sit beside the playbook or inside a role:

```yaml
roles/
  orders_web/
    files/
      platform-internal-ca.pem
    templates/
      orders-api.env.j2
      orders-api.nginx.conf.j2
    tasks/
      main.yml
inventories/
  prod/
    group_vars/
      orders_web.yml
```

The `files/` directory holds content that should land unchanged. The `templates/` directory holds Jinja2 files that need inventory values. The `group_vars` file tells the template which port, region, hostname, and feature flags production should use.

## Directories and Metadata with file
<!-- section-summary: The file module manages path state and metadata before content arrives. -->

The `ansible.builtin.file` module manages a path and its metadata. It can create directories, remove paths, create links, touch files, and set ownership, group, permissions, and SELinux context fields. For file content, teams usually pair it with `copy` or `template`, and `file` often prepares the safe place where those files will live.

For the orders service, the config directory should allow root to write and the `orders` group to read. Other users on the host should have no access because environment files often contain endpoints, feature flags, and sometimes secret references.

```yaml
- name: Create orders API config directory
  ansible.builtin.file:
    path: /etc/orders-api
    state: directory
    owner: root
    group: orders
    mode: "0750"

- name: Create systemd drop-in directory
  ansible.builtin.file:
    path: /etc/systemd/system/orders-api.service.d
    state: directory
    owner: root
    group: root
    mode: "0755"
```

The mode values use quoted strings like `"0750"` and `"0755"`. YAML can treat unquoted numbers in surprising ways, and file permissions need octal meaning. Quoting modes gives Ansible the clearest input and avoids decimal permission mistakes.

This task also gives later failures a clear place to start. If the template task fails with a permission error, you can check whether the directory task ran and whether the owner, group, and mode match the playbook. The fix usually belongs in the directory state instead of in a manual `chmod` after the run.

## Static Files with copy
<!-- section-summary: The copy module sends fixed content from the control node to selected managed hosts. -->

The `ansible.builtin.copy` module handles files whose content should be the same for every selected host. Common examples include an internal CA certificate, a login banner, a small policy file, or a prebuilt config fragment with no host variables. The module compares the remote file with the desired content and reports `changed` only when content or metadata needs an update.

The orders fleet uses an internal CA certificate so the service can call private company APIs over TLS. The same certificate lands on every web server, so `copy` is a good fit.

```yaml
- name: Install internal platform CA certificate
  ansible.builtin.copy:
    src: files/platform-internal-ca.pem
    dest: /usr/local/share/ca-certificates/platform-internal-ca.crt
    owner: root
    group: root
    mode: "0644"
    backup: true
  notify: Refresh trusted certificates
```

`src` points to a file on the control node, usually inside the playbook or role. `dest` is the path on the managed host. `backup: true` asks Ansible to keep a timestamped copy of the old remote file before changing it, which gives an operator a quick rollback path during a bad certificate rollout.

Static files can still be sensitive. If the content includes private keys, tokens, or secrets, teams usually encrypt the source file with Ansible Vault and add `no_log: true` around tasks that may reveal values. Diff mode is helpful for normal config, and it can leak secret-bearing content into CI logs if the task allows a full diff.

## Rendered Files with template
<!-- section-summary: The template module renders Jinja2 with inventory variables before writing the file. -->

The `ansible.builtin.template` module renders a Jinja2 template on the control node and writes the rendered file to the managed host. It fits files that share one structure across environments and need different values per host, group, or environment. For the orders platform, staging and production use the same environment file shape with different ports, endpoints, and feature flags.

The template might live at `templates/orders-api.env.j2`:

```jinja2
ORDERS_ENV={{ orders_api_env }}
ORDERS_PORT={{ orders_api_port }}
ORDERS_REGION={{ orders_api_region }}
PAYMENTS_BASE_URL={{ payments_base_url }}
ENABLE_PROMO_CODES={{ orders_enable_promo_codes | bool | lower }}
```

The playbook renders it like this:

```yaml
- name: Render orders API environment file
  ansible.builtin.template:
    src: orders-api.env.j2
    dest: /etc/orders-api/orders-api.env
    owner: root
    group: orders
    mode: "0640"
    backup: true
  notify: Restart orders API
```

This task gives you a strong production habit: **variables decide the difference, templates decide the shape**. Staging can set `orders_api_env: staging` and `payments_base_url: https://payments.staging.internal`, while production sets production values in inventory or a secured variable store. The task stays the same across both environments.

Rendered files should also keep whitespace and quoting boring. Environment files, YAML, JSON, Nginx configs, and systemd drop-ins all have their own syntax rules. A template reviewer should be able to see the final rendered shape from `--diff` in staging before the task touches production.

## Validation Before Replacement
<!-- section-summary: The validate option tests a temporary candidate file before Ansible installs it. -->

Some formats can be checked before they become live files. The `validate` parameter lets `copy`, `template`, and several line-editing modules run a command against a temporary candidate file. Ansible replaces `%s` with that temporary path, and the module installs the file only after the command exits successfully.

For an application config file, validation can call the application itself:

```yaml
- name: Render orders API YAML config
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: /etc/orders-api/orders-api.yml
    owner: root
    group: orders
    mode: "0640"
    validate: /usr/local/bin/orders-api --check-config %s
    backup: true
  notify: Restart orders API
```

For Nginx, validation often needs the full config tree instead of one fragment. Many teams use a small wrapper script that copies the candidate fragment into a temporary directory and runs `nginx -t` against that tree. The playbook then stays readable while the wrapper handles the service-specific validation details.

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders-api.nginx.conf.j2
    dest: /etc/nginx/conf.d/orders-api.conf
    owner: root
    group: root
    mode: "0644"
    validate: /usr/local/sbin/validate-nginx-fragment %s
    backup: true
  notify: Reload Nginx
```

Validation is one of the best safety tools in this part of Ansible. A syntax error fails the task before the live file changes. The operator sees a clear playbook failure, the previous file remains in place, and the handler never reloads a service with broken input.

## Verification and Failure Reading
<!-- section-summary: Check mode, diff mode, stat checks, and service validators help operators confirm what changed. -->

Before production, run the playbook in staging with check mode and diff mode. Check mode predicts changes without writing them for modules that support it, and diff mode shows the exact file content or metadata changes when the task allows a diff. This gives reviewers a chance to catch a wrong endpoint, a missing variable, or a risky permission before the real run.

```bash
ansible-playbook -i inventories/staging orders-web.yml --limit orders-web-stg-01 --check --diff
ansible-playbook -i inventories/staging orders-web.yml --limit orders-web-stg-01
```

After the run, verify both the file state and the service-level validators. The first command checks the metadata Ansible manages. The second command asks the service to parse its config in the target environment.

```bash
ansible -i inventories/production orders_web -m ansible.builtin.stat -a "path=/etc/orders-api/orders-api.env"
ansible -i inventories/production orders_web -m ansible.builtin.command -a "/usr/local/bin/orders-api --check-config /etc/orders-api/orders-api.yml"
ansible -i inventories/production orders_web -m ansible.builtin.command -a "nginx -t"
```

Give each managed path one task so failure signals point to one owner. A `changed` result on every run usually means the rendered template includes a moving value such as a timestamp, random token, or command output. A permission failure usually points back to the directory owner, group, mode, or `become` setting. A validation failure usually means the generated file content is syntactically wrong even though the Ansible task itself worked.

## Rollback and Safety
<!-- section-summary: Safe file automation keeps previous versions reachable and rolls changes through the fleet in small batches. -->

File rollback starts before the change lands. Keep the source templates and files in Git, tag releases, and run production playbooks from reviewed commits. For high-risk config changes, combine `backup: true` with small rollout batches so one bad change affects one or two hosts before the rest of the fleet sees it.

```yaml
- name: Configure orders web servers
  hosts: orders_web
  become: true
  serial: 1
```

If a bad template reaches production, the cleanest rollback is usually a Git revert followed by another playbook run. That puts the repository and the hosts back in sync. When the emergency is happening right now, the timestamped backup on the remote host can restore the old file while the team prepares the proper repository rollback.

```bash
sudo cp /etc/orders-api/orders-api.yml.12345.2026-06-13@12:15:09~ /etc/orders-api/orders-api.yml
sudo systemctl restart orders-api
```

Treat that manual restore as a temporary incident step. After the service is stable, commit or revert the desired source content and run Ansible again. That keeps the next deployment from reapplying the broken file.

## Putting It All Together
<!-- section-summary: Full-file ownership combines file, copy, template, validation, verification, and careful rollout. -->

The orders web fleet now has a repeatable file path. The `file` module creates directories with the right ownership and modes. The `copy` module installs fixed files such as the internal CA certificate. The `template` module renders environment, application, and web server config from inventory variables. Validation checks candidate files before they replace live files.

The operator workflow also has a clear shape. Review with `--check --diff`, run in staging, verify file metadata and service parsers, then roll through production with `serial`. If a change fails validation, Ansible leaves the old file alone. If a change reaches production and causes trouble, Git revert plus a controlled playbook run returns the fleet to the previous desired state.

That is the happy path when Ansible owns the full file. Some files have multiple owners, such as `sshd_config`, `sudoers`, or a vendor-managed config file. Those shared files need smaller tools, and that is where line-level edits come in.

## What's Next

The next article covers `lineinfile`, `blockinfile`, and `replace`. Those modules help when Ansible should own one clear part of a shared file while leaving the rest of the file under the package, operating system, or another team's control.

---

**References**

- [ansible.builtin.file](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/file_module.html) - Official module documentation for path state, ownership, modes, links, and removal.
- [ansible.builtin.copy](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/copy_module.html) - Official module documentation for copying fixed files and inline content to managed hosts.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module documentation for rendering Jinja2 templates to target hosts.
- [Templating (Jinja2)](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_templating.html) - Official playbook guide for Jinja2 templating behavior in Ansible.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official playbook guide for previewing and reviewing changes.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official guide for connecting changed file tasks to delayed service actions.
