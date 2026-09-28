export interface ExecutionRecordingResult {
  blob: Blob;
  durationMs: number;
  filename: string;
  width: number;
  height: number;
}

export interface ExecutionRecording {
  finished: Promise<ExecutionRecordingResult>;
  stop(): Promise<ExecutionRecordingResult>;
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

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

export function downloadExecutionRecording(recording: ExecutionRecordingResult): void {
  const url = URL.createObjectURL(recording.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = recording.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Uses the browser's current-tab capture as a live pixel source, then crops
 * every frame to the graph stage before encoding. This preserves React Flow's
 * exact viewport, zoom, animations, and user interaction without recording
 * the surrounding application HUD.
 */
export async function startExecutionRecording(stage: HTMLElement, workflowName: string): Promise<ExecutionRecording> {
  if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('Video recording is not supported by this browser.');
  }
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') {
    throw new Error('Graph-only video recording is not supported by this browser.');
  }

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 }, displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
    surfaceSwitching: 'exclude',
    systemAudio: 'exclude',
    monitorTypeSurfaces: 'exclude',
  } as DisplayMediaStreamOptions);
  const displayTrack = displayStream.getVideoTracks()[0];
  const displaySurface = displayTrack?.getSettings().displaySurface;
  if (!displayTrack || (displaySurface && displaySurface !== 'browser')) {
    displayStream.getTracks().forEach((track) => track.stop());
    throw new Error('Choose This Tab in the sharing dialog so the workflow canvas can be recorded without the HUD.');
  }

  const source = document.createElement('video');
  source.muted = true;
  source.playsInline = true;
  source.srcObject = displayStream;
  try {
    await source.play();
  } catch (error) {
    displayStream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  if (!source.videoWidth || !source.videoHeight) {
    displayStream.getTracks().forEach((track) => track.stop());
    throw new Error('The selected tab did not provide a video frame. Please try recording again.');
  }

  const initialRect = stage.getBoundingClientRect();
  const sourceScaleX = source.videoWidth / window.innerWidth;
  const sourceScaleY = source.videoHeight / window.innerHeight;
  const naturalWidth = initialRect.width * sourceScaleX;
  const naturalHeight = initialRect.height * sourceScaleY;
  const outputScale = Math.min(1, 3840 / Math.max(1, naturalWidth), 2160 / Math.max(1, naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = evenDimension(naturalWidth * outputScale);
  canvas.height = evenDimension(naturalHeight * outputScale);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) {
    displayStream.getTracks().forEach((track) => track.stop());
    throw new Error('Could not create the video recording canvas.');
  }
  stage.classList.add('is-video-recording');

  let drawingFrame = 0;
  let drawing = true;
  const draw = () => {
    const rect = stage.getBoundingClientRect();
    const scaleX = source.videoWidth / window.innerWidth;
    const scaleY = source.videoHeight / window.innerHeight;
    context.fillStyle = '#171719';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      source,
      Math.max(0, rect.left * scaleX),
      Math.max(0, rect.top * scaleY),
      Math.max(1, rect.width * scaleX),
      Math.max(1, rect.height * scaleY),
      0,
      0,
      canvas.width,
      canvas.height,
    );
    if (drawing) drawingFrame = window.requestAnimationFrame(draw);
  };
  draw();

  let canvasStream: MediaStream;
  let recorder: MediaRecorder;
  const { mimeType, extension } = supportedMimeType();
  try {
    canvasStream = canvas.captureStream(30);
    recorder = new MediaRecorder(canvasStream, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 8_000_000,
    });
  } catch (error) {
    drawing = false;
    window.cancelAnimationFrame(drawingFrame);
    stage.classList.remove('is-video-recording');
    source.pause();
    source.srcObject = null;
    displayStream.getTracks().forEach((track) => track.stop());
    throw error;
  }
  const chunks: BlobPart[] = [];
  const startedAt = performance.now();
  let stopPromise: Promise<ExecutionRecordingResult> | undefined;
  let settled = false;
  let resolveFinished!: (result: ExecutionRecordingResult) => void;
  let rejectFinished!: (error: unknown) => void;
  const finished = new Promise<ExecutionRecordingResult>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  const cleanup = () => {
    drawing = false;
    window.cancelAnimationFrame(drawingFrame);
    source.pause();
    source.srcObject = null;
    stage.classList.remove('is-video-recording');
    canvasStream.getTracks().forEach((track) => track.stop());
    displayStream.getTracks().forEach((track) => track.stop());
  };

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener('error', (event) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectFinished(new Error((event as Event & { error?: DOMException }).error?.message ?? 'Video recording failed.'));
  });
  recorder.addEventListener('stop', () => {
    if (settled) return;
    settled = true;
    cleanup();
    const type = recorder.mimeType || mimeType || `video/${extension}`;
    resolveFinished({
      blob: new Blob(chunks, { type }),
      durationMs: Math.max(0, performance.now() - startedAt),
      filename: `${safeFilename(workflowName)}-execution.${extension}`,
      width: canvas.width,
      height: canvas.height,
    });
  });
  displayTrack.addEventListener('ended', () => {
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
