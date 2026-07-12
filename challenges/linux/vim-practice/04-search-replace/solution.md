```bash
$ vim /home/dev/deployment.yml
```

- Inside vim: - `/staging` then Enter finds first match, `n` finds the next one, and `N` finds the previous one - `:%s/staging/production/g` then Enter replaces all occurrences in the file - `u` to undo if you want to try again - `:wq` to save or `:q!` to discard

- The `%` means "all lines", `s` means substitute, `g` means "all matches per line" (not just the first).
