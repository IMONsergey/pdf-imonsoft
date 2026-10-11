import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, ArrowUp, ArrowDown, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Combine, Copy, Download, Ellipsis, Eye, FileImage, Files, FileText, FolderOpen, Grid2X2, Hash, History, Image, Info, Layers, LayoutTemplate, LoaderCircle, LockKeyhole, Menu, Minimize2, Moon, Plus, Presentation, RefreshCw, RotateCw, ScanText, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Split, Sun, Trash2, Type, UnlockKeyhole, Upload, X, Maximize2, Table2, Eraser } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const icons: Record<string, LucideIcon> = {
  'arrow-right': ArrowRight, 'arrow-left': ArrowLeft, 'arrow-up-right': ArrowUpRight,
  'arrow-up': ArrowUp, 'arrow-down': ArrowDown, 'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft, 'chevron-right': ChevronRight,
  check: Check, alert: CircleAlert, success: CircleCheck, combine: Combine, copy: Copy,
  download: Download, save: ArrowDownToLine, eye: Eye, 'file-image': FileImage,
  files: Files, text: FileText, folder: FolderOpen, grid: Grid2X2, numbers: Hash,
  history: History, image: Image, info: Info, pages: Layers, slides: LayoutTemplate,
  loading: LoaderCircle, lock: LockKeyhole, menu: Menu, compress: Minimize2, moon: Moon,
  plus: Plus, presentation: Presentation, refresh: RefreshCw, rotate: RotateCw,
  scan: ScanText, search: Search, settings: Settings2, shield: ShieldCheck,
  sliders: SlidersHorizontal, sparkle: Sparkles, split: Split, sun: Sun,
  remove: Trash2, watermark: Type, unlock: UnlockKeyhole, upload: Upload, x: X,
  resize: Maximize2, table: Table2, clean: Eraser, more: Ellipsis,
};
export function Icon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  const Component = icons[name] || FileText;
  return <Component aria-hidden="true" size={size} strokeWidth={1.65} className={className} />;
}
