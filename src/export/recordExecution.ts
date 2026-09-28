export interface ExecutionRecording {
  finished: Promise<void>;
  stop(): Promise<void>;
}

function safeFilename(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workflow';
}

function supportedMimeType(): { mimeType?: string; extension: string } {
  const candidates = [
    ['video/webm;codecs=vp9', 'webm'],
    ['video/webm;codecs=vp8', 'webm'],
    ['video/webm', 'webm'],
    ['video/mp4;codecs=avc1', 'mp4'],
    ['video/mp4', 'mp4'],
  ] as const;
  const match = candidates.find(([type]) => MediaRecorder.isTypeSupported(type));
  return match ? { mimeType: match[0], extension: match[1] } : { extension: 'webm' };
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Records the browser surface selected by the user. Browsers intentionally
 * require their own picker here; choosing the current tab captures exactly
 * the canvas viewport, including live pan and zoom.
 */
export async function startExecutionRecording(workflowName: string): Promise<ExecutionRecording> {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Video recording is not supported by this browser.');
  }

  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 }, displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
  } as DisplayMediaStreamOptions);
  const { mimeType, extension } = supportedMimeType();
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, {
    ...(mimeType ? { mimeType } : {}),
    videoBitsPerSecond: 8_000_000,
  });

  let resolveFinished!: () => void;
  let rejectFinished!: (error: unknown) => void;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  let stopPromise: Promise<void> | undefined;

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener('error', (event) => {
    stream.getTracks().forEach((track) => track.stop());
    rejectFinished(new Error((event as Event & { error?: DOMException }).error?.message ?? 'Video recording failed.'));
  });
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((track) => track.stop());
    if (chunks.length) {
      const type = recorder.mimeType || mimeType || `video/${extension}`;
      download(new Blob(chunks, { type }), `${safeFilename(workflowName)}-execution.${extension}`);
    }
    resolveFinished();
  });
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (recorder.state !== 'inactive') recorder.stop();
  });

  recorder.start(500);
  return {
    finished,
    stop() {
      if (stopPromise) return stopPromise;
      stopPromise = finished;
      if (recorder.state !== 'inactive') recorder.stop();
      return stopPromise;
    },
  };
}
