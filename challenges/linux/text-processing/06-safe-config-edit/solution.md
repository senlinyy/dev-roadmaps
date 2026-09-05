```bash
sed 's/^environment=development$/environment=production/' app.env
sed -i.bak 's/^environment=development$/environment=production/' app.env
cat app.env
```

The anchors restrict the change to the exact active setting. The backup retains the original rather than another copy of the edited file.
