/**
 * Cross-change `depends_on` graph checks, shared between single-item and
 * bulk `openspec validate`: existence/self-reference/cycle detection
 * (always on) and capability-path overlap suggestions (opt-in, behind
 * `--check-dependencies`).
 */

import path from 'path';
import { readChangeMetadata } from '../utils/change-metadata.js';
import { discoverSpecFiles } from '../utils/spec-discovery.js';
import { listSchemas } from './artifact-graph/resolver.js';

export interface DependencyIssue {
  level: 'ERROR' | 'INFO';
  path: string;
  message: string;
}

export interface DependsOnCollection {
  dependsOnByChange: Map<string, string[]>;
  /** id -> readChangeMetadata failure message, for a change whose `.openspec.yaml` could not be read as valid metadata (so its `depends_on`, if any, could not be determined). */
  metadataErrors: Map<string, string>;
}

/**
 * Reads `depends_on` for each active change, id -> its declared entries
 * (empty when unset). Metadata that fails to parse cannot be walked for
 * dependencies, but the failure is recorded rather than dropped - nothing
 * else in `openspec validate` reports a plain `.openspec.yaml` parse/schema
 * failure that isn't also a `skip_specs`/`retire_capabilities` marker, so
 * silently treating it as "no dependencies" would let e.g. a non-kebab-case
 * `depends_on` entry pass validate with no feedback at all.
 */
export async function collectDependsOnMap(
  changesDir: string,
  activeChangeIds: string[],
  projectRoot: string
): Promise<DependsOnCollection> {
  const availableSchemas = listSchemas(projectRoot);
  const dependsOnByChange = new Map<string, string[]>();
  const metadataErrors = new Map<string, string>();
  for (const id of activeChangeIds) {
    let dependsOn: string[] = [];
    try {
      const metadata = readChangeMetadata(path.join(changesDir, id), projectRoot, availableSchemas);
      dependsOn = metadata?.depends_on ?? [];
    } catch (err) {
      metadataErrors.set(id, err instanceof Error ? err.message : String(err));
    }
    dependsOnByChange.set(id, dependsOn);
  }
  return { dependsOnByChange, metadataErrors };
}

function addFinding(findings: Map<string, DependencyIssue[]>, id: string, issue: DependencyIssue): void {
  const list = findings.get(id);
  if (list) {
    list.push(issue);
  } else {
    findings.set(id, [issue]);
  }
}

/**
 * Finds cycles in a directed graph via DFS, reporting each cycle's member
 * nodes once. A node already covered by a reported cycle is not re-walked
 * into a second, overlapping cycle report.
 */
function findCycles(edges: Map<string, string[]>): string[][] {
  const visited = new Set<string>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const reported = new Set<string>();

  function visit(node: string): void {
    visited.add(node);
    onStack.add(node);
    stack.push(node);

    for (const next of edges.get(node) ?? []) {
      if (!visited.has(next)) {
        visit(next);
      } else if (onStack.has(next)) {
        const startIndex = stack.indexOf(next);
        const cycle = stack.slice(startIndex);
        if (cycle.some((n) => !reported.has(n))) {
          cycles.push(cycle);
          cycle.forEach((n) => reported.add(n));
        }
      }
    }

    stack.pop();
    onStack.delete(node);
  }

  for (const node of edges.keys()) {
    if (!visited.has(node)) visit(node);
  }

  return cycles;
}

/**
 * Always-on `depends_on` graph checks: unresolved/self-referential entries,
 * cycles among active changes, and changes whose `.openspec.yaml` could not
 * be read at all (so `depends_on` could not be determined). A dependency on
 * an archived change is not an error - it's already satisfied.
 */
export function computeDependencyGraphFindings(
  dependsOnByChange: Map<string, string[]>,
  activeChangeIds: string[],
  archivedChangeIds: string[],
  metadataErrors: Map<string, string> = new Map()
): Map<string, DependencyIssue[]> {
  const activeSet = new Set(activeChangeIds);
  const archivedSet = new Set(archivedChangeIds);
  const findings = new Map<string, DependencyIssue[]>();

  for (const [id, message] of metadataErrors) {
    addFinding(findings, id, {
      level: 'ERROR',
      path: '.openspec.yaml',
      message: `depends_on cannot be verified: ${message}`,
    });
  }

  for (const id of activeChangeIds) {
    const dependsOn = [...new Set(dependsOnByChange.get(id) ?? [])];
    for (const dep of dependsOn) {
      if (dep === id) {
        addFinding(findings, id, {
          level: 'ERROR',
          path: '.openspec.yaml',
          message: `depends_on names itself ('${dep}')`,
        });
        continue;
      }
      if (!activeSet.has(dep) && !archivedSet.has(dep)) {
        addFinding(findings, id, {
          level: 'ERROR',
          path: '.openspec.yaml',
          message: `depends_on names unknown change '${dep}' (not found among active or archived changes)`,
        });
      }
    }
  }

  const activeEdges = new Map<string, string[]>();
  for (const id of activeChangeIds) {
    const dependsOn = dependsOnByChange.get(id) ?? [];
    activeEdges.set(id, dependsOn.filter((dep) => dep !== id && activeSet.has(dep)));
  }

  for (const cycle of findCycles(activeEdges)) {
    const cyclePath = [...cycle, cycle[0]].join(' -> ');
    for (const id of cycle) {
      addFinding(findings, id, {
        level: 'ERROR',
        path: '.openspec.yaml',
        message: `depends_on cycle: ${cyclePath}`,
      });
    }
  }

  return findings;
}

/**
 * Opt-in capability-path overlap suggestions: two active changes that touch
 * the same `specs/<capability-path>/` and declare no `depends_on` relation
 * either way get an informational finding each. Never blocks; `--strict`
 * ignores INFO-level findings.
 */
export async function computeCapabilityOverlapFindings(
  changesDir: string,
  activeChangeIds: string[],
  dependsOnByChange: Map<string, string[]>
): Promise<Map<string, DependencyIssue[]>> {
  const findings = new Map<string, DependencyIssue[]>();
  const capsByChange = new Map<string, Set<string>>();
  for (const id of activeChangeIds) {
    const discovered = await discoverSpecFiles(path.join(changesDir, id, 'specs'));
    capsByChange.set(id, new Set(discovered.map((d) => d.id)));
  }

  const relates = (a: string, b: string): boolean =>
    (dependsOnByChange.get(a) ?? []).includes(b) || (dependsOnByChange.get(b) ?? []).includes(a);

  for (let i = 0; i < activeChangeIds.length; i++) {
    for (let j = i + 1; j < activeChangeIds.length; j++) {
      const a = activeChangeIds[i];
      const b = activeChangeIds[j];
      if (relates(a, b)) continue;

      const shared = [...(capsByChange.get(a) ?? [])]
        .filter((cap) => capsByChange.get(b)?.has(cap))
        .sort();
      if (shared.length === 0) continue;

      const capsList = shared.join(', ');
      addFinding(findings, a, {
        level: 'INFO',
        path: '.openspec.yaml',
        message: `shares capability path(s) ${capsList} with '${b}'; consider depends_on`,
      });
      addFinding(findings, b, {
        level: 'INFO',
        path: '.openspec.yaml',
        message: `shares capability path(s) ${capsList} with '${a}'; consider depends_on`,
      });
    }
  }

  return findings;
}

function mergeFindingsMaps(
  a: Map<string, DependencyIssue[]>,
  b: Map<string, DependencyIssue[]>
): Map<string, DependencyIssue[]> {
  const merged = new Map<string, DependencyIssue[]>();
  for (const [id, issues] of a) merged.set(id, [...issues]);
  for (const [id, issues] of b) {
    const existing = merged.get(id);
    merged.set(id, existing ? [...existing, ...issues] : [...issues]);
  }
  return merged;
}

/**
 * Computes both dependency-graph passes for a set of active changes: the
 * always-on graph checks, plus the opt-in capability-overlap suggestions
 * when requested. Used by both single-item and bulk `openspec validate`, so
 * the two invocation shapes never diverge on what a "depends_on" problem is.
 */
export async function computeDependencyFindings(
  changesDir: string,
  projectRoot: string,
  activeChangeIds: string[],
  archivedChangeIds: string[],
  checkDependencies: boolean
): Promise<Map<string, DependencyIssue[]>> {
  if (activeChangeIds.length === 0) return new Map();

  const { dependsOnByChange, metadataErrors } = await collectDependsOnMap(changesDir, activeChangeIds, projectRoot);
  const graphFindings = computeDependencyGraphFindings(dependsOnByChange, activeChangeIds, archivedChangeIds, metadataErrors);
  if (!checkDependencies) return graphFindings;

  const overlapFindings = await computeCapabilityOverlapFindings(changesDir, activeChangeIds, dependsOnByChange);
  return mergeFindingsMaps(graphFindings, overlapFindings);
}
