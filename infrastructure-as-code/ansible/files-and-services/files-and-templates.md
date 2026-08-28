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

1. [Why Are Files Desired State?](#why-are-files-desired-state)
2. [When Should You Use the file Module?](#when-should-you-use-the-file-module)
3. [When Should You Use copy?](#when-should-you-use-copy)
4. [When Should You Use template?](#when-should-you-use-template)
5. [How Does Validation Protect Replacement?](#how-does-validation-protect-replacement)
6. [How Do You Verify and Diagnose File State?](#how-do-you-verify-and-diagnose-file-state)
7. [How Do Backup and Rollback Differ?](#how-do-backup-and-rollback-differ)
8. [How Do You Design Safe Full-File Ownership?](#how-do-you-design-safe-full-file-ownership)
9. [Check Your Answers](#check-your-answers)

A lot of Linux operations come down to files. Nginx reads a site config, systemd reads a unit file, an application reads an environment file, and a monitoring agent reads a YAML file. When a team says "deploy the new service configuration," the actual work often means putting the right bytes in the right path with the right owner, group, and mode.

![File Template Choice Map](/content-assets/articles/article-infrastructure-as-code-ansible-templates-files-service-config/file-template-choice-map.png)

*The choice map separates file, copy, template, and validation so each file-management task has the right level of ownership.*

Ansible gives us a clean way to describe that state. The playbook says which directory should exist, which static files should land on the host, which templates should render from variables, and which validation command should approve the candidate file before it replaces the live one. That matters in production because a tiny permission or syntax drift can turn one host in a fleet into the odd server that fails during the next incident.

Keep these questions in view as you work through the lesson:

1. **Why Are Files Desired State?**
2. **When Should You Use the file Module?**
3. **When Should You Use copy?**
4. **When Should You Use template?**
5. **How Does Validation Protect Replacement?**
6. **How Do You Verify and Diagnose File State?**
7. **How Do Backup and Rollback Differ?**
8. **How Do You Design Safe Full-File Ownership?**

## Why Are Files Desired State?
<!-- section-summary: Ansible file work turns service configuration, permissions, and ownership into repeatable state. -->

The key beginner idea is **ownership boundary**. When Ansible owns the whole file, the repository should contain the whole desired file through `copy` or `template`. When Ansible owns only one line or one section inside a shared file, the next article's smaller edit modules are the right tool. This article stays with full-file ownership because it gives beginners the clearest starting point.

File automation answers three separate questions:

```text
file     → what kind of path and metadata should exist?
copy     → which fixed bytes should be present?
template → which bytes should be computed from variables?
```

Choosing the right abstraction gives Ansible enough knowledge to compare current and desired state. It also clarifies where source content lives. `copy` and `template` normally read from the controller or role, while `dest` and `file` paths describe the managed host.

Metadata is part of correctness, not decoration. A config with correct content but world-readable secrets, the wrong owner, or an unusable SELinux context is not the desired state. Content and metadata should converge together under one clear owner.

The controller and managed host have separate filesystems. A source such as `templates/application.env.j2` lives in the repository or role available to Ansible. `/etc/application-api/application.env` lives on each target. A remote command cannot see the controller path unless the content is transferred or the task executes locally.

### A small application web fleet
<!-- section-summary: A small production scenario connects the file modules into one service path. -->

Imagine a small application platform with three web servers behind a load balancer. Each host runs Nginx in front of an `application-api` systemd service. The service needs a config directory, a rendered environment file, an Nginx virtual host, a static internal CA certificate, and a systemd drop-in directory for service limits.

Manual SSH edits feel quick on day one. By day thirty, one server has an old timeout, one has a different certificate file mode, and one has a hand-edited environment variable that nobody can find in Git. Ansible fixes that by making the repository the source of truth for files that the platform team owns.

Here is the playbook shape we will build around:

```yaml
- name: Configure application web servers
  hosts: application_web
  become: true
  vars:
    application_api_env: production
    application_api_port: 8080
    application_api_region: us-east-1
    application_api_config_dir: /etc/application-api
  tasks:
    - name: Prepare application API config directory
      ansible.builtin.file:
        path: "{{ application_api_config_dir }}"
        state: directory
        owner: root
        group: application
        mode: "0750"
```

That first task already shows the pattern. We name the desired state, use the fully qualified module name, and quote the file mode. The rest of the article fills in the other file operations around the same service.

In a real repo, the file sources usually sit beside the playbook or inside a role:

```yaml
roles/
  application_web/
    files/
      platform-internal-ca.pem
    templates/
      application-api.env.j2
      application-api.nginx.conf.j2
    tasks/
      main.yml
inventories/
  prod/
    group_vars/
      application_web.yml
```

The `files/` directory holds content that should land unchanged. The `templates/` directory holds Jinja2 files that need inventory values. The `group_vars` file tells the template which port, region, hostname, and feature flags production should use.

## When Should You Use the file Module?
<!-- section-summary: The file module manages path state and metadata before content arrives. -->

The `ansible.builtin.file` module manages a path and its metadata. It can create directories, remove paths, create links, touch files, and set ownership, group, permissions, and SELinux context fields. For file content, teams usually pair it with `copy` or `template`, and `file` often prepares the safe place where those files will live.

For the application service, the config directory should allow root to write and the `application` group to read. Other users on the host should have no access because environment files often contain endpoints, feature flags, and sometimes secret references.

```yaml
- name: Create application API config directory
  ansible.builtin.file:
    path: /etc/application-api
    state: directory
    owner: root
    group: application
    mode: "0750"

- name: Create systemd drop-in directory
  ansible.builtin.file:
    path: /etc/systemd/system/application-api.service.d
    state: directory
    owner: root
    group: root
    mode: "0755"
```

The mode values use quoted strings like `"0750"` and `"0755"`. YAML can treat unquoted numbers in surprising ways, and file permissions need octal meaning. Quoting modes gives Ansible the clearest input and avoids decimal permission mistakes.

This task also gives later failures a clear place to start. If the template task fails with a permission error, you can check whether the directory task ran and whether the owner, group, and mode match the playbook. The fix usually belongs in the directory state instead of in a manual `chmod` after the run.

`state` means more than “exists.” `directory` creates a directory and can manage its metadata. `touch` creates a file when missing and updates timestamps according to its semantics. `link` and `hard` manage link targets. `absent` removes the path and can be destructive. Choose the exact path type the service expects.

A subtle point is that `state: file` does not create a missing ordinary file. It manages attributes when a file already exists. Use `touch` when an empty file is genuinely desired, or use `copy` or `template` when content has an owner.

Parent directories are separate state. A copy or template task should not be expected to invent a complex directory hierarchy with correct ownership. Create the directory explicitly so its failure and security policy are visible before content arrives.

Recursive ownership changes deserve care because they can touch large trees and application-generated data. Manage the narrowest path Ansible truly owns, especially under data directories where the service may create files with its own permissions.

## When Should You Use copy?
<!-- section-summary: The copy module sends fixed content from the control node to selected managed hosts. -->

The `ansible.builtin.copy` module handles files whose content should be the same for every selected host. Common examples include an internal CA certificate, a login banner, a small policy file, or a prebuilt config fragment with no host variables. The module compares the remote file with the desired content and reports `changed` only when content or metadata needs an update.

The application fleet uses an internal CA certificate so the service can call private company APIs over TLS. The same certificate lands on every web server, so `copy` is a good fit.

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

`copy` is not the same as running `cp`. The module calculates or compares the desired content and metadata, transfers only when needed, can validate a temporary candidate, and reports `changed` truthfully. A shell copy command usually hides those semantics and reports an action rather than a lasting state.

Use `copy` when every selected host should receive the same bytes. Inline `content` can be convenient for a very small fixed file, but larger content is easier to review under `files/`. If the content needs host or environment values, `copy` has stopped being the right abstraction and a template should own the rendered file.

Source and destination direction matters. The default `src` is controller-side. `remote_src: true` changes the meaning to a source already on the managed host and has different behavior and constraints. Make that exceptional choice explicit so reviewers know which filesystem owns the input.

Static does not mean public. A private key may be identical across a selected set but still needs encryption at rest, strict destination modes, censored output, and a rotation plan. File sameness and secret handling are independent design questions.

## When Should You Use template?
<!-- section-summary: The template module renders Jinja2 with inventory variables before writing the file. -->

The `ansible.builtin.template` module renders a Jinja2 template on the control node and writes the rendered file to the managed host. It fits files that share one structure across environments and need different values per host, group, or environment. For the application platform, staging and production use the same environment file shape with different ports, endpoints, and feature flags.


![Rendered Template Flow](/content-assets/articles/article-infrastructure-as-code-ansible-templates-files-service-config/rendered-template-flow.png)

*The template flow shows variables and template.j2 becoming a temporary file, passing validation, landing as final config, and notifying a handler.*

The template might live at `templates/application-api.env.j2`:

```jinja2
ORDERS_ENV={{ application_api_env }}
ORDERS_PORT={{ application_api_port }}
ORDERS_REGION={{ application_api_region }}
PAYMENTS_BASE_URL={{ payments_base_url }}
ENABLE_PROMO_CODES={{ application_enable_promo_codes | bool | lower }}
```

The playbook renders it like this:

```yaml
- name: Render application API environment file
  ansible.builtin.template:
    src: application-api.env.j2
    dest: /etc/application-api/application-api.env
    owner: root
    group: application
    mode: "0640"
    backup: true
  notify: Restart application API
```

This task gives you a strong production habit: **variables decide the difference, templates decide the shape**. Staging can set `application_api_env: staging` and `payments_base_url: https://payments.staging.internal`, while production sets production values in inventory or a secured variable store. The task stays the same across both environments.

Rendered files should also keep whitespace and quoting boring. Environment files, YAML, JSON, Nginx configs, and systemd drop-ins all have their own syntax rules. A template reviewer should be able to see the final rendered shape from `--diff` in staging before the task touches production.

The key model is a pure-looking function:

```text
render(template source, effective host variables) → desired file bytes
```

Jinja expressions insert values, filters transform them, conditions include optional structure, and loops repeat structured sections. Keep the inputs explicit and the generated syntax easy to inspect.

Policy should mostly live outside the template. Inventory and role defaults choose the port, endpoint, and feature flag; the template translates those choices into the application's file format. A template full of environment-name branches becomes a second, hidden policy engine.

Templates remain idempotent when their source and variables are stable. Ansible renders the same candidate, compares it with the destination, and stays `ok` when the bytes and requested metadata match. A variable change creates one meaningful diff and can notify the appropriate handler.

Avoid volatile values unless the file genuinely requires them. Current timestamps, random tokens, and unordered data make the rendered output different every run, creating repeated writes and service restarts. Generate durable values once and store them as state rather than recalculating them in a steady-state template.

Connect file changes to service changes with handlers. A template should notify a restart or reload only when the managed content or metadata actually changes. This preserves the causal link between configuration drift and process action.

## How Does Validation Protect Replacement?
<!-- section-summary: The validate option tests a temporary candidate file before Ansible installs it. -->

Some formats can be checked before they become live files. The `validate` parameter lets `copy`, `template`, and several line-editing modules run a command against a temporary candidate file. Ansible replaces `%s` with that temporary path, and the module installs the file only after the command exits successfully.

For an application config file, validation can call the application itself:

```yaml
- name: Render application API YAML config
  ansible.builtin.template:
    src: application-api.yml.j2
    dest: /etc/application-api/application-api.yml
    owner: root
    group: application
    mode: "0640"
    validate: /usr/local/bin/application-api --check-config %s
    backup: true
  notify: Restart application API
```

For Nginx, validation often needs the full config tree instead of one fragment. Many teams use a small wrapper script that copies the candidate fragment into a temporary directory and runs `nginx -t` against that tree. The playbook then stays readable while the wrapper handles the service-specific validation details.

```yaml
- name: Render application Nginx site
  ansible.builtin.template:
    src: application-api.nginx.conf.j2
    dest: /etc/nginx/conf.d/application-api.conf
    owner: root
    group: root
    mode: "0644"
    validate: /usr/local/sbin/validate-nginx-fragment %s
    backup: true
  notify: Reload Nginx
```

Validation is one of the best safety tools in this part of Ansible. A syntax error fails the task before the live file changes. The operator sees a clear playbook failure, the previous file remains in place, and the handler never reloads a service with broken input.

Validation is executed directly rather than through a shell, so shell operators such as pipes and redirection are not interpreted automatically. Put complex validation in a reviewed wrapper script with a clear exit-code contract, and pass `%s` as the candidate path.

`copy` can validate too. A fixed sudoers fragment, SSH configuration, policy file, or certificate bundle may need a parser even though it contains no variables. Static versus rendered content does not determine whether validation is necessary.

For sensitive access files, use the program's native checker. An SSH daemon configuration can be tested against a candidate, and sudoers fragments should use `visudo`. Syntax success is not the whole operational proof, but it prevents the most direct invalid replacement.

Atomic replacement adds another safety layer. Ansible typically prepares content in a temporary location and moves the approved candidate into place rather than writing the live file gradually. Readers are less likely to observe a half-written file. Filesystem and platform constraints can affect atomic behavior, so treat unsafe-write fallbacks as explicit exceptions.

Validation is usually better than relying on rollback because it blocks a known-bad candidate before the service consumes it. Backup and rollback remain necessary for syntactically valid but behaviorally wrong content.

## How Do You Verify and Diagnose File State?
<!-- section-summary: Check mode, diff mode, stat checks, and service validators help operators confirm what changed. -->

Before production, run the playbook in staging with check mode and diff mode. Check mode predicts changes without writing them for modules that support it, and diff mode shows the exact file content or metadata changes when the task allows a diff. This gives reviewers a chance to catch a wrong endpoint, a missing variable, or a risky permission before the real run.

```bash
ansible-playbook -i inventories/staging application-web.yml --limit application-web-stg-01 --check --diff
ansible-playbook -i inventories/staging application-web.yml --limit application-web-stg-01
```

After the run, verify both the file state and the service-level validators. The first command checks the metadata Ansible manages. The second command asks the service to parse its config in the target environment.

```bash
ansible -i inventories/production application_web -m ansible.builtin.stat -a "path=/etc/application-api/application-api.env"
ansible -i inventories/production application_web -m ansible.builtin.command -a "/usr/local/bin/application-api --check-config /etc/application-api/application-api.yml"
ansible -i inventories/production application_web -m ansible.builtin.command -a "nginx -t"
```

Give each managed path one task so failure signals point to one owner. A `changed` result on every run usually means the rendered template includes a moving value such as a timestamp, random token, or command output. A permission failure usually points back to the directory owner, group, mode, or `become` setting. A validation failure usually means the generated file content is syntactically wrong even though the Ansible task itself worked.

Run the playbook twice with fixed inputs. The first run may create directories and files; the second should normally report them `ok`. Change one non-secret variable and preview again: only the expected rendered file and dependent handler should become active.

Test metadata drift separately. Change a mode on a staging host without changing file content, run the play, and confirm Ansible repairs only the metadata. This proves that ownership and permissions are part of the declared state rather than incidental effects of transfer.

Use `stat` for focused evidence such as type, owner, mode, size, and checksum. Service parsers prove syntax, while readiness checks prove behavior after handlers run. No one check replaces the others because file state, parse validity, and application health are different claims.

Diff output should be reviewed for deletions as well as additions. Full-file ownership means the repository may intentionally remove manual or vendor changes from the destination. That is correct only when the ownership boundary is real and understood.

## How Do Backup and Rollback Differ?
<!-- section-summary: Safe file automation keeps previous versions reachable and rolls changes through the fleet in small batches. -->

File rollback starts before the change lands. Keep the source templates and files in Git, tag releases, and run production playbooks from reviewed commits. For high-risk config changes, combine `backup: true` with small rollout batches so one bad change affects one or two hosts before the rest of the fleet sees it.

```yaml
- name: Configure application web servers
  hosts: application_web
  become: true
  serial: 1
```

If a bad template reaches production, the cleanest rollback is usually a Git revert followed by another playbook run. That puts the repository and the hosts back in sync. When the emergency is happening right now, the timestamped backup on the remote host can restore the old file while the team prepares the proper repository rollback.

```bash
sudo cp /etc/application-api/application-api.yml.12345.2026-06-13@12:15:09~ /etc/application-api/application-api.yml
sudo systemctl restart application-api
```

Treat that manual restore as a temporary incident step. After the service is stable, commit or revert the desired source content and run Ansible again. That keeps the next deployment from reapplying the broken file.

`backup: true` preserves previous remote content; it does not choose a backup, restore it, reload the service, or prove the application recovered. It is an emergency artifact, not automatic rollback. Git remains the reviewable desired-state history when the source is version controlled.

Rollback must restore both content and any coupled process state. Reverting a template without reloading the service leaves the old process configuration active. Conversely, restarting before the restored file validates can extend the outage. Use the same validate-notify-health sequence in reverse.

Roll out high-risk files in small batches. Access-control, proxy, and service-unit changes can remove the path needed to repair the host. Preserve an old connection, validate the candidate, apply to one canary, start a fresh session, and only then widen.

Backups can contain secrets and stale credentials. Protect, rotate, and eventually remove them according to the same data policy as the live file. A secure destination with world-readable timestamped backups is not secure state.

## How Do You Design Safe Full-File Ownership?
<!-- section-summary: Full-file ownership combines file, copy, template, validation, verification, and careful rollout. -->

The application web fleet now has a repeatable file path. The `file` module creates directories with the right ownership and modes. The `copy` module installs fixed files such as the internal CA certificate. The `template` module renders environment, application, and web server config from inventory variables. Validation checks candidate files before they replace live files.


![Files Templates Summary](/content-assets/articles/article-infrastructure-as-code-ansible-templates-files-service-config/files-templates-summary.png)

*The summary follows the file workflow from ownership to render, validate, notify, and verify.*

The operator workflow also has a clear shape. Review with `--check --diff`, run in staging, verify file metadata and service parsers, then roll through production with `serial`. If a change fails validation, Ansible leaves the old file alone. If a change reaches production and causes trouble, Git revert plus a controlled playbook run returns the fleet to the previous desired state.

That is the happy path when Ansible owns the full file. Some files have multiple owners, such as `sshd_config`, `sudoers`, or a vendor-managed config file. Those shared files need smaller tools, and that is where line-level edits come in.

The deeper architecture is:

```text
repository source + effective variables
        ↓ render or select fixed bytes
temporary candidate + requested metadata
        ↓ validate
atomic replacement on managed host
        ↓ truthful change notification
service action and behavioral verification
```

The next article covers `lineinfile`, `blockinfile`, and `replace`. Those modules help when Ansible should own one clear part of a shared file while leaving the rest of the file under the package, operating system, or another team's control.

Symlinks and mount boundaries deserve explicit review. Managing a destination reached through a symlink can affect a different path than the task name suggests, and atomic replacement may behave differently across filesystems. Inspect the resolved target and platform behavior for high-risk access or service configuration instead of assuming every path is an ordinary local file.

File encodings and line endings are also part of the bytes Ansible compares. A controller-side template rendered with unexpected newline or encoding behavior can create repeated diffs or a configuration the target parser rejects. Keep sources normalized, validate the candidate with the target format, and test on the operating systems the role supports.

Ownership boundaries should be documented for generated files. If an application rewrites the same file that Ansible templates, every run can oscillate between two owners. Either configure the application not to rewrite it, manage a separate include file, or give the application ownership and verify through another interface. One path should not have competing authorities.

Templates can read stable host facts, but volatile values deserve care. Rendering `ansible_date_time` into a managed file can make every later run produce a different result, while facts such as operating-system family can legitimately select syntax. When a file changes, notify a handler that uses `ansible.builtin.service` rather than restarting inline. That separates file convergence from the process consequence and deduplicates the restart.

## Check Your Answers

:::expand[Why Are Files Desired State?]{kind="recap"}
Correct file state includes path type, content, owner, group, mode, and relevant security metadata. Controller sources and managed-host destinations are separate filesystems.
:::

:::expand[When Should You Use the file Module?]{kind="recap"}
Use `file` for path type and metadata. Choose states precisely, create parent directories explicitly, and remember that `state: file` does not create missing content.
:::

:::expand[When Should You Use copy?]{kind="recap"}
Use `copy` for fixed bytes. It compares and transfers state rather than merely running `cp`; switch to a template when host or environment values determine content.
:::

:::expand[When Should You Use template?]{kind="recap"}
Use `template` as a deterministic function from structure and variables to desired bytes. Keep policy in inputs, avoid volatile data, and notify handlers on real change.
:::

:::expand[How Does Validation Protect Replacement?]{kind="recap"}
Validate a temporary candidate with the format's native parser before atomic replacement. It blocks invalid syntax but cannot prove behavioral correctness.
:::

:::expand[How Do You Verify and Diagnose File State?]{kind="recap"}
Use preview, diff, second-run convergence, metadata inspection, parser checks, and service health. Each proves a different layer of the managed file path.
:::

:::expand[How Do Backup and Rollback Differ?]{kind="recap"}
Backup preserves old remote bytes; rollback selects and reapplies a previous desired state, validates it, performs required service actions, and verifies recovery.
:::

:::expand[How Do You Design Safe Full-File Ownership?]{kind="recap"}
Give one owner the complete file, use the right source abstraction, manage metadata, validate before replacement, connect changes to handlers, and roll out in bounded batches.
:::

---

**References**

- [ansible.builtin.file](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/file_module.html) - Official module documentation for path state, ownership, modes, links, and removal.
- [ansible.builtin.copy](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/copy_module.html) - Official module documentation for copying fixed files and inline content to managed hosts.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module documentation for rendering Jinja2 templates to target hosts.
- [Templating (Jinja2)](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_templating.html) - Official playbook guide for Jinja2 templating behavior in Ansible.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Official playbook guide for previewing and reviewing changes.
- [Handlers: running operations on change](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_handlers.html) - Official guide for connecting changed file tasks to delayed service actions.
