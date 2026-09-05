```bash
deploy
command -v deploy; stat /opt/release/bin/deploy
echo "$PATH"
export PATH="/opt/release/bin:$PATH"
command -v deploy
deploy
```
