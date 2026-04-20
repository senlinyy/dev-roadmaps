---
title: "Changing Permissions with chmod"
sectionSlug: numeric-octal-notation
order: 2
---

A developer left some files with incorrect permissions. Fix them using `chmod`.

1. The script `/opt/app/start.sh` needs to be executable by its owner. Use `chmod` with symbolic notation to add execute permission for the user.
2. The config file `/opt/app/secrets.env` contains credentials and should only be readable and writable by the owner (no access for group or others). Use octal notation.
3. The directory `/opt/app/logs` should be readable and traversable by everyone, but only writable by the owner. Use octal notation.
4. Verify your changes by running `ls -l /opt/app`.
