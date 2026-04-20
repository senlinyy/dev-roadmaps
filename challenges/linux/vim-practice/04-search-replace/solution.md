Open the file, then use `:%s/staging/production/g` to replace all occurrences:

```bash
$ vim /home/dev/deployment.yml
```

Inside vim:
- `/staging` → Enter → finds first match, `n` for next, `N` for previous
- `:%s/staging/production/g` → Enter → replaces all occurrences in the file
- `u` to undo if you want to try again
- `:wq` to save or `:q!` to discard

The `%` means "all lines", `s` means substitute, `g` means "all matches per line" (not just the first).
