---
title: "Package Management"
description: "Install, update, and manage software packages using apt, yum, and other Linux package managers."
overview: "Use Linux package managers to install, update, pin, audit, and remove the software that keeps a Linux server running safely."
tags: ["apt", "yum", "dnf"]
order: 6
id: article-devops-foundation-linux-linux-basics-package-management
---

## Table of Contents

1. [Why Package Management Matters](#why-package-management-matters)
2. [What a Package Manager Does](#what-a-package-manager-does)
3. [APT on Debian and Ubuntu](#apt-on-debian-and-ubuntu)
4. [DNF on Fedora, RHEL, and Rocky](#dnf-on-fedora-rhel-and-rocky)
5. [Repositories and Trust](#repositories-and-trust)
6. [Third-Party Software and Version Pinning](#third-party-software-and-version-pinning)
7. [Security Updates and Maintenance Windows](#security-updates-and-maintenance-windows)
8. [Remove, Roll Back, and Audit Packages](#remove-roll-back-and-audit-packages)
9. [References](#references)

## Why Package Management Matters
<!-- section-summary: Package management controls how server software is installed, updated, verified, and removed. -->

Sooner or later a server needs one more tool. Maybe Nginx has to serve traffic, `curl` is missing during a health check, or OpenSSL needs a security fix before the next maintenance window. Copying random files onto the machine can solve the immediate error and leave the next operator with no clear source, version, or update path.

**Package management** is how Linux installs, updates, verifies, and removes software in a controlled way. A server needs packages for web servers such as Nginx, service tools such as systemd, TLS libraries such as OpenSSL, health-check tools such as `curl`, and application runtimes such as Node.js, Python, Go, or Java.

A **package manager** handles software as managed units instead of loose files copied around by hand. It knows which package installed `/usr/sbin/nginx`, which dependencies that package needs, which repository supplied it, and which updates are available.

This matters because unmanaged software creates mystery. If someone built a binary on their laptop and copied it into `/usr/local/bin`, the next engineer may not know its version, source, patch status, or removal procedure. Packages give the server an inventory and a repeatable way to change that inventory.

For a beginner, the first goal is simple: learn how to ask the package manager what it knows before you change the machine.

## What a Package Manager Does
<!-- section-summary: Package managers install files, resolve dependencies, verify repository metadata, track ownership, and support updates. -->

Suppose a fresh Ubuntu server needs Nginx. Copying only `/usr/sbin/nginx` onto the server would leave a lot behind: the service file, default directories, shared libraries, log rotation, documentation, and a record of which version was installed. The package manager exists to handle that whole change as one managed operation.

A **package** is the managed unit. It includes an archive of files plus metadata. The archive contains the files that land on disk. The metadata names the package, version, dependencies, checksums, install scripts, and repository source.

That metadata matters because software rarely stands alone. Nginx may need shared libraries before it can run. It may also need a service file so systemd can manage it, a logrotate rule so logs do not grow forever, and directories created during installation. The package manager reads the metadata, builds a plan, downloads the needed packages, verifies them, unpacks files, runs package scripts, and records the result in its local database.

On Debian and Ubuntu systems, the package format is `.deb`, and the main tool family is APT. On Fedora, RHEL, CentOS Stream, Rocky Linux, and AlmaLinux, the package format is `.rpm`, and the modern tool is DNF. Older Red Hat style systems may still use `yum`, which DNF replaced in many distributions.

The package manager does several jobs:

| Job | Example |
|---|---|
| Install software | Add Nginx and its dependencies |
| Upgrade software | Apply OpenSSL security updates |
| Remove software | Uninstall a runtime the application no longer uses |
| Query ownership | Identify which package installed `/usr/bin/curl` |
| Verify integrity | Compare installed files with package metadata |
| Manage repositories | Enable official or trusted third-party sources |

The practical server rule is to prefer OS packages for system software. Nginx, logrotate, systemd tooling, CA certificates, and security libraries should come from trusted repositories whenever possible. Application dependencies can still come from language tools like `npm`, `pip`, or `cargo`, but the base server should stay visible to the OS package manager.

The production symptom of weak package metadata is mystery. A binary exists at `/usr/local/bin/tool`, and nobody knows which version it is, which files belong to it, or how to remove it. With a managed package, the next decision is easier: query the package owner, inspect the version, check the repository, then decide whether to upgrade, pin, remove, or rebuild.

## APT on Debian and Ubuntu
<!-- section-summary: APT installs and updates `.deb` packages from configured repositories on Debian-style systems. -->

On an Ubuntu server, the practical task may be simple: install `curl` for health checks and Nginx for the public proxy. Before APT can install the right packages, it needs a current local list of what the configured repositories offer.

APT keeps that list as a **local package index**. The index is metadata, not the package files themselves. It tells APT which package names exist, which versions are available, where to download them, and what dependencies they require.

Refresh that local package index before installing or upgrading packages:

```bash
sudo apt update
```

Example output:

```console
Hit:1 http://archive.ubuntu.com/ubuntu noble InRelease
Get:2 http://archive.ubuntu.com/ubuntu noble-updates InRelease [126 kB]
Get:3 http://security.ubuntu.com/ubuntu noble-security InRelease [126 kB]
Fetched 252 kB in 1s (342 kB/s)
Reading package lists... Done
Building dependency tree... Done
Reading state information... Done
12 packages can be upgraded. Run 'apt list --upgradable' to see them.
```

`apt update` downloads the latest package lists from configured repositories. It does not upgrade installed packages yet. The final line is the important one: APT has found 12 installed packages with newer versions available.

Preview those packages before making changes:

```bash
apt list --upgradable
```

Example output:

```console
Listing... Done
curl/noble-updates 8.5.0-2ubuntu10.6 amd64 [upgradable from: 8.5.0-2ubuntu10.4]
libssl3t64/noble-security 3.0.13-0ubuntu3.5 amd64 [upgradable from: 3.0.13-0ubuntu3.4]
nginx/noble-updates 1.24.0-2ubuntu7.3 amd64 [upgradable from: 1.24.0-2ubuntu7.2]
```

This output tells you three things:

- The package name is on the left, such as `nginx`.
- The repository pocket appears after the slash, such as `noble-updates` or `noble-security`.
- The bracketed text shows the currently installed version.

Installing Nginx and common operating tools looks like this:

```bash
sudo apt install nginx curl ca-certificates logrotate
```

Example output:

```console
The following NEW packages will be installed:
  nginx nginx-common
The following packages will be upgraded:
  ca-certificates curl logrotate
Need to get 2,184 kB of archives.
After this operation, 1,536 kB of additional disk space will be used.
Do you want to continue? [Y/n]
```

APT is showing the transaction before it changes the system. `NEW packages` are not installed yet. `upgraded` packages already exist on the server. The disk-space line helps you catch surprises on small machines.

This is dependency resolution in action. APT is solving the question, "Which packages must change together so the requested package works?" If installing one small tool wants to remove a runtime or upgrade a core library, pause at this summary. The next decision is to accept the plan, change the requested package, or test the transaction on a safer machine first.

Upgrading installed packages uses:

```bash
sudo apt upgrade
```

Example output:

```console
Calculating upgrade... Done
The following packages will be upgraded:
  curl libssl3t64 nginx openssl
4 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.
Need to get 4,912 kB of archives.
Do you want to continue? [Y/n]
```

For production work, pause at this summary. An update to Nginx, OpenSSL, or an application runtime may be routine, but you still want to know what will change before accepting the prompt.

APT can answer ownership questions. If you see a binary and want to know where it came from, ask `dpkg`:

```bash
dpkg -S /usr/sbin/nginx
```

Example output:

```console
nginx-core: /usr/sbin/nginx
```

This says the file `/usr/sbin/nginx` belongs to the installed package `nginx-core`.

Then inspect package metadata:

```bash
apt show nginx
```

Example output:

```console
Package: nginx
Version: 1.24.0-2ubuntu7.3
Priority: optional
Section: web
Origin: Ubuntu
Depends: nginx-common, nginx-core
Description: small, powerful, scalable web/proxy server
```

The metadata tells you which version APT knows about, which source provides it, and which dependencies come with it.

APT also keeps history. After a surprising change, inspect the logs:

```bash
sudo less /var/log/apt/history.log
```

```bash
sudo less /var/log/apt/term.log
```

The history log shows which packages changed and when. The terminal log records detailed installation output. Those files help you decide whether to roll back, pin a version, or fix a config prompt that appeared during upgrade.

## DNF on Fedora, RHEL, and Rocky
<!-- section-summary: DNF installs and updates `.rpm` packages on Red Hat style systems and keeps transaction history. -->

On a Rocky Linux or Fedora server, the same kind of task uses DNF. You may need Nginx for traffic, `curl` for health checks, and CA certificates so HTTPS requests work correctly. DNF needs repository metadata before it can show the available versions and build a safe transaction.

DNF refreshes metadata automatically when needed, and an explicit update check is common before a maintenance window:

```bash
sudo dnf check-update
```

Example output:

```console
Last metadata expiration check: 0:08:14 ago on Wed 24 Jun 2026 09:12:30 AM UTC.
curl.x86_64        8.6.0-5.el9_4.2       baseos
nginx.x86_64       1:1.24.0-4.el9        appstream
openssl.x86_64     1:3.2.2-6.el9_4       baseos
```

Each line shows a package with an available update, the target version, and the repository. `dnf check-update` may return a nonzero status when updates exist, so automation should treat that command carefully.

Install Nginx and useful tools:

```bash
sudo dnf install nginx curl ca-certificates logrotate
```

Example output:

```console
Dependencies resolved.
================================================================================
 Package             Architecture Version              Repository        Size
================================================================================
Installing:
 nginx               x86_64       1:1.24.0-4.el9       appstream        36 k
Installing dependencies:
 nginx-core          x86_64       1:1.24.0-4.el9       appstream       570 k

Transaction Summary
================================================================================
Install  2 Packages
Total download size: 606 k
Is this ok [y/N]:
```

DNF calls the planned change a transaction. The summary gives you the package count, repository source, and download size before installation.

The transaction view is the under-the-hood model to keep in mind. DNF builds one planned change set from package metadata, dependency rules, enabled repositories, and the installed package database. If the transaction pulls from an unexpected repository or includes removals, stop before accepting it and inspect the repository configuration.

Update installed packages:

```bash
sudo dnf upgrade
```

Example output:

```console
Dependencies resolved.
================================================================================
 Package        Architecture Version              Repository              Size
================================================================================
Upgrading:
 curl           x86_64       8.6.0-5.el9_4.2      baseos                 315 k
 nginx          x86_64       1:1.24.0-4.el9       appstream               36 k

Transaction Summary
================================================================================
Upgrade  2 Packages
Is this ok [y/N]:
```

Check the transaction summary before accepting. DNF may also include dependency updates or removals, and that context matters during production maintenance.

Query package ownership with RPM:

```bash
rpm -qf /usr/sbin/nginx
```

Example output:

```console
nginx-core-1.24.0-4.el9.x86_64
```

Then inspect the package through DNF:

```bash
dnf info nginx
```

Example output:

```console
Name         : nginx
Version      : 1.24.0
Release      : 4.el9
Architecture : x86_64
Repository   : appstream
Summary      : A high performance web server and reverse proxy server
```

On a server, these two commands confirm whether `/usr/sbin/nginx` came from the expected OS repository.

DNF records transactions, which is valuable after a maintenance window:

```bash
sudo dnf history
```

Example output:

```console
ID     | Command line                 | Date and time    | Action(s) | Altered
42     | upgrade                      | 2026-06-24 09:30 | Upgrade   |    12
41     | install nginx curl logrotate | 2026-06-10 12:02 | Install   |     6
```

Inspect one transaction before trying any rollback:

```bash
sudo dnf history info 42
```

Example output:

```console
Transaction ID : 42
Begin time     : Wed 24 Jun 2026 09:30:11 AM UTC
Command Line   : upgrade
Packages Altered:
    Upgrade  nginx-1:1.24.0-4.el9.x86_64
    Upgrade  openssl-1:3.2.2-6.el9_4.x86_64
```

Some DNF systems support undoing a transaction:

```bash
sudo dnf history undo 42
```

Treat undo as one recovery tool among several. A package rollback may leave data migrations, config edits, or application-level changes in place. Package rollback should sit beside service health checks, config backups, and release rollback.

## Repositories and Trust
<!-- section-summary: Repositories are signed software sources, so adding one extends who can install code on the server. -->

The moment a package install asks to enable a new source, pause. A repository is not just a download URL. It is a publisher that can provide packages, updates, metadata, and install scripts to the server over time.

A **repository** is a software source that publishes packages and metadata. Package managers verify repository metadata and package signatures so the server can detect tampering. Official distribution repositories are the safest default because the distribution maintainers build, sign, test, and patch those packages for that OS release.

Repository signing exists because packages often install files as root. The package manager must know that the metadata and packages came from a trusted publisher and were not changed on the way to the server. The trust chain usually works like this: the server has a trusted signing key, the repository publishes signed metadata, and the package manager verifies that metadata before using it.

On Ubuntu and Debian, repository configuration lives under `/etc/apt/sources.list` and `/etc/apt/sources.list.d/`. On DNF systems, repository files live under `/etc/yum.repos.d/`.

For a production server, adding a repository is a security decision. A repository can provide packages that run scripts as root during installation and upgrades. The team should know who publishes it, why the package is needed, how keys are managed, and how updates will be tested.

APT can show which repository would supply a package:

```bash
apt-cache policy nginx
```

Example output:

```console
nginx:
  Installed: 1.24.0-2ubuntu7.2
  Candidate: 1.24.0-2ubuntu7.3
  Version table:
     1.24.0-2ubuntu7.3 500
        500 http://archive.ubuntu.com/ubuntu noble-updates/main amd64 Packages
 *** 1.24.0-2ubuntu7.2 100
        100 /var/lib/dpkg/status
```

The `Candidate` line is the version APT would install or upgrade to. The URL below it shows the repository source.

DNF can list enabled repositories:

```bash
dnf repolist
```

Example output:

```console
repo id        repo name
baseos         Rocky Linux 9 - BaseOS
appstream      Rocky Linux 9 - AppStream
extras         Rocky Linux 9 - Extras
```

A healthy output should point at the distribution repository or an approved vendor repository. If `nginx` suddenly comes from a personal package archive or an unknown mirror, pause the maintenance work and trace how that repository was added.

The next decision after finding an unknown repository is ownership. Find the repo file, check who added it, check which signing key it uses, and list which installed packages came from it. Removing a repo without checking installed packages can strand software with no update path.

## Third-Party Software and Version Pinning
<!-- section-summary: Third-party repositories and pins can solve version needs, but they require explicit ownership and review. -->

Sometimes official repositories lack the version you need. An application may require a newer Node.js runtime than the OS release ships, or Nginx may need a module available from the vendor repository. Third-party repositories can solve that version gap while expanding the server's trust boundary.

The plain rule is that a third-party repository lets another publisher feed packages into your server's update stream. That can be perfectly reasonable for a vendor-supported runtime, and it needs the same review as any other privileged software source. The package may update automatically during a normal upgrade, so the team should know how it is tested and who owns breakage.

A practical decision flow helps:

| Need | Better first option |
|---|---|
| Nginx stable web server | Distribution package |
| Security library | Distribution package |
| Newer language runtime | Vendor repository or runtime manager with documented owner |
| Application dependencies | Project lockfile and language package manager |
| One custom internal tool | Internal package repository or `/usr/local` with clear versioning |

Pinning holds a package at a chosen version or priority. On APT, a pin file can live under `/etc/apt/preferences.d/`:

```apt
Package: nginx
Pin: version 1.24.*
Pin-Priority: 1001
```

The fields tell APT which package the rule controls and how strongly to prefer the matching version:

- `Package: nginx` limits the rule to the Nginx package. Use the exact package name shown by `apt show` or `apt list`.
- `Pin: version 1.24.*` matches versions beginning with `1.24.`, so `1.24.0` and `1.24.3` match while `1.26.0` does not.
- `Pin-Priority: 1001` gives the matching version a very high priority. A priority above `1000` can force a downgrade or keep a chosen version preferred.

Because this priority can override normal upgrade behavior, the pin should be documented and reviewed.

On DNF, a version lock plugin is commonly used:

```bash
sudo dnf install python3-dnf-plugin-versionlock
```

Example output:

```console
Installed:
  python3-dnf-plugin-versionlock-4.3.0-13.el9.noarch
Complete!
```

Then add a lock:

```bash
sudo dnf versionlock add nginx
```

Example output:

```console
Adding versionlock on: nginx-1:1.24.0-4.el9.*
```

Pins reduce surprise during maintenance, and they can also block security updates. A pinned package needs an owner and review date. If the team pins Nginx to avoid a breaking change, schedule the test work needed to remove that pin later.

The production symptom of a forgotten pin is a package that never receives a fix even though the repository has one. When `apt list --upgradable` or `dnf check-update` does not show an expected update, inspect pins and locks before assuming the vendor has not published it. The next decision is to keep the pin with a reason, test the newer version, or remove the pin.

## Security Updates and Maintenance Windows
<!-- section-summary: Production updates need preview, backup, health checks, and a rollback path rather than blind upgrades. -->

Security updates keep the server healthy. Libraries such as OpenSSL, glibc, and zlib sit below many programs. Nginx and application runtimes receive fixes over time. Ignoring updates leaves known vulnerabilities on a public server.

The production question is how to update without surprising users. A small server can use a simple maintenance checklist:

1. Capture current state with package history and service status.
2. Preview updates with `apt list --upgradable` or `dnf check-update`.
3. Back up important config such as `/etc/nginx` and systemd unit files.
4. Apply updates in a planned window.
5. Restart services when libraries or runtimes require it.
6. Run local and public health checks.
7. Watch Nginx and service logs after the change.

Check current service state first:

```bash
systemctl status nginx app.service
```

Example output:

```console
● nginx.service - A high performance web server and a reverse proxy server
     Active: active (running) since Wed 2026-06-24 08:42:10 UTC; 48min ago

● app.service - Web application
     Active: active (running) since Wed 2026-06-24 08:43:02 UTC; 47min ago
```

Back up Nginx config before changing packages or reload behavior:

```bash
sudo tar -czf /root/etc-nginx-backup-$(date +%Y%m%d-%H%M%S).tar.gz /etc/nginx
```

Then apply the chosen updates:

```bash
sudo apt upgrade
```

After the package change, validate and reload Nginx:

```bash
sudo nginx -t
```

Example output:

```console
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

```bash
sudo systemctl reload nginx
```

Run health checks from both local and public paths when possible:

```bash
curl --fail --silent --show-error http://127.0.0.1:8080/health
```

Example output:

```console
ok
```

```bash
curl --fail --silent --show-error https://example.com/health
```

Example output:

```console
ok
```

These commands form a safety loop. Check the service first, preview the package change, keep a config backup, apply the update, validate syntax, reload carefully, and prove the service still responds.

Some teams enable unattended security updates for low-risk packages and keep manual windows for larger changes. That can work well, but it still needs monitoring. Automatic updates that restart a critical service should be visible in logs and alerts.

## Remove, Roll Back, and Audit Packages
<!-- section-summary: Package management also includes removing unused software, verifying ownership, and investigating change history. -->

After a few release cycles, servers collect leftovers. A Python runtime may remain after the app moved to Node.js. An old helper package may stay installed after a migration. Removing unused packages reduces attack surface and operational noise, but removal still deserves the same preview-and-check habit as installation.

APT removal:

```bash
sudo apt remove unused-package
```

Example output:

```console
The following packages will be REMOVED:
  unused-package
0 upgraded, 0 newly installed, 1 to remove and 0 not upgraded.
After this operation, 42.0 MB disk space will be freed.
Do you want to continue? [Y/n]
```

Clean up dependencies that no installed package needs:

```bash
sudo apt autoremove
```

DNF removal:

```bash
sudo dnf remove unused-package
```

Example output:

```console
Dependencies resolved.
================================================================================
 Package             Architecture Version           Repository             Size
================================================================================
Removing:
 unused-package      x86_64       1.0-1.el9         @appstream             42 M

Transaction Summary
================================================================================
Remove  1 Package
Is this ok [y/N]:
```

Before removal, query ownership and dependencies. Removing a package that another service still uses can create an avoidable outage.

Rollback and audit start from evidence. Package history tells you what changed. Ownership queries tell you which package placed a binary or config helper on disk. Service checks tell you whether the machine still behaves correctly after the change. Use those three clues together before trying a package downgrade.

Debian-style package audit:

```bash
dpkg -l | grep nginx
```

Example output:

```console
ii  nginx          1.24.0-2ubuntu7.3  amd64  small, powerful, scalable web/proxy server
ii  nginx-core     1.24.0-2ubuntu7.3  amd64  nginx web/proxy server core
```

```bash
dpkg -S /usr/sbin/nginx
```

Example output:

```console
nginx-core: /usr/sbin/nginx
```

RPM-style package audit:

```bash
rpm -qa | grep nginx
```

Example output:

```console
nginx-core-1.24.0-4.el9.x86_64
nginx-filesystem-1.24.0-4.el9.noarch
```

```bash
rpm -qf /usr/sbin/nginx
```

Example output:

```console
nginx-core-1.24.0-4.el9.x86_64
```

Config files deserve special attention. Package managers may keep local modifications, create `.dpkg-old` or `.dpkg-dist` files, or show prompts during upgrades. After an Nginx package update, compare active config and test it:

```bash
sudo nginx -t
```

Example output:

```console
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

If the audit shows the package changed and the service test fails, choose the smallest recovery path first. That may be restoring a config backup, undoing a DNF transaction, reinstalling the previous package version from an approved repo, or rolling back the application release that depended on the package change.

```bash
sudo systemctl reload nginx
```

Package management is part of operating the server. Every installed package is part of the server's supply chain, patch story, and rollback story.

## References

- [Debian APT user manual](https://www.debian.org/doc/manuals/apt-guide/) - Official Debian guide to APT usage.
- [Ubuntu package management documentation](https://documentation.ubuntu.com/server/how-to/software/package-management/) - Ubuntu server package management guidance.
- [DNF command reference](https://dnf.readthedocs.io/en/latest/command_ref.html) - Official DNF command documentation.
- [RPM manual](https://rpm.org/docs/4.20.x/man/rpm.8.html) - Official RPM command documentation.
- [Nginx Linux packages](https://nginx.org/en/linux_packages.html) - Official Nginx package repository guidance.
- [Debian unattended-upgrades package](https://wiki.debian.org/UnattendedUpgrades) - Debian documentation for automatic security updates.
