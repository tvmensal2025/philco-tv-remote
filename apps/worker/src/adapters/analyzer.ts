export type ClipCandidate = { cameraId: string; path: string; localPath: string; position: number; startOffsetSeconds: number; hasAudio: boolean };
export type EditDecision = { clips: ClipCandidate[]; score: number; reason: string };
export interface SceneAnalyzer { analyze(clips: ClipCandidate[]): Promise<EditDecision> }

export class RulesAnalyzer implements SceneAnalyzer {
  constructor(private readonly style: "natural" | "dynamic" | "cinematic") {}
  async analyze(clips: ClipCandidate[]): Promise<EditDecision> {
    const ordered = [...clips].sort((a, b) => a.position - b.position);
    if (this.style === "dynamic") return { clips: [...ordered, ...ordered.slice().reverse()], score: 76, reason: "Estilo dinâmico: cortes curtos com alternância de ângulos" };
    if (this.style === "cinematic") return { clips: ordered.slice(0, 2), score: 74, reason: "Estilo cinematográfico: planos longos e ritmo suave" };
    return { clips: ordered.slice(0, 4), score: 72, reason: "Estilo natural: alternância equilibrada entre câmeras" };
  }
}

// Future adapters implement the same interface: LocalVlmAnalyzer, YoloAnalyzer,
// BytePlusAnalyzer or OpusClipAnalyzer. The pipeline never depends on a provider.
export function createAnalyzer(style: string): SceneAnalyzer {
  return new RulesAnalyzer(["natural", "dynamic", "cinematic"].includes(style) ? style as "natural" | "dynamic" | "cinematic" : "natural");
}
