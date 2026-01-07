# MCPize CLI

## Publishing

**IMPORTANT: DO NOT use `npm publish` directly!**

The CLI is published automatically via GitHub Actions when a git tag is pushed.

### To release a new version:

```bash
cd /Users/oleg/Dev/mcpize/cli

# 1. Update version in package.json manually (e.g., "1.0.36" -> "1.0.37")

# 2. Build to verify
npm run build

# 3. Commit and tag
git add package.json
git commit -m "chore: release v1.0.37"
git tag v1.0.37
git push origin main --tags
```

GitHub Actions will automatically build and publish to npm.

### Version format
- Tags must be in format `vX.Y.Z` (e.g., `v1.0.36`)
- Use semantic versioning (patch for fixes, minor for features, major for breaking)

## Development

```bash
npm install
npm run build
npm run dev  # watch mode
```

## Testing locally

```bash
# Link globally for testing
npm link

# Test commands
mcpize --version
mcpize login
mcpize dev --playground
```
