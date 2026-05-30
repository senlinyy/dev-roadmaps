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

1. [The Principle of Idempotency](#the-principle-of-idempotency)
2. [The Target State Code Preview](#the-target-state-code-preview)
3. [How Modules Reconcile State Under the Hood](#how-modules-reconcile-state-under-the-hood)
4. [Evaluating the Second Run Settle](#evaluating-the-second-run-settle)
5. [Handlers: Binding Restarts to True Changes](#handlers-binding-restarts-to-true-changes)
6. [Idempotency with Shell and Command Modules](#idempotency-with-shell-and-command-modules)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## The Principle of Idempotency

Idempotency is the core safety property of a modern configuration management system. An operation is defined as idempotent when executing it multiple times produces the exact same final system state as running it once, without creating duplicate side effects or accumulating unnecessary changes. In Ansible, this means that when a playbook runs against a target server, the tasks should modify the host only if it has drifted from your written goals, and then report a quiet status of no changes on all subsequent runs.

To understand why idempotency is a vital operational safeguard, consider our scenario. You are managing the log storage directories, user security settings, and runtime configuration parameters on a fleet of three server machines.

If your automation scripts are not idempotent:
- Running the setup script a second time might append the same user definition line to `/etc/passwd`, corrupting the system login database.
- A task that creates a directory might fail with an error because the directory already exists, blocking the rest of the script from executing.
- The web server service might be forcefully restarted on every single run, dropping active application socket connections and triggering unnecessary service downtime for your users.

An idempotent playbook changes this behavior completely. Instead of treating tasks as a sequence of aggressive command actions, you describe the target state you want the machines to settle into. The playbook can then be executed continuously (every day, or even every hour) to audit your servers. If a server is perfectly configured, the run executes instantly with zero modifications, keeping your environments completely stable.

## The Target State Code Preview

Here is an early, comment-free YAML preview of an idempotent playbook. This script describes the log directories, user accounts, and configuration states we require, designed to run safely repeatedly without causing drift:

```yaml
- name: Audit log environment and configuration
  hosts: loghosts
  become: true
  tasks:
    - name: Ensure system log utility is installed
      ansible.builtin.apt:
        name: rsyslog
        state: present

    - name: Settle application log directory properties
      ansible.builtin.file:
        path: /var/log/app_storage
        state: directory
        owner: syslog
        group: adm
        mode: "0755"

    - name: Maintain application configuration file
      ansible.builtin.copy:
        content: "log_format = json"
        dest: /etc/app_log.conf
        owner: root
        group: root
        mode: "0644"
```

## How Modules Reconcile State Under the Hood

Because Ansible is agentless and executes tasks using temporary module payloads over SSH, the modules must contain a high degree of state-aware system intelligence. When a module executes, it does not blindly run command-line tools. It queries low-level operating system APIs to compare the actual system state with the desired state you wrote.

Here is the low-level systems depth of how different Ansible modules reconcile state under the hood:

### 1. The File Module and Inode Metadata
When you call the `ansible.builtin.file` module to manage a directory path, the temporary Python script executes the low-level `stat()` system call on the target path:
- The kernel returns a detailed status structure containing the inode metadata: file type, owner user ID (UID), group ID (GID), and permission bitmask (mode octal).
- The module compares these numeric values with your playbook arguments.
- If the path is missing, the module runs the `mkdir()` system call and reports `changed`.
- If the path exists but the permissions bits differ (for example, the directory is set to `0777` but your playbook requires `0755`), the module executes `chmod()` and `chown()` system calls to align the metadata, reporting `changed`.
- If all values match exactly, the module returns a status of `ok` with zero system modifications.

### 2. The Copy Module and Content Checksums
When you use `ansible.builtin.copy` to write configuration content to a host, Ansible must avoid writing the file if the content is already correct:
- Before transferring any files, the control node compiles the final text block and calculates a content checksum.
- The remote Python script queries the target path on the managed host, executing the `stat()` system call to verify the file exists.
- If the file exists, the script calculates a checksum of the remote file's contents.
- The module compares the local and remote checksum strings in memory.
- If the checksums match, the content is identical. The module skips the file transfer entirely and reports `ok`.
- If the checksums differ, the module transfers the new content to a temporary file, calculates the checksum of the temporary file to verify integrity, and then executes an atomic `rename()` system call to replace the target file instantly, preventing file corruption if the network drops.

### 3. The Package Module and System Catalogs
When you manage packages using `ansible.builtin.apt`, the remote module queries local package directories and system catalogs (such as running internal searches equivalent to `dpkg-query -W` on Debian-based hosts):
- The module parses the package manager output to inspect the installation status and version string.
- If the package status is marked as uninstalled, the module calls the package manager API to download and install it, reporting `changed`.
- If the status is already correct, the module reports `ok` and exits.

```mermaid
flowchart TD
    subgraph Control["Control Node"]
        TargetSHA["Local File Checksum<br/>(e.g., a1b2c3d4)"]
    end

    subgraph Managed["Managed Server"]
        FileExists{"1. File Exist?"}
        ReadHash["2. Compute Remote File Hash"]
        Compare{"3. Compare Hashes"}
        SystemWrite["4. Atomic System Write<br/>(rename temporary file)"]
        SkipWrite["5. Skip Network Transfer"]
    end

    TargetSHA -->|Send Hash Over SSH| FileExists
    FileExists -->|Yes| ReadHash
    FileExists -->|No| SystemWrite
    ReadHash --> Compare
    Compare -->|Hashes Differ| SystemWrite
    Compare -->|Hashes Match| SkipWrite
```

This structural verification ensures that your playbooks act as a strict state validator, modifying only the exact operating system parameters that have drifted.

## Evaluating the Second Run Settle

One of the clearest ways to verify that your playbooks are designed correctly is to execute a second run against the same server immediately after a successful initial run.

When you run a playbook against a freshly provisioned host, the first execution may apply many modifications:

```text
PLAY RECAP
server-01 : ok=12 changed=6 unreachable=0 failed=0 skipped=0
```

This output is completely healthy. A fresh server requires configuration files to be written, packages to be installed, and directories to be created.

However, when you run the exact same playbook command immediately afterward, the second execution should be completely quiet:

```text
PLAY RECAP
server-01 : ok=18 changed=0 unreachable=0 failed=0 skipped=0
```

This quiet recap is the definition of a settled host. It proves that the playbook inspected all eighteen states, confirmed they were already correct, and took zero active modifications.

If your second run continues to report changes, you have a configuration bug. A non-zero changed count on a settled host indicates that one or more tasks are executing blindly on every run. You must isolate and fix these tasks, because false changes generate constant operational noise and make it impossible to recognize real configuration errors.

## Handlers: Binding Restarts to True Changes

Configuration file changes are almost always paired with service restarts. For example, if you update the configuration parameters in an application file, the application background service must be reloaded to read the new settings.

If you restart the service on every single run, you introduce constant service drops. Ansible solves this using **Handlers**.

A handler is a special type of task that is defined in a separate block at the end of your play. It behaves exactly like a normal task, but it only executes when it is explicitly notified by another task that reports a status of `changed`.

```yaml
tasks:
  - name: Maintain application configuration file
    ansible.builtin.copy:
      content: "log_format = json"
      dest: /etc/app_log.conf
    notify: Restart app service

handlers:
  - name: Restart app service
    ansible.builtin.service:
      name: app_service
      state: restarted
```

The execution flow of a handler is highly structured:
- **No Change, No Restart**: If the configuration file already matches, the copy task reports `ok`. The handler is not notified, and the application service continues running without interruption.
- **Change Triggers Notification**: If the configuration file differs, the copy task writes the file and reports `changed`. This alerts the handler named `Restart app service`.
- **Deferred Batch Execution**: Ansible does not run the handler immediately when notified. It queues the notification in memory and completes the remaining tasks in the play first. At the next handler flush point, Ansible executes each notified handler once. If three separate configuration files are updated and all three notify the same restart handler, Ansible restarts the service once at that flush point, avoiding multiple service reboots.

If a later task fails before handlers run, Ansible may skip the queued handler on that failed host unless you explicitly use handler failure controls such as `force_handlers`. That nuance matters when a changed configuration file must be followed by a reload to keep the running service aligned with the file on disk.

This deferral mechanic makes change reporting highly critical. If a task falsely reports `changed` on every run, it will trigger your handlers and restart your services continuously. Truthful change reporting is the foundation of rolling deployments.

## Idempotency with Shell and Command Modules

While Ansible's built-in modules are designed to be idempotent out of the hood, you will occasionally encounter scenarios where you must run raw commands using the `ansible.builtin.command` or `ansible.builtin.shell` modules.

These modules execute the command you provide, but they do it differently. `ansible.builtin.command` runs a program directly without shell features such as pipes, redirects, or variable expansion. `ansible.builtin.shell` runs through a remote shell when you truly need those shell features. In both cases, Ansible cannot automatically know what system state the command modifies under the hood, so these tasks commonly report `changed` unless you add explicit guards.

To make command and shell tasks safe and idempotent, you must use Ansible's built-in execution guards:

### 1. The `creates` Guard
If your command's primary purpose is to generate a specific file, you pass the `creates` argument containing the target file path. Ansible will skip the task entirely if the file already exists:

```yaml
- name: Initialize application search database
  ansible.builtin.command:
    cmd: /opt/app/bin/init-db
    creates: /var/lib/app/database.db
```

### 2. The `removes` Guard
Conversely, if your command is designed to clean up or delete a file, you pass the `removes` argument. The task will only execute if the file is still present on the system:

```yaml
- name: Clean up temporary installer package
  ansible.builtin.command:
    cmd: rm /tmp/installer.sh
    removes: /tmp/installer.sh
```

### 3. The `changed_when` Override
If your command performs a read-only check (such as verifying a port status or pulling a health check endpoint), it never modifies the system. You instruct Ansible to ignore the change status by setting `changed_when: false`:

```yaml
- name: Check database cluster connection status
  ansible.builtin.command: pg_isready -h localhost -p 5432
  register: db_status
  changed_when: false
```

This override prevents a successful read-only command from reporting `changed`, allowing you to run health checks inside playbooks without triggering downstream handlers. It does not change failure semantics: if the command exits with a non-zero return code, the task can still fail unless you also define the intended failure behavior with `failed_when`.

## Putting It All Together

We started by looking at how an non-idempotent automation script can corrupt system files, fail on existing directories, and cause service drops across your log host fleet.

Ansible solves these issues by placing the concept of idempotency at the center of its execution model:
- **Declarative Modules**: Tasks describe desired final states, and built-in modules use low-level calls like `stat()` and checksum comparisons to verify if changes are actually required.
- **The Second Run Settle**: A healthy playbook should report exactly zero changes on a second run, proving that your host environments are stable.
- **Handler Orchestration**: Restarts are bound to actual task changes, queueing notifications so each notified handler runs once at the next handler flush point.
- **Command Guards**: Raw shell executions are made safe and repeatable using `creates`, `removes`, and `changed_when: false` overrides.

By building your playbooks around these idempotent behaviors, you transform your automation from a fragile list of instructions into a resilient, continuous auditing utility.

## What's Next

Now that you understand the mechanics of idempotency and how modules reconcile host states, the next article will explore how to read and analyze run results. We will break down the specific return codes, stderr captures, and recap blocks that Ansible outputs, showing you how to diagnose connection failures and task errors.

---

**References**

- [Ansible Playbooks: Desired State and Idempotency](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html#desired-state-and-idempotency) - Core guide to declarative system management.
- [Ansible Handlers Documentation](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html) - Official reference for change-triggered notifications and deferred execution.
- [Open Group POSIX system interfaces - stat()](https://pubs.opengroup.org/onlinepubs/9699919799/functions/stat.html) - The POSIX standard interface used by file modules to inspect inode metadata.
- [Ansible Command Module Parameters](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/command_module.html) - Reference guide for using creates, removes, and execution overrides.
