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

1. [Why Secrets Sit Near Playbooks](#why-secrets-sit-near-playbooks)
2. [What Vault Protects](#what-vault-protects)
3. [Encrypted Files and Encrypted Variables](#encrypted-files-and-encrypted-variables)
4. [Creating Vaulted Variable Files](#creating-vaulted-variable-files)
5. [Supplying Vault Passwords](#supplying-vault-passwords)
6. [Using Vault During a Run](#using-vault-during-a-run)
7. [Rotation, Verification, and Recovery](#rotation-verification-and-recovery)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## Why Secrets Sit Near Playbooks
<!-- section-summary: Ansible Vault lets a team keep secret values close to the automation that uses them while storing the values encrypted at rest. -->

Most useful Ansible playbooks eventually need a secret. A web service needs a database password, a deploy job needs an API token, a TLS rollout needs a private key, or a monitoring agent needs a registration token. The awkward part is that those values belong near the playbook logic, because the playbook needs them at the exact moment it renders a file, calls an API, or starts a service.

Let's use a small production orders platform as the running example. The platform has three web hosts in `orders_web`, one worker group in `orders_workers`, and a PostgreSQL database managed outside the playbook. The orders app needs `ORDERS_DATABASE_PASSWORD` in `/etc/orders/orders.env`, and the team wants the hostname, port, service user, and template to stay in Git because those are reviewable configuration choices.

**Ansible Vault** is Ansible's built-in way to encrypt sensitive Ansible content. It gives you a practical middle ground: the secret variable file can live beside the inventory and role that need it, while the stored file stays unreadable without a Vault password or Vault password source. A reviewer can still see that the encrypted file changed, and the playbook can still decrypt it at run time.

That solves one important storage problem. The secret can be versioned with the automation without showing the plain value in the repository. The next thing to learn is exactly which part Vault protects, because Vault helps a lot at rest and then the decrypted value still needs careful handling during the run.

## What Vault Protects
<!-- section-summary: Vault protects encrypted Ansible content at rest, while decrypted values still need output, file, and process boundaries during execution. -->

Vault protects **content at rest**. That means the committed file, copied file, or stored variable appears as encrypted Vault payload until Ansible receives a matching password. If someone opens the repository without the password, they see ciphertext instead of `orders_database_password: real-value-here`.


![Vault File Boundary](/content-assets/articles/article-infrastructure-as-code-ansible-secrets-with-ansible-vault/vault-file-boundary.png)

*The boundary map shows Vault protecting files at rest, while the run still needs a password source and careful in-memory secret use.*

Here is the important boundary. Vault encryption covers the stored Ansible content, and Ansible decrypts the value when the run needs it. After that, the value may appear in a rendered file, module argument, task result, diff, process environment, remote host, CI log, or failed task output unless the playbook creates more boundaries.

For the orders platform, Vault can protect this file in Git:

```yaml
orders_database_password: "EXAMPLE_DATABASE_PASSWORD"
orders_stripe_webhook_secret: "EXAMPLE_STRIPE_WEBHOOK_SECRET"
```

After encryption, the repository stores a Vault payload instead of readable YAML. The exact encrypted text changes each time you encrypt or rekey, so code review on that file is really a review of intent and process. Reviewers can ask, "Why did the production secret file change?" and "Was the secret rotated in the database too?" They cannot review the secret value itself from the diff.

That is normal. In production teams, the secret value often comes from a password manager, an external secrets platform, or a database rotation procedure. Vault stores the Ansible copy securely enough for the playbook to use, but the team still treats the real secret lifecycle as an operational process with owners, rotation steps, and rollback notes.

## Encrypted Files and Encrypted Variables
<!-- section-summary: File-level Vault is simple for secret variable files, while variable-level Vault keeps surrounding YAML readable. -->

Vault can encrypt a whole file or a single variable value inside a readable file. Both patterns are useful, and the right choice depends on how much of the file should remain visible to reviewers.

| Pattern | Fits best when | Review shape |
|---|---|---|
| Whole-file Vault | Nearly every value in the file is sensitive | Review why the secret set changed and who rotated it |
| `encrypt_string` | One field is secret inside otherwise readable YAML | Review surrounding non-secret values normally |
| External secret manager | Secrets should stay outside Git entirely | Review the lookup path, credential boundary, and runtime access |

**Encrypted files** are the most common starting point. An encrypted file hides every value inside it. This fits `group_vars/prod/vault.yml`, private key files, or environment-specific secret sets where nearly every line is sensitive.

```bash
ansible-vault create inventories/prod/group_vars/orders_web/vault.yml
```

**Encrypted variables** keep the YAML file readable while encrypting one value with the `!vault` tag. This fits a file where most settings are ordinary configuration and only one field is sensitive. The tradeoff is that variable-level encryption can make rotation and editing more fiddly because the secret is embedded inside a larger plaintext file.

```bash
ansible-vault encrypt_string --name orders_database_password
```

For a beginner team, a clean file split is usually easier to operate. Keep non-secret values in one readable file and secret values in a separate vaulted file. The plain file stays friendly to review, and the vaulted file has a very obvious purpose.

```yaml
# inventories/prod/group_vars/orders_web/main.yml
orders_database_host: "orders-db.prod.internal"
orders_database_port: 5432
orders_database_name: "orders"
orders_service_user: "orders"
```

```yaml
# inventories/prod/group_vars/orders_web/vault.yml before encryption
orders_database_password: "from-the-production-secret-store"
orders_stripe_webhook_secret: "from-the-production-secret-store"
```

The playbook sees both files through the normal Ansible variable system. A template can combine the readable values and the vaulted values without caring which file they came from.

```jinja2
ORDERS_DATABASE_URL=postgres://{{ orders_service_user }}:{{ orders_database_password }}@{{ orders_database_host }}:{{ orders_database_port }}/{{ orders_database_name }}
ORDERS_STRIPE_WEBHOOK_SECRET={{ orders_stripe_webhook_secret }}
```

That split also makes reviews calmer. A change to the database host appears as a normal diff in `main.yml`, while a change to the password appears as an encrypted diff in `vault.yml` and should point to a rotation ticket or deployment note.

## Creating Vaulted Variable Files
<!-- section-summary: A production Vault workflow creates, edits, views, and rekeys encrypted files through ansible-vault commands instead of opening ciphertext directly. -->

Start with a predictable inventory layout. The exact names can vary, but production teams usually keep the secret file close to the group or environment that owns the secret. For the orders platform, the production web group might use this structure:

```yaml
inventories/
  prod/
    hosts.yml
    group_vars/
      orders_web/
        main.yml
        vault.yml
```

Create the secret file with `ansible-vault create`. This opens your editor, encrypts the saved content, and writes the Vault payload back to the file. Use a terminal with shell history disabled for that operation, and configure the editor to keep swap files and backup files outside the repository.

```bash
ansible-vault create inventories/prod/group_vars/orders_web/vault.yml
```

View a vaulted file when you need to inspect it during a controlled operation:

```bash
ansible-vault view inventories/prod/group_vars/orders_web/vault.yml
```

Edit it through Vault instead of decrypting it to a long-lived plaintext file:

```bash
ansible-vault edit inventories/prod/group_vars/orders_web/vault.yml
```

Encrypt an existing plaintext file if a team has already prepared the YAML locally:

```bash
ansible-vault encrypt inventories/prod/group_vars/orders_web/vault.yml
```

When a password source changes, rekey the encrypted file. Rekeying changes the Vault password that protects the file while the application secret inside the file stays the same, so application secret rotation and Vault password rotation are two different operations.

```bash
ansible-vault rekey inventories/prod/group_vars/orders_web/vault.yml
```

That distinction matters during incident response. If the Vault password leaks, rekey the Vault files. If the database password leaks, rotate the database password, update the vaulted variable, and deploy the application config that uses the new value. In a real production runbook, those steps should appear as separate checklist items so nobody rekeys Vault and accidentally leaves the actual database password unchanged.

## Supplying Vault Passwords
<!-- section-summary: Vault passwords can come from prompts, files, scripts, or labeled Vault IDs, and production automation should avoid storing password files in the repo. -->

Ansible needs a Vault password source before it can decrypt vaulted content. During local development, the simplest source is an interactive prompt. This fits an operator running a controlled command from a terminal:

```bash
ansible-playbook -i inventories/prod orders.yml --ask-vault-pass
```

Prompts are good for a human operator at a terminal. CI needs a non-interactive source, so it usually writes a protected secret from the CI secret store into a temporary file and passes that path to Ansible. The temporary file should live outside the repository, have restrictive permissions, and be deleted when the job exits.

```bash
install -m 0700 -d "$RUNNER_TEMP/ansible-secrets"
install -m 0600 /dev/null "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
printf '%s\n' "$ANSIBLE_PROD_VAULT_PASSWORD" > "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --vault-password-file "$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
```

Vault IDs add a label to the password source. This helps when one repository has separate secret domains, such as `dev`, `staging`, and `prod`, or when a shared role reads different vaulted files for different environments.

```bash
ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --vault-id prod@"$RUNNER_TEMP/ansible-secrets/prod-vault-pass"
```

The label helps Ansible try the right password for the right encrypted content. It also helps people read the command and understand which secret domain the run is allowed to open. In a production pipeline, that command should appear in logs without printing the password file content or the secret value itself.

One rule deserves special attention: Vault password files belong outside Git. The encrypted file and the password that decrypts it should live in different trust zones. The encrypted file can be in Git, while the password belongs in a CI secret store, enterprise password manager, external secret manager, or a tightly controlled operator process.

## Using Vault During a Run
<!-- section-summary: A vaulted value acts like ordinary Ansible data once decrypted, so playbooks need careful templates, permissions, and output controls. -->

Once Ansible decrypts a vaulted value, the value behaves like any other variable. That is convenient because templates and modules can use it normally. Vault covers the stored encrypted content, and every downstream place where the value travels needs its own boundary.


![Vaulted Vars Run Flow](/content-assets/articles/article-infrastructure-as-code-ansible-secrets-with-ansible-vault/vaulted-vars-run-flow.png)

*The run flow shows a vaulted file, password source, ansible-playbook, task or template use, and masked logs without exposing secret values.*

The orders service might render a secret-bearing environment file like this:

```yaml
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
```

The file permissions protect the remote copy. `no_log: true` keeps task arguments and result data out of normal output. `diff: false` keeps before-and-after file content out of diff mode. Those controls belong near Vault because they protect the decrypted phase of the same secret.

Verification should use non-secret evidence. Check that Ansible can load the inventory and decrypt the variables, then check that the remote file exists with the right owner and mode. Avoid printing the secret value as proof.

```bash
ansible-inventory \
  -i inventories/prod \
  --host orders-web-01 \
  --vault-id prod@prompt
```

```yaml
- name: Verify orders secret file permissions
  ansible.builtin.stat:
    path: /etc/orders/orders.env
  register: orders_env_file
  changed_when: false

- name: Assert orders secret file is owned and restricted
  ansible.builtin.assert:
    that:
      - orders_env_file.stat.exists
      - orders_env_file.stat.pw_name == "root"
      - orders_env_file.stat.gr_name == "orders"
      - orders_env_file.stat.mode == "0640"
```

That verification tells the operator the secret file exists and has the intended boundary. The app health check can prove the service can read the value without exposing it in logs.

```yaml
- name: Check orders app health after secret render
  ansible.builtin.uri:
    url: "http://127.0.0.1:8080/health"
    status_code: 200
  register: orders_health
  changed_when: false
```

Common Vault failures usually point to one of three areas. A message about no Vault secrets being available means the run did not receive a password source. A decryption failure means the password source did not match the encrypted file. A template error about an undefined variable means Ansible decrypted what it could, but the expected variable name or inventory path did not line up.

## Rotation, Verification, and Recovery
<!-- section-summary: Secret operations need separate steps for changing the protected application secret, changing the Vault password, verifying the rollout, and rolling back safely. -->

Production secret work should be written as a small runbook, even when the command sequence feels simple. People get into trouble when they say "rotate Vault" and mix together three different operations: changing the application secret, changing the encrypted Ansible file, and changing the password that protects Vault content.

For an orders database password rotation, a clear sequence might look like this. First, create or activate the new database password in the database platform. Second, edit the vaulted Ansible variable with `ansible-vault edit`. Third, run a canary deployment to one web host and verify the app can connect. Fourth, roll through the remaining hosts. Fifth, remove the old database password after the fleet is healthy.

```bash
ansible-vault edit inventories/prod/group_vars/orders_web/vault.yml

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --limit orders-web-01 \
  --vault-id prod@prompt
```

If the canary fails, the rollback depends on the database rotation design. When the old password still works, put the old value back into the vaulted file and rerun the canary. When the old password has already been disabled, rollback means restoring database access first or applying the corrected new value. The important point is that the Ansible rollback and the service-side rollback must agree.

Write that decision into the change ticket before the rotation starts. The safest rotation has a period where both old and new credentials can work, the canary proves the new value, and only then the old credential is disabled. If the service supports only one active password, schedule the rotation like an application change with a tested restore procedure and a clear owner for the database-side rollback.

Vault password rotation uses `ansible-vault rekey` and has a different verification path. After rekeying, test that the old password source can no longer decrypt the file and the new password source can run a syntax or inventory check. That proves the encryption boundary changed without making a production host change.

```bash
ansible-vault rekey --vault-id prod@prompt inventories/prod/group_vars/orders_web/vault.yml

ansible-playbook \
  -i inventories/prod \
  orders.yml \
  --syntax-check \
  --vault-id prod@prompt
```

If a plaintext secret was accidentally committed, treat that as a real secret leak. Encrypting the file afterward cleans up future commits, but Git history and any clones may still contain the old value. Rotate the exposed application secret, remove or rewrite the leaked history according to your organization's policy, and check CI logs or artifacts that may have captured the value.

## Putting It All Together
<!-- section-summary: A good Vault setup combines encrypted files, separate password storage, careful run commands, and non-secret verification evidence. -->

For the orders platform, the production setup now has a simple shape. Plain operational variables live in `main.yml`, secret variables live in `vault.yml`, and the playbook uses both to render the app environment file. The repository stores the encrypted file, while the Vault password comes from a prompt for humans or a temporary CI file sourced from the CI secret store.


![Vault Summary](/content-assets/articles/article-infrastructure-as-code-ansible-secrets-with-ansible-vault/vault-summary.png)

*The summary turns Vault use into a lifecycle: encrypt, store the password source, use, rotate, and recover.*

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  vars_files:
    - group_vars/orders_web/main.yml
    - group_vars/orders_web/vault.yml
  tasks:
    - name: Create orders config directory
      ansible.builtin.file:
        path: /etc/orders
        state: directory
        owner: root
        group: orders
        mode: "0750"

    - name: Render orders environment
      ansible.builtin.template:
        src: orders.env.j2
        dest: /etc/orders/orders.env
        owner: root
        group: orders
        mode: "0640"
      no_log: true
      diff: false
      notify: Restart orders app

    - name: Verify orders health
      ansible.builtin.uri:
        url: "http://127.0.0.1:8080/health"
        status_code: 200
      changed_when: false

  handlers:
    - name: Restart orders app
      ansible.builtin.service:
        name: orders
        state: restarted
```

That is the practical pattern. Vault keeps the repository copy encrypted. The password source stays outside the repository. The playbook writes decrypted values only where the app needs them, locks down the file, hides secret-bearing output, and verifies health without printing the secret.

This gives a junior operator a safe first workflow and gives a senior reviewer useful questions. Which secret domain did this run unlock? Which file changed? Which service consumed the value? Which verification proved the deployment worked? Those questions matter more than the encryption command by itself.

## What's Next

Vault keeps secret content encrypted before the run. During the run, Ansible handles the decrypted secret as ordinary data that modules, templates, and remote hosts can receive. The next article focuses on that second half: keeping decrypted values out of logs, diffs, debug output, and registered results while still leaving enough evidence to operate the system.

---

**References**

- [Protecting sensitive data with Ansible vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/index.html) - Ansible's main Vault guide for encrypting and managing sensitive data.
- [Encrypting content with Ansible Vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_encrypting_content.html) - Documents encrypted files, encrypted variables, `encrypt_string`, editing, viewing, and rekeying.
- [Using encrypted variables and files](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_using_encrypted_content.html) - Covers `--ask-vault-pass`, `--vault-password-file`, `--vault-id`, and multiple password sources.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official command reference for playbook execution options including Vault password arguments.
- [ansible.builtin.assert module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Documents assertion tasks used for non-secret verification checks.
