import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import { runCLI } from '../helpers/run-cli.js';

describe('top-level validate command', () => {
  const projectRoot = process.cwd();
  const testDir = path.join(projectRoot, 'test-validate-command-tmp');
  const changesDir = path.join(testDir, 'openspec', 'changes');
  const specsDir = path.join(testDir, 'openspec', 'specs');

  beforeEach(async () => {
    await fs.mkdir(changesDir, { recursive: true });
    await fs.mkdir(specsDir, { recursive: true });

    // Create a valid spec
    const specContent = [
      '## Purpose',
      'This spec ensures the validation harness exercises a deterministic alpha module for automated tests.',
      '',
      '## Requirements',
      '',
      '### Requirement: Alpha module SHALL produce deterministic output',
      'The alpha module SHALL produce a deterministic response for validation.',
      '',
      '#### Scenario: Deterministic alpha run',
      '- **GIVEN** a configured alpha module',
      '- **WHEN** the module runs the default flow',
      '- **THEN** the output matches the expected fixture result',
    ].join('\n');
    await fs.mkdir(path.join(specsDir, 'alpha'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'alpha', 'spec.md'), specContent, 'utf-8');

    // Create a simple change with bullets (parser supports this)
    const changeContent = `# Test Change\n\n## Why\nBecause reasons that are sufficiently long for validation.\n\n## What Changes\n- **alpha:** Add something`;
    await fs.mkdir(path.join(changesDir, 'c1'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'c1', 'proposal.md'), changeContent, 'utf-8');
    const deltaContent = [
      '## ADDED Requirements',
      '### Requirement: Validator SHALL support alpha change deltas',
      'The validator SHALL accept deltas provided by the test harness.',
      '',
      '#### Scenario: Apply alpha delta',
      '- **GIVEN** the test change delta',
      '- **WHEN** openspec validate runs',
      '- **THEN** the validator reports the change as valid',
    ].join('\n');
    const c1DeltaDir = path.join(changesDir, 'c1', 'specs', 'alpha');
    await fs.mkdir(c1DeltaDir, { recursive: true });
    await fs.writeFile(path.join(c1DeltaDir, 'spec.md'), deltaContent, 'utf-8');

    // Duplicate name for ambiguity test
    await fs.mkdir(path.join(changesDir, 'dup'), { recursive: true });
    await fs.writeFile(path.join(changesDir, 'dup', 'proposal.md'), changeContent, 'utf-8');
    const dupDeltaDir = path.join(changesDir, 'dup', 'specs', 'dup');
    await fs.mkdir(dupDeltaDir, { recursive: true });
    await fs.writeFile(path.join(dupDeltaDir, 'spec.md'), deltaContent, 'utf-8');
    await fs.mkdir(path.join(specsDir, 'dup'), { recursive: true });
    await fs.writeFile(path.join(specsDir, 'dup', 'spec.md'), specContent, 'utf-8');
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('prints a helpful hint when no args in non-interactive mode', async () => {
    const result = await runCLI(['validate'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Nothing to validate. Try one of:');
  });

  it('shows marker-specific next steps on a skip_specs conflict, not delta-authoring guidance', async () => {
    const chDir = path.join(changesDir, 'marked-conflict');
    const strayDir = path.join(chDir, 'specs', 'notes');
    await fs.mkdir(strayDir, { recursive: true });
    await fs.writeFile(path.join(strayDir, 'spec.md'), '# headerless notes\n', 'utf-8');
    await fs.writeFile(
      path.join(chDir, '.openspec.yaml'),
      'schema: spec-driven\nskip_specs: true\n',
      'utf-8'
    );

    const result = await runCLI(['validate', 'marked-conflict', '--type', 'change'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('delete the files under specs/');
    expect(result.stderr).not.toContain('Ensure change has deltas in specs/');
  });

  it('leads with the metadata fix when the marker is unhonorable and no spec files exist', async () => {
    const chDir = path.join(changesDir, 'marked-invalid');
    await fs.mkdir(chDir, { recursive: true });
    // skip_specs without the required schema field, and nothing under specs/:
    // "delete the files" would describe files that don't exist.
    await fs.writeFile(path.join(chDir, '.openspec.yaml'), 'skip_specs: true\n', 'utf-8');

    const result = await runCLI(['validate', 'marked-invalid', '--type', 'change'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Fix .openspec.yaml so the skip_specs marker can be honored');
    expect(result.stderr).not.toContain('delete the files under specs/');
  });

  it('keeps delta-authoring next steps for a plain zero-delta change', async () => {
    // The generic no-deltas guidance itself mentions skip_specs; that string
    // must not flip the footer into marker mode.
    const chDir = path.join(changesDir, 'plain-empty');
    await fs.mkdir(chDir, { recursive: true });

    const result = await runCLI(['validate', 'plain-empty', '--type', 'change'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Ensure change has deltas in specs/');
    expect(result.stderr).not.toContain('delete the files under specs/');
  });

  it('validates all with --all and outputs JSON summary', async () => {
    const result = await runCLI(['validate', '--all', '--json'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).not.toBe('');
    const json = JSON.parse(output);
    expect(Array.isArray(json.items)).toBe(true);
    expect(json.summary?.totals?.items).toBeDefined();
    expect(json.version).toBe('1.0');
  });

  it('validates only specs with --specs and respects --concurrency', async () => {
    const result = await runCLI(['validate', '--specs', '--json', '--concurrency', '1'], { cwd: testDir });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.trim();
    expect(output).not.toBe('');
    const json = JSON.parse(output);
    expect(json.items.every((i: any) => i.type === 'spec')).toBe(true);
  });

  it('errors on ambiguous item names and suggests type override', async () => {
    const result = await runCLI(['validate', 'dup'], { cwd: testDir });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Ambiguous item');
  });

  it('accepts change proposals saved with CRLF line endings', async () => {
    const changeId = 'crlf-change';
    const toCrlf = (segments: string[]) => segments.join('\n').replace(/\n/g, '\r\n');

    const crlfContent = toCrlf([
      '# CRLF Proposal',
      '',
      '## Why',
      'This change verifies validation works with Windows line endings.',
      '',
      '## What Changes',
      '- **alpha:** Ensure validation passes on CRLF files',
    ]);

    await fs.mkdir(path.join(changesDir, changeId), { recursive: true });
    await fs.writeFile(path.join(changesDir, changeId, 'proposal.md'), crlfContent, 'utf-8');

    const deltaContent = toCrlf([
      '## ADDED Requirements',
      '### Requirement: Parser SHALL accept CRLF change proposals',
      'The parser SHALL accept CRLF change proposals without manual edits.',
      '',
      '#### Scenario: Validate CRLF change',
      '- **GIVEN** a change proposal saved with CRLF line endings',
      '- **WHEN** a developer runs openspec validate on the proposal',
      '- **THEN** validation succeeds without section errors',
    ]);

    const deltaDir = path.join(changesDir, changeId, 'specs', 'alpha');
    await fs.mkdir(deltaDir, { recursive: true });
    await fs.writeFile(path.join(deltaDir, 'spec.md'), deltaContent, 'utf-8');

    const result = await runCLI(['validate', changeId], { cwd: testDir });
    expect(result.exitCode).toBe(0);
  });

  // #1182 — validate resolves a change by directory existence (matching
  // status/instructions), not by requiring proposal.md.
  const validDelta = [
    '## ADDED Requirements',
    '### Requirement: Scaffolded change SHALL validate without a proposal',
    'The change SHALL validate by directory existence without a proposal file.',
    '',
    '#### Scenario: Validate scaffolded change',
    '- **GIVEN** a change directory with no proposal.md',
    '- **WHEN** openspec validate runs',
    '- **THEN** the change resolves and its deltas are validated',
  ].join('\n');

  it('resolves and validates a scaffolded change without proposal.md (#1182)', async () => {
    const changeDir = path.join(changesDir, 'scaffolded');
    const deltaDir = path.join(changeDir, 'specs', 'alpha');
    await fs.mkdir(deltaDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n', 'utf-8');
    await fs.writeFile(path.join(deltaDir, 'spec.md'), validDelta, 'utf-8');

    const result = await runCLI(['validate', 'scaffolded'], { cwd: testDir });
    expect(result.stderr).not.toContain('Unknown item');
    expect(result.exitCode).toBe(0);
  });

  it('a resolved-but-invalid proposal-less change exits non-zero, not "Unknown item" (#1182)', async () => {
    // Resolves by directory existence, then fails validation (no deltas).
    const changeDir = path.join(changesDir, 'scaffolded-empty');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, '.openspec.yaml'), 'schema: spec-driven\n', 'utf-8');

    const result = await runCLI(['validate', 'scaffolded-empty'], { cwd: testDir });
    expect(result.stderr).not.toContain('Unknown item');
    expect(result.exitCode).toBe(1);
  });

  it('includes a sole proposal-less change in --all (not "No items found") (#1182)', async () => {
    const isoRoot = path.join(projectRoot, 'test-validate-iso-tmp');
    const isoChanges = path.join(isoRoot, 'openspec', 'changes');
    const deltaDir = path.join(isoChanges, 'only', 'specs', 'alpha');
    await fs.mkdir(deltaDir, { recursive: true });
    try {
      await fs.writeFile(path.join(isoChanges, 'only', '.openspec.yaml'), 'schema: spec-driven\n', 'utf-8');
      await fs.writeFile(path.join(deltaDir, 'spec.md'), validDelta, 'utf-8');

      const result = await runCLI(['validate', '--all'], { cwd: isoRoot });
      expect(result.stdout + result.stderr).not.toContain('No items found to validate');
      expect(result.exitCode).toBe(0);
    } finally {
      await fs.rm(isoRoot, { recursive: true, force: true });
    }
  });

  it('respects --no-interactive flag passed via CLI', async () => {
    // This test ensures Commander.js --no-interactive flag is correctly parsed
    // and passed to the validate command. The flag sets options.interactive = false
    // (not options.noInteractive = true) due to Commander.js convention.
    const result = await runCLI(['validate', '--specs', '--no-interactive'], {
      cwd: testDir,
      // Don't set OPEN_SPEC_INTERACTIVE to ensure we're testing the flag itself
      env: { ...process.env, OPEN_SPEC_INTERACTIVE: undefined },
    });
    expect(result.exitCode).toBe(0);
    // Should complete without hanging and without prompts
    expect(result.stderr).not.toContain('What would you like to validate?');
  });
});

describe('validate: depends_on graph checks', () => {
  const projectRoot = process.cwd();

  async function makeChange(
    root: string,
    id: string,
    opts: { dependsOn?: string[]; capability?: string; archived?: boolean } = {}
  ): Promise<void> {
    const base = opts.archived
      ? path.join(root, 'openspec', 'changes', 'archive', id)
      : path.join(root, 'openspec', 'changes', id);
    await fs.mkdir(base, { recursive: true });
    const yaml = opts.dependsOn
      ? `schema: spec-driven\ndepends_on:\n${opts.dependsOn.map((d) => `  - ${d}`).join('\n')}\n`
      : 'schema: spec-driven\n';
    await fs.writeFile(path.join(base, '.openspec.yaml'), yaml, 'utf-8');
    if (opts.capability && !opts.archived) {
      const specDir = path.join(base, 'specs', opts.capability);
      await fs.mkdir(specDir, { recursive: true });
      await fs.writeFile(
        path.join(specDir, 'spec.md'),
        [
          '## ADDED Requirements',
          `### Requirement: ${id} does something`,
          `The system SHALL do something for ${id}.`,
          '',
          '#### Scenario: works',
          '- **WHEN** a',
          '- **THEN** b',
        ].join('\n'),
        'utf-8'
      );
    }
  }

  async function withIsoRoot(fn: (root: string) => Promise<void>): Promise<void> {
    const root = path.join(projectRoot, `test-depends-on-iso-${Math.random().toString(36).slice(2)}`);
    try {
      await fn(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }

  it('reports an error when depends_on names an unresolved change', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { dependsOn: ['typo-name'], capability: 'cap' });
      const result = await runCLI(['validate', 'a'], { cwd: root });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("depends_on names unknown change 'typo-name'");
    });
  });

  it('reports an error on self-dependency', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { dependsOn: ['a'], capability: 'cap' });
      const result = await runCLI(['validate', 'a'], { cwd: root });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("depends_on names itself ('a')");
    });
  });

  it('reports an error when depends_on fails the metadata schema (e.g. not kebab-case)', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { dependsOn: ['Not_Kebab'], capability: 'cap' });
      const result = await runCLI(['validate', 'a'], { cwd: root });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('depends_on cannot be verified');
    });
  });

  it('does not error when depends_on names an archived change', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'done', { archived: true });
      await makeChange(root, 'a', { dependsOn: ['done'], capability: 'cap' });
      const result = await runCLI(['validate', 'a'], { cwd: root });
      expect(result.exitCode).toBe(0);
    });
  });

  it('reports a cycle error on every change in a direct cycle', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { dependsOn: ['b'], capability: 'cap-a' });
      await makeChange(root, 'b', { dependsOn: ['a'], capability: 'cap-b' });
      const resultA = await runCLI(['validate', 'a'], { cwd: root });
      const resultB = await runCLI(['validate', 'b'], { cwd: root });
      expect(resultA.exitCode).toBe(1);
      expect(resultA.stderr).toContain('depends_on cycle: a -> b -> a');
      expect(resultB.exitCode).toBe(1);
      expect(resultB.stderr).toContain('depends_on cycle');
    });
  });

  it('reports a cycle error on every change in an indirect cycle', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { dependsOn: ['b'], capability: 'cap-a' });
      await makeChange(root, 'b', { dependsOn: ['c'], capability: 'cap-b' });
      await makeChange(root, 'c', { dependsOn: ['a'], capability: 'cap-c' });
      const result = await runCLI(['validate', '--changes', '--json'], { cwd: root });
      const json = JSON.parse(result.stdout.trim());
      const issuesById = new Map(json.items.map((i: any) => [i.id, i.issues]));
      for (const id of ['a', 'b', 'c']) {
        expect((issuesById.get(id) as any[]).some((iss) => iss.message.includes('depends_on cycle'))).toBe(true);
      }
    });
  });

  it('reports no cycle error for an acyclic dependency chain', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { capability: 'cap-a' });
      await makeChange(root, 'b', { dependsOn: ['a'], capability: 'cap-b' });
      const result = await runCLI(['validate', 'b'], { cwd: root });
      expect(result.exitCode).toBe(0);
    });
  });

  it('--check-dependencies is opt-in: no finding without the flag, an informational finding with it', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { capability: 'shared' });
      await makeChange(root, 'b', { capability: 'shared' });

      const withoutFlag = await runCLI(['validate', 'a'], { cwd: root });
      expect(withoutFlag.exitCode).toBe(0);
      expect(withoutFlag.stderr).not.toContain('consider depends_on');

      const withFlag = await runCLI(['validate', 'a', '--check-dependencies'], { cwd: root });
      expect(withFlag.exitCode).toBe(0);
      expect(withFlag.stderr).toContain("shares capability path(s) shared with 'b'; consider depends_on");
    });
  });

  it('suppresses the capability-overlap finding once a depends_on relationship is declared', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { dependsOn: ['b'], capability: 'shared' });
      await makeChange(root, 'b', { capability: 'shared' });
      const result = await runCLI(['validate', 'a', '--check-dependencies'], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('consider depends_on');
    });
  });

  it('reports no capability-overlap finding when changes share no capability path', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { capability: 'cap-a' });
      await makeChange(root, 'b', { capability: 'cap-b' });
      const result = await runCLI(['validate', 'a', '--check-dependencies'], { cwd: root });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('consider depends_on');
    });
  });

  it('strict mode still passes when the only findings are capability-overlap suggestions', async () => {
    await withIsoRoot(async (root) => {
      await makeChange(root, 'a', { capability: 'shared' });
      await makeChange(root, 'b', { capability: 'shared' });
      const result = await runCLI(['validate', 'a', '--check-dependencies', '--strict'], { cwd: root });
      expect(result.exitCode).toBe(0);
    });
  });
});
