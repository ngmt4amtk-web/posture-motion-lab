import { PROTOCOL_VERSION } from './protocol';
import type { AppSettings, PoseFrame, PosePoint, SessionAnalysis, TaskCapture, TaskId } from './types';

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

const DETAIL_HEADERS = [
  'frame',
  't_sec',
  'required_confidence',
  'nose_v',
  'left_ear_v',
  'right_ear_v',
  'left_shoulder_v',
  'right_shoulder_v',
  'left_hip_v',
  'right_hip_v',
  'left_knee_v',
  'right_knee_v',
  'left_ankle_v',
  'right_ankle_v',
  'side_used',
  'head_tilt_deg',
  'shoulder_height_diff_ratio',
  'pelvis_height_diff_ratio',
  'trunk_lean_deg',
  'shoulder_over_feet_offset_ratio',
  'pelvis_over_feet_offset_ratio',
  'knee_midline_over_feet_offset_ratio',
  'craniovertebral_angle_deg',
  'head_forward_ratio',
  'side_shoulder_hip_offset_ratio',
  'side_hip_ankle_offset_ratio',
  'side_knee_ankle_offset_ratio',
  'side_stack_error_ratio',
  'side_hip_angle_deg',
  'side_ankle_angle_deg',
  'left_knee_angle_deg',
  'right_knee_angle_deg',
  'left_fppa_deg',
  'right_fppa_deg',
  'pelvis_x',
  'pelvis_y',
  'left_knee_x',
  'right_knee_x',
  'left_knee_y',
  'right_knee_y',
  'left_ankle_x',
  'right_ankle_x',
  'left_heel_y',
  'right_heel_y',
  'foot_width_ratio',
  'torso_scale',
];

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

function dateStamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}`;
}

function valueLine(label: string, value: number | string, unit?: string) {
  return `- ${label}: ${value}${unit ? ` ${unit}` : ''}`;
}

function deg(rad: number) {
  return (rad * 180) / Math.PI;
}

function normalizeAxisAngle(angle: number) {
  let normalized = angle;
  while (normalized > 90) normalized -= 180;
  while (normalized < -90) normalized += 180;
  return normalized;
}

function fmt(value: number | string | null | undefined, digits = 5) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '';
  return value.toFixed(digits);
}

function point(frame: PoseFrame, index: number) {
  return frame.landmarks[index];
}

function visibility(frame: PoseFrame, index: number) {
  return point(frame, index)?.visibility ?? null;
}

function visible(lm: PosePoint | undefined, threshold = 0.5) {
  return Boolean(lm) && (lm?.visibility == null || lm.visibility >= threshold);
}

function frameConfidence(frame: PoseFrame, required: number[]) {
  const passed = required.filter((index) => visible(point(frame, index), 0.5)).length;
  return required.length > 0 ? passed / required.length : 0;
}

function distance(a: PosePoint, b: PosePoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: PosePoint, b: PosePoint): PosePoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: undefined,
  };
}

function angle3(a: PosePoint | undefined, b: PosePoint | undefined, c: PosePoint | undefined) {
  if (!a || !b || !c) return null;
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };
  const dot = ba.x * bc.x + ba.y * bc.y;
  const magBA = Math.hypot(ba.x, ba.y);
  const magBC = Math.hypot(bc.x, bc.y);
  if (magBA === 0 || magBC === 0) return null;
  const cosine = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return deg(Math.acos(cosine));
}

function shoulderWidth(frame: PoseFrame) {
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  if (!lShoulder || !rShoulder) return null;
  return distance(lShoulder, rShoulder);
}

function torsoScale(frame: PoseFrame) {
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  if (!lShoulder || !rShoulder || !lHip || !rHip) return null;
  return distance(mid(lShoulder, rShoulder), mid(lHip, rHip));
}

function pelvisCenter(frame: PoseFrame) {
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  if (!lHip || !rHip) return null;
  return mid(lHip, rHip);
}

function trunkLean(frame: PoseFrame) {
  const lShoulder = point(frame, IDX.leftShoulder);
  const rShoulder = point(frame, IDX.rightShoulder);
  const lHip = point(frame, IDX.leftHip);
  const rHip = point(frame, IDX.rightHip);
  if (!lShoulder || !rShoulder || !lHip || !rHip) return null;
  const shoulder = mid(lShoulder, rShoulder);
  const hip = mid(lHip, rHip);
  return deg(Math.atan2(shoulder.x - hip.x, hip.y - shoulder.y));
}

function fppa(frame: PoseFrame, side: 'left' | 'right') {
  const hip = point(frame, side === 'left' ? IDX.leftHip : IDX.rightHip);
  const knee = point(frame, side === 'left' ? IDX.leftKnee : IDX.rightKnee);
  const ankle = point(frame, side === 'left' ? IDX.leftAnkle : IDX.rightAnkle);
  const angle = angle3(hip, knee, ankle);
  return angle == null ? null : Math.abs(180 - angle);
}

function sideChoice(frame: PoseFrame) {
  const leftScore = frameConfidence(frame, REQUIRED_SIDE_LEFT);
  const rightScore = frameConfidence(frame, REQUIRED_SIDE_RIGHT);
  return leftScore >= rightScore ? 'left' : 'right';
}

function sideRequiredConfidence(frame: PoseFrame) {
  return Math.max(frameConfidence(frame, REQUIRED_SIDE_LEFT), frameConfidence(frame, REQUIRED_SIDE_RIGHT));
}

function frameDetailRow(taskId: TaskId, frame: PoseFrame, index: number) {
  const width = shoulderWidth(frame);
  const torso = torsoScale(frame);
  const pelvis = pelvisCenter(frame);
  const side = sideChoice(frame);
  const ear = point(frame, side === 'left' ? IDX.leftEar : IDX.rightEar);
  const shoulder = point(frame, side === 'left' ? IDX.leftShoulder : IDX.rightShoulder);
  const hip = point(frame, side === 'left' ? IDX.leftHip : IDX.rightHip);
  const knee = point(frame, side === 'left' ? IDX.leftKnee : IDX.rightKnee);
  const ankle = point(frame, side === 'left' ? IDX.leftAnkle : IDX.rightAnkle);
  const foot = point(frame, side === 'left' ? IDX.leftFoot : IDX.rightFoot);
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

  const headTilt = lEar && rEar ? normalizeAxisAngle(deg(Math.atan2(lEar.y - rEar.y, rEar.x - lEar.x))) : null;
  const shoulderDiff = lShoulder && rShoulder && width ? (lShoulder.y - rShoulder.y) / width : null;
  const pelvisDiff = lHip && rHip && width ? (lHip.y - rHip.y) / width : null;
  const cva = ear && shoulder ? deg(Math.atan2(shoulder.y - ear.y, Math.abs(ear.x - shoulder.x))) : null;
  const headForward = ear && shoulder && hip && torso ? Math.abs(ear.x - shoulder.x) / torso : null;
  const isSideTask = taskId === 'side_static' || taskId === 'side_squat';
  const required = taskId === 'sit_to_stand' || taskId === 'squat' ? REQUIRED_DYNAMIC : REQUIRED_STATIC;
  const requiredConfidence = isSideTask ? sideRequiredConfidence(frame) : frameConfidence(frame, required);
  const footWidth = lAnkle && rAnkle && width ? distance(lAnkle, rAnkle) / width : null;
  const shoulderCenter = lShoulder && rShoulder ? mid(lShoulder, rShoulder) : null;
  const kneeCenter = lKnee && rKnee ? mid(lKnee, rKnee) : null;
  const ankleCenter = lAnkle && rAnkle ? mid(lAnkle, rAnkle) : null;
  const shoulderOverFeet = shoulderCenter && ankleCenter && width ? (shoulderCenter.x - ankleCenter.x) / width : null;
  const pelvisOverFeet = pelvis && ankleCenter && width ? (pelvis.x - ankleCenter.x) / width : null;
  const kneeMidlineOverFeet = kneeCenter && ankleCenter && width ? (kneeCenter.x - ankleCenter.x) / width : null;
  const sideShoulderHip = shoulder && hip && torso ? Math.abs(shoulder.x - hip.x) / torso : null;
  const sideHipAnkle = hip && ankle && torso ? Math.abs(hip.x - ankle.x) / torso : null;
  const sideKneeAnkle = knee && ankle && torso ? Math.abs(knee.x - ankle.x) / torso : null;
  const sideStack = headForward != null && sideShoulderHip != null && sideHipAnkle != null ? headForward + sideShoulderHip + sideHipAnkle : null;
  const sideHipAngle = angle3(shoulder, hip, knee);
  const sideAnkleAngle = angle3(knee, ankle, foot);

  const row: Record<string, string> = {
    frame: String(index),
    t_sec: fmt(frame.t, 4),
    required_confidence: fmt(requiredConfidence, 3),
    nose_v: fmt(visibility(frame, IDX.nose), 3),
    left_ear_v: fmt(visibility(frame, IDX.leftEar), 3),
    right_ear_v: fmt(visibility(frame, IDX.rightEar), 3),
    left_shoulder_v: fmt(visibility(frame, IDX.leftShoulder), 3),
    right_shoulder_v: fmt(visibility(frame, IDX.rightShoulder), 3),
    left_hip_v: fmt(visibility(frame, IDX.leftHip), 3),
    right_hip_v: fmt(visibility(frame, IDX.rightHip), 3),
    left_knee_v: fmt(visibility(frame, IDX.leftKnee), 3),
    right_knee_v: fmt(visibility(frame, IDX.rightKnee), 3),
    left_ankle_v: fmt(visibility(frame, IDX.leftAnkle), 3),
    right_ankle_v: fmt(visibility(frame, IDX.rightAnkle), 3),
    side_used: taskId === 'side_static' ? side : '',
    head_tilt_deg: fmt(headTilt),
    shoulder_height_diff_ratio: fmt(shoulderDiff),
    pelvis_height_diff_ratio: fmt(pelvisDiff),
    trunk_lean_deg: fmt(trunkLean(frame)),
    shoulder_over_feet_offset_ratio: fmt(shoulderOverFeet),
    pelvis_over_feet_offset_ratio: fmt(pelvisOverFeet),
    knee_midline_over_feet_offset_ratio: fmt(kneeMidlineOverFeet),
    craniovertebral_angle_deg: fmt(cva),
    head_forward_ratio: fmt(headForward),
    side_shoulder_hip_offset_ratio: fmt(sideShoulderHip),
    side_hip_ankle_offset_ratio: fmt(sideHipAnkle),
    side_knee_ankle_offset_ratio: fmt(sideKneeAnkle),
    side_stack_error_ratio: fmt(sideStack),
    side_hip_angle_deg: fmt(sideHipAngle),
    side_ankle_angle_deg: fmt(sideAnkleAngle),
    left_knee_angle_deg: fmt(angle3(point(frame, IDX.leftHip), point(frame, IDX.leftKnee), point(frame, IDX.leftAnkle))),
    right_knee_angle_deg: fmt(angle3(point(frame, IDX.rightHip), point(frame, IDX.rightKnee), point(frame, IDX.rightAnkle))),
    left_fppa_deg: fmt(fppa(frame, 'left')),
    right_fppa_deg: fmt(fppa(frame, 'right')),
    pelvis_x: fmt(pelvis?.x),
    pelvis_y: fmt(pelvis?.y),
    left_knee_x: fmt(point(frame, IDX.leftKnee)?.x),
    right_knee_x: fmt(point(frame, IDX.rightKnee)?.x),
    left_knee_y: fmt(point(frame, IDX.leftKnee)?.y),
    right_knee_y: fmt(point(frame, IDX.rightKnee)?.y),
    left_ankle_x: fmt(point(frame, IDX.leftAnkle)?.x),
    right_ankle_x: fmt(point(frame, IDX.rightAnkle)?.x),
    left_heel_y: fmt(point(frame, IDX.leftHeel)?.y),
    right_heel_y: fmt(point(frame, IDX.rightHeel)?.y),
    foot_width_ratio: fmt(footWidth),
    torso_scale: fmt(torso),
  };

  if (!isSideTask) {
    row.craniovertebral_angle_deg = '';
    row.head_forward_ratio = '';
    row.side_shoulder_hip_offset_ratio = '';
    row.side_hip_ankle_offset_ratio = '';
    row.side_knee_ankle_offset_ratio = '';
    row.side_stack_error_ratio = '';
    row.side_hip_angle_deg = '';
    row.side_ankle_angle_deg = '';
    row.side_used = '';
  }
  return row;
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function frameCsv(taskId: TaskId, frames: PoseFrame[]) {
  const lines = [DETAIL_HEADERS.join(',')];
  frames.forEach((frame, index) => {
    const row = frameDetailRow(taskId, frame, index);
    lines.push(DETAIL_HEADERS.map((header) => csvEscape(row[header] ?? '')).join(','));
  });
  return lines.join('\n');
}

export function buildMarkdown(
  analysis: SessionAnalysis,
  captures: Partial<Record<TaskId, TaskCapture>>,
  settings: AppSettings,
) {
  const lines: string[] = [];
  lines.push('# 姿勢動作測定ログ');
  lines.push('');
  lines.push(`date: ${new Date().toLocaleString('ja-JP')}`);
  lines.push(`protocol_version: ${PROTOCOL_VERSION}`);
  lines.push(`device: browser`);
  lines.push(`camera: ${settings.facingMode}`);
  lines.push(`height_cm: ${settings.heightCm || 'unknown'}`);
  lines.push(`chair_height_cm: ${settings.chairHeightCm || 'unknown'}`);
  lines.push(`voice_guide: ${settings.voiceGuide ? 'on' : 'off'}`);
  lines.push(`rhythm_guide: ${settings.rhythmGuide ? 'on' : 'off'}`);
  lines.push(`overall_quality: ${analysis.overallQuality}`);
  lines.push(`notes: ${settings.note || ''}`);
  lines.push('');
  lines.push('## 測定品質');
  lines.push(`- overall: ${analysis.overallQuality}`);
  lines.push(`- captured_tasks: ${Object.keys(captures).length}`);
  if (analysis.warnings.length > 0) {
    lines.push('- warnings:');
    analysis.warnings.forEach((warning) => lines.push(`  - ${warning}`));
  } else {
    lines.push('- warnings: none');
  }

  analysis.analyses.forEach((task) => {
    lines.push('');
    lines.push(`## ${task.label}`);
    lines.push(`- quality: ${task.quality}`);
    lines.push(`- duration_sec: ${task.durationSec.toFixed(2)}`);
    lines.push(`- frames: ${task.frameCount}`);
    lines.push(`- high_confidence_ratio: ${task.highConfidenceRatio.toFixed(3)}`);
    task.metrics.forEach((metric) => {
      lines.push(valueLine(metric.key, metric.value, metric.unit));
      if (metric.note) lines.push(`  - note: ${metric.note}`);
    });
    if (task.warnings.length > 0) {
      lines.push('- task_warnings:');
      task.warnings.forEach((warning) => lines.push(`  - ${warning}`));
    }
  });

  lines.push('');
  lines.push('## 解釈ルール');
  lines.push('- このログは診断ではない');
  lines.push('- 測定品質A/B/C/測定不能を必ず確認する');
  lines.push('- 測定誤差内の変化を改善扱いしない');
  lines.push('- カメラのみで足圧、地面反力、横隔膜機能、骨盤角度の絶対値は断定しない');
  lines.push('- 猫背、反り腰、肋骨フレア、骨盤前傾は直接診断せず、CVA、頭部前方、矢状面スタック、股関節/膝/足首プロキシとして読む');
  lines.push('- 不明は不明として扱う');

  return lines.join('\n');
}

export function buildText(
  analysis: SessionAnalysis,
  captures: Partial<Record<TaskId, TaskCapture>>,
  settings: AppSettings,
) {
  const lines: string[] = [];
  lines.push('app=Posture Motion Lab');
  lines.push(`protocol=${PROTOCOL_VERSION}`);
  lines.push(`date=${new Date().toLocaleString('ja-JP')}`);
  lines.push(`camera=${settings.facingMode}`);
  lines.push(`height_cm=${settings.heightCm || 'unknown'}`);
  lines.push(`chair_height_cm=${settings.chairHeightCm || 'unknown'}`);
  lines.push(`voice_guide=${settings.voiceGuide ? 'on' : 'off'}`);
  lines.push(`rhythm_guide=${settings.rhythmGuide ? 'on' : 'off'}`);
  lines.push(`overall_quality=${analysis.overallQuality}`);
  lines.push(`captured_tasks=${Object.keys(captures).length}`);
  lines.push(`notes=${settings.note || ''}`);
  lines.push('');

  analysis.analyses.forEach((task) => {
    lines.push(`[${task.taskId}]`);
    lines.push(`label=${task.label}`);
    lines.push(`quality=${task.quality}`);
    lines.push(`duration_sec=${task.durationSec.toFixed(2)}`);
    lines.push(`frames=${task.frameCount}`);
    lines.push(`high_confidence_ratio=${task.highConfidenceRatio.toFixed(3)}`);
    task.metrics.forEach((metric) => lines.push(`${metric.key}=${metric.value}${metric.unit ? ` ${metric.unit}` : ''}`));
    if (task.warnings.length > 0) lines.push(`warnings=${task.warnings.join(' / ')}`);
    lines.push('');
  });

  lines.push('[interpretation_rules]');
  lines.push('diagnosis=false');
  lines.push('read_quality_first=true');
  lines.push('do_not_treat_small_change_as_improvement=true');
  return lines.join('\n');
}

export function buildDetailedMarkdown(
  analysis: SessionAnalysis,
  captures: Partial<Record<TaskId, TaskCapture>>,
  settings: AppSettings,
) {
  const lines = [buildMarkdown(analysis, captures, settings)];
  lines.push('');
  lines.push('## フレーム別詳細');
  lines.push('');
  lines.push('- 各タスクの全フレームをCSVとして出力する');
  lines.push('- required_confidenceは、そのタスクで必要な主要ランドマークが見えていた割合');
  lines.push('- visibility列はMediaPipeのランドマーク信頼度');
  lines.push('- ratioは画像座標または肩幅・体幹長で正規化した相対値');
  lines.push('- side_*列は側面タスク用。猫背/反り腰を直接測るものではなく、動画推薦に使う前段のプロキシ');
  lines.push('- 品質Cまたは測定不能のフレーム列は、原因確認用であり強い解釈には使わない');

  Object.entries(captures).forEach(([taskId, capture]) => {
    lines.push('');
    lines.push(`### ${capture.label}`);
    lines.push('');
    lines.push('```csv');
    lines.push(frameCsv(taskId as TaskId, capture.frames));
    lines.push('```');
  });

  return lines.join('\n');
}

export function buildJson(
  analysis: SessionAnalysis,
  captures: Partial<Record<TaskId, TaskCapture>>,
  settings: AppSettings,
) {
  return JSON.stringify(
    {
      app: 'Posture Motion Lab',
      protocolVersion: PROTOCOL_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      analysis,
      raw: Object.fromEntries(
        Object.entries(captures).map(([taskId, capture]) => [
          taskId,
          {
            ...capture,
            frames: capture.frames.map((frame) => ({
              t: frame.t,
              landmarks: frame.landmarks,
            })),
          },
        ]),
      ),
    },
    null,
    2,
  );
}

export function buildPrompt(
  analysis: SessionAnalysis,
  captures: Partial<Record<TaskId, TaskCapture>>,
  settings: AppSettings,
) {
  const log = buildDetailedMarkdown(analysis, captures, settings);
  return [
    '# 姿勢動作測定ログ 解析プロンプト',
    '',
    'あなたは、姿勢と動作を科学的・測定論的に読む解析者です。',
    '以下のPosture Motion Labログを読み、医学的診断ではなく、測定品質、数値傾向、再測定方針、仮説を整理してください。',
    '',
    '## 絶対ルール',
    '- 診断名を付けない',
    '- 治った、矯正された、原因はこれ、と断定しない',
    '- 測定品質A/B/C/測定不能を最初に確認する',
    '- 品質Cや測定不能の値は、強い解釈に使わない',
    '- 測定誤差内の小さい差を改善扱いしない',
    '- カメラだけで足圧、地面反力、横隔膜機能、骨盤角度絶対値は断定しない',
    '- 猫背、反り腰、肋骨フレア、骨盤前傾は直接診断せず、CVA、頭部前方、矢状面スタック、股関節/膝/足首プロキシに分解して扱う',
    '- アプリや動画の推薦は、このログ単体では確定しない。推薦する場合も候補理由と不足測定を分ける',
    '- 1回の測定で正常/異常を決めない',
    '- 不明なものは不明と書く',
    '- 痛み、しびれ、めまい、神経症状がある場合は、セルフ解析の範囲外として扱う',
    '',
    '## 解析で見てほしいこと',
    '1. このログは解析に使えるか。使えない項目があれば、理由を書く。',
    '2. 品質A/Bの数値だけを中心に、目立つ左右差、前後差、動作中のばらつきを列挙する。',
    '3. 静止姿勢より、立ち座りとスクワットで崩れが増えるかを見る。',
    '4. 猫背系、反り腰系、足部/重心系、股関節/スクワット系、呼吸/肋骨系のどの推薦カテゴリに使える数値が揃っているかを整理する。',
    '5. アーティストパフォーマンス研究所、Nピラティス、三田院の語彙は、仮説ラベルとしてだけ使う。',
    '6. 次回、同じ条件で再測定すべき項目を1から3個に絞る。',
    '7. 必要なら、次回メモに書くべき主観情報を質問として出す。',
    '',
    '## 出力形式',
    '次の見出しだけで返してください。',
    '',
    '### 1. 測定品質',
    '- 使える項目',
    '- 参考値扱いの項目',
    '- 測定し直すべき項目',
    '',
    '### 2. 数値から言えること',
    '- 断定できること',
    '- 可能性に留まること',
    '- 言えないこと',
    '',
    '### 3. 動作仮説',
    '- 仮説A',
    '- 仮説B',
    '- 反証するには何を測るか',
    '',
    '### 4. 次回の測定計画',
    '- 次に測る項目',
    '- 撮影条件の修正',
    '- 比較するときの注意',
    '',
    '### 5. 追加で聞きたいこと',
    '- 質問を最大3つ',
    '',
    '## 測定ログ',
    '',
    '```md',
    log,
    '```',
    '',
  ].join('\n');
}

export function download(content: string, extension: 'md' | 'txt' | 'json', label = 'posture_motion_lab') {
  const mime = extension === 'json' ? 'application/json' : 'text/plain';
  const blob = new Blob([content], { type: `${mime}; charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${label}_${dateStamp()}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
