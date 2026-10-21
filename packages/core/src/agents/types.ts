import type {
  AdapterDiagnostic,
  AgentDescriptor,
  AgentId,
  CustomSkillLocation,
  InstallScope,
  RootStatus,
  SkillRoot,
  ValidationIssue,
} from '@skillscope/shared';
import type { PlatformContext } from '../platform/context.js';

export interface AdapterContext {
  platform: PlatformContext;
  /** Selected workspace root, or null when no project is selected. */
  workspaceRoot: string | null;
  includeSystemRoots: boolean;
  /** Upper bound for recursive roots (category folders). */
  maxDepth: number;
  customLocations: CustomSkillLocation[];
}

/** Minimal view of a parsed skill that adapters need for compatibility checks. */
export interface SkillForCompatibility {
  name: string | null;
  directoryName: string;
  frontmatter: Record<string, unknown>;
  hasFrontmatter: boolean;
  files: string[];
}

export type AdapterOperation = 'discover' | 'install' | 'update' | 'remove';

/**
 * Contract every coding-agent adapter implements. The inventory, validation and installation
 * engines only talk to adapters through this interface, so adding an agent means adding one
 * adapter and registering it.
 */
export interface AgentAdapter {
  readonly id: AgentId;
  readonly descriptor: AgentDescriptor;
  readonly operations: readonly AdapterOperation[];
  /** All roots this agent reads, in precedence order. Never creates directories. */
  roots(ctx: AdapterContext): SkillRoot[];
  /** Paths whose existence suggests the agent is installed (checked with stat only). */
  evidencePaths(ctx: AdapterContext): string[];
  /** Roots that SkillScope may install into for a scope; the first one is the default. */
  installRoots(ctx: AdapterContext, scope: InstallScope): SkillRoot[];
  /** Agent-specific portability findings. Reported as warnings unless a hard incompatibility. */
  checkCompatibility(skill: SkillForCompatibility): ValidationIssue[];
  /** Agent-level diagnostics after a scan, e.g. "no skill directory exists yet". */
  diagnose(ctx: AdapterContext, statuses: RootStatus[]): AdapterDiagnostic[];
}
