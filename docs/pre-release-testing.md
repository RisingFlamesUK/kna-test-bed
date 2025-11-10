# Pre-Release Testing Guide

This guide explains how to use the pre-release testing capability in `kna-test-bed` to test version-specific scenarios and schema validations without affecting the main test suite.

## Purpose

Pre-release testing allows you to:

- Test exploratory or version-specific configurations
- Validate changes against test fixtures (both valid and invalid)
- Isolate pre-release work from production test runs
- Maintain separate test assets per version during development

**Important**: Pre-release test assets are **gitignored** by default. Each developer/team member should create their own versioned test assets as needed for their specific work.

## Directory Structure

Pre-release tests follow a versioned directory structure under each test area:

### Schema Tests

```
test/e2e/schema/
├── config/
│   └── tests.json              # production config (tests real files)
├── fixtures/
│   └── prompt-map-valid.json   # production fixture
└── pre-release-tests/          # gitignored
    └── <version>/              # e.g., 0.4.3, 1.0.0-beta, etc.
        ├── config/
        │   └── tests.json      # pre-release config (tests fixtures)
        └── fixtures/
            ├── *-valid.json    # valid test fixtures
            └── *-invalid-*.json # invalid test fixtures
```

### Scenario Tests

```
test/e2e/scenarios/<scenario>/
├── config/
│   ├── tests.json              # production config
│   └── answers.json            # production answers
├── manifest/
│   ├── env.json
│   ├── files.json
│   └── routes.json
└── pre-release-tests/          # gitignored
    └── <version>/
        ├── config/
        │   ├── tests.json
        │   └── answers.json
        └── manifest/
            ├── env.json
            ├── files.json
            └── routes.json
```

## How It Works

### Environment Variables

The test runners support two environment variables for pre-release testing:

1. **`PRE_RELEASE_VERSION`**: Version string (e.g., `0.4.3`, `1.0.0-beta`)
   - When set, runners look for `pre-release-tests/<version>/config/tests.json`
   - Falls back to production `config/tests.json` if versioned config doesn't exist

2. **`SCHEMA_CONFIG`** / **`SCENARIO_CONFIG`**: Explicit config path (absolute or repo-relative)
   - Overrides automatic config resolution
   - Useful for one-off testing with custom configs

### Resolution Order

When loading test configuration, runners use this priority:

1. Explicit config path (`SCHEMA_CONFIG` or `SCENARIO_CONFIG`) if set
2. Pre-release config (`pre-release-tests/<PRE_RELEASE_VERSION>/config/tests.json`) if `PRE_RELEASE_VERSION` is set and file exists
3. Production config (`config/tests.json`) as fallback

### Running Pre-Release Tests

#### Direct Environment Variable

```bash
# Set PRE_RELEASE_VERSION and run tests
PRE_RELEASE_VERSION=0.4.3 npm test

# Run specific test file
PRE_RELEASE_VERSION=0.4.3 npm test -- schema-validation

# With Vitest filters
PRE_RELEASE_VERSION=0.4.3 npm test -- -t "prompt-map"
```

#### Helper Script (Recommended)

The helper script `scripts/test-pre.mjs` provides a cleaner interface:

```bash
# Run all tests with version
npm run test:pre -- 0.4.3

# Pass Vitest arguments after version
npm run test:pre -- 0.4.3 -t "local-only-silent"
npm run test:pre -- 0.4.3 schema-validation

# For log collection (exits 0 even on test failures)
npm run test:pre:report -- 0.4.3
```

The helper script:

- Sets `PRE_RELEASE_VERSION` automatically
- Forwards all additional arguments to Vitest
- Provides `test:pre:report` variant that sets `ALLOW_TEST_FAILURES=1` (always exits 0)

## Creating Pre-Release Test Assets

### Step 1: Create Version Directory

```bash
# For schema tests
mkdir -p test/e2e/schema/pre-release-tests/0.4.3/{config,fixtures}

# For scenario tests
mkdir -p test/e2e/scenarios/local-only/pre-release-tests/0.4.3/{config,manifest}
```

### Step 2: Create Config File

Copy and modify the production config as a starting point:

**Schema example** (`test/e2e/schema/pre-release-tests/0.4.3/config/tests.json`):

```json
{
  "tests": [
    {
      "schema": "config/prompt-map.schema.json",
      "files": [
        "pre-release-tests/0.4.3/fixtures/prompt-map-valid.json",
        "pre-release-tests/0.4.3/fixtures/prompt-map-invalid-*.json"
      ]
    }
  ]
}
```

**Scenario example** (`test/e2e/scenarios/local-only/pre-release-tests/0.4.3/config/tests.json`):

```json
{
  "tests": [
    {
      "title": "local-only (silent) [pre-release 0.4.3]",
      "testGroupName": "local-only",
      "generatorFlags": "--silent --yes",
      "keepArtifacts": false
    }
  ]
}
```

### Step 3: Create Test Fixtures/Manifests

Create the actual test files referenced by your config:

**Valid fixtures** (should pass validation):

- `*-valid.json`

**Invalid fixtures** (should fail validation with specific error):

- `*-invalid-<reason>.json` (e.g., `prompt-map-invalid-missing-expect.json`)

### Step 4: Run Tests

```bash
# Test your pre-release assets
PRE_RELEASE_VERSION=0.4.3 npm test

# Or use the helper
npm run test:pre -- 0.4.3
```

## Reporter Behavior

When `PRE_RELEASE_VERSION` is set:

- The reporter displays the **active config path** in area headers
- Scenario/schema area headers show: `file:///absolute/path/to/tests.json`
- This makes it clear which config is being used (production vs pre-release)

Example output:

```
Schema tests
  • Validating JSON configuration files...
  - area-file: file:///d:/path/to/test/e2e/schema/pre-release-tests/0.4.3/config/tests.json
```

## Best Practices

### 1. Use Descriptive Version Tags

Choose version strings that clearly identify the purpose:

- `0.4.3` — matches release version
- `1.0.0-beta.1` — pre-release identifier
- `feature-xyz` — feature branch testing

### 2. Valid + Invalid Fixtures

For schema tests, always include both:

- **Valid fixtures**: Confirm schema accepts correct data
- **Invalid fixtures**: Confirm schema properly rejects bad data with meaningful errors

### 3. Document Expected Failures

When creating invalid fixtures, use descriptive filenames:

- ✅ `prompt-map-invalid-missing-expect.json`
- ✅ `answers-invalid-port-string.json`
- ❌ `bad-test.json` (unclear what's wrong)

### 4. Clean Up After Release

After a feature ships:

- Update production `config/tests.json` if needed
- Move validated fixtures to production `fixtures/` if reusable
- Delete the pre-release directory (it's gitignored anyway)

### 5. Don't Commit Pre-Release Assets

The `.gitignore` excludes all `pre-release-tests/` directories:

```gitignore
test/e2e/scenarios/**/pre-release-tests/
test/e2e/schema/**/pre-release-tests/
```

This ensures:

- Each developer maintains their own version-specific tests
- No accidental commits of temporary test assets
- Clean repository history

## Troubleshooting

### Tests not using pre-release config

**Problem**: Tests run production config despite setting `PRE_RELEASE_VERSION`.

**Solutions**:

1. Verify the versioned config exists: `test/e2e/schema/pre-release-tests/<version>/config/tests.json`
2. Check the version string matches exactly (case-sensitive)
3. Ensure you're setting the environment variable correctly

### Config path not showing in output

**Problem**: Reporter doesn't display `area-file` link.

**Solution**: The runner prints `/* CI: AreaFile <path> */` which the reporter uses. Check that your test file calls the runner correctly.

### Invalid fixtures passing validation

**Problem**: Schema should reject invalid fixture but test passes.

**Solutions**:

1. Verify the schema is correct (use ajv-cli to test directly)
2. Check the fixture is actually invalid (JSON syntax might be malformed)
3. Ensure config points to the right schema and files

## Examples

### Example 1: Schema Test for New Schema

Testing a new `app-config.schema.json`:

```bash
# Create directories
mkdir -p test/e2e/schema/pre-release-tests/1.0.0/{config,fixtures}

# Create fixtures
cat > test/e2e/schema/pre-release-tests/1.0.0/fixtures/app-config-valid.json << 'EOF'
{
  "appName": "my-app",
  "version": "1.0.0"
}
EOF

cat > test/e2e/schema/pre-release-tests/1.0.0/fixtures/app-config-invalid-no-name.json << 'EOF'
{
  "version": "1.0.0"
}
EOF

# Create config
cat > test/e2e/schema/pre-release-tests/1.0.0/config/tests.json << 'EOF'
{
  "tests": [
    {
      "schema": "config/app-config.schema.json",
      "files": ["pre-release-tests/1.0.0/fixtures/app-config-*.json"]
    }
  ]
}
EOF

# Run tests
npm run test:pre -- 1.0.0
```

### Example 2: Scenario Test for OAuth Provider

Testing a new OAuth provider configuration:

```bash
# Create directories
mkdir -p test/e2e/scenarios/local-only/pre-release-tests/feature-oauth/{config,manifest}

# Copy and modify config
cp test/e2e/scenarios/local-only/config/tests.json \
   test/e2e/scenarios/local-only/pre-release-tests/feature-oauth/config/tests.json

# Update manifest for new env vars
cat > test/e2e/scenarios/local-only/pre-release-tests/feature-oauth/manifest/env.json << 'EOF'
{
  "required": ["DATABASE_URL", "OAUTH_PROVIDER"],
  "optional": ["PORT"]
}
EOF

# Run tests
npm run test:pre -- feature-oauth -t "local-only"
```

## Summary

Pre-release testing provides:

- ✅ **Isolation**: Test version-specific changes without affecting production tests
- ✅ **Flexibility**: Use environment variables or explicit config paths
- ✅ **Clarity**: Reporter shows which config is active
- ✅ **Safety**: Pre-release assets are gitignored by default

For more details on the underlying mechanisms, see:

- [`docs/scenarios.md`](./scenarios.md) — Scenario runner and test configuration
- [`docs/components.md`](./components.md) — Schema runner implementation details
- [`docs/design.md`](./design.md) — Overall architecture
