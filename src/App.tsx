import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildJson, buildMarkdown, buildText, download } from './exporters';
import { analyzeSession } from './metrics';
import { detectPose, drawPose, initPoseLandmarker } from './pose';
import { TASKS } from './protocol';
import type { AppSettings, PoseFrame, PosePoint, TaskCapture, TaskDefinition, TaskId } from './types';

const initialSettings: AppSettings = {
  facingMode: 'environment',
  heightCm: '',
  chairHeightCm: '',
  note: '',
};

function qualityLabel(value: number) {
  if (value >= 0.85) return 'A';
  if (value >= 0.65) return 'B';
  if (value >= 0.45) return 'C';
  return '低';
}

function liveVisibility(landmarks: PosePoint[] | null) {
  if (!landmarks) return 0;
  const required = [0, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28];
  const visibleCount = required.filter((index) => {
    const point = landmarks[index];
    return point && (point.visibility == null || point.visibility >= 0.5);
  }).length;
  return visibleCount / required.length;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeTaskRef = useRef<TaskDefinition | null>(null);
  const framesRef = useRef<PoseFrame[]>([]);
  const startTimeRef = useRef<number>(0);
  const startedAtRef = useRef<string>('');
  const finishRef = useRef<() => void>(() => {});
  const lastUiUpdateRef = useRef<number>(0);
  const lastFrameTimeRef = useRef<number>(0);

  const [settings, setSettings] = useState<AppSettings>(initialSettings);
  const settingsRef = useRef(settings);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [poseStatus, setPoseStatus] = useState('not loaded');
  const [activeTask, setActiveTask] = useState<TaskDefinition | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [fps, setFps] = useState(0);
  const [previewQuality, setPreviewQuality] = useState(0);
  const [captures, setCaptures] = useState<Partial<Record<TaskId, TaskCapture>>>({});
  const [message, setMessage] = useState('カメラを開始してください');

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCameraStatus('loading');
    setMessage('カメラと姿勢検出を準備中');
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: settingsRef.current.facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      await initPoseLandmarker(setPoseStatus);
      setCameraStatus('ready');
      setMessage('測定できます');
    } catch (error) {
      setCameraStatus('error');
      const text = error instanceof Error ? error.message : '';
      const blocked = /permission|denied|dismissed|notallowed/i.test(text);
      setMessage(blocked ? 'ブラウザのカメラ許可が必要です' : 'カメラを開始できません');
    }
  }, [stopStream]);

  const finishTask = useCallback(() => {
    const task = activeTaskRef.current;
    if (!task) return;
    const frames = [...framesRef.current];
    setCaptures((current) => ({
      ...current,
      [task.id]: {
        taskId: task.id,
        label: task.label,
        startedAt: startedAtRef.current,
        endedAt: new Date().toISOString(),
        frames,
      },
    }));
    activeTaskRef.current = null;
    framesRef.current = [];
    startTimeRef.current = 0;
    setActiveTask(null);
    setElapsed(0);
    setMessage(`${task.label}を保存しました`);
  }, []);

  useEffect(() => {
    finishRef.current = finishTask;
  }, [finishTask]);

  useEffect(() => {
    const loop = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const now = performance.now();
      if (video && canvas && video.readyState >= 2) {
        const landmarks = detectPose(video, now);
        drawPose(canvas, video, landmarks, settingsRef.current.facingMode === 'user');
        const task = activeTaskRef.current;
        if (task && landmarks) {
          const t = (now - startTimeRef.current) / 1000;
          framesRef.current.push({ t, landmarks });
          if (t >= task.durationSec) finishRef.current();
        }
        if (now - lastUiUpdateRef.current > 250) {
          const dt = now - lastFrameTimeRef.current;
          if (lastFrameTimeRef.current) setFps(dt > 0 ? Math.round(1000 / dt) : 0);
          lastFrameTimeRef.current = now;
          lastUiUpdateRef.current = now;
          setPreviewQuality(liveVisibility(landmarks));
          const running = activeTaskRef.current;
          if (running) setElapsed((now - startTimeRef.current) / 1000);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stopStream();
    };
  }, [stopStream]);

  const startTask = (task: TaskDefinition) => {
    if (cameraStatus !== 'ready') {
      setMessage('先にカメラを開始してください');
      return;
    }
    framesRef.current = [];
    startTimeRef.current = performance.now();
    startedAtRef.current = new Date().toISOString();
    activeTaskRef.current = task;
    setActiveTask(task);
    setElapsed(0);
    setMessage(task.instruction);
  };

  const clearSession = () => {
    setCaptures({});
    setMessage('セッションをリセットしました');
  };

  const analysis = useMemo(() => analyzeSession(captures), [captures]);
  const hasCaptures = analysis.analyses.length > 0;
  const activeProgress = activeTask ? Math.min(100, (elapsed / activeTask.durationSec) * 100) : 0;

  const switchCamera = async () => {
    const next = settings.facingMode === 'environment' ? 'user' : 'environment';
    setSettings((current) => ({ ...current, facingMode: next }));
    settingsRef.current = { ...settingsRef.current, facingMode: next };
    if (cameraStatus === 'ready') await startCamera();
  };

  const exportMd = () => download(buildMarkdown(analysis, captures, settings), 'md');
  const exportTxt = () => download(buildText(analysis, captures, settings), 'txt');
  const exportJson = () => download(buildJson(analysis, captures, settings), 'json');

  return (
    <main className="app">
      <section className="topbar">
        <div>
          <p className="eyebrow">measurement only</p>
          <h1>Posture Motion Lab</h1>
        </div>
        <div className="statusStrip">
          <span>カメラ: {cameraStatus}</span>
          <span>姿勢検出: {poseStatus}</span>
          <span>FPS: {fps}</span>
        </div>
      </section>

      <section className="workspace">
        <div className="cameraPanel">
          <div className="cameraFrame">
            <video ref={videoRef} className={settings.facingMode === 'user' ? 'mirror' : ''} playsInline muted />
            <canvas ref={canvasRef} className="overlay" />
            <div className="cameraHud top">
              <span>Live quality {qualityLabel(previewQuality)} / {(previewQuality * 100).toFixed(0)}%</span>
              {activeTask && <span>{activeTask.label} {elapsed.toFixed(1)}s</span>}
            </div>
            {activeTask && (
              <div className="progressTrack">
                <div className="progressBar" style={{ width: `${activeProgress}%` }} />
              </div>
            )}
            <div className="cameraHud bottom">{message}</div>
          </div>

          <div className="controlRow">
            <button className="primary" type="button" onClick={startCamera}>
              カメラ開始
            </button>
            <button type="button" onClick={switchCamera}>
              カメラ切替
            </button>
            <button type="button" disabled={!activeTask} onClick={finishTask}>
              測定停止
            </button>
          </div>
        </div>

        <aside className="sidePanel">
          <section className="panelBlock">
            <h2>プロトコル</h2>
            <div className="taskList">
              {TASKS.map((task) => {
                const done = Boolean(captures[task.id]);
                const running = activeTask?.id === task.id;
                return (
                  <button
                    className={`taskButton ${done ? 'done' : ''} ${running ? 'running' : ''}`}
                    key={task.id}
                    type="button"
                    disabled={Boolean(activeTask)}
                    onClick={() => startTask(task)}
                  >
                    <span>
                      <strong>{task.shortLabel}</strong>
                      <small>{task.durationSec}s</small>
                    </span>
                    <em>{running ? '測定中' : done ? '保存済' : '開始'}</em>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panelBlock">
            <h2>条件</h2>
            <label>
              身長 cm
              <input
                inputMode="decimal"
                value={settings.heightCm}
                onChange={(event) => setSettings((current) => ({ ...current, heightCm: event.target.value }))}
              />
            </label>
            <label>
              椅子高さ cm
              <input
                inputMode="decimal"
                value={settings.chairHeightCm}
                onChange={(event) => setSettings((current) => ({ ...current, chairHeightCm: event.target.value }))}
              />
            </label>
            <label>
              メモ
              <textarea
                rows={3}
                value={settings.note}
                onChange={(event) => setSettings((current) => ({ ...current, note: event.target.value }))}
              />
            </label>
          </section>

          <section className="panelBlock">
            <h2>書き出し</h2>
            <div className="exportGrid">
              <button type="button" disabled={!hasCaptures} onClick={exportMd}>md</button>
              <button type="button" disabled={!hasCaptures} onClick={exportTxt}>txt</button>
              <button type="button" disabled={!hasCaptures} onClick={exportJson}>json</button>
            </div>
            <button className="subtle" type="button" disabled={!hasCaptures} onClick={clearSession}>
              セッションリセット
            </button>
          </section>
        </aside>
      </section>

      <section className="results">
        <div className="resultsHeader">
          <h2>測定値</h2>
          <p>診断、スコア、処方は表示しません。数値と品質だけを残します。</p>
        </div>
        {analysis.analyses.length === 0 ? (
          <div className="empty">まだ測定ログがありません。</div>
        ) : (
          <div className="resultGrid">
            {analysis.analyses.map((task) => (
              <article className="resultCard" key={task.taskId}>
                <header>
                  <h3>{task.label}</h3>
                  <span className={`quality q${task.quality}`}>{task.quality}</span>
                </header>
                <p className="meta">
                  {task.durationSec.toFixed(1)}s / {task.frameCount} frames / confidence {(task.highConfidenceRatio * 100).toFixed(0)}%
                </p>
                <dl>
                  {task.metrics.map((metric) => (
                    <div key={metric.key}>
                      <dt>{metric.label}</dt>
                      <dd>
                        {metric.value}
                        {metric.unit && <small>{metric.unit}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
                {task.warnings.length > 0 && (
                  <ul className="warnings">
                    {task.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                  </ul>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
