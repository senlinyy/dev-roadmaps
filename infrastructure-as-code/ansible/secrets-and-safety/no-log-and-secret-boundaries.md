---
title: "Masking Secrets in Logs"
description: "Use no_log and output boundaries to keep decrypted Ansible secrets out of logs, diffs, and task results."
overview: "Vault protects secret files before the run, but decrypted values still need output boundaries so review evidence stays useful without exposing credentials."
tags: ["ansible", "no-log", "secrets"]
order: 2
id: article-infrastructure-as-code-ansible-no-log-secret-boundaries
aliases:
  - no-log-secret-boundaries
  - infrastructure-as-code/ansible/no-log-and-secret-boundaries.md
---

## Table of Contents

1. [Secrets After Decryption](#secrets-after-decryption)
2. [What no_log Does](#what-no_log-does)
3. [Designing Secret Boundaries](#designing-secret-boundaries)
4. [Diffs, Debugging, and Registered Results](#diffs-debugging-and-registered-results)
5. [Logs in CI and Automation Platforms](#logs-in-ci-and-automation-platforms)
6. [Verification Without Leaking Values](#verification-without-leaking-values)
7. [Common Failure Reading](#common-failure-reading)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## Secrets After Decryption
<!-- section-summary: Vault protects stored Ansible content, and output boundaries protect the same secret after Ansible decrypts it. -->

Vault solves the repository storage problem. The production database password for the orders platform can sit in `inventories/prod/group_vars/orders_web/vault.yml` as encrypted content, and a person without the Vault password cannot read the stored value. That is a strong first boundary.

During a playbook run, Ansible has to decrypt the value so it can do real work. The template module may render `/etc/orders/orders.env`, the service module may restart the application, and a health check may prove the app can connect to the database. At that point, the secret is moving through task arguments, rendered files, result objects, and possibly logs.

This is where **output boundaries** come in. An output boundary is a deliberate choice about which tasks are allowed to print details and which tasks must stay quiet. The goal is practical: operators need enough evidence to understand the deployment, while the password, token, or key stays out of terminal output, CI logs, saved artifacts, and chat notifications.

Think about a failed production run. A template task fails because the destination directory is missing, or a command task fails because the app rejects a token. Ansible tries to help by showing task details. That helpful output can become a secret leak when the task handled decrypted values.

## What no_log Does
<!-- section-summary: no_log masks task arguments and result details for secret-bearing tasks, while nearby non-secret tasks can still provide evidence. -->

`no_log: true` tells Ansible to hide sensitive task details from normal output. It is usually applied to tasks that pass passwords, tokens, private keys, certificates, secret-bearing environment files, or API credentials. The task still runs, and Ansible still records success or failure, but the detailed result is censored.


![No Log Redaction Map](/content-assets/articles/article-infrastructure-as-code-ansible-no-log-secret-boundaries/no-log-redaction-map.png)

*The redaction map shows no_log shielding task output before it reaches CI logs, while audit notes still explain the action.*

A **task result** is the structured data Ansible gets back from a module. **Module arguments** are the values passed into that module. **Diff output** is the before-and-after content a file module may print. Secret handling needs all three in view because a password can leak through the input, the returned result, or the diff.

Here is the orders service environment file task:

```yaml
- name: Render orders secret environment file
  ansible.builtin.template:
    src: orders.env.j2
    dest: /etc/orders/orders.env
    owner: root
    group: orders
    mode: "0640"
  no_log: true
  diff: false
  notify: Restart orders app
```

This task deserves `no_log` because the rendered file contains `ORDERS_DATABASE_URL` and `ORDERS_STRIPE_WEBHOOK_SECRET`. The task also uses `diff: false`, because diff mode can show before-and-after file content for templates. A diff for a secret environment file is usually a password disclosure with a nice header on top.

The tradeoff is real. When a `no_log` task fails, the output gives fewer details. That is acceptable when the task handles secrets, because the fix is to surround the quiet task with safe evidence. Create the directory in a separate non-secret task, verify file permissions with `stat`, and run a health check that reports only status.

```yaml
- name: Create orders config directory
  ansible.builtin.file:
    path: /etc/orders
    state: directory
    owner: root
    group: orders
    mode: "0750"

- name: Verify orders environment file metadata
  ansible.builtin.stat:
    path: /etc/orders/orders.env
  register: orders_env_stat
  changed_when: false
```

Now the deployment log can still show useful non-secret context. It can show that the directory exists, the file exists, the mode is correct, and the health endpoint returns 200. The secret-bearing task stays quiet.

## Designing Secret Boundaries
<!-- section-summary: Safe secret boundaries keep secrets out of command strings, process lists, debug output, world-readable files, and broad registered data. -->

A secret boundary is larger than one `no_log` line. You also decide how the secret reaches the remote host, which module receives it, which file stores it, and which later tasks might copy it into another result.


![Secret Boundary Design](/content-assets/articles/article-infrastructure-as-code-ansible-no-log-secret-boundaries/secret-boundary-design.png)

*The boundary design shows secrets decrypted late, used in a small scope, kept out of registered results, and verified safely.*

Prefer purpose-built modules and structured parameters over shell strings. A shell command that includes a token may expose that token through process listings while the command runs, through shell tracing, or through a failed command result. A module parameter with `no_log` is usually a cleaner boundary because Ansible can handle the value without building a visible command line.

This pattern is risky because the token is part of a command string:

```yaml
- name: Register orders app with monitoring
  ansible.builtin.shell: >
    orders-monitor register
    --token {{ orders_monitoring_token }}
    --service orders
  no_log: true
```

A safer pattern writes a restricted config file or passes the value through a module interface that avoids command-line exposure. If a command-line tool is the only option, keep the task narrow, set `no_log: true`, avoid verbose shell tracing, and prefer passing secrets through a protected file or environment variable when the tool supports it.

```yaml
- name: Render monitoring registration config
  ansible.builtin.template:
    src: monitoring-registration.yml.j2
    dest: /etc/orders/monitoring-registration.yml
    owner: root
    group: orders
    mode: "0640"
  no_log: true
  diff: false

- name: Register orders app with monitoring
  ansible.builtin.command:
    cmd: orders-monitor register --config /etc/orders/monitoring-registration.yml
  no_log: true
```

File permissions are part of the same design. If a secret is rendered to `/etc/orders/orders.env`, the file should be readable only by the service user and administrators who need it. A `0640` mode with `root:orders` is a common shape for systemd services that run as the `orders` group.

Blocks can help when several tasks share the same sensitive boundary. Keep the block tight so ordinary operational output remains visible around it.

```yaml
- name: Configure orders secrets
  no_log: true
  block:
    - name: Render orders environment
      ansible.builtin.template:
        src: orders.env.j2
        dest: /etc/orders/orders.env
        owner: root
        group: orders
        mode: "0640"
      diff: false

    - name: Render monitoring registration config
      ansible.builtin.template:
        src: monitoring-registration.yml.j2
        dest: /etc/orders/monitoring-registration.yml
        owner: root
        group: orders
        mode: "0640"
      diff: false
```

This block makes the secret zone obvious. The next task can leave the zone and print a safe health check, so an operator still knows whether the service came back.

## Diffs, Debugging, and Registered Results
<!-- section-summary: Diff mode, debug tasks, and registered variables can copy secret-bearing data into places that live longer than the playbook run. -->

Diff mode is one of the easiest ways to leak a secret by accident. It helps reviewers see file changes, and that is valuable for ordinary config. For a secret-bearing file, the same before-and-after display can reveal passwords, tokens, or private keys in CI logs.

Use `diff: false` on individual secret-bearing file tasks. Use `no_log: true` as well when the arguments, rendered content, or result might contain the secret. This makes the intent visible during review: the task writes sensitive material and should stay out of diff output.

Debug tasks need the same discipline. A debug task that prints `orders_database_password` turns the deployment log into a secret store. A debug task that prints a whole registered result can also leak data, because module results often include invocation arguments, stdout, stderr, or changed content.

This task is safe because it prints a non-secret endpoint:

```yaml
- name: Show selected orders endpoint
  ansible.builtin.debug:
    msg: "Orders API endpoint is {{ orders_public_endpoint }}"
```

This task is risky because the registered result can contain secret-bearing content:

```yaml
- name: Read orders environment file
  ansible.builtin.command:
    cmd: cat /etc/orders/orders.env
  register: orders_env_contents
  changed_when: false
  no_log: true
```

In real production playbooks, avoid reading secret files back into Ansible unless a task truly needs the content. Verification can usually check metadata, service health, or a redacted command. If you must register a secret-bearing result, keep `no_log: true` on every task that touches that result and avoid later debug output that prints it.

Use `ansible.builtin.assert` for safe checks. Assertions can prove permissions, paths, status codes, and boolean facts without printing a password.

```yaml
- name: Assert orders secret file boundary
  ansible.builtin.assert:
    that:
      - orders_env_stat.stat.exists
      - orders_env_stat.stat.pw_name == "root"
      - orders_env_stat.stat.gr_name == "orders"
      - orders_env_stat.stat.mode == "0640"
    fail_msg: "orders.env exists but its ownership or mode is outside the expected boundary"
```

That gives a clean failure message. It tells the operator what boundary broke, and it avoids printing the file body.

## Logs in CI and Automation Platforms
<!-- section-summary: CI and automation platform logs last longer than terminal output, so secret masking has to account for retention, artifacts, and global logging settings. -->

CI changes the risk because logs are stored, searchable, and often shared. A developer terminal scrollback might disappear quickly. A pipeline log may live for months, get copied into a ticket, or become a downloadable artifact. That makes `no_log`, `diff: false`, and careful command design more important.

Ansible can log output on the control node with `log_path`, and it can include task argument values in output with `display_args_to_stdout`. Those settings are useful for troubleshooting ordinary automation, but they need careful review in environments that handle secrets. A setting that makes task output more descriptive can also make accidental secret output easier to store.

In CI, keep the command itself clean. Passing a Vault password file path is usually fine. Printing the password, echoing secret variables, or running with shell tracing around secret setup is the danger.

```bash
set +x
install -m 0700 -d "$RUNNER_TEMP/ansible-secrets"
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
printf '%s\n' "$ANSIBLE_PROD_VAULT_PASSWORD" > "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@"$RUNNER_TEMP/ansible-secrets/prod-vault-pass" \
  --diff
```

The `--diff` flag can stay useful because individual secret tasks use `diff: false`. That lets ordinary config changes appear in review while secret files stay hidden. This is usually the best balance for deployment evidence.

Automation platforms such as Red Hat Ansible Automation Platform add another layer. Job output, credentials, inventories, and execution environments have their own retention and access controls. A strong setup limits who can read production job output, keeps credentials in platform credential stores, and uses `no_log` in the playbook because platform-level controls and playbook-level controls cover different parts of the path.

## Verification Without Leaking Values
<!-- section-summary: Verification should prove that the secret-dependent workflow works by checking metadata, service health, and behavior instead of printing the secret. -->

A good verification step answers the operator's real production question without revealing the secret. For the orders platform, the useful proof is service behavior: the service can read its config, start cleanly, and connect successfully.

Start with file metadata. This proves the rendered file exists and has the intended ownership and mode. It also gives reviewers a stable check that avoids the secret value:

```yaml
- name: Read orders environment file metadata
  ansible.builtin.stat:
    path: /etc/orders/orders.env
  register: orders_env_stat
  changed_when: false

- name: Assert orders environment file is restricted
  ansible.builtin.assert:
    that:
      - orders_env_stat.stat.exists
      - orders_env_stat.stat.mode == "0640"
      - orders_env_stat.stat.gr_name == "orders"
```

Then check application behavior. A local health endpoint can prove the app started, loaded configuration, and can reach dependencies if the health endpoint includes dependency checks.

```yaml
- name: Check orders health endpoint
  ansible.builtin.uri:
    url: "http://127.0.0.1:8080/health"
    status_code: 200
    return_content: false
  register: orders_health
  changed_when: false
```

For deeper verification, use redacted commands. The app can expose a safe status line, or a database migration tool can return a count or status code without echoing credentials. The playbook should register and assert those safe values rather than printing the raw secret-bearing environment.

```yaml
- name: Check orders database connectivity through app CLI
  ansible.builtin.command:
    cmd: ordersctl db-check --quiet
  register: orders_db_check
  changed_when: false
  failed_when: orders_db_check.rc != 0
```

This gives the deployment log the evidence it needs: the file boundary is correct and the application can use the secret. It avoids turning verification into disclosure.

## Common Failure Reading
<!-- section-summary: Secret-boundary failures usually come from missing no_log, overbroad diff output, unsafe debug tasks, or secret values passed through shell commands. -->

A leaked secret in Ansible output usually has a path. Find the task that first printed the value, then decide whether the task should have been quiet, redesigned, or removed. The most common source is a template or copy task running with diff mode against a secret-bearing file.

Another common source is a debug task added during troubleshooting and left behind. Debug output feels harmless during a late incident, especially when the run happens in a private terminal. The problem appears later when the same playbook runs in CI or an automation platform and stores the output.

Registered results create a quieter version of the same problem. A task can capture a secret into `register`, and a later debug task can print the whole object. During review, look for `register` on command, shell, template validation, API, and file-reading tasks that touch secret paths.

```yaml
- name: Unsafe debug of a secret-bearing result
  ansible.builtin.debug:
    var: orders_secret_render
```

A safer debug task prints a non-secret fact about the work:

```yaml
- name: Show whether secret file metadata was collected
  ansible.builtin.debug:
    msg: "orders secret file exists={{ orders_env_stat.stat.exists | default(false) }}"
```

When a secret appears in logs, rotate the exposed secret and clean up the log according to your retention process. Future masking protects later runs, and the old value may still remain in saved logs, copied tickets, notifications, or artifacts. Treat the log exposure as a credential incident, even if the underlying playbook fix is small.

## Putting It All Together
<!-- section-summary: A safe secret-bearing playbook keeps secret work quiet and leaves the deployment log full of non-secret evidence. -->

Here is the complete pattern for the orders platform. The secret values come from Vault, the rendered files stay restricted, the task output stays quiet, and verification uses metadata plus health checks.


![Secret Boundary Summary](/content-assets/articles/article-infrastructure-as-code-ansible-no-log-secret-boundaries/secret-boundary-summary.png)

*The summary keeps secret handling practical: mask, minimize, separate, verify, and debug safely.*

```yaml
- name: Configure orders secrets safely
  hosts: orders_web
  become: true
  tasks:
    - name: Create orders config directory
      ansible.builtin.file:
        path: /etc/orders
        state: directory
        owner: root
        group: orders
        mode: "0750"

    - name: Render orders secret environment file
      ansible.builtin.template:
        src: orders.env.j2
        dest: /etc/orders/orders.env
        owner: root
        group: orders
        mode: "0640"
      no_log: true
      diff: false
      notify: Restart orders app

    - name: Flush restart before verification
      ansible.builtin.meta: flush_handlers

    - name: Read orders environment file metadata
      ansible.builtin.stat:
        path: /etc/orders/orders.env
      register: orders_env_stat
      changed_when: false

    - name: Assert orders environment file boundary
      ansible.builtin.assert:
        that:
          - orders_env_stat.stat.exists
          - orders_env_stat.stat.pw_name == "root"
          - orders_env_stat.stat.gr_name == "orders"
          - orders_env_stat.stat.mode == "0640"

    - name: Check orders app health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
        return_content: false
      changed_when: false

  handlers:
    - name: Restart orders app
      ansible.builtin.service:
        name: orders
        state: restarted
```

The log from this playbook tells a useful story. It shows the directory creation, the secret render task as censored, the handler flush, the permission assertion, and the health check. A reviewer can understand the rollout without seeing the database password or webhook secret.

That is the production habit to build. Secret tasks should be quiet by design, and the surrounding tasks should make the run understandable. When those two ideas work together, operators get both safety and enough visibility to do their job.

## What's Next

Now the secret path has two boundaries: Vault before the run and output controls during the run. The next safety layer is previewing changes before the run applies them. Check mode and diff mode help with that, as long as the team understands which predictions are trustworthy and which diffs should stay hidden.

---

**References**

- [Logging Ansible output](https://docs.ansible.com/projects/ansible/latest/reference_appendices/logging.html) - Documents Ansible output logging, `log_path`, `display_args_to_stdout`, and the `no_log` warning for sensitive data.
- [Validating tasks: check mode and diff mode](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_checkmode.html) - Explains diff mode behavior and why file changes can appear in output.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertion-based verification without printing secret values.
- [Using encrypted variables and files](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_using_encrypted_content.html) - Covers Vault password sources used when secret-bearing playbooks run.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official command reference for playbook execution options used in CI and operator runs.
