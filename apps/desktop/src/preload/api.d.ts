import type { SkillScopeApi } from '@skillscope/shared';

declare global {
  interface Window {
    skillscope: SkillScopeApi;
  }
}

export {};
