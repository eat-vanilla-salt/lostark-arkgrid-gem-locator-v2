import { type ArkGridAttr, type LocalizationName, type LostArkGrade } from '../constants/enums';

export type ArkGridGemOptionType = {
  name: LocalizationName;
};
export const ArkGridGemOptionTypes = {
  공격력: {
    name: {
      ko_kr: '공격력',
      en_us: 'Atk. Power',
    },
  },
  '보스 피해': {
    name: {
      ko_kr: '보스 피해',
      en_us: 'Boss Damage',
    },
  },
  '추가 피해': {
    name: {
      ko_kr: '추가 피해',
      en_us: 'Additional Damage',
    },
  },
  낙인력: {
    name: {
      ko_kr: '낙인력',
      en_us: 'Brand Power',
    },
  },
  '아군 공격 강화': {
    name: {
      ko_kr: '아군 공격 강화',
      en_us: 'Ally Attack Enh.',
    },
  },
  '아군 피해 강화': {
    name: {
      ko_kr: '아군 피해 강화',
      en_us: 'Ally Damage Enh.',
    },
  },
} as const satisfies Record<string, ArkGridGemOptionType>;
export type ArkGridGemOptionName = keyof typeof ArkGridGemOptionTypes;
export const ArkGridGemOptionNames = Object.keys(ArkGridGemOptionTypes) as ArkGridGemOptionName[];

export type ArkGridGemSpec = {
  attr: ArkGridAttr;
  name: LocalizationName;
  req: Number;
  availableOptions: ArkGridGemOptionName[];
};
export const ArkGridGemSpecs = {
  '질서의 젬 : 안정': {
    attr: '질서',
    name: {
      ko_kr: '질서의 젬 : 안정',
      en_us: 'Order Astrogem: Stability',
    },
    req: 8,
    availableOptions: ['공격력', '추가 피해', '낙인력', '아군 피해 강화'],
  },
  '질서의 젬 : 견고': {
    attr: '질서',
    name: {
      ko_kr: '질서의 젬 : 견고',
      en_us: 'Order Astrogem: Solidity',
    },
    req: 9,
    availableOptions: ['공격력', '보스 피해', '아군 피해 강화', '아군 공격 강화'],
  },
  '질서의 젬 : 불변': {
    attr: '질서',
    name: {
      ko_kr: '질서의 젬 : 불변',
      en_us: 'Order Astrogem: Immutability',
    },
    req: 10,
    availableOptions: ['추가 피해', '보스 피해', '낙인력', '아군 공격 강화'],
  },
  '혼돈의 젬 : 침식': {
    attr: '혼돈',
    name: {
      ko_kr: '혼돈의 젬 : 침식',
      en_us: 'Chaos Astrogem: Corrosion',
    },
    req: 8,
    availableOptions: ['공격력', '추가 피해', '낙인력', '아군 피해 강화'],
  },
  '혼돈의 젬 : 왜곡': {
    attr: '혼돈',
    name: {
      ko_kr: '혼돈의 젬 : 왜곡',
      en_us: 'Chaos Astrogem: Distortion',
    },
    req: 9,
    availableOptions: ['공격력', '보스 피해', '아군 피해 강화', '아군 공격 강화'],
  },
  '혼돈의 젬 : 붕괴': {
    attr: '혼돈',
    name: {
      ko_kr: '혼돈의 젬 : 붕괴',
      en_us: 'Chaos Astrogem: Destruction',
    },
    req: 10,
    availableOptions: ['추가 피해', '보스 피해', '낙인력', '아군 공격 강화'],
  },
} as const satisfies Record<string, ArkGridGemSpec>;
export type ArkGridGemName = keyof typeof ArkGridGemSpecs;
export const ArkGridGemNames = Object.keys(ArkGridGemSpecs) as ArkGridGemName[];

export type ArkGridGemOption = {
  optionType: ArkGridGemOptionName;
  value: number;
};

export interface ArkGridGem {
  name?: ArkGridGemName;
  grade?: LostArkGrade;
  gemAttr: ArkGridAttr;
  req: number;
  point: number;
  option1: ArkGridGemOption;
  option2: ArkGridGemOption;
  assign?: number;
  isNew?: boolean;
}

export function gemFingerprint(gem: ArkGridGem): string {
  return `${gem.req}|${gem.point}|${gem.option1.optionType}|${gem.option1.value}|${gem.option2.optionType}|${gem.option2.value}`;
}

export function determineGemGrade(
  req: number,
  point: number,
  option1: ArkGridGemOption,
  option2: ArkGridGemOption,
  name?: ArkGridGemName
) {
  let basePoint = name ? ArkGridGemSpecs[name].req : 8;
  const totalPoint = basePoint - req + point + option1.value + option2.value;
  return totalPoint < 16 ? '전설' : totalPoint < 19 ? '유물' : '고대';
}
export function determineGemGradeByGem(gem: ArkGridGem) {
  let basePoint = gem.name ? ArkGridGemSpecs[gem.name].req : 8;
  const totalPoint = basePoint - gem.req + gem.point + gem.option1.value + gem.option2.value;
  return totalPoint < 16 ? '전설' : totalPoint < 19 ? '유물' : '고대';
}

export function isSameArkGridGem(a: ArkGridGem | undefined, b: ArkGridGem | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return (
    (a.name !== undefined && b.name !== undefined ? a.name === b.name : true) &&
    a.gemAttr === b.gemAttr &&
    a.req === b.req &&
    a.point === b.point &&
    isSameOption(a.option1, b.option1) &&
    isSameOption(a.option2, b.option2)
  );
}

function isSameOption(a: ArkGridGemOption, b: ArkGridGemOption): boolean {
  return a.optionType === b.optionType && a.value === b.value;
}

const MapGemNameImage: Record<ArkGridGemName, string> = {
  '질서의 젬 : 안정': 'order_0',
  '질서의 젬 : 견고': 'order_1',
  '질서의 젬 : 불변': 'order_2',
  '혼돈의 젬 : 침식': 'chaos_0',
  '혼돈의 젬 : 왜곡': 'chaos_1',
  '혼돈의 젬 : 붕괴': 'chaos_2',
};
const gemImages = import.meta.glob<string>('/src/assets/gems/*.png', {
  eager: true,
  import: 'default',
});

export function getGemImage(gemAttr?: ArkGridAttr, gemName?: ArkGridGemName): string {
  if (!gemName) {
    return gemAttr == '질서'
      ? gemImages['/src/assets/gems/order_0.png']
      : gemImages['/src/assets/gems/chaos_0.png'];
  }
  return gemImages[`/src/assets/gems/${MapGemNameImage[gemName] ?? 'order_0'}.png`];
}
