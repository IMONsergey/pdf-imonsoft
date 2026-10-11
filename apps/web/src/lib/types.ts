export type Category = 'all' | 'pdf' | 'presentations' | 'documents' | 'images';
export type Engine = 'pdf' | 'image' | 'office' | 'ocr';
export interface Tool {
  id: string; title: string; description: string; category: Exclude<Category, 'all'>;
  engine: Engine; accept: string[]; output: string; icon: string; settings: string[];
  notice: string; multiple: boolean; minFiles: number; featured: boolean; keywords: string;
}
export interface ServerConfig {
  version: string; maxUploadMb: number; maxFiles: number; maxPages: number;
  retentionSeconds: number;
  engines: Record<Engine, boolean> & { ocrLanguages: string[] };
  tools: { id: string; available: boolean }[];
}
export type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export interface Job {
  id: string; tool: string; names: string[]; state: JobState;
  createdAt: number; expiresAt: number; inputSize: number; outputSize: number | null;
  progress: number | null; stage: string; error: string | null; warnings: string[];
  downloadUrl: string | null; outputExtension: string | null;
}
export type Options = Record<string, string | number>;
export interface PickedFile { id: string; file: File }
