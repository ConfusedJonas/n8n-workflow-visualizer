import { afterEach, describe, expect, it, vi } from 'vitest';
import { startExecutionRecording } from '../src/export/recordExecution';

class FakeTrack extends EventTarget {
  stop = vi.fn();
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
  it('captures the selected browser surface and downloads a safe WebM filename', async () => {
    const track = new FakeTrack();
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const getDisplayMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getDisplayMedia } });
    vi.stubGlobal('MediaRecorder', FakeRecorder);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:recording'),
      revokeObjectURL: vi.fn(),
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const recording = await startExecutionRecording('My / Workflow');
    expect(getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false, preferCurrentTab: true }));
    await recording.stop();

    expect(click).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalled();
    const anchor = click.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe('my-workflow-execution.webm');
  });
});
