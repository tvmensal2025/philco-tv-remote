declare module '@revideo/renderer' {
  export function renderVideo(props: {
    projectFile: string;
    variables?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  }): Promise<string>;
}
