declare module "stable-diffusion-cjs" {
  export interface AIResult {
    error?: string;
    results: string[];
  }

  export interface AI {
    generate: (prompt: string, callback: (result: AIResult) => void) => void;
  }

  const AI: AI;
  export = AI;
}
