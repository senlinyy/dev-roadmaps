```bash
vim app.conf
```

Inside Vim, press `gg0f=li`, press `Delete` five times, type `true`, then press `Esc`. Enter `:wq` and press `Enter`.

```bash
cat app.conf
```

`i` enters Insert mode; `Esc` returns to Normal mode. The saved file must contain `enabled=true` and the original port.
