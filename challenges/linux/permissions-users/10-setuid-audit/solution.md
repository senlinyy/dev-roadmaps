```bash
find /usr/local/bin -perm -4000 -type f
stat /usr/local/bin/legacy-helper
sudo chmod u-s /usr/local/bin/legacy-helper
stat /usr/local/bin/legacy-helper
```

The search identifies the privileged helper through its setuid bit. Removing `u-s` changes `4755` to `0755`, preserving normal execution while removing the effective-root transition.
