import { toPng, toSvg } from 'html-to-image';
import type { ReactFlowInstance } from '@xyflow/react';

export type ExportFormat = 'png' | 'svg';

const SAFE_CANVAS_SIDE = 16_000;
const SAFE_CANVAS_PIXELS = 120_000_000;

function safeFilename(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'workflow';
}

function download(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  link.click();
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

function exportFilter(node: HTMLElement): boolean {
  return !node.classList?.contains('react-flow__controls')
    && !node.classList?.contains('react-flow__minimap')
    && !node.classList?.contains('react-flow__attribution');
}

export async function exportGraphStage(
  stage: HTMLElement,
  instance: ReactFlowInstance,
  format: ExportFormat,
  workflowName: string,
  viewName: string,
): Promise<void> {
  const previousViewport = instance.getViewport();
  await instance.fitView({ padding: 0.08, duration: 0, minZoom: 0.02, maxZoom: 2 });
  await nextPaint();
  try {
    const width = Math.max(1, Math.ceil(stage.clientWidth));
    const height = Math.max(1, Math.ceil(stage.clientHeight));
    const requestedRatio = format === 'png' ? 2 : 1;
    const ratio = Math.min(
      requestedRatio,
      SAFE_CANVAS_SIDE / width,
      SAFE_CANVAS_SIDE / height,
      Math.sqrt(SAFE_CANVAS_PIXELS / (width * height)),
    );
    if (ratio < 0.25) throw new Error('The graph is too large to export safely in this browser.');
    const options = {
      backgroundColor: '#101014',
      cacheBust: true,
      filter: exportFilter,
      pixelRatio: ratio,
      width,
      height,
    };
    const dataUrl = format === 'png'
      ? await toPng(stage, options)
      : await toSvg(stage, options);
    download(dataUrl, `${safeFilename(workflowName)}-${safeFilename(viewName)}.${format}`);
  } finally {
    instance.setViewport(previousViewport, { duration: 0 });
  }
}
