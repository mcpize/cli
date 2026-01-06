# MCPize CLI

## Deployment

**IMPORTANT: DO NOT use `npm publish` directly!**

The CLI is published automatically via GitHub Actions when a git tag is pushed.

### To release a new version:

```bash
cd /Users/oleg/Dev/mcpize/cli

# 1. Bump version in package.json
npm version patch  # or minor/major

# 2. Commit changes
git add -A
git commit -m "chore: bump version to X.Y.Z"

# 3. Create and push tag
git tag vX.Y.Z
git push origin main --tags
```

The CI pipeline will automatically:
- Build the package
- Run tests
- Publish to npm

### Version format
- Tags must be in format `vX.Y.Z` (e.g., `v1.0.29`)
- Use semantic versioning

## Development

```bash
npm install
npm run build
npm run dev  # watch mode
```
