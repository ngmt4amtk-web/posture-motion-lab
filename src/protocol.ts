import type { TaskDefinition } from './types';

export const PROTOCOL_VERSION = 'posture_motion_lab_v0.1';

export const TASKS: TaskDefinition[] = [
  {
    id: 'front_static',
    label: '静止 正面',
    shortLabel: '正面',
    durationSec: 10,
    view: 'front',
    instruction: '正面を向いて、10秒間そのまま立つ。',
    setup: 'カメラを体の正面に置き、頭から足先まで全身を入れる。',
    steps: [
      '足は腰幅から肩幅くらい。つま先は自然な向き。',
      '腕は体の横に楽に下ろす。肩を作らない。',
      '正面を見て、10秒間なるべく動かない。',
    ],
  },
  {
    id: 'side_static',
    label: '静止 側面',
    shortLabel: '側面',
    durationSec: 10,
    view: 'side',
    instruction: '横向きで、10秒間そのまま立つ。',
    setup: 'カメラに対して真横を向き、耳、肩、股関節、膝、足首が見える位置にする。',
    steps: [
      '左右どちら向きでもよいが、毎回同じ向きで測る。',
      '腕で股関節が隠れる場合は、手を軽く前にずらす。',
      '腰を反らせたり顎を引きすぎたりせず、普段の立ち方で止まる。',
    ],
  },
  {
    id: 'back_static',
    label: '静止 背面',
    shortLabel: '背面',
    durationSec: 10,
    view: 'back',
    instruction: '背面を向けて、10秒間そのまま立つ。',
    setup: 'カメラに背中を向け、肩、骨盤、膝、踵が隠れないようにする。',
    steps: [
      '足幅は正面測定と同じにする。',
      '髪や服で首、肩、骨盤まわりが隠れないようにする。',
      'カメラの中心に背骨が来るように立つ。',
    ],
  },
  {
    id: 'sit_to_stand',
    label: '5回立ち座り',
    shortLabel: '立ち座り',
    durationSec: 30,
    view: 'dynamic',
    instruction: '椅子に座った状態から、5回立ち座りする。',
    setup: '横または斜め前から全身と椅子が入るように固定する。椅子は動かないものを使う。',
    steps: [
      '足裏を床につけ、椅子に座った状態で開始する。',
      '手は胸の前で組むか、毎回同じ位置にする。',
      '立つ、座るを5回。速さより同じ条件で行うことを優先する。',
      '5回終わったら、立ったまま1秒止まる。',
    ],
  },
  {
    id: 'squat',
    label: 'スクワット3回',
    shortLabel: 'スクワット',
    durationSec: 25,
    view: 'dynamic',
    instruction: '正面から、ゆっくり3回スクワットする。',
    setup: 'カメラを正面に固定し、頭から足先まで入れる。足元が切れないようにする。',
    steps: [
      '足幅は腰幅から肩幅くらい。つま先は自然な向き。',
      '3秒くらいで下がり、3秒くらいで上がる。',
      '深くしゃがむ必要はない。毎回同じ深さを狙う。',
      '膝、足首、股関節が画面から外れたら測定品質が落ちる。',
    ],
  },
];

export function getTask(id: string) {
  return TASKS.find((task) => task.id === id);
}
