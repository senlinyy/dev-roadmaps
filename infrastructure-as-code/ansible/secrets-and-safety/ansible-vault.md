---
title: "Ansible Vault"
description: "Use Ansible Vault to keep sensitive Ansible files encrypted at rest and understand where decrypted values go during a run."
overview: "Vault lets Ansible projects store secret variables beside the playbooks that need them, while keeping the stored files unreadable without the Vault password."
tags: ["ansible", "vault", "secrets"]
order: 1
id: article-infrastructure-as-code-ansible-secrets-with-ansible-vault
aliases:
  - secrets-with-ansible-vault
  - infrastructure-as-code/ansible/secrets-with-ansible-vault.md
---

## Table of Contents

1. [Why Do Configuration and Secrets Meet?](#why-do-configuration-and-secrets-meet)
2. [What Does Vault Protect?](#what-does-vault-protect)
3. [Should You Encrypt a File or One Variable?](#should-you-encrypt-a-file-or-one-variable)
4. [How Do You Work with Vaulted Files Safely?](#how-do-you-work-with-vaulted-files-safely)
5. [How Should a Run Receive Vault Passwords?](#how-should-a-run-receive-vault-passwords)
6. [What Happens to Secrets During a Run?](#what-happens-to-secrets-during-a-run)
7. [How Do Rotation and Recovery Differ?](#how-do-rotation-and-recovery-differ)
8. [What Is a Production Vault Workflow?](#what-is-a-production-vault-workflow)
9. [Check Your Answers](#check-your-answers)

Most useful Ansible playbooks eventually need a secret. A web service needs a database password, a deploy job needs an API token, a TLS rollout needs a private key, or a monitoring agent needs a registration token. The awkward part is that those values belong near the playbook logic, because the playbook needs them at the exact moment it renders a file, calls an API, or starts a service.

Let's use a small production application platform as the running example. The platform has three web hosts in `application_web`, one worker group in `application_workers`, and a PostgreSQL database managed outside the playbook. The application app needs `ORDERS_DATABASE_PASSWORD` in `/etc/application/application.env`, and the team wants the hostname, port, service user, and template to stay in Git because those are reviewable configuration choices.

**Ansible Vault** is Ansible's built-in way to encrypt sensitive Ansible content. It gives you a practical middle ground: the secret variable file can live beside the inventory and role that need it, while the stored file stays unreadable without a Vault password or Vault password source. A reviewer can still see that the encrypted file changed, and the playbook can still decrypt it at run time.

Keep these questions in view as you work through the lesson:

1. **Why Do Configuration and Secrets Meet?**
2. **What Does Vault Protect?**
3. **Should You Encrypt a File or One Variable?**
4. **How Do You Work with Vaulted Files Safely?**
5. **How Should a Run Receive Vault Passwords?**
6. **What Happens to Secrets During a Run?**
7. **How Do Rotation and Recovery Differ?**
8. **What Is a Production Vault Workflow?**

## Why Do Configuration and Secrets Meet?
<!-- section-summary: Ansible Vault lets a team keep secret values close to the automation that uses them while storing the values encrypted at rest. -->

Vault addresses one important storage problem. The secret can be versioned with the automation without showing the plain value in the repository. The next thing to learn is exactly which part Vault protects, because Vault helps a lot at rest and then the decrypted value still needs careful handling during the run.

Configuration and secrets naturally meet at the consumption point. A template needs both the public database hostname and the private password. Keeping them in completely unrelated workflows can make deployments fragile; storing both as plaintext makes review unsafe. Vault inserts encryption between repository storage and Ansible's normal variable use.

```text
author secret → encrypt → store ciphertext → provide key at run → decrypt → consume
```

The encryption step does not change the variable's meaning. After decryption, the role and template use it like ordinary data. That compatibility is Vault's strength and the reason the later plaintext boundary must be explicit.

Vault is not a secret server. It does not provide dynamic credentials, leases, automatic application-side rotation, fine-grained per-read authorization, or a network API by itself. It encrypts Ansible content. A dedicated external secret manager may be a better source when those lifecycle features are required.

## What Does Vault Protect?
<!-- section-summary: Vault protects encrypted Ansible content at rest, while decrypted values still need output, file, and process boundaries during execution. -->

Vault protects **content at rest**. That means the committed file, copied file, or stored variable appears as encrypted Vault payload until Ansible receives a matching password. If someone opens the repository without the password, they see ciphertext instead of `application_database_password: real-value-here`.


![Vault File Boundary](/content-assets/articles/article-infrastructure-as-code-ansible-secrets-with-ansible-vault/vault-file-boundary.png)

*The boundary map shows Vault protecting files at rest, while the run still needs a password source and careful in-memory secret use.*

Here is the important boundary. Vault encryption covers the stored Ansible content, and Ansible decrypts the value when the run needs it. After that, the value may appear in a rendered file, module argument, task result, diff, process environment, remote host, CI log, or failed task output unless the playbook creates more boundaries.

For the application platform, Vault can protect this file in Git:

```yaml
application_database_password: "EXAMPLE_DATABASE_PASSWORD"
application_stripe_webhook_secret: "EXAMPLE_STRIPE_WEBHOOK_SECRET"
```

After encryption, the repository stores a Vault payload instead of readable YAML. The exact encrypted text changes each time you encrypt or rekey, so code review on that file is really a review of intent and process. Reviewers can ask, "Why did the production secret file change?" and "Was the secret rotated in the database too?" They cannot review the secret value itself from the diff.

That is normal. In production teams, the secret value often comes from a password manager, an external secrets platform, or a database rotation procedure. Vault stores the Ansible copy securely enough for the playbook to use, but the team still treats the real secret lifecycle as an operational process with owners, rotation steps, and rollback notes.

The Vault password is the root of trust for the encrypted payload. Anyone who obtains both ciphertext and its password can decrypt the content. Keep those two materials in separate trust zones, restrict who can launch production credentials, and rotate the Vault password when its confidentiality is uncertain.

Vault does not automatically protect Ansible output, rendered remote files, process environments, shell arguments, backups, or application logs. `no_log`, `diff: false`, target permissions, command design, and retention controls protect those later paths.

It also does not prevent an authorized operator from viewing plaintext through `ansible-vault view` or editing it. Access to the password is access to the content. Audit and process controls around password delivery therefore matter as much as the encrypted file format.

## Should You Encrypt a File or One Variable?
<!-- section-summary: File-level Vault is simple for secret variable files, while variable-level Vault keeps surrounding YAML readable. -->

Vault can encrypt a whole file or a single variable value inside a readable file. Both patterns are useful, and the right choice depends on how much of the file should remain visible to reviewers.

| Pattern | Fits best when | Review shape |
|---|---|---|
| Whole-file Vault | Nearly every value in the file is sensitive | Review why the secret set changed and who rotated it |
| `encrypt_string` | One field is secret inside otherwise readable YAML | Review surrounding non-secret values normally |
| External secret manager | Secrets should stay outside Git entirely | Review the lookup path, credential boundary, and runtime access |

**Encrypted files** are the most common starting point. An encrypted file hides every value inside it. This fits `group_vars/prod/vault.yml`, private key files, or environment-specific secret sets where nearly every line is sensitive.

```bash
ansible-vault create inventories/prod/group_vars/application_web/vault.yml
```

**Encrypted variables** keep the YAML file readable while encrypting one value with the `!vault` tag. This fits a file where most settings are ordinary configuration and only one field is sensitive. The tradeoff is that variable-level encryption can make rotation and editing more fiddly because the secret is embedded inside a larger plaintext file.

```bash
ansible-vault encrypt_string --name application_database_password
```

For a beginner team, a clean file split is usually easier to operate. Keep non-secret values in one readable file and secret values in a separate vaulted file. The plain file stays friendly to review, and the vaulted file has a very obvious purpose.

```yaml
# inventories/prod/group_vars/application_web/main.yml
application_database_host: "application-db.prod.internal"
application_database_port: 5432
application_database_name: "application"
application_service_user: "application"
```

```yaml
# inventories/prod/group_vars/application_web/vault.yml before encryption
application_database_password: "from-the-production-secret-store"
application_stripe_webhook_secret: "from-the-production-secret-store"
```

The playbook sees both files through the normal Ansible variable system. A template can combine the readable values and the vaulted values without caring which file they came from.

```jinja2
ORDERS_DATABASE_URL=postgres://{{ application_service_user }}:{{ application_database_password }}@{{ application_database_host }}:{{ application_database_port }}/{{ application_database_name }}
ORDERS_STRIPE_WEBHOOK_SECRET={{ application_stripe_webhook_secret }}
```

That split also makes reviews calmer. A change to the database host appears as a normal diff in `main.yml`, while a change to the password appears as an encrypted diff in `vault.yml` and should point to a rotation ticket or deployment note.

Whole-file encryption creates a clean security boundary: everything inside requires the Vault password, and editors cannot accidentally leave one secret line plaintext among ordinary values. Its cost is opaque review; even non-secret names and structure are hidden.

Variable-level encryption optimizes for readable context. Reviewers can inspect surrounding configuration and the secret variable name while the scalar remains encrypted. Its cost is noisier editing and a larger chance that another nearby sensitive value is mistakenly left plain.

Choose by ownership and review shape rather than tool preference. If nearly every line is sensitive, encrypt the file. If one value is sensitive inside otherwise public policy, `encrypt_string` may be appropriate. If secrets must never enter Git, use an external manager and review the lookup path.

Vaulted and plain files at the same `group_vars` scope accumulate through normal variable loading. The secret file does not need a special playbook branch merely because it is encrypted; the run needs only the matching password source.

## How Do You Work with Vaulted Files Safely?
<!-- section-summary: A production Vault workflow creates, edits, views, and rekeys encrypted files through ansible-vault commands instead of opening ciphertext directly. -->

Start with a predictable inventory layout. The exact names can vary, but production teams usually keep the secret file close to the group or environment that owns the secret. For the application platform, the production web group might use this structure:

```yaml
inventories/
  prod/
    hosts.yml
    group_vars/
      application_web/
        main.yml
        vault.yml
```

Create the secret file with `ansible-vault create`. This opens your editor, encrypts the saved content, and writes the Vault payload back to the file. Use a terminal with shell history disabled for that operation, and configure the editor to keep swap files and backup files outside the repository.

```bash
ansible-vault create inventories/prod/group_vars/application_web/vault.yml
```

View a vaulted file when you need to inspect it during a controlled operation:

```bash
ansible-vault view inventories/prod/group_vars/application_web/vault.yml
```

Edit it through Vault instead of decrypting it to a long-lived plaintext file:

```bash
ansible-vault edit inventories/prod/group_vars/application_web/vault.yml
```

Encrypt an existing plaintext file if a team has already prepared the YAML locally:

```bash
ansible-vault encrypt inventories/prod/group_vars/application_web/vault.yml
```

When a password source changes, rekey the encrypted file. Rekeying changes the Vault password that protects the file while the application secret inside the file stays the same, so application secret rotation and Vault password rotation are two different operations.

```bash
ansible-vault rekey inventories/prod/group_vars/application_web/vault.yml
```

That distinction matters during incident response. If the Vault password leaks, rekey the Vault files. If the database password leaks, rotate the database password, update the vaulted variable, and deploy the application config that uses the new value. In a real production runbook, those steps should appear as separate checklist items so nobody rekeys Vault and accidentally leaves the actual database password unchanged.

Use `create`, `view`, and `edit` for routine work so plaintext exists only in the controlled editor process and temporary handling Ansible manages. Repeatedly running `decrypt`, editing a normal file, and remembering to re-encrypt increases the chance of plaintext backups, swap files, Git staging, or shell tooling capturing the value.

`decrypt` is a much stronger operation: it replaces encrypted stored content with plaintext. Use it only when a workflow genuinely requires a plaintext file and control the destination, permissions, lifetime, and cleanup. It is not the normal way to make a small update.

Editor behavior belongs in the threat model. Swap, crash-recovery, backup, clipboard, and remote-development features can copy plaintext outside the vaulted file. Use a controlled workstation and editor configuration for production secrets.

Encrypted diffs are not human-readable value review. Require an accompanying rotation record that explains which secret changed, why, who owns the service-side update, how the canary will verify it, and how rollback works without publishing the value.

## How Should a Run Receive Vault Passwords?
<!-- section-summary: Vault passwords can come from prompts, files, scripts, or labeled Vault IDs, and production automation should avoid storing password files in the repo. -->

Ansible needs a Vault password source before it can decrypt vaulted content. During local development, the simplest source is an interactive prompt. This fits an operator running a controlled command from a terminal:

```bash
ansible-playbook -i inventories/prod application.yml --ask-vault-pass
```

Prompts are good for a human operator at a terminal. CI needs a non-interactive source, so it usually writes a protected secret from the CI secret store into a temporary file and passes that path to Ansible. The temporary file should live outside the repository, have restrictive permissions, and be deleted when the job exits.

```bash
install -m 0700 -d "$RUNNER_TEMP/ansible-secrets"
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
printf '%s\n' "$ANSIBLE_PROD_VAULT_PASSWORD" > "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"

ansible-playbook \
  -i inventories/prod \
  application.yml \
  --vault-password-file "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
```

Vault IDs add a label to the password source. This helps when one repository has separate secret domains, such as `dev`, `staging`, and `prod`, or when a shared role reads different vaulted files for different environments.

```bash
ansible-playbook \
  -i inventories/prod \
  application.yml \
  --vault-id prod@"$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
```

The label helps Ansible try the right password for the right encrypted content. It also helps people read the command and understand which secret domain the run is allowed to open. In a production pipeline, that command should appear in logs without printing the password file content or the secret value itself.

One rule deserves special attention: Vault password files belong outside Git. The encrypted file and the password that decrypts it should live in different trust zones. The encrypted file can be in Git, while the password belongs in a CI secret store, enterprise password manager, external secret manager, or a tightly controlled operator process.

Password sources can be executable. A client script can retrieve or derive the password from an approved manager at runtime, avoiding a long-lived plaintext password file. Protect the script, its authentication path, stdout, errors, and environment because it now sits on the root-of-trust path.

Vault IDs solve the “one key for everything” operational problem. Development, staging, production, or separate teams can use labeled password sources, and one playbook run can receive more than one `--vault-id` when it must open several domains.

The label is routing metadata, not automatically a cryptographic access-control boundary. Ansible may try supplied secrets according to its configuration and encrypted headers. Do not assume naming one source `prod` prevents that password from decrypting another payload encrypted with the same secret. Use genuinely separate passwords and launch authorization.

Do not put the password itself on the command line. Shell history, process listings, CI command echo, and job metadata can capture it. Pass a protected file, executable client, interactive prompt, or controller credential reference instead.

Prompting is simplest for one human run but prevents unattended automation and recovery. A CI or controller workflow should make password availability testable without exposing it, and it should fail clearly before mutation when the required secret domain cannot be opened.

## What Happens to Secrets During a Run?
<!-- section-summary: A vaulted value acts like ordinary Ansible data once decrypted, so playbooks need careful templates, permissions, and output controls. -->

Once Ansible decrypts a vaulted value, the value behaves like any other variable. That is convenient because templates and modules can use it normally. Vault covers the stored encrypted content, and every downstream place where the value travels needs its own boundary.


![Vaulted Vars Run Flow](/content-assets/articles/article-infrastructure-as-code-ansible-secrets-with-ansible-vault/vaulted-vars-run-flow.png)

*The run flow shows a vaulted file, password source, ansible-playbook, task or template use, and masked logs without exposing secret values.*

The application service might render a secret-bearing environment file like this:

```yaml
- name: Create application config directory
  ansible.builtin.file:
    path: /etc/application
    state: directory
    owner: root
    group: application
    mode: "0750"

- name: Render application secret environment file
  ansible.builtin.template:
    src: application.env.j2
    dest: /etc/application/application.env
    owner: root
    group: application
    mode: "0640"
  no_log: true
  diff: false
  notify: Restart application app
```

The file permissions protect the remote copy. `no_log: true` keeps task arguments and result data out of normal output. `diff: false` keeps before-and-after file content out of diff mode. Those controls belong near Vault because they protect the decrypted phase of the same secret.

Verification should use non-secret evidence. Check that Ansible can load the inventory and decrypt the variables, then check that the remote file exists with the right owner and mode. Avoid printing the secret value as proof.

```bash
ansible-inventory \
  -i inventories/prod \
  --host application-web-01 \
  --vault-id prod@prompt
```

```yaml
- name: Verify application secret file permissions
  ansible.builtin.stat:
    path: /etc/application/application.env
  register: application_env_file
  changed_when: false

- name: Assert application secret file is owned and restricted
  ansible.builtin.assert:
    that:
      - application_env_file.stat.exists
      - application_env_file.stat.pw_name == "root"
      - application_env_file.stat.gr_name == "application"
      - application_env_file.stat.mode == "0640"
```

That verification tells the operator the secret file exists and has the intended boundary. The app health check can prove the service can read the value without exposing it in logs.

```yaml
- name: Check application app health after secret render
  ansible.builtin.uri:
    url: "http://127.0.0.1:8080/health"
    status_code: 200
  register: application_health
  changed_when: false
```

Common Vault failures usually point to one of three areas. A message about no Vault secrets being available means the run did not receive a password source. A decryption failure means the password source did not match the encrypted file. A template error about an undefined variable means Ansible decrypted what it could, but the expected variable name or inventory path did not line up.

Vault integrates cleanly with roles because encryption is outside the role's variable interface. The role declares `application_database_password` as an input and treats it normally; inventory decides whether that input comes from a vaulted file or an external source. Do not embed one environment's encrypted payload inside reusable role defaults.

Be careful with shell commands. A decrypted variable inserted into `cmd` can appear in process listings and target audit logs even when Ansible censors its own output. Prefer module parameters, stdin, protected files, or the tool's secure credential mechanism.

Follow the secret through the deployment: password source reaches the controller, ciphertext becomes plaintext, a task consumes it, a restricted file or API receives it, and safe verification proves behavior. Every step needs a distinct boundary; Vault covers only the ciphertext step.

## How Do Rotation and Recovery Differ?
<!-- section-summary: Secret operations need separate steps for changing the protected application secret, changing the Vault password, verifying the rollout, and rolling back safely. -->

Production secret work should be written as a small runbook, even when the command sequence feels simple. People get into trouble when they say "rotate Vault" and mix together three different operations: changing the application secret, changing the encrypted Ansible file, and changing the password that protects Vault content.

For an application database password rotation, a clear sequence might look like this. First, create or activate the new database password in the database platform. Second, edit the vaulted Ansible variable with `ansible-vault edit`. Third, run a canary deployment to one web host and verify the app can connect. Fourth, roll through the remaining hosts. Fifth, remove the old database password after the fleet is healthy.

```bash
ansible-vault edit inventories/prod/group_vars/application_web/vault.yml

ansible-playbook \
  -i inventories/prod \
  application.yml \
  --limit application-web-01 \
  --vault-id prod@prompt
```

If the canary fails, the rollback depends on the database rotation design. When the old password still works, put the old value back into the vaulted file and rerun the canary. When the old password has already been disabled, rollback means restoring database access first or applying the corrected new value. The important point is that the Ansible rollback and the service-side rollback must agree.

Write that decision into the change ticket before the rotation starts. The safest rotation has a period where both old and new credentials can work, the canary proves the new value, and only then the old credential is disabled. If the service supports only one active password, schedule the rotation like an application change with a tested restore procedure and a clear owner for the database-side rollback.

Vault password rotation uses `ansible-vault rekey` and has a different verification path. After rekeying, test that the old password source can no longer decrypt the file and the new password source can run a syntax or inventory check. That proves the encryption boundary changed without making a production host change.

```bash
ansible-vault rekey --vault-id prod@prompt inventories/prod/group_vars/application_web/vault.yml

ansible-playbook \
  -i inventories/prod \
  application.yml \
  --syntax-check \
  --vault-id prod@prompt
```

If a plaintext secret was accidentally committed, treat that as a real secret leak. Encrypting the file afterward cleans up future commits, but Git history and any clones may still contain the old value. Rotate the exposed application secret, remove or rewrite the leaked history according to your organization's policy, and check CI logs or artifacts that may have captured the value.

Rekeying current files does not erase old ciphertext or plaintext from repository history. If the old Vault password leaked, old revisions encrypted with it may remain decryptable. Decide whether repository history must be rewritten and assume existing clones or artifacts can preserve the old data.

Losing a Vault password differs from forgetting an application password. The application secret may be rotatable at its service, but the encrypted file cannot be recovered without a matching Vault secret. Maintain a controlled recovery copy or password-manager record and test that authorized operators and automation can use it.

Verification must cover two opposite risks: secrets become exposed, and nobody can deploy. Scan repositories and logs for plaintext markers, verify file and output boundaries, and also run a safe syntax, inventory, or staging task with the production password-delivery mechanism. Confidentiality without operational availability can cause an outage during the next urgent deployment.

CI changes the delivery question because the job must acquire a Vault secret non-interactively. Limit which protected branches, environments, approvers, and runner identities can access it. A masked CI variable alone does not prevent a malicious playbook change from using the credential to print decrypted data, so review code and launch permissions together.

## What Is a Production Vault Workflow?
<!-- section-summary: A good Vault setup combines encrypted files, separate password storage, careful run commands, and non-secret verification evidence. -->

For the application platform, the production setup now has a simple shape. Plain operational variables live in `main.yml`, secret variables live in `vault.yml`, and the playbook uses both to render the app environment file. The repository stores the encrypted file, while the Vault password comes from a prompt for humans or a temporary CI file sourced from the CI secret store.


![Vault Summary](/content-assets/articles/article-infrastructure-as-code-ansible-secrets-with-ansible-vault/vault-summary.png)

*The summary turns Vault use into a lifecycle: encrypt, store the password source, use, rotate, and recover.*

```yaml
- name: Configure application web hosts
  hosts: application_web
  become: true
  vars_files:
    - group_vars/application_web/main.yml
    - group_vars/application_web/vault.yml
  tasks:
    - name: Create application config directory
      ansible.builtin.file:
        path: /etc/application
        state: directory
        owner: root
        group: application
        mode: "0750"

    - name: Render application environment
      ansible.builtin.template:
        src: application.env.j2
        dest: /etc/application/application.env
        owner: root
        group: application
        mode: "0640"
      no_log: true
      diff: false
      notify: Restart application app

    - name: Verify application health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
      changed_when: false

  handlers:
    - name: Restart application app
      ansible.builtin.service:
        name: application
        state: restarted
```

That is the practical pattern. Vault keeps the repository copy encrypted. The password source stays outside the repository. The playbook writes decrypted values only where the app needs them, locks down the file, hides secret-bearing output, and verifies health without printing the secret.

This gives a junior operator a safe first workflow and gives a senior reviewer useful questions. Which secret domain did this run unlock? Which file changed? Which service consumed the value? Which verification proved the deployment worked? Those questions matter more than the encryption command by itself.

The deepest model is lifecycle separation: Vault protects stored Ansible content; password delivery authorizes decryption; playbook controls protect plaintext use; service-side rotation changes the credential's meaning; and recovery preserves both confidentiality and deployability.

Vault keeps secret content encrypted before the run. During the run, Ansible handles the decrypted secret as ordinary data that modules, templates, and remote hosts can receive. The next article focuses on that second half: keeping decrypted values out of logs, diffs, debug output, and registered results while still leaving enough evidence to operate the system.

Vault decryption still needs a password source. An interactive prompt can suit a local repair, while CI usually obtains the password or vault identity from a protected credential binding or password-client script. Keep that source outside the repository and out of command arguments. A decrypted value passed to `ansible.builtin.command` or shown through `ansible.builtin.debug` can still reach logs, so secret-consuming tasks need the output controls described here.

## Check Your Answers

:::expand[Why Do Configuration and Secrets Meet?]{kind="recap"}
Automation needs public context and private credentials at one consumption point. Vault inserts encryption between repository storage and ordinary variable use.
:::

:::expand[What Does Vault Protect?]{kind="recap"}
Vault protects encrypted content at rest. The password is the root of trust, while logs, target files, processes, and external systems need separate controls.
:::

:::expand[Should You Encrypt a File or One Variable?]{kind="recap"}
Encrypt a whole secret set for a clean boundary, one value for readable surrounding context, or keep secrets outside Git when a dedicated manager should own them.
:::

:::expand[How Do You Work with Vaulted Files Safely?]{kind="recap"}
Use `create`, `view`, and `edit`; avoid long-lived plaintext decryption; control editor artifacts; and accompany opaque encrypted diffs with a rotation record.
:::

:::expand[How Should a Run Receive Vault Passwords?]{kind="recap"}
Use prompts, protected temporary files, executable clients, or controller credentials. Keep passwords outside Git and commands, and use separate secrets behind meaningful Vault IDs.
:::

:::expand[What Happens to Secrets During a Run?]{kind="recap"}
Decrypted values become normal variables. Minimize their consumers, censor output and diffs, restrict destinations, avoid unsafe commands, and verify behavior without printing values.
:::

:::expand[How Do Rotation and Recovery Differ?]{kind="recap"}
Application rotation changes the service credential; `rekey` changes file encryption. Repository history, lost passwords, rollback overlap, and CI access need their own plans.
:::

:::expand[What Is a Production Vault Workflow?]{kind="recap"}
Separate plain and secret configuration, deliver keys from another trust zone, deploy through a canary, verify confidentiality and usability, and record every rotation boundary.
:::

---

**References**

- [Protecting sensitive data with Ansible vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/index.html) - Ansible's main Vault guide for encrypting and managing sensitive data.
- [Encrypting content with Ansible Vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_encrypting_content.html) - Documents encrypted files, encrypted variables, `encrypt_string`, editing, viewing, and rekeying.
- [Using encrypted variables and files](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_using_encrypted_content.html) - Covers `--ask-vault-pass`, `--vault-password-file`, `--vault-id`, and multiple password sources.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official command reference for playbook execution options including Vault password arguments.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertion tasks used for non-secret verification checks.
