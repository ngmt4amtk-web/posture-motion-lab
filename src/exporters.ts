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

export function buildPrompt(
  analysis: SessionAnalysis,
  captures: Partial<Record<TaskId, TaskCapture>>,
  settings: AppSettings,
) {
  const log = buildMarkdown(analysis, captures, settings);
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
    '- 1回の測定で正常/異常を決めない',
    '- 不明なものは不明と書く',
    '- 痛み、しびれ、めまい、神経症状がある場合は、セルフ解析の範囲外として扱う',
    '',
    '## 解析で見てほしいこと',
    '1. このログは解析に使えるか。使えない項目があれば、理由を書く。',
    '2. 品質A/Bの数値だけを中心に、目立つ左右差、前後差、動作中のばらつきを列挙する。',
    '3. 静止姿勢より、立ち座りとスクワットで崩れが増えるかを見る。',
    '4. アーティストパフォーマンス研究所、Nピラティス、三田院の語彙は、仮説ラベルとしてだけ使う。',
    '5. 次回、同じ条件で再測定すべき項目を1から3個に絞る。',
    '6. 必要なら、次回メモに書くべき主観情報を質問として出す。',
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
