# Hierarchical Reporter - Proof of Concept

## Overview

Explored implementing a hierarchical buffering reporter that maintains strict ordering (Area → Config → Test Group → Test) with single "open path" streaming and progressive buffering for everything else.

## Implementation

Created `suite/vitest-reporter-hierarchical.ts` as a separate proof-of-concept reporter (preserving existing `vitest-reporter.ts`).

### Key Architectural Decisions

#### 1. Single Open Path

- At any moment: exactly 1 open area, 1 open config, 1 open test group, 1 open test
- Output from tasks on the open path streams directly to console
- Output from all other tasks buffers until they become open
- Progressive flush: 10ms delay between buffered lines for typewriter effect

#### 2. Hierarchical Buffer Structure

```
Area Buffer
  ├─ Config Buffer
  │   ├─ Test Group Buffer
  │   │   ├─ Test Buffer (lines[], status, hasOutput)
  │   │   └─ ...
  │   └─ ...
  └─ ...
```

#### 3. Cascading Open/Close

- Opening area → immediately opens first config → first test group → first test
- Closing test → opens next test OR closes group (cascade up)
- Closing group → opens next group OR closes config (cascade up)
- etc.

#### 4. Area Ordering Strategy

- **Problem**: Vitest collects and runs tests concurrently; Schema often finishes collecting before Suite is even collected
- **Solution**: Pre-initialize Suite and Schema areas in `onInit()` to ensure they exist in correct order before any tests run
- Final order: Suite → Schema → Scenarios (via sorting)

### What Works ✅

1. **Strict area ordering**: Suite always opens first, then Schema, then Scenarios
2. **Hierarchy extraction**: Successfully walks Vitest task tree (File → Suite → Test) and builds area/config/group/test hierarchy
3. **Dynamic config opening**: When an area is already open and its hierarchy is built later, the first config/group/test opens automatically
4. **Test completion detection**: "⚠️ completed but did not provide any results to output" for tests without console logs
5. **Single open path maintained**: No duplicate area closures, guards prevent re-entry

### What Doesn't Work ❌

#### Fundamental Architectural Limitation: Direct CI Output Bypass

**The Problem:**

- Hierarchical reporter can only buffer output from `console.log()` calls that Vitest reports via `on UserConsoleLog()`
- Test code (especially scenarios) directly calls `ci.write()` which bypasses Vitest's reporter hooks entirely
- This output goes straight to stdout and cannot be intercepted or buffered by the reporter

**Example:**

```typescript
// In scenario test code:
ci.write('Testing local-only-silent...'); // ← Bypasses reporter, goes straight to stdout
```

**Impact:**

- Scenario tests interleave with Suite/Schema tests even when not on the "open path"
- Cannot enforce strict sequential output ordering without modifying test code

#### Solutions (not implemented):

**Option 1: Wrap CI Object**

- Create a reporter-aware CI wrapper that routes all `ci.write()` calls through the reporter
- Tests would use `reporterCI.write()` instead of direct `ci.write()`
- Reporter could then buffer or emit based on current open path

**Option 2: Test-specific Logger**

- Modify all tests to use a test-specific logger that the reporter can intercept
- Reporter provides logger instances tagged with task IDs
- All test output goes through reporter-controlled channels

**Option 3: Stdout/Stderr Interception**

- Intercept all stdout/stderr at process level
- Parse output to determine source task
- Buffer/route based on open path
- Very complex, fragile

### Files Created

- `suite/vitest-reporter-hierarchical.ts` (808 lines) - Hierarchical buffering reporter POC
- `docs/hierarchical-reporter-poc.md` (this file) - Documentation

### Files Modified

- `vitest.config.ts` - Temporarily used new reporter (restored to original)
- `docs/planning/approach-running-order.md` - Fixed Mermaid diagram nesting errors

### Key Code Patterns

#### Area Pre-initialization

```typescript
onInit(): void {
  const canonical = [
    { key: 'suite', name: 'Suite' },
    { key: 'schema', name: 'Schema' },
  ];
  for (const { key, name } of canonical) {
    this.areas.set(key, { /* ... */ });
    this.areaOrder.push(key);
  }
}
```

#### Dynamic Config Opening

```typescript
// In buildHierarchy(), after extracting tests:
if (this.openState.area === areaKey && !this.openState.config && isNewConfig) {
  this.openConfig(areaKey, configKey);
}
```

#### Re-entry Guards

```typescript
private async closeArea(areaKey: string): Promise<void> {
  const area = this.areas.get(areaKey);
  if (!area) return;
  if (area.isComplete) return; // ← Guard prevents duplicate closures

  area.isComplete = true; // ← Mark complete FIRST
  // ... emit footer, open next area ...
}
```

#### Output Routing

```typescript
private routeOutput(task: RunnerTask, content: string): void {
  const hierarchy = this.taskToHierarchy.get(task.id);
  const isOpen =
    this.openState.area === hierarchy.area &&
    this.openState.config === hierarchy.config &&
    this.openState.testGroup === hierarchy.testGroup &&
    this.openState.test === hierarchy.test;

  if (isOpen) {
    this.emitToOpen(content); // ← Direct to console
  } else {
    this.bufferOutput(...); // ← Store for later
  }
}
```

## Lessons Learned

1. **Vitest's concurrent collection is a challenge**: Tests start running before all files are collected, making deterministic ordering difficult
2. **Pre-initialization strategy works**: Adding canonical areas early ensures correct ordering
3. **Direct stdout bypass is the blocker**: Without control over all output channels, true hierarchical buffering isn't achievable
4. **Guard patterns essential**: Re-entry guards prevent duplicate footers when hooks fire multiple times
5. **Cascading open/close is clean**: Each level only knows about its immediate children, cascading up/down naturally

## Recommendations

### For Future Work

1. **If pursuing hierarchical buffering**:
   - Implement Option 1 (Wrap CI Object) - most practical
   - Create `ReporterAwareCI` class that routes through reporter
   - Update all tests to use wrapped CI instance
   - Reporter can then fully control output ordering

2. **If keeping current architecture**:
   - Current reporter (`vitest-reporter.ts`) already achieves deterministic Suite → Schema → Scenarios ordering
   - Uses file queue with planned order, switches areas on first event
   - Works well with current test patterns (direct CI output)
   - Consider enhancing with stage-aware ordering from `running-order.json`

3. **Middle Ground**:
   - Keep current reporter for e2e tests (works with existing patterns)
   - Use hierarchical reporter for unit tests (console.log output only)
   - Different test types, different output patterns

## Conclusion

The hierarchical reporter POC successfully demonstrates:

- ✅ Core buffering architecture and data structures
- ✅ Strict area ordering (Suite → Schema → Scenarios)
- ✅ Single open path with cascading open/close
- ✅ Hierarchy extraction from Vitest task tree

But reveals a fundamental limitation:

- ❌ Cannot buffer output from `ci.write()` calls (bypasses reporter hooks)

To fully implement hierarchical buffering would require significant test code changes to route all output through reporter-controlled channels.

Current reporter (`vitest-reporter.ts`) achieves similar ordering goals with simpler architecture that works with existing test patterns.

---

**Status**: POC complete, architectural limitation identified
**Decision**: Restore original reporter, document findings
**Next steps**: Consider Option 1 (Wrap CI Object) if strict buffering is critical
