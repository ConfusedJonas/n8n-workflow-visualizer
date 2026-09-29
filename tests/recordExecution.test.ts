import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadExecutionRecording, startExecutionRecording } from '../src/export/recordExecution';

class FakeTrack extends EventTarget {
  stop = vi.fn();
  cropTo = vi.fn().mockResolvedValue(undefined);
  getSettings = vi.fn(() => ({ displaySurface: 'browser' }) as MediaTrackSettings);
}

class FakeRecorder extends EventTarget {
  static isTypeSupported = vi.fn((type: string) => type.startsWith('video/webm'));
  state: RecordingState = 'inactive';
  mimeType: string;
  start = vi.fn(() => { this.state = 'recording'; });

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    super();
    this.mimeType = options?.mimeType ?? 'video/webm';
  }

  stop = vi.fn(() => {
    this.state = 'inactive';
    const data = new Event('dataavailable');
    Object.defineProperty(data, 'data', { value: new Blob(['recorded frame'], { type: this.mimeType }) });
    this.dispatchEvent(data);
    this.dispatchEvent(new Event('stop'));
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('execution video recording', () => {
  it('crops the selected tab to the graph stage and waits for download confirmation', async () => {
    const displayTrack = new FakeTrack();
    const canvasTrack = new FakeTrack();
    const displayStream = {
      getTracks: () => [displayTrack],
      getVideoTracks: () => [displayTrack],
    } as unknown as MediaStream;
    const canvasStream = {
      getTracks: () => [canvasTrack],
      getVideoTracks: () => [canvasTrack],
    } as unknown as MediaStream;
    const getDisplayMedia = vi.fn().mockResolvedValue(displayStream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia } });
    const cropTarget = { stage: true };
    const fromElement = vi.fn().mockResolvedValue(cropTarget);
    vi.stubGlobal('CropTarget', { fromElement });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 1920 });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 1080 });
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage, set fillStyle(_value: string) {} } as unknown as CanvasRenderingContext2D);
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', { configurable: true, value: vi.fn(() => canvasStream) });
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:recording'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const stage = document.createElement('div');
    vi.spyOn(stage, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 160, left: 100, top: 160, right: 900, bottom: 760, width: 800, height: 600, toJSON: () => ({}) });

    const recording = await startExecutionRecording(stage, 'My / Workflow');
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: false,
      preferCurrentTab: true,
      video: expect.objectContaining({ cursor: 'never', displaySurface: 'browser' }),
    }));
    expect(fromElement).toHaveBeenCalledWith(stage);
    expect(displayTrack.cropTo).toHaveBeenCalledWith(cropTarget);
    expect(stage).toHaveClass('is-video-recording');
    const result = await recording.stop();

    expect(drawImage).toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(result.filename).toBe('my-workflow-execution.webm');
    expect(result.blob.size).toBeGreaterThan(0);
    expect(displayTrack.stop).toHaveBeenCalled();
    expect(canvasTrack.stop).toHaveBeenCalled();
    expect(stage).not.toHaveClass('is-video-recording');

    downloadExecutionRecording(result);
    expect(click).toHaveBeenCalledOnce();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('my-workflow-execution.webm');
  });
});
