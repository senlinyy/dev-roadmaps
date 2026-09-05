```bash
vim endpoints.conf
```

Enter this command and press `Enter`:

```vim
:%s/api-dev/api-prod/gc
```

Press `y` for each of the three active matches, then `n` for the comment. Press `Esc`, enter `:wq`, and press `Enter`.

```bash
cat endpoints.conf
```

The global flag includes both mirrors on the same line. Confirmation preserves the rollback example.
