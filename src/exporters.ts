import { PROTOCOL_VERSION } from './protocol';
import type { AppSettings, SessionAnalysis, TaskCapture, TaskId } from './types';

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

export function download(content: string, extension: 'md' | 'txt' | 'json') {
  const mime = extension === 'json' ? 'application/json' : 'text/plain';
  const blob = new Blob([content], { type: `${mime}; charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `posture_motion_lab_${dateStamp()}.${extension}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
