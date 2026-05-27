import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDetailedMarkdown, buildJson, buildMarkdown, buildPrompt, buildText, download } from './exporters';
import { analyzeSession } from './metrics';
import { detectPose, drawPose, initPoseLandmarker } from './pose';
import { TASKS } from './protocol';
import { loadStoredSession, saveStoredSession } from './storage';
import type { AppSettings, PoseFrame, PosePoint, TaskCapture, TaskDefinition, TaskId, TaskSnapshot } from './types';

const initialSettings: AppSettings = {
  facingMode: 'environment',
  heightCm: '',
  chairHeightCm: '',
  note: '',
  voiceGuide: true,
  rhythmGuide: false,
};

type ExportKind = 'md' | 'detail' | 'txt' | 'prompt';
type VoiceCue = { atSec: number; text: string };
const STATIC_TASK_IDS: TaskId[] = ['front_static', 'side_static', 'back_static'];
const SNAPSHOT_AT_SEC = 5;

function qualityLabel(value: number) {
  if (value >= 0.85) return 'A';
  if (value >= 0.65) return 'B';
  if (value >= 0.45) return 'C';
  return '低';
}

function liveVisibility(landmarks: PosePoint[] | null) {
  if (!landmarks) return 0;
  const score = (required: number[]) => {
    const visibleCount = required.filter((index) => {
      const point = landmarks[index];
      return point && (point.visibility == null || point.visibility >= 0.5);
    }).length;
    return visibleCount / required.length;
  };
  const fullBody = score([0, 7, 8, 11, 12, 23, 24, 25, 26, 27, 28]);
  const leftSide = score([7, 11, 23, 25, 27]);
  const rightSide = score([8, 12, 24, 26, 28]);
  return Math.max(fullBody, leftSide, rightSide);
}

function speechSupported() {
  return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function taskStartSpeech(task: TaskDefinition) {
  if (task.id === 'front_static') return '正面静止、開始。10秒間、普段通り立ってください。';
  if (task.id === 'side_static') return '側面静止、開始。横向きのまま、10秒間止まってください。';
  if (task.id === 'back_static') return '背面静止、開始。10秒間、足幅を変えずに立ってください。';
  if (task.id === 'sit_to_stand') return '立ち座り、開始。5回行い、終わったら立ったまま止まってください。';
  if (task.id === 'side_squat') return '側面スクワット、開始。横向きのまま3回、同じ深さで行ってください。';
  return 'スクワット、開始。3回、同じ深さで行ってください。';
}

function taskVoiceCues(task: TaskDefinition, rhythmGuide: boolean): VoiceCue[] {
  if (rhythmGuide && (task.id === 'squat' || task.id === 'side_squat')) {
    return [
      { atSec: 3, text: '上がる' },
      { atSec: 6, text: '2回目、下がる' },
      { atSec: 9, text: '上がる' },
      { atSec: 12, text: '3回目、下がる' },
      { atSec: 15, text: '上がる' },
      { atSec: 18, text: '立って止まる' },
      { atSec: 20, text: '残り5秒' },
    ];
  }

  if (rhythmGuide && task.id === 'sit_to_stand') {
    return [
      { atSec: 1, text: '1回目' },
      { atSec: 4, text: '2回目' },
      { atSec: 7, text: '3回目' },
      { atSec: 10, text: '4回目' },
      { atSec: 13, text: '5回目' },
      { atSec: 16, text: '立って止まる' },
      { atSec: 25, text: '残り5秒' },
    ];
  }

  if (task.id === 'sit_to_stand') {
    return [
      { atSec: 10, text: '5回終わったら、立って止まる' },
      { atSec: 25, text: '残り5秒' },
    ];
  }

  if (task.id === 'squat' || task.id === 'side_squat') {
    return [
      { atSec: 10, text: '3回です。回数をそろえてください' },
      { atSec: 20, text: '残り5秒' },
    ];
  }

  return [{ atSec: Math.max(1, task.durationSec - 5), text: '残り5秒' }];
}

function isStaticTask(taskId: TaskId) {
  return STATIC_TASK_IDS.includes(taskId);
}

function captureVideoSnapshot(video: HTMLVideoElement, label: string, mirror: boolean): TaskSnapshot | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);
  return {
    atSec: SNAPSHOT_AT_SEC,
    capturedAt: new Date().toISOString(),
    dataUrl: canvas.toDataURL('image/jpeg', 0.88),
    width,
    height,
    label,
  };
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const activeTaskRef = useRef<TaskDefinition | null>(null);
  const pendingTaskRef = useRef<TaskDefinition | null>(null);
  const framesRef = useRef<PoseFrame[]>([]);
  const snapshotRef = useRef<TaskSnapshot | null>(null);
  const startTimeRef = useRef<number>(0);
  const startedAtRef = useRef<string>('');
  const finishRef = useRef<() => void>(() => {});
  const countdownTimerRef = useRef<number | null>(null);
  const voiceTimersRef = useRef<number[]>([]);
  const saveTimerRef = useRef<number | null>(null);
  const storageReadyRef = useRef(false);
  const saveSequenceRef = useRef(0);
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
  const [selectedTaskId, setSelectedTaskId] = useState<TaskId>('front_static');
  const [pendingTaskId, setPendingTaskId] = useState<TaskId | null>(null);
  const [countdownTask, setCountdownTask] = useState<TaskDefinition | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [exportPreview, setExportPreview] = useState<{ title: string; content: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [storageStatus, setStorageStatus] = useState('起動中');

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    loadStoredSession()
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          const restoredSettings = { ...initialSettings, ...stored.settings };
          setSettings(restoredSettings);
          settingsRef.current = restoredSettings;
          setCaptures(stored.captures ?? {});
          setMessage('前回セッションを復元しました');
          setStorageStatus('復元済');
        } else {
          setStorageStatus('待機');
        }
        storageReadyRef.current = true;
      })
      .catch(() => {
        if (cancelled) return;
        storageReadyRef.current = true;
        setStorageStatus('保存不可');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReadyRef.current) return;
    if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    setStorageStatus('保存待ち');
    saveTimerRef.current = window.setTimeout(() => {
      const sequence = saveSequenceRef.current + 1;
      saveSequenceRef.current = sequence;
      setStorageStatus('保存中');
      saveStoredSession({ settings, captures, savedAt: new Date().toISOString() })
        .then(() => {
          if (saveSequenceRef.current === sequence) setStorageStatus('保存済');
        })
        .catch(() => {
          if (saveSequenceRef.current === sequence) setStorageStatus('保存失敗');
        });
    }, 150);

    return () => {
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [settings, captures]);

  const clearVoiceTimers = useCallback(() => {
    voiceTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    voiceTimersRef.current = [];
  }, []);

  const speak = useCallback((text: string, interrupt = true) => {
    if (!settingsRef.current.voiceGuide) return false;
    if (!speechSupported()) {
      setMessage('このブラウザは音声合成に対応していません');
      return false;
    }

    if (interrupt) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 1.02;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    return true;
  }, []);

  const scheduleVoiceCues = useCallback((task: TaskDefinition) => {
    clearVoiceTimers();
    if (!settingsRef.current.voiceGuide) return;
    const cues = taskVoiceCues(task, settingsRef.current.rhythmGuide);
    voiceTimersRef.current = cues.map((cue) => window.setTimeout(() => speak(cue.text), cue.atSec * 1000));
  }, [clearVoiceTimers, speak]);

  useEffect(() => {
    return () => {
      clearVoiceTimers();
      if (speechSupported()) window.speechSynthesis.cancel();
      if (saveTimerRef.current != null) window.clearTimeout(saveTimerRef.current);
    };
  }, [clearVoiceTimers]);

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
      pendingTaskRef.current = null;
      setPendingTaskId(null);
      const text = error instanceof Error ? error.message : '';
      const blocked = /permission|denied|dismissed|notallowed/i.test(text);
      setMessage(blocked ? 'ブラウザのカメラ許可が必要です' : 'カメラを開始できません');
    }
  }, [stopStream]);

  const finishTask = useCallback(() => {
    const task = activeTaskRef.current;
    if (!task) return;
    const frames = [...framesRef.current];
    const snapshot = snapshotRef.current ?? undefined;
    clearVoiceTimers();
    setCaptures((current) => ({
      ...current,
      [task.id]: {
        taskId: task.id,
        label: task.label,
        startedAt: startedAtRef.current,
        endedAt: new Date().toISOString(),
        frames,
        snapshot,
      },
    }));
    activeTaskRef.current = null;
    framesRef.current = [];
    snapshotRef.current = null;
    startTimeRef.current = 0;
    setActiveTask(null);
    setElapsed(0);
    setMessage(snapshot ? `${task.label}と5秒写真を保存しました` : `${task.label}を保存しました`);
    speak(snapshot ? `${task.shortLabel}、終了。写真も保存しました。` : `${task.shortLabel}、終了。保存しました。`);
  }, [clearVoiceTimers, speak]);

  useEffect(() => {
    finishRef.current = finishTask;
  }, [finishTask]);

  const recordTask = useCallback((task: TaskDefinition) => {
    framesRef.current = [];
    snapshotRef.current = null;
    startTimeRef.current = performance.now();
    startedAtRef.current = new Date().toISOString();
    activeTaskRef.current = task;
    setActiveTask(task);
    setElapsed(0);
    setMessage(task.instruction);
    speak(taskStartSpeech(task));
    scheduleVoiceCues(task);
  }, [scheduleVoiceCues, speak]);

  const cancelCountdown = useCallback(() => {
    if (countdownTimerRef.current != null) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    clearVoiceTimers();
    if (speechSupported()) window.speechSynthesis.cancel();
    pendingTaskRef.current = null;
    setPendingTaskId(null);
    setCountdownTask(null);
    setCountdown(null);
    setMessage('測定開始をキャンセルしました');
    speak('キャンセルしました');
  }, [clearVoiceTimers, speak]);

  const startCountdown = useCallback((task: TaskDefinition) => {
    if (countdownTimerRef.current != null) window.clearInterval(countdownTimerRef.current);
    let remaining = 5;
    setCountdownTask(task);
    setCountdown(remaining);
    setMessage(`${task.label}: ${remaining}秒後に測定開始`);
    speak(`${task.shortLabel}。5秒後に開始します。`);
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current != null) window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        setCountdownTask(null);
        setCountdown(null);
        recordTask(task);
        return;
      }
      setCountdown(remaining);
      setMessage(`${task.label}: ${remaining}秒後に測定開始`);
      speak(String(remaining));
    }, 1000);
  }, [recordTask, speak]);

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
          if (isStaticTask(task.id) && !snapshotRef.current && t >= SNAPSHOT_AT_SEC) {
            const snapshot = captureVideoSnapshot(video, `${task.label} ${SNAPSHOT_AT_SEC}s`, settingsRef.current.facingMode === 'user');
            if (snapshot) {
              snapshotRef.current = snapshot;
              setMessage(`${task.label}: ${SNAPSHOT_AT_SEC}秒写真を保存しました`);
            }
          }
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
      if (countdownTimerRef.current != null) window.clearInterval(countdownTimerRef.current);
      stopStream();
    };
  }, [stopStream]);

  useEffect(() => {
    if (cameraStatus !== 'ready' || !pendingTaskRef.current || activeTaskRef.current || countdownTask) return;
    const task = pendingTaskRef.current;
    pendingTaskRef.current = null;
    setPendingTaskId(null);
    startCountdown(task);
  }, [cameraStatus, countdownTask, startCountdown]);

  const startTask = async (task: TaskDefinition) => {
    setSelectedTaskId(task.id);
    if (activeTaskRef.current || countdownTask) return;
    if (cameraStatus !== 'ready') {
      pendingTaskRef.current = task;
      setPendingTaskId(task.id);
      setMessage('カメラ許可後、5秒カウントダウンして開始します');
      await startCamera();
      return;
    }
    startCountdown(task);
  };

  const stopCurrent = () => {
    if (countdownTask) {
      cancelCountdown();
      return;
    }
    finishTask();
  };

  const clearSession = () => {
    setCaptures({});
    setExportPreview(null);
    setCopyStatus('');
    setMessage('セッションをリセットしました');
  };

  const analysis = useMemo(() => analyzeSession(captures), [captures]);
  const hasCaptures = analysis.analyses.length > 0;
  const activeProgress = activeTask ? Math.min(100, (elapsed / activeTask.durationSec) * 100) : 0;
  const selectedTask = TASKS.find((task) => task.id === selectedTaskId) ?? TASKS[0];
  const busy = Boolean(activeTask || countdownTask || pendingTaskId);

  const switchCamera = async () => {
    const next = settings.facingMode === 'environment' ? 'user' : 'environment';
    setSettings((current) => ({ ...current, facingMode: next }));
    settingsRef.current = { ...settingsRef.current, facingMode: next };
    if (cameraStatus === 'ready') await startCamera();
  };

  const exportMd = () => download(buildMarkdown(analysis, captures, settings), 'md');
  const exportDetail = () => download(buildDetailedMarkdown(analysis, captures, settings), 'md', 'posture_motion_lab_detail');
  const exportTxt = () => download(buildText(analysis, captures, settings), 'txt');
  const exportJson = () => download(buildJson(analysis, captures, settings), 'json');
  const exportPrompt = () => download(buildPrompt(analysis, captures, settings), 'md', 'posture_motion_lab_prompt');
  const snapshotCaptures = Object.values(captures).filter((capture): capture is TaskCapture & { snapshot: TaskSnapshot } => Boolean(capture?.snapshot));

  const buildExportContent = (kind: ExportKind) => {
    if (kind === 'detail') return buildDetailedMarkdown(analysis, captures, settings);
    if (kind === 'txt') return buildText(analysis, captures, settings);
    if (kind === 'prompt') return buildPrompt(analysis, captures, settings);
    return buildMarkdown(analysis, captures, settings);
  };

  const showExport = (kind: ExportKind) => {
    const labels: Record<ExportKind, string> = {
      md: 'サマリーmd',
      detail: '詳細md',
      txt: 'txtログ',
      prompt: 'AI解析プロンプト',
    };
    setExportPreview({ title: labels[kind], content: buildExportContent(kind) });
    setCopyStatus('');
  };

  const copyExport = async () => {
    if (!exportPreview) return;
    try {
      await navigator.clipboard.writeText(exportPreview.content);
      setCopyStatus('コピーしました');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = exportPreview.content;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.top = '-1000px';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      setCopyStatus('コピーしました');
    }
  };

  const downloadSnapshot = (capture: TaskCapture & { snapshot: TaskSnapshot }) => {
    downloadDataUrl(capture.snapshot.dataUrl, `posture_motion_lab_${capture.taskId}_${capture.snapshot.atSec}s.jpg`);
  };

  const downloadAllSnapshots = () => {
    snapshotCaptures.forEach((capture, index) => {
      window.setTimeout(() => downloadSnapshot(capture), index * 180);
    });
  };

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
          <span>保存: {storageStatus}</span>
          <span>FPS: {fps}</span>
        </div>
      </section>

      <section className="guide">
        <article className="guideCard primaryGuide">
          <h2>撮影条件</h2>
          <ul>
            <li>スマホやPCは固定する。手持ちは比較用データとして使わない。</li>
            <li>頭から足先まで全身を入れる。足元が切れると膝や足部の値が弱くなる。</li>
            <li>明るい場所で、体の輪郭が見える服にする。裸足か同じ靴下で揃える。</li>
            <li>毎回、距離、向き、足幅、椅子の高さを同じにする。</li>
            <li>1人で測る時は、開始後の5秒カウントダウン中に位置へ戻る。</li>
          </ul>
        </article>
        <article className="guideCard">
          <h2>手持ち撮影</h2>
          <p>試し撮りとしては可能。ただし測定値はカメラの揺れが混ざるので、品質Cまたは参考値扱いにする。AI解析に渡す本番ログは固定撮影で取る。</p>
        </article>
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
            {countdownTask && countdown != null && (
              <div className="countdownOverlay">
                <strong>{countdown}</strong>
                <span>{countdownTask.shortLabel}を開始します</span>
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
            <button type="button" disabled={!activeTask && !countdownTask} onClick={stopCurrent}>
              {countdownTask ? '開始取消' : '測定停止'}
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
                    className={`taskButton ${done ? 'done' : ''} ${running ? 'running' : ''} ${selectedTaskId === task.id ? 'selected' : ''}`}
                    key={task.id}
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSelectedTaskId(task.id);
                    }}
                  >
                    <span>
                      <strong>{task.shortLabel}</strong>
                      <small>{task.durationSec}s</small>
                    </span>
                    <em>{running ? '測定中' : pendingTaskId === task.id ? '準備中' : done ? '保存済' : selectedTaskId === task.id ? '選択中' : '選択'}</em>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panelBlock taskGuide">
            <h2>やること</h2>
            <p className="guideLead">{selectedTask.setup}</p>
            <ol>
              {selectedTask.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
            <p className="guideNote">迷ったら、まずカメラ開始で骨格線が全身に出るか確認してから開始。</p>
            <button className="primary startSelected" type="button" disabled={busy} onClick={() => startTask(selectedTask)}>
              {cameraStatus === 'ready' ? `${selectedTask.shortLabel}を開始` : `カメラ起動して${selectedTask.shortLabel}を開始`}
            </button>
          </section>

          <section className="panelBlock voicePanel">
            <h2>音声</h2>
            <label className="checkLabel">
              <input
                type="checkbox"
                checked={settings.voiceGuide}
                onChange={(event) => {
                  const voiceGuide = event.target.checked;
                  if (!voiceGuide && speechSupported()) window.speechSynthesis.cancel();
                  setSettings((current) => ({
                    ...current,
                    voiceGuide,
                    rhythmGuide: voiceGuide ? current.rhythmGuide : false,
                  }));
                }}
              />
              <span>音声ガイド</span>
            </label>
            <label className="checkLabel">
              <input
                type="checkbox"
                checked={settings.rhythmGuide}
                disabled={!settings.voiceGuide}
                onChange={(event) => setSettings((current) => ({ ...current, rhythmGuide: event.target.checked }))}
              />
              <span>リズムガイド</span>
            </label>
            <p className="exportHint">リズムONは回数をそろえる測定用。自然速度を比べる時はOFF。</p>
            <button className="subtle" type="button" disabled={!settings.voiceGuide} onClick={() => speak('音声ガイド、オンです。')}>
              音声テスト
            </button>
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
              <button type="button" disabled={!hasCaptures} onClick={exportDetail}>detail</button>
              <button type="button" disabled={!hasCaptures} onClick={exportTxt}>txt</button>
              <button type="button" disabled={!hasCaptures} onClick={exportJson}>json</button>
              <button type="button" disabled={!hasCaptures} onClick={exportPrompt}>prompt</button>
            </div>
            <p className="exportHint">AIへ送るならprompt。フレーム別数値だけ見たい時はdetail。静止5秒写真は結果カードか下のボタンから保存。</p>
            <div className="exportGrid viewGrid">
              <button type="button" disabled={!hasCaptures} onClick={() => showExport('md')}>表示md</button>
              <button type="button" disabled={!hasCaptures} onClick={() => showExport('detail')}>表示detail</button>
              <button type="button" disabled={!hasCaptures} onClick={() => showExport('prompt')}>表示prompt</button>
            </div>
            <button className="subtle" type="button" disabled={snapshotCaptures.length === 0} onClick={downloadAllSnapshots}>
              静止写真を保存
            </button>
            <button className="subtle" type="button" disabled={!hasCaptures} onClick={clearSession}>
              セッションリセット
            </button>
          </section>
        </aside>
      </section>

      <section className="results">
        <div className="resultsHeader">
          <h2>測定値</h2>
          <p>診断、スコア、処方は表示しません。動画推薦に使えるよう、CVA、矢状面スタック、膝/股関節/足首プロキシ、動作中のばらつきを数値で残します。</p>
        </div>
        {exportPreview && (
          <article className="exportPreview">
            <header>
              <div>
                <h3>{exportPreview.title}</h3>
                <p>{exportPreview.content.length.toLocaleString('ja-JP')} characters</p>
              </div>
              <div className="previewActions">
                <button type="button" onClick={copyExport}>コピー</button>
                <button type="button" onClick={() => setExportPreview(null)}>閉じる</button>
              </div>
            </header>
            {copyStatus && <p className="copyStatus">{copyStatus}</p>}
            <textarea className="previewText" readOnly value={exportPreview.content} />
          </article>
        )}
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
                {captures[task.taskId]?.snapshot && (
                  <div className="snapshotBox">
                    <img src={captures[task.taskId]?.snapshot?.dataUrl} alt={`${task.label} 5秒写真`} />
                    <button
                      type="button"
                      onClick={() => {
                        const capture = captures[task.taskId];
                        if (capture?.snapshot) downloadSnapshot(capture as TaskCapture & { snapshot: TaskSnapshot });
                      }}
                    >
                      写真DL
                    </button>
                  </div>
                )}
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
