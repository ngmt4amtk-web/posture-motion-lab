import { DrawingUtils, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { PosePoint } from './types';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_FULL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const MODEL_LITE =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let poseLandmarker: PoseLandmarker | null = null;

export async function initPoseLandmarker(onStatus: (message: string) => void) {
  if (poseLandmarker) return poseLandmarker;

  try {
    onStatus('MediaPipe full model loading');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_FULL,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
      outputSegmentationMasks: false,
    });
    onStatus('ready');
    return poseLandmarker;
  } catch {
    onStatus('GPU failed, CPU lite model loading');
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_LITE,
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });
    onStatus('ready');
    return poseLandmarker;
  }
}

export function detectPose(video: HTMLVideoElement, timestampMs: number): PosePoint[] | null {
  if (!poseLandmarker || video.readyState < 2) return null;
  const result = poseLandmarker.detectForVideo(video, timestampMs);
  const landmarks = result.landmarks?.[0];
  return landmarks ? landmarks.map((point) => ({ ...point })) : null;
}

export function drawPose(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  landmarks: PosePoint[] | null,
  mirrored: boolean,
) {
  const width = video.videoWidth || canvas.clientWidth;
  const height = video.videoHeight || canvas.clientHeight;
  if (!width || !height) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, width, height);
  if (!landmarks) return;

  ctx.save();
  if (mirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  const drawableLandmarks = landmarks.map((point) => ({ ...point, visibility: point.visibility ?? 1 }));
  const drawingUtils = new DrawingUtils(ctx);
  drawingUtils.drawConnectors(drawableLandmarks, PoseLandmarker.POSE_CONNECTIONS, {
    color: 'rgba(57, 216, 163, 0.9)',
    lineWidth: 3,
  });
  drawingUtils.drawLandmarks(drawableLandmarks, {
    color: 'rgba(255, 255, 255, 0.95)',
    fillColor: 'rgba(57, 216, 163, 0.95)',
    lineWidth: 1,
    radius: 4,
  });
  ctx.restore();
}
