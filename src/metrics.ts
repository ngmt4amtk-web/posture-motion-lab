import { PROTOCOL_VERSION, TASKS } from './protocol';
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

const REQUIRED_SIDE_LEFT = [IDX.leftEar, IDX.leftShoulder, IDX.leftHip, IDX.leftKnee, IDX.leftAnkle];
const REQUIRED_SIDE_RIGHT = [IDX.rightEar, IDX.rightShoulder, IDX.rightHip, IDX.rightKnee, IDX.rightAnkle];

function deg(rad: number) {
  return (rad * 180) / Math.PI;
}

function round(value: number, digits = 3) {
  const unit = 10 ** digits;
  return Math.round(value * unit) / unit;
}

function normalizeAxisAngle(angle: number) {
  let normalized = angle;
  while (normalized > 90) normalized -= 180;
  while (normalized < -90) normalized += 180;
  return normalized;
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

function sideFrameConfidence(frame: PoseFrame, threshold = 0.5) {
  return Math.max(
    frameConfidence(frame, REQUIRED_SIDE_LEFT, threshold),
    frameConfidence(frame, REQUIRED_SIDE_RIGHT, threshold),
  );
}

function highSideConfidenceRatio(frames: PoseFrame[], threshold = 0.5) {
  if (frames.length === 0) return 0;
  const high = frames.filter((frame) => sideFrameConfidence(frame, threshold) >= 0.92).length;
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

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg == null) return null;
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return variance == null ? null : Math.sqrt(variance);
}

function coefficientOfVariation(values: number[]) {
  if (values.length < 2) return null;
  const avg = mean(values);
  const sd = standardDeviation(values);
  if (avg == null || sd == null || Math.abs(avg) < 0.000001) return null;
  return sd / Math.abs(avg);
}

function percentile(values: number[], q: number) {
  const xs = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const index = (xs.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return xs[lower];
  const weight = index - lower;
  return xs[lower] * (1 - weight) + xs[upper] * weight;
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  let best: string | null = null;
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  });
  return best;
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
  const shoulderCenter = mid(lShoulder, rShoulder);
  const hipCenter = mid(lHip, rHip);
  const kneeCenter = mid(lKnee, rKnee);
  const ankleCenter = mid(lAnkle, rAnkle);
  const ankleWidth = distance(lAnkle, rAnkle);

  return {
    head_tilt_deg: normalizeAxisAngle(deg(Math.atan2(lEar.y - rEar.y, rEar.x - lEar.x))),
    shoulder_height_diff_ratio: (lShoulder.y - rShoulder.y) / width,
    pelvis_height_diff_ratio: (lHip.y - rHip.y) / width,
    trunk_lean_deg: trunkLean(frame),
    shoulder_over_feet_offset_ratio: (shoulderCenter.x - ankleCenter.x) / width,
    pelvis_over_feet_offset_ratio: (hipCenter.x - ankleCenter.x) / width,
    knee_midline_over_feet_offset_ratio: (kneeCenter.x - ankleCenter.x) / width,
    knee_center_offset_left: (lKnee.x - (lHip.x + lAnkle.x) / 2) / width,
    knee_center_offset_right: (rKnee.x - (rHip.x + rAnkle.x) / 2) / width,
    knee_width_ratio: distance(lKnee, rKnee) / width,
    knee_to_foot_width_ratio: ankleWidth > 0 ? distance(lKnee, rKnee) / ankleWidth : null,
    foot_width_ratio: distance(lAnkle, rAnkle) / width,
  };
}

function sidePoints(frame: PoseFrame) {
  const leftScore = frameConfidence(frame, [IDX.leftEar, IDX.leftShoulder, IDX.leftHip, IDX.leftKnee, IDX.leftAnkle], 0.4);
  const rightScore = frameConfidence(frame, [IDX.rightEar, IDX.rightShoulder, IDX.rightHip, IDX.rightKnee, IDX.rightAnkle], 0.4);
  const side = leftScore >= rightScore ? 'left' : 'right';
  const ear = point(frame, side === 'left' ? IDX.leftEar : IDX.rightEar);
  const shoulder = point(frame, side === 'left' ? IDX.leftShoulder : IDX.rightShoulder);
  const hip = point(frame, side === 'left' ? IDX.leftHip : IDX.rightHip);
  const knee = point(frame, side === 'left' ? IDX.leftKnee : IDX.rightKnee);
  const ankle = point(frame, side === 'left' ? IDX.leftAnkle : IDX.rightAnkle);
  const heel = point(frame, side === 'left' ? IDX.leftHeel : IDX.rightHeel);
  const foot = point(frame, side === 'left' ? IDX.leftFoot : IDX.rightFoot);
  if (![ear, shoulder, hip, knee, ankle].every(Boolean)) return null;
  const torso = distance(shoulder, hip);
  if (!torso || torso === 0) return null;
  return { side, ear, shoulder, hip, knee, ankle, heel, foot, torso };
}

function staticSideMetrics(frame: PoseFrame) {
  const p = sidePoints(frame);
  if (!p) return null;

  const kneeAngle = angle3(p.hip, p.knee, p.ankle);
  const hipAngle = angle3(p.shoulder, p.hip, p.knee);
  const ankleAngle = p.foot ? angle3(p.knee, p.ankle, p.foot) : null;
  const earShoulderOffset = Math.abs(p.ear.x - p.shoulder.x) / p.torso;
  const shoulderHipOffset = Math.abs(p.shoulder.x - p.hip.x) / p.torso;
  const hipAnkleOffset = Math.abs(p.hip.x - p.ankle.x) / p.torso;
  const kneeAnkleOffset = Math.abs(p.knee.x - p.ankle.x) / p.torso;

  return {
    side_used: p.side,
    craniovertebral_angle_deg: deg(Math.atan2(p.shoulder.y - p.ear.y, Math.abs(p.ear.x - p.shoulder.x))),
    head_forward_ratio: earShoulderOffset,
    trunk_lean_deg: deg(Math.atan2(p.shoulder.x - p.hip.x, p.hip.y - p.shoulder.y)),
    shoulder_hip_offset_ratio: shoulderHipOffset,
    hip_ankle_offset_ratio: hipAnkleOffset,
    knee_ankle_offset_ratio: kneeAnkleOffset,
    sagittal_stack_error_ratio: earShoulderOffset + shoulderHipOffset + hipAnkleOffset,
    knee_angle_deg: kneeAngle,
    hip_angle_deg: hipAngle,
    ankle_angle_deg: ankleAngle,
    ankle_under_hip_ratio: (p.ankle.x - p.hip.x) / p.torso,
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

function metricAroundTime(frames: PoseFrame[], timeSec: number, windowSec: number, getter: (frame: PoseFrame) => number | null | undefined) {
  return mean(
    frames
      .filter((frame) => Math.abs(frame.t - timeSec) <= windowSec)
      .map(getter),
  );
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
  const isSide = capture.taskId === 'side_static';
  const ratio = isSide ? highSideConfidenceRatio(capture.frames) : highConfidenceRatio(capture.frames, REQUIRED_STATIC);
  const baseQuality = gradeFromRatio(ratio, capture.frames.length);
  const durationSec = capture.frames.at(-1)?.t ?? 0;
  const warnings: string[] = [];
  if (baseQuality === '測定不能') warnings.push('必要ランドマークが不足しています');
  if (durationSec < 7) warnings.push('静止測定は10秒に満たないため参考値です');

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
    buildMetric('shoulder_over_feet_offset_ratio', '肩中心-足中心ずれ', mean(parsed.map((m) => m.shoulder_over_feet_offset_ratio)), 'ratio'),
    buildMetric('pelvis_over_feet_offset_ratio', '骨盤中心-足中心ずれ', mean(parsed.map((m) => m.pelvis_over_feet_offset_ratio)), 'ratio'),
    buildMetric('knee_midline_over_feet_offset_ratio', '膝中心-足中心ずれ', mean(parsed.map((m) => m.knee_midline_over_feet_offset_ratio)), 'ratio'),
    buildMetric('knee_center_offset_left', '左膝中心オフセット', mean(parsed.map((m) => m.knee_center_offset_left)), 'ratio'),
    buildMetric('knee_center_offset_right', '右膝中心オフセット', mean(parsed.map((m) => m.knee_center_offset_right)), 'ratio'),
    buildMetric('knee_width_ratio', '膝幅', mean(parsed.map((m) => m.knee_width_ratio)), 'ratio'),
    buildMetric('knee_to_foot_width_ratio', '膝幅/足幅', mean(parsed.map((m) => m.knee_to_foot_width_ratio)), 'ratio'),
    buildMetric('foot_width_ratio', '足幅', mean(parsed.map((m) => m.foot_width_ratio)), 'ratio'),
  ];
}

function analyzeStaticSideMetrics(frames: PoseFrame[]): MetricValue[] {
  const parsed = frames.map(staticSideMetrics).filter((item): item is NonNullable<ReturnType<typeof staticSideMetrics>> => Boolean(item));
  return [
    buildMetric('side_used', '側面採用側', mode(parsed.map((m) => m.side_used)) ?? 'unknown'),
    buildMetric('craniovertebral_angle_deg', 'CVAプロキシ', mean(parsed.map((m) => m.craniovertebral_angle_deg)), 'deg'),
    buildMetric('head_forward_ratio', '頭部前方移動プロキシ', mean(parsed.map((m) => m.head_forward_ratio)), 'ratio'),
    buildMetric('trunk_lean_deg', '体幹前後傾斜', mean(parsed.map((m) => m.trunk_lean_deg)), 'deg'),
    buildMetric('shoulder_hip_offset_ratio', '肩-股関節前後ずれ', mean(parsed.map((m) => m.shoulder_hip_offset_ratio)), 'ratio', '絶対値。体幹長で正規化'),
    buildMetric('hip_ankle_offset_ratio', '股関節-足首前後ずれ', mean(parsed.map((m) => m.hip_ankle_offset_ratio)), 'ratio', '絶対値。体幹長で正規化'),
    buildMetric('knee_ankle_offset_ratio', '膝-足首前後ずれ', mean(parsed.map((m) => m.knee_ankle_offset_ratio)), 'ratio', '絶対値。体幹長で正規化'),
    buildMetric('sagittal_stack_error_ratio', '矢状面スタック誤差', mean(parsed.map((m) => m.sagittal_stack_error_ratio)), 'ratio', '耳-肩、肩-股関節、股関節-足首の横ずれ合計'),
    buildMetric('knee_angle_deg', '膝角度プロキシ', mean(parsed.map((m) => m.knee_angle_deg)), 'deg'),
    buildMetric('hip_angle_deg', '股関節角度プロキシ', mean(parsed.map((m) => m.hip_angle_deg)), 'deg'),
    buildMetric('ankle_angle_deg', '足関節角度プロキシ', mean(parsed.map((m) => m.ankle_angle_deg)), 'deg'),
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
  const kneePathDiff = kneePathLeft != null && kneePathRight != null ? Math.abs(kneePathLeft - kneePathRight) : null;
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
      buildMetric('rep_time_cv', 'rep間隔ばらつきCV', coefficientOfVariation(repTimes), 'ratio'),
      buildMetric('hip_vertical_range_ratio', '骨盤上下移動幅', range, 'ratio'),
      buildMetric('trunk_flexion_peak_deg', '体幹前傾ピーク', max(trunkPeaks), 'deg'),
      buildMetric('trunk_flexion_p95_deg', '体幹前傾95パーセンタイル', percentile(trunkPeaks, 0.95), 'deg', '一瞬の誤検出を避けるための補助値'),
      buildMetric('knee_lateral_path_left', '左膝横移動幅', kneePathLeft, 'ratio'),
      buildMetric('knee_lateral_path_right', '右膝横移動幅', kneePathRight, 'ratio'),
      buildMetric('knee_lateral_path_diff', '膝横移動幅左右差', kneePathDiff, 'ratio'),
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
  const bottomFppaPairs = bottoms
    .map((time) => ({
      left: metricAroundTime(frames, time, 0.35, (frame) => fppa(frame, 'left')),
      right: metricAroundTime(frames, time, 0.35, (frame) => fppa(frame, 'right')),
    }))
    .filter((value): value is { left: number; right: number } => Number.isFinite(value.left) && Number.isFinite(value.right));
  const bottomFppaLeft = bottomFppaPairs.map((value) => value.left);
  const bottomFppaRight = bottomFppaPairs.map((value) => value.right);
  const bottomFppaDiff = bottomFppaPairs.map((value) => Math.abs(value.left - value.right));
  const bottomKneeLeft = bottoms.map((time) => metricAroundTime(frames, time, 0.35, (frame) => angle3(point(frame, IDX.leftHip), point(frame, IDX.leftKnee), point(frame, IDX.leftAnkle)))).filter((value): value is number => Number.isFinite(value));
  const bottomKneeRight = bottoms.map((time) => metricAroundTime(frames, time, 0.35, (frame) => angle3(point(frame, IDX.rightHip), point(frame, IDX.rightKnee), point(frame, IDX.rightAnkle)))).filter((value): value is number => Number.isFinite(value));
  const trunkPeaks = frames.map((frame) => Math.abs(trunkLean(frame) ?? 0));
  const bottomTrunkLean = bottoms.map((time) => metricAroundTime(frames, time, 0.35, (frame) => Math.abs(trunkLean(frame) ?? 0))).filter((value): value is number => Number.isFinite(value));
  const heelLiftLeft = verticalPath(frames, IDX.leftHeel);
  const heelLiftRight = verticalPath(frames, IDX.rightHeel);
  const kneePathLeft = normalizedPath(frames, IDX.leftKnee);
  const kneePathRight = normalizedPath(frames, IDX.rightKnee);
  const meanScale = mean(pelvisSeries.map((item) => item.scale));
  const normalizedDepth = meanScale && meanScale > 0 ? depthRange / meanScale : null;

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
      buildMetric('bottom_times_sec', 'ボトム推定時刻', bottoms.map((time) => round(time, 2)).join(', '), 'sec'),
      buildMetric('squat_depth_ratio', 'しゃがみ深さ', depthRange, 'ratio'),
      buildMetric('squat_depth_torso_ratio', 'しゃがみ深さ/体幹長', normalizedDepth, 'ratio'),
      buildMetric('fppa_left_deg', '左FPPA最大', leftFppa.length ? max(leftFppa) : null, 'deg'),
      buildMetric('fppa_right_deg', '右FPPA最大', rightFppa.length ? max(rightFppa) : null, 'deg'),
      buildMetric('bottom_fppa_left_deg', 'ボトム左FPPA平均', mean(bottomFppaLeft), 'deg'),
      buildMetric('bottom_fppa_right_deg', 'ボトム右FPPA平均', mean(bottomFppaRight), 'deg'),
      buildMetric('bottom_fppa_diff_deg', 'ボトムFPPA左右差', mean(bottomFppaDiff), 'deg'),
      buildMetric('bottom_knee_angle_left_deg', 'ボトム左膝角度', mean(bottomKneeLeft), 'deg'),
      buildMetric('bottom_knee_angle_right_deg', 'ボトム右膝角度', mean(bottomKneeRight), 'deg'),
      buildMetric('trunk_lean_peak_deg', '体幹傾斜ピーク', max(trunkPeaks), 'deg'),
      buildMetric('trunk_lean_p95_deg', '体幹傾斜95パーセンタイル', percentile(trunkPeaks, 0.95), 'deg'),
      buildMetric('bottom_trunk_lean_deg', 'ボトム体幹傾斜平均', mean(bottomTrunkLean), 'deg'),
      buildMetric('knee_lateral_path_left', '左膝横移動幅', kneePathLeft, 'ratio'),
      buildMetric('knee_lateral_path_right', '右膝横移動幅', kneePathRight, 'ratio'),
      buildMetric('heel_lift_proxy_left', '左踵上下移動', heelLiftLeft, 'ratio'),
      buildMetric('heel_lift_proxy_right', '右踵上下移動', heelLiftRight, 'ratio'),
    ],
    warnings,
  };
}

function sideVerticalPath(frames: PoseFrame[], getter: (points: NonNullable<ReturnType<typeof sidePoints>>) => PosePoint | undefined) {
  const usable = frames
    .map((frame) => ({ points: sidePoints(frame) }))
    .filter((item): item is { points: NonNullable<ReturnType<typeof sidePoints>> } => Boolean(item.points));
  const ys = usable.map((item) => getter(item.points)?.y).filter((value): value is number => Number.isFinite(value));
  const scales = usable.map((item) => item.points.torso).filter((value) => Number.isFinite(value) && value > 0);
  if (ys.length < 2 || scales.length === 0) return null;
  return (max(ys) - min(ys)) / (mean(scales) ?? 1);
}

function analyzeSideSquat(capture: TaskCapture): TaskAnalysis {
  const frames = capture.frames;
  const ratio = highSideConfidenceRatio(frames);
  const durationSec = frames.at(-1)?.t ?? 0;
  const warnings: string[] = [];
  const usable = frames
    .map((frame) => ({ frame, points: sidePoints(frame) }))
    .filter((item): item is { frame: PoseFrame; points: NonNullable<ReturnType<typeof sidePoints>> } => Boolean(item.points));

  if (usable.length < 20) {
    return {
      taskId: capture.taskId,
      label: capture.label,
      quality: '測定不能',
      highConfidenceRatio: ratio,
      frameCount: frames.length,
      durationSec,
      metrics: [],
      warnings: ['側面の耳・肩・股関節・膝・足首を取得できません'],
    };
  }

  const ySeries = movingAverage(usable.map((item) => item.points.hip.y), 7);
  const yMin = min(ySeries);
  const yMax = max(ySeries);
  const depthRange = yMax - yMin;
  const bottoms = findPeaks(ySeries, usable.map((item) => item.frame.t), yMin + depthRange * 0.58);
  const meanScale = mean(usable.map((item) => item.points.torso));
  const normalizedDepth = meanScale && meanScale > 0 ? depthRange / meanScale : null;

  if (depthRange < 0.035) warnings.push('股関節上下移動が小さく、側面スクワット検出が不安定です');
  if (bottoms.length < 3) warnings.push(`ボトム推定が3回未満です: ${bottoms.length}回`);

  const side = mode(usable.map((item) => item.points.side)) ?? 'unknown';
  const trunkLeanValues = usable.map((item) => Math.abs(deg(Math.atan2(item.points.shoulder.x - item.points.hip.x, item.points.hip.y - item.points.shoulder.y))));
  const kneeAngles = usable.map((item) => angle3(item.points.hip, item.points.knee, item.points.ankle)).filter((value): value is number => Number.isFinite(value));
  const hipAngles = usable.map((item) => angle3(item.points.shoulder, item.points.hip, item.points.knee)).filter((value): value is number => Number.isFinite(value));
  const ankleAngles = usable.map((item) => (item.points.foot ? angle3(item.points.knee, item.points.ankle, item.points.foot) : null)).filter((value): value is number => Number.isFinite(value));
  const kneeAnkleOffsets = usable.map((item) => Math.abs(item.points.knee.x - item.points.ankle.x) / item.points.torso);
  const hipAnkleOffsets = usable.map((item) => Math.abs(item.points.hip.x - item.points.ankle.x) / item.points.torso);
  const stackErrors = usable.map((item) => (
    Math.abs(item.points.ear.x - item.points.shoulder.x)
    + Math.abs(item.points.shoulder.x - item.points.hip.x)
    + Math.abs(item.points.hip.x - item.points.ankle.x)
  ) / item.points.torso);
  const bottomKneeAngles = bottoms.map((time) => metricAroundTime(frames, time, 0.35, (frame) => {
    const p = sidePoints(frame);
    return p ? angle3(p.hip, p.knee, p.ankle) : null;
  })).filter((value): value is number => Number.isFinite(value));
  const bottomHipAngles = bottoms.map((time) => metricAroundTime(frames, time, 0.35, (frame) => {
    const p = sidePoints(frame);
    return p ? angle3(p.shoulder, p.hip, p.knee) : null;
  })).filter((value): value is number => Number.isFinite(value));
  const bottomKneeAnkleOffsets = bottoms.map((time) => metricAroundTime(frames, time, 0.35, (frame) => {
    const p = sidePoints(frame);
    return p ? Math.abs(p.knee.x - p.ankle.x) / p.torso : null;
  })).filter((value): value is number => Number.isFinite(value));
  const heelLift = sideVerticalPath(frames, (points) => points.heel);

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
      buildMetric('side_used', '側面採用側', side),
      buildMetric('bottom_count_detected', '推定ボトム回数', bottoms.length, 'count'),
      buildMetric('bottom_times_sec', 'ボトム推定時刻', bottoms.map((time) => round(time, 2)).join(', '), 'sec'),
      buildMetric('squat_depth_ratio', 'しゃがみ深さ', depthRange, 'ratio'),
      buildMetric('squat_depth_torso_ratio', 'しゃがみ深さ/体幹長', normalizedDepth, 'ratio'),
      buildMetric('trunk_lean_peak_deg', '体幹前傾ピーク', max(trunkLeanValues), 'deg'),
      buildMetric('trunk_lean_p95_deg', '体幹前傾95パーセンタイル', percentile(trunkLeanValues, 0.95), 'deg'),
      buildMetric('knee_angle_min_deg', '膝角度最小', kneeAngles.length ? min(kneeAngles) : null, 'deg'),
      buildMetric('hip_angle_min_deg', '股関節角度最小', hipAngles.length ? min(hipAngles) : null, 'deg'),
      buildMetric('ankle_angle_min_deg', '足関節角度最小', ankleAngles.length ? min(ankleAngles) : null, 'deg'),
      buildMetric('knee_ankle_offset_peak_ratio', '膝-足首前後ずれピーク', max(kneeAnkleOffsets), 'ratio'),
      buildMetric('hip_ankle_offset_peak_ratio', '股関節-足首前後ずれピーク', max(hipAnkleOffsets), 'ratio'),
      buildMetric('sagittal_stack_error_peak_ratio', '矢状面スタック誤差ピーク', max(stackErrors), 'ratio'),
      buildMetric('bottom_knee_angle_deg', 'ボトム膝角度平均', mean(bottomKneeAngles), 'deg'),
      buildMetric('bottom_hip_angle_deg', 'ボトム股関節角度平均', mean(bottomHipAngles), 'deg'),
      buildMetric('bottom_knee_ankle_offset_ratio', 'ボトム膝-足首前後ずれ', mean(bottomKneeAnkleOffsets), 'ratio'),
      buildMetric('heel_lift_proxy', '踵上下移動', heelLift, 'ratio'),
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
    if (task.id === 'side_squat') return analyzeSideSquat(capture);
    return analyzeStatic(capture);
  });
  const warnings = analyses.flatMap((analysis) => analysis.warnings.map((warning) => `${analysis.label}: ${warning}`));
  return {
    createdAt: new Date().toISOString(),
    protocolVersion: PROTOCOL_VERSION,
    overallQuality: worstQuality(analyses.map((analysis) => analysis.quality)),
    analyses,
    warnings,
  };
}
