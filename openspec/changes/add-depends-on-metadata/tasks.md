## 1. Schema: add `depends_on`

- [x] 1.1 Add cases to `test/utils/change-metadata.test.ts`: `depends_on` accepts an array of kebab-case names, rejects a non-kebab-case entry, and is omitted safely when unset.
- [x] 1.2 In `src/core/change-metadata/schema.ts`, add `depends_on: z.array(KebabIdentifierSchema('depends_on entry')).optional()` to `ChangeMetadataSchema`.
- [x] 1.3 Run `pnpm exec vitest run test/utils/change-metadata.test.ts` and confirm the new cases pass.

## 2. `createChange`: `--depends-on` validated against active changes

- [x] 2.1 Add test cases in `test/utils/change-utils.test.ts`: a valid `--depends-on` naming an active change is recorded; an unknown name is rejected and no change directory is created; the change naming itself is rejected; omitting the option leaves `depends_on` unset.
- [x] 2.2 In `src/utils/change-utils.ts`, extend `CreateChangeOptions['metadata']` to include `depends_on`, and validate each entry (self-dependency, membership in `getAvailableChanges`) before any directory is created.
- [x] 2.3 In `src/commands/workflow/new-change.ts` and `src/cli/index.ts`, thread a comma-separated `--depends-on <names>` CLI flag through `NewChangeOptions` into `createChange`'s `metadata`.
- [x] 2.4 Run `pnpm exec vitest run test/utils/change-utils.test.ts` and confirm all new cases pass.

## 3. `openspec validate`: always-on graph checks + opt-in `--check-dependencies`

- [x] 3.1 Add `src/core/change-dependencies.ts` with the shared graph logic: existence/self-reference checks, cycle detection (DFS over active-change edges), and capability-overlap suggestions via `discoverSpecFiles()`. Shared between single-item and bulk validate so the two invocation shapes never diverge on what a `depends_on` problem is.
- [x] 3.2 Wire `computeDependencyFindings` into `src/commands/validate.ts`: always-on for both `runBulkValidation` and `validateByType`/`validateDirectItem`; opt-in capability-overlap behind a new `checkDependencies` option threaded from a `--check-dependencies` CLI flag.
- [x] 3.3 Add `--check-dependencies` to the top-level `validate` command in `src/cli/index.ts`, and to `src/core/completions/command-registry.ts`.
- [x] 3.4 Add test cases in `test/commands/validate.test.ts`: unresolved dependency, self-dependency, archived dependency is not an error, direct cycle, indirect cycle, no-cycle case, `--check-dependencies` opt-in (absent/present), suppressed once a relationship is declared, no finding without shared capability, `--strict` unaffected by suggestion-only findings.
- [x] 3.5 Run `pnpm exec vitest run test/commands/validate.test.ts` and confirm all new cases pass.

## 4. `openspec list`: "Blocked by" column and JSON

- [x] 4.1 Add test cases in `test/core/list.test.ts`: table shows "Blocked by" for a change with an active dependency, omits an archived dependency, doesn't break alignment for a change without `depends_on`; `--json` includes the raw `depends_on` array only when set.
- [x] 4.2 In `src/core/list.ts`, extend `ChangeInfo` with `dependsOn`/`blockedBy`, populate `blockedBy` by filtering `depends_on` to entries still present among active change directories, and add the "Blocked by" column following the existing Priority/Author presence-gated pattern.
- [x] 4.3 Run `pnpm exec vitest run test/core/list.test.ts` and confirm all new cases pass.

## 5. `/opsx:explore`: "Check for dependencies" step

- [x] 5.1 Add a shared `DEPENDENCY_CHECK_GUIDANCE` constant in `src/core/templates/workflows/explore.ts` (following the `PLANNING_GUIDANCE` precedent, to avoid the two-copy drift risk `design.md` calls out) with the up-front yes/no ask, the pre-write cycle-check + post-write `openspec validate` backstop, and the no-op re-askable "no" path.
- [x] 5.2 Reference it from both `getExploreSkillTemplate` and `getOpsxExploreCommandTemplate`, right after "Check for context" and before "When no change exists"/change-name detection.
- [x] 5.3 Add a "Possible dependency on another active change" row to the "Offer to capture when decisions are made" table in both templates.
- [x] 5.4 Update the golden hashes in `test/core/templates/skill-templates-parity.test.ts` (`getExploreSkillTemplate`, `getOpsxExploreCommandTemplate`, `openspec-explore`) and regenerate `skills/openspec-explore/SKILL.md` via `pnpm run generate:skills`.

## 6. Regression and verification

- [x] 6.1 Run `pnpm run build` and `pnpm exec tsc --noEmit`. Clean.
- [x] 6.2 Run the full test suite. Fixed the regressions this change caused: `new change`/`validate` flag lists in `src/core/completions/command-registry.ts` + its test (added `depends-on`/`check-dependencies`), and the three golden-hash/skill-parity fixtures in section 5.4. Remaining 3 failures (`test/core/version-check.test.ts`, npm-global-install detection) are pre-existing and environment-specific — reproduced identically on the base branch via `git stash`, unrelated to this change.
- [x] 6.3 Manually smoke-tested against the built CLI in a scratch repo: `new change --depends-on` records/rejects as expected; `validate` catches unresolved/self/cycle dependencies and treats an archived dependency as satisfied; `--check-dependencies` surfaces a capability-overlap suggestion only with the flag, and only without a declared relationship; `list`/`list --json` render "Blocked by"/`depends_on` correctly.
- [x] 6.4 Added `.changeset/add-depends-on-metadata.md` (minor bump) by hand, following `.changeset/README.md`'s template.
