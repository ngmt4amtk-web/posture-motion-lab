import { TASKS } from './protocol';
import type { MetricValue, PoseFrame, PosePoint, QualityGrade, SessionAnalysis, TaskAnalysis, TaskCapture, TaskId } from './types';

const IDX = {
  nose: 0,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
  leftHeel: 29,
  rightHeel: 30,
  leftFoot: 31,
  rightFoot: 32,
};

const REQUIRED_STATIC = [
  IDX.leftEar,
  IDX.rightEar,
  IDX.leftShoulder,
  IDX.rightShoulder,
  IDX.leftHip,
  IDX.rightHip,
  IDX.leftKnee,
  IDX.rightKnee,
  IDX.leftAnkle,
  IDX.rightAnkle,
];

const REQUIRED_DYNAMIC = [
  IDX.leftShoulder,
  IDX.rightShoulder,
  IDX.leftHip,
  IDX.rightHip,
  IDX.leftKnee,
  IDX.rightKnee,
  IDX.leftAnkle,
  IDX.rightAnkle,
];

function deg(rad: number) {
  return (rad * 180) / Math.PI;
}

function round(value: number, digits = 3) {
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

function point(frame: PoseFrame, index: number) {
  return frame.landmarks[index];
}

function visible(lm: PosePoint | undefined, threshold = 0.5) {
  return Boolean(lm) && (lm?.visibility == null || lm.visibility >= threshold);
}

function frameConfidence(frame: PoseFrame, required: number[], threshold = 0.5) {
  const passed = required.filter((index) => visible(point(frame, index), threshold)).length;
  return passed / required.length;
}

function highConfidenceRatio(frames: PoseFrame[], required: number[], threshold = 0.5) {
  if (frames.length === 0) return 0;
  const high = frames.filter((frame) => frameConfidence(frame, required, threshold) >= 0.92).length;
  return high / frames.length;
}

function gradeFromRatio(ratio: number, frameCount: number): QualityGrade {
  if (frameCount < 20 || ratio < 0.45) return '測定不能';
  if (ratio >= 0.85) return 'A';
  if (ratio >= 0.65) return 'B';
  return 'C';
}

function mean(values: Array<number | null | undefined>) {
  const xs = values.filter((value): value is number => Number.isFinite(value));
  if (xs.length === 0) return null;
  return xs.reduce((sum, value) => sum + value, 0) / xs.length;
}

function min(values: number[]) {
  return values.reduce((m, value) => Math.min(m, value), Number.POSITIVE_INFINITY);
}

function max(values: number[]) {
  return values.reduce((m, value) => Math.max(m, value), Number.NEGATIVE_INFINITY);
}

function distance(a: PosePoint, b: PosePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: PosePoint, b: PosePoint): PosePoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: mean([a.visibility, b.visibility]) ?? undefined,
  };
}

function angle3(a: PosePoint, b: PosePoint, c: PosePoint) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.hypot(ba.x, ba.y);
  const magBC = Math.hypot(bc.x, bc.y);
  if (magBA === 0 || magBC === 0) return null;
  const cosine = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return deg(Math.acos(cosine));
}

function torsoScale(frame: PoseFrame) {
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  if (![lShoulder, rShoulder, lHip, rHip].every(Boolean)) return null;
  return distance(mid(lShoulder, rShoulder), mid(lHip, rHip));
}

function shoulderWidth(frame: PoseFrame) {
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  if (!lShoulder || !rShoulder) return null;
  return distance(lShoulder, rShoulder);
}

function trunkLean(frame: PoseFrame) {
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  if (![lShoulder, rShoulder, lHip, rHip].every(Boolean)) return null;
  const shoulder = mid(lShoulder, rShoulder);
  const hip = mid(lHip, rHip);
  return deg(Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y));
}

function pelvisCenter(frame: PoseFrame) {
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  if (!lHip || !rHip) return null;
  return mid(lHip, rHip);
}

function staticFrontMetrics(frame: PoseFrame) {
  const lEar = point(frame, IDX.leftEar);
  const rEar = point(frame, IDX.rightEar);
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  const lKnee = point(frame, IDX.leftKnee);
  const rKnee = point(frame, IDX.rightKnee);
  const lAnkle = point(frame, IDX.leftAnkle);
  const rAnkle = point(frame, IDX.rightAnkle);
  if (![lEar, rEar, lShoulder, rShoulder, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle].every(Boolean)) return null;

  const width = shoulderWidth(frame);
  if (!width || width === 0) return null;

  return {
    head_tilt_deg: deg(Math.atan2(lEar.y - rEar.y, rEar.x - lEar.x)),
    shoulder_height_diff_ratio: (lShoulder.y - rShoulder.y) / width,
    pelvis_height_diff_ratio: (lHip.y - rHip.y) / width,
    trunk_lean_deg: trunkLean(frame),
    knee_center_offset_left: (lKnee.x - (lHip.x + lAnkle.x) / 2) / width,
    knee_center_offset_right: (rKnee.x - (rHip.x + rAnkle.x) / 2) / width,
    foot_width_ratio: distance(lAnkle, rAnkle) / width,
  };
}

function staticSideMetrics(frame: PoseFrame) {
  const leftScore = frameConfidence(frame, [IDX.leftEar, IDX.leftShoulder, IDX.leftHip, IDX.leftKnee, IDX.leftAnkle], 0.4);
  const rightScore = frameConfidence(frame, [IDX.rightEar, IDX.rightShoulder, IDX.rightHip, IDX.rightKnee, IDX.rightAnkle], 0.4);
  const side = leftScore >= rightScore ? 'left' : 'right';
  const ear = point(frame, side === 'left' ? IDX.leftEar : IDX.rightEar);
  const shoulder = point(frame, side === 'left' ? IDX.leftShoulder : IDX.rightShoulder);
  const hip = point(frame, side === 'left' ? IDX.leftHip : IDX.rightHip);
  const knee = point(frame, side === 'left' ? IDX.leftKnee : IDX.rightKnee);
  const ankle = point(frame, side === 'left' ? IDX.leftAnkle : IDX.rightAnkle);
  if (![ear, shoulder, hip, knee, ankle].every(Boolean)) return null;

  const torso = distance(shoulder, hip);
  const kneeAngle = angle3(hip, knee, ankle);

  return {
    craniovertebral_angle_deg: deg(Math.atan2(shoulder.y - ear.y, Math.abs(ear.x - shoulder.x))),
    head_forward_ratio: torso > 0 ? Math.abs(ear.x - shoulder.x) / torso : null,
    trunk_lean_deg: deg(Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y)),
    knee_angle_deg: kneeAngle,
    ankle_under_hip_ratio: torso > 0 ? (ankle.x - hip.x) / torso : null,
  };
}

function fppa(frame: PoseFrame, side: 'left' | 'right') {
  const hip = point(frame, side === 'left' ? IDX.leftHip : IDX.rightHip);
  const knee = point(frame, side === 'left' ? IDX.leftKnee : IDX.rightKnee);
  const ankle = point(frame, side === 'left' ? IDX.leftAnkle : IDX.rightAnkle);
  if (!hip || !knee || !ankle) return null;
  const angle = angle3(hip, knee, ankle);
  return angle == null ? null : Math.abs(180 - angle);
}

function metricAverage(frames: PoseFrame[], getter: (frame: PoseFrame) => number | null | undefined) {
  return mean(frames.map(getter));
}

function buildMetric(key: string, label: string, value: number | string | null, unit?: string, note?: string): MetricValue {
  return {
    key,
    label,
    value: typeof value === 'number' ? round(value) : value ?? 'measurement_limited',
    unit,
    note,
  };
}

function analyzeStatic(capture: TaskCapture): TaskAnalysis {
  const required = REQUIRED_STATIC;
  const ratio = highConfidenceRatio(capture.frames, required);
  const baseQuality = gradeFromRatio(ratio, capture.frames.length);
  const durationSec = capture.frames.at(-1)?.t ?? 0;
  const warnings: string[] = [];
  if (baseQuality === '測定不能') warnings.push('必要ランドマークが不足しています');
  if (durationSec < 7) warnings.push('静止測定は10秒に満たないため参考値です');

  const isSide = capture.taskId === 'side_static';
  const metrics = isSide ? analyzeStaticSideMetrics(capture.frames) : analyzeStaticFrontBackMetrics(capture.frames);

  return {
    taskId: capture.taskId,
    label: capture.label,
    quality: baseQuality,
    highConfidenceRatio: ratio,
    frameCount: capture.frames.length,
    durationSec,
    metrics,
    warnings,
  };
}

function analyzeStaticFrontBackMetrics(frames: PoseFrame[]): MetricValue[] {
  const parsed = frames.map(staticFrontMetrics).filter((item): item is NonNullable<ReturnType<typeof staticFrontMetrics>> => Boolean(item));
  return [
    buildMetric('head_tilt_deg', '頭部傾斜', mean(parsed.map((m) => m.head_tilt_deg)), 'deg'),
    buildMetric('shoulder_height_diff_ratio', '肩高差', mean(parsed.map((m) => m.shoulder_height_diff_ratio)), 'ratio', '正値は左側ランドマークが下'),
    buildMetric('pelvis_height_diff_ratio', '骨盤高差', mean(parsed.map((m) => m.pelvis_height_diff_ratio)), 'ratio', '正値は左側ランドマークが下'),
    buildMetric('trunk_lean_deg', '体幹側方傾斜', mean(parsed.map((m) => m.trunk_lean_deg)), 'deg'),
    buildMetric('knee_center_offset_left', '左膝中心オフセット', mean(parsed.map((m) => m.knee_center_offset_left)), 'ratio'),
    buildMetric('knee_center_offset_right', '右膝中心オフセット', mean(parsed.map((m) => m.knee_center_offset_right)), 'ratio'),
    buildMetric('foot_width_ratio', '足幅', mean(parsed.map((m) => m.foot_width_ratio)), 'ratio'),
  ];
}

function analyzeStaticSideMetrics(frames: PoseFrame[]): MetricValue[] {
  const parsed = frames.map(staticSideMetrics).filter((item): item is NonNullable<ReturnType<typeof staticSideMetrics>> => Boolean(item));
  return [
    buildMetric('craniovertebral_angle_deg', 'CVAプロキシ', mean(parsed.map((m) => m.craniovertebral_angle_deg)), 'deg'),
    buildMetric('head_forward_ratio', '頭部前方移動プロキシ', mean(parsed.map((m) => m.head_forward_ratio)), 'ratio'),
    buildMetric('trunk_lean_deg', '体幹前後傾斜', mean(parsed.map((m) => m.trunk_lean_deg)), 'deg'),
    buildMetric('knee_angle_deg', '膝角度プロキシ', mean(parsed.map((m) => m.knee_angle_deg)), 'deg'),
    buildMetric('ankle_under_hip_ratio', '足関節位置プロキシ', mean(parsed.map((m) => m.ankle_under_hip_ratio)), 'ratio'),
  ];
}

function movingAverage(values: number[], windowSize = 5) {
  return values.map((_, index) => {
    const start = Math.max(0, index - Math.floor(windowSize / 2));
    const end = Math.min(values.length, index + Math.ceil(windowSize / 2));
    return values.slice(start, end).reduce((sum, value) => sum + value, 0) / (end - start);
  });
}

function analyzeSitToStand(capture: TaskCapture): TaskAnalysis {
  const frames = capture.frames;
  const ratio = highConfidenceRatio(frames, REQUIRED_DYNAMIC);
  const durationSec = frames.at(-1)?.t ?? 0;
  const warnings: string[] = [];
  const usable = frames
    .map((frame) => ({ frame, pelvis: pelvisCenter(frame), scale: torsoScale(frame) }))
    .filter((item): item is { frame: PoseFrame; pelvis: PosePoint; scale: number } => Boolean(item.pelvis && item.scale && item.scale > 0));

  if (usable.length < 20) {
    return {
      taskId: capture.taskId,
      label: capture.label,
      quality: '測定不能',
      highConfidenceRatio: ratio,
      frameCount: frames.length,
      durationSec,
      metrics: [],
      warnings: ['骨盤中心または体幹スケールを取得できません'],
    };
  }

  const ySeries = movingAverage(usable.map((item) => item.pelvis.y), 7);
  const yMin = min(ySeries);
  const yMax = max(ySeries);
  const range = yMax - yMin;
  if (range < 0.035) warnings.push('骨盤上下移動が小さく、立ち座り検出が不安定です');

  const lowThreshold = yMin + range * 0.38;
  const highThreshold = yMin + range * 0.62;
  let state: 'sit' | 'stand' | 'unknown' = ySeries[0] > highThreshold ? 'sit' : ySeries[0] < lowThreshold ? 'stand' : 'unknown';
  const standTransitions: number[] = [];

  ySeries.forEach((y, index) => {
    const nextState = y > highThreshold ? 'sit' : y < lowThreshold ? 'stand' : state;
    if (state === 'sit' && nextState === 'stand') {
      const t = usable[index].frame.t;
      const previous = standTransitions.at(-1);
      if (previous == null || t - previous > 0.7) standTransitions.push(t);
    }
    state = nextState;
  });

  const repCount = standTransitions.length;
  const repTimes = standTransitions.map((time, index) => round(index === 0 ? time : time - standTransitions[index - 1], 2));
  const detectedTotal = repCount >= 5 ? standTransitions[4] : durationSec;
  const trunkPeaks = frames.map((frame) => Math.abs(trunkLean(frame) ?? 0));
  const kneePathLeft = normalizedPath(frames, IDX.leftKnee);
  const kneePathRight = normalizedPath(frames, IDX.rightKnee);
  const sway = pelvisSwayAfter(frames, standTransitions.at(-1) ?? durationSec);

  let quality = gradeFromRatio(ratio, frames.length);
  if (repCount < 3 || range < 0.025) quality = '測定不能';
  else if (repCount < 5 || range < 0.04 || ratio < 0.7) quality = quality === 'A' ? 'B' : quality;
  if (repCount < 5) warnings.push(`立ち上がり推定回数が5回未満です: ${repCount}回`);

  return {
    taskId: capture.taskId,
    label: capture.label,
    quality,
    highConfidenceRatio: ratio,
    frameCount: frames.length,
    durationSec,
    metrics: [
      buildMetric('rep_count_detected', '推定立ち上がり回数', repCount, 'count'),
      buildMetric('total_time_sec', '5回完了時間または記録時間', detectedTotal, 'sec', repCount >= 5 ? undefined : '5回未満のため記録時間'),
      buildMetric('rep_times_sec', 'rep間隔推定', repTimes.join(', '), 'sec'),
      buildMetric('hip_vertical_range_ratio', '骨盤上下移動幅', range, 'ratio'),
      buildMetric('trunk_flexion_peak_deg', '体幹前傾ピーク', max(trunkPeaks), 'deg'),
      buildMetric('knee_lateral_path_left', '左膝横移動幅', kneePathLeft, 'ratio'),
      buildMetric('knee_lateral_path_right', '右膝横移動幅', kneePathRight, 'ratio'),
      buildMetric('post_stand_sway_ratio', '最終立位後の骨盤揺れ', sway, 'ratio'),
    ],
    warnings,
  };
}

function normalizedPath(frames: PoseFrame[], index: number) {
  const xs = frames.map((frame) => point(frame, index)?.x).filter((value): value is number => Number.isFinite(value));
  const scales = frames.map(shoulderWidth).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (xs.length < 2 || scales.length === 0) return null;
  return (max(xs) - min(xs)) / (mean(scales) ?? 1);
}

function pelvisSwayAfter(frames: PoseFrame[], startTime: number) {
  const points = frames
    .filter((frame) => frame.t >= startTime && frame.t <= startTime + 1.2)
    .map(pelvisCenter)
    .filter((value): value is PosePoint => Boolean(value));
  if (points.length < 5) return null;
  const avgX = mean(points.map((p) => p.x)) ?? 0;
  const avgY = mean(points.map((p) => p.y)) ?? 0;
  const distances = points.map((p) => Math.hypot(p.x - avgX, p.y - avgY));
  return mean(distances);
}

function analyzeSquat(capture: TaskCapture): TaskAnalysis {
  const frames = capture.frames;
  const ratio = highConfidenceRatio(frames, REQUIRED_DYNAMIC);
  const durationSec = frames.at(-1)?.t ?? 0;
  const warnings: string[] = [];
  const pelvisSeries = frames
    .map((frame) => ({ frame, pelvis: pelvisCenter(frame), scale: torsoScale(frame) }))
    .filter((item): item is { frame: PoseFrame; pelvis: PosePoint; scale: number } => Boolean(item.pelvis && item.scale && item.scale > 0));

  if (pelvisSeries.length < 20) {
    return {
      taskId: capture.taskId,
      label: capture.label,
      quality: '測定不能',
      highConfidenceRatio: ratio,
      frameCount: frames.length,
      durationSec,
      metrics: [],
      warnings: ['骨盤中心または体幹スケールを取得できません'],
    };
  }

  const ySeries = movingAverage(pelvisSeries.map((item) => item.pelvis.y), 7);
  const yMin = min(ySeries);
  const yMax = max(ySeries);
  const depthRange = yMax - yMin;
  const bottoms = findPeaks(ySeries, pelvisSeries.map((item) => item.frame.t), yMin + depthRange * 0.58);

  if (depthRange < 0.035) warnings.push('骨盤上下移動が小さく、スクワット検出が不安定です');
  if (bottoms.length < 3) warnings.push(`ボトム推定が3回未満です: ${bottoms.length}回`);

  const leftFppa = frames.map((frame) => fppa(frame, 'left')).filter((value): value is number => Number.isFinite(value));
  const rightFppa = frames.map((frame) => fppa(frame, 'right')).filter((value): value is number => Number.isFinite(value));
  const trunkPeaks = frames.map((frame) => Math.abs(trunkLean(frame) ?? 0));
  const heelLiftLeft = verticalPath(frames, IDX.leftHeel);
  const heelLiftRight = verticalPath(frames, IDX.rightHeel);

  let quality = gradeFromRatio(ratio, frames.length);
  if (bottoms.length < 2 || depthRange < 0.025) quality = '測定不能';
  else if (bottoms.length < 3 || depthRange < 0.04 || ratio < 0.7) quality = quality === 'A' ? 'B' : quality;

  return {
    taskId: capture.taskId,
    label: capture.label,
    quality,
    highConfidenceRatio: ratio,
    frameCount: frames.length,
    durationSec,
    metrics: [
      buildMetric('bottom_count_detected', '推定ボトム回数', bottoms.length, 'count'),
      buildMetric('squat_depth_ratio', 'しゃがみ深さ', depthRange, 'ratio'),
      buildMetric('fppa_left_deg', '左FPPA最大', leftFppa.length ? max(leftFppa) : null, 'deg'),
      buildMetric('fppa_right_deg', '右FPPA最大', rightFppa.length ? max(rightFppa) : null, 'deg'),
      buildMetric('trunk_lean_peak_deg', '体幹傾斜ピーク', max(trunkPeaks), 'deg'),
      buildMetric('heel_lift_proxy_left', '左踵上下移動', heelLiftLeft, 'ratio'),
      buildMetric('heel_lift_proxy_right', '右踵上下移動', heelLiftRight, 'ratio'),
    ],
    warnings,
  };
}

function findPeaks(values: number[], times: number[], threshold: number) {
  const peaks: number[] = [];
  for (let i = 1; i < values.length - 1; i += 1) {
    const isPeak = values[i] >= threshold && values[i] >= values[i - 1] && values[i] >= values[i + 1];
    if (!isPeak) continue;
    const t = times[i];
    const previous = peaks.at(-1);
    if (previous == null || t - previous > 1.2) peaks.push(t);
  }
  return peaks;
}

function verticalPath(frames: PoseFrame[], index: number) {
  const ys = frames.map((frame) => point(frame, index)?.y).filter((value): value is number => Number.isFinite(value));
  const scales = frames.map(shoulderWidth).filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (ys.length < 2 || scales.length === 0) return null;
  return (max(ys) - min(ys)) / (mean(scales) ?? 1);
}

function worstQuality(grades: QualityGrade[]): QualityGrade {
  if (grades.includes('測定不能')) return '測定不能';
  if (grades.includes('C')) return 'C';
  if (grades.includes('B')) return 'B';
  return grades.length ? 'A' : '測定不能';
}

export function analyzeSession(captures: Partial<Record<TaskId, TaskCapture>>): SessionAnalysis {
  const analyses = TASKS.flatMap((task) => {
    const capture = captures[task.id];
    if (!capture) return [];
    if (task.id === 'sit_to_stand') return analyzeSitToStand(capture);
    if (task.id === 'squat') return analyzeSquat(capture);
    return analyzeStatic(capture);
  });
  const warnings = analyses.flatMap((analysis) => analysis.warnings.map((warning) => `${analysis.label}: ${warning}`));
  return {
    createdAt: new Date().toISOString(),
    protocolVersion: 'posture_motion_lab_v0.1',
    overallQuality: worstQuality(analyses.map((analysis) => analysis.quality)),
    analyses,
    warnings,
  };
}
