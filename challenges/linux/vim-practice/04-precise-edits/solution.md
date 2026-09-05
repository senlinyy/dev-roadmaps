```bash
vim workers.conf
```

In Normal mode, press `2Gdd`, then `0f=lcw`. Type `production` and press `Esc`. Press `j0f=l.`, then enter `:wq` and press `Enter`.

```bash
cat workers.conf
```

The delete removes one line. The change affects one word; dot applies that same edit to the mirror value.
