import { UIError } from '../shared/i18n';
import { compileDraft } from './build';
import type { Compiler } from './compiler';
import type { Draft, BuildProfile, Compilation } from '../shared/types';
import type { CompilerContext } from './build/plan';
export type PreparedProgram = Awaited<ReturnType<typeof compileDraft>>;
export class CompiledProgram {
  private readonly programs = new Map<
    BuildProfile | undefined,
    { key: string; program: PreparedProgram }
  >();
  constructor(private compiler: Compiler) {}
  matches(key: string, profile?: BuildProfile) {
    return this.programs.get(profile)?.key === key;
  }
  require(key: string, profile?: BuildProfile): PreparedProgram {
    const current = this.programs.get(profile);
    if (!current || current.key !== key)
      throw new UIError('Save your changes, then click Compile.');
    return current.program;
  }
  async clear() {
    const previous = [...this.programs.values()];
    this.programs.clear();
    await Promise.all(previous.map(({ program }) => program.cleanup()));
  }
  async compile(
    key: string,
    draft: Draft,
    options: CompilerContext,
    signal?: AbortSignal,
    profile?: BuildProfile,
  ): Promise<Compilation> {
    const previous = this.programs.get(profile);
    this.programs.delete(profile);
    await previous?.program.cleanup();
    let prepared: PreparedProgram | undefined;
    try {
      prepared = await compileDraft(this.compiler, draft, options, signal);
      if (prepared.compilation.status === 'success' && !signal?.aborted) {
        this.programs.set(profile, { key, program: prepared });
        return prepared.compilation;
      }
      const result = prepared.compilation;
      await prepared.cleanup();
      prepared = undefined;
      return result;
    } catch (error) {
      await prepared?.cleanup();
      throw error;
    }
  }
}
