export type Category = 'all' | 'pdf' | 'presentations' | 'documents' | 'images';
export type Engine = 'pdf' | 'image' | 'office' | 'ocr';
export interface Tool {
  id: string; title: string; description: string; category: Exclude<Category, 'all'>;
  engine: Engine; accept: string[]; output: string; icon: string; settings: string[];
  notice: string; multiple: boolean; minFiles: number; featured: boolean; keywords: string;
  batch: boolean; postprocess: boolean;
}
export interface ServerConfig {
  version: string; maxUploadMb: number; maxFiles: number; maxPages: number;
  retentionSeconds: number; accessEnabled: boolean; sessionStorageMb: number;
  engines: Record<Engine, boolean> & { ocrLanguages: string[] };
  tools: { id: string; available: boolean }[];
}
export type JobState = 'queued' | 'running' | 'done' | 'error' | 'cancelled';
export interface Job {
  id: string; tool: string; names: string[]; state: JobState;
  createdAt: number; expiresAt: number; inputSize: number; outputSize: number | null;
  progress: number | null; stage: string; error: string | null; warnings: string[];
  batch?: { processed: number; total: number; failed: number } | null;
  downloadUrl: string | null; outputExtension: string | null;
}
export interface PageSpec { page: number; rotation: 0 | 90 | 180 | 270 }
export interface Options {
  [key: string]: string | number | boolean | PageSpec[];
  pages: string; page_plan: PageSpec[]; angle: number; dpi: number;
  password: string; new_password: string; text: string; start: number;
  format: string; quality: number; width: number; height: number;
  page_size: string; language: string; batch: boolean; postprocess: string;
  split_every: number; crop_top: number; crop_right: number; crop_bottom: number; crop_left: number;
  watermark_opacity: number; watermark_angle: number; flip: string;
}
export type SubmittedOptions = Partial<Options>;
export interface PickedFile { id: string; file: File }
