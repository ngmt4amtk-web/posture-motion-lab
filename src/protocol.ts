import type { TaskDefinition } from './types';

export const PROTOCOL_VERSION = 'posture_motion_lab_v0.1';

export const TASKS: TaskDefinition[] = [
  {
    id: 'front_static',
    label: '静止 正面',
    shortLabel: '正面',
    durationSec: 10,
    view: 'front',
    instruction: '足幅を固定し、全身が入る位置で正面を向いて立つ。10秒間、楽に立つ。',
  },
  {
    id: 'side_static',
    label: '静止 側面',
    shortLabel: '側面',
    durationSec: 10,
    view: 'side',
    instruction: '横向きで立つ。耳、肩、股関節、膝、足首が見える位置にする。',
  },
  {
    id: 'back_static',
    label: '静止 背面',
    shortLabel: '背面',
    durationSec: 10,
    view: 'back',
    instruction: '背面を向けて立つ。肩、骨盤、膝、踵が隠れないようにする。',
  },
  {
    id: 'sit_to_stand',
    label: '5回立ち座り',
    shortLabel: '立ち座り',
    durationSec: 30,
    view: 'dynamic',
    instruction: '椅子に座った状態で開始し、5回立ち座りする。終わったら停止を押す。',
  },
  {
    id: 'squat',
    label: 'スクワット3回',
    shortLabel: 'スクワット',
    durationSec: 25,
    view: 'dynamic',
    instruction: '正面から全身を入れ、ゆっくり3回スクワットする。深さより再現性を優先する。',
  },
];

export function getTask(id: string) {
  return TASKS.find((task) => task.id === id);
}
