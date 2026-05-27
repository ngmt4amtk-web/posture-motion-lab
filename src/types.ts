export type TaskId = 'front_static' | 'side_static' | 'back_static' | 'sit_to_stand' | 'squat' | 'side_squat';

export type QualityGrade = 'A' | 'B' | 'C' | '測定不能';

export interface PosePoint {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

export interface PoseFrame {
  t: number;
  landmarks: PosePoint[];
}

export interface TaskDefinition {
  id: TaskId;
  label: string;
  shortLabel: string;
  durationSec: number;
  instruction: string;
  setup: string;
  steps: string[];
  view: 'front' | 'side' | 'back' | 'dynamic';
}

export interface TaskCapture {
  taskId: TaskId;
  label: string;
  startedAt: string;
  endedAt: string;
  frames: PoseFrame[];
  snapshot?: TaskSnapshot;
}

export interface TaskSnapshot {
  atSec: number;
  capturedAt: string;
  dataUrl: string;
  width: number;
  height: number;
  label: string;
}

export interface MetricValue {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
  quality?: QualityGrade;
  note?: string;
}

export interface TaskAnalysis {
  taskId: TaskId;
  label: string;
  quality: QualityGrade;
  highConfidenceRatio: number;
  frameCount: number;
  durationSec: number;
  metrics: MetricValue[];
  warnings: string[];
}

export interface SessionAnalysis {
  createdAt: string;
  protocolVersion: string;
  overallQuality: QualityGrade;
  analyses: TaskAnalysis[];
  warnings: string[];
}

export interface AppSettings {
  facingMode: 'user' | 'environment';
  heightCm: string;
  chairHeightCm: string;
  note: string;
  voiceGuide: boolean;
  rhythmGuide: boolean;
}
