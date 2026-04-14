import { persistedState } from 'svelte-persisted-state';

import {
  type ArkGridAttr,
  ArkGridAttrs,
  DEFAULT_PROFILE_NAME,
  LostArkGrades,
} from '../constants/enums';
import {
  type ArkGridCore,
  type ArkGridCoreType,
  ArkGridCoreTypes,
  createCore,
} from '../models/arkGridCores';
import { type ArkGridGem, determineGemGrade } from '../models/arkGridGems';
import type { GemSetPackTuple } from '../solver/models';
import { addNewProfile, appConfig, getProfile, initArkGridCores } from './appConfig.state.svelte';

export let currentProfileName = persistedState<string>('currentProfileName', DEFAULT_PROFILE_NAME);
export interface AllGems {
  orderGems: ArkGridGem[];
  chaosGems: ArkGridGem[];
}
export type WeaponInfo = {
  fixed: number;
  percent: number;
};
export interface CharacterProfile {
  characterName: string;
  gems: AllGems;
  cores: Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>;
  isSupporter: boolean;
  weapon?: WeaponInfo;
  solveInfo: SolveInfo;
}

// 결과

// 준비물
export type SolveBefore = {
  coreGoalPoint: number[]; // not used
};

// 최적화 결과
export type SolveAnswerScoreSet = {
  score: number;
  bestScore: number;
  perfectScore: number;
};
export type SolveAnswer = {
  assignedGems: ArkGridGem[][];
  gemSetPackTuple: GemSetPackTuple;
};
export type AdditionalGemResult = Record<
  ArkGridAttr,
  Record<
    string, // 10,17,17와 같이 corePointTuple을 문자열로 만든 것
    {
      corePointTuple: [number, number, number];
      gems: ArkGridGem[];
      score: number;
    }
  >
>;
export type NeedLauncherGem = Record<ArkGridAttr, boolean>;
export type SolveAfter = {
  solveAnswer?: SolveAnswer;
  scoreSet?: SolveAnswerScoreSet;
  answerCores?: Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>;
  additionalGemResult?: AdditionalGemResult;
  needLauncherGem?: NeedLauncherGem;
  gemSnapshot?: ArkGridGem[];
};
export type SolveInfo = {
  before: SolveBefore;
  after?: SolveAfter;
};
export function updateSolveAnswer(solveAnswer: SolveAnswer) {
  // 현재 프로필의 solve after에 solve answer 설정
  const profile = getCurrentProfile();
  if (!profile.solveInfo.after) {
    profile.solveInfo.after = {
      solveAnswer: solveAnswer,
    };
  } else {
    profile.solveInfo.after.solveAnswer = solveAnswer;
  }
}

export function updateScoreSet(scoreSet: SolveAnswerScoreSet) {
  // 현재 프로필의 solve after에 score set 설정
  const profile = getCurrentProfile();
  if (!profile.solveInfo.after) {
    profile.solveInfo.after = {
      scoreSet: scoreSet,
    };
  } else {
    profile.solveInfo.after.scoreSet = scoreSet;
  }
}

export function updateAnswerCores(
  cores: Record<ArkGridAttr, Record<ArkGridCoreType, ArkGridCore | null>>
) {
  // 현재 프로필의 solve after에 answer core 설정
  const profile = getCurrentProfile();
  if (!profile.solveInfo.after) {
    profile.solveInfo.after = {
      answerCores: cores,
    };
  } else {
    profile.solveInfo.after.answerCores = cores;
  }
}

export function updateAdditionalGemResult(additionalGemResult: AdditionalGemResult) {
  // 현재 프로필의 solve after에 additionalGemResult 설정
  const profile = getCurrentProfile();
  if (!profile.solveInfo.after) {
    profile.solveInfo.after = {
      additionalGemResult: additionalGemResult,
    };
  } else {
    profile.solveInfo.after.additionalGemResult = additionalGemResult;
  }
}

export function updateNeedLauncherGem(needLauncherGem: NeedLauncherGem) {
  // 현재 프로필의 solve after에 additionalGemResult 설정
  const profile = getCurrentProfile();
  if (!profile.solveInfo.after) {
    profile.solveInfo.after = {
      needLauncherGem: needLauncherGem,
    };
  } else {
    profile.solveInfo.after.needLauncherGem = needLauncherGem;
  }
}

export function updateSolveAfter(data: SolveAfter) {
  const profile = getCurrentProfile();
  profile.solveInfo.after = data;
}

export function initNewProfile(name: string): CharacterProfile {
  return {
    characterName: name,
    gems: {
      orderGems: [],
      chaosGems: [],
    },
    cores: initArkGridCores(),
    isSupporter: false,
    solveInfo: {
      before: {
        coreGoalPoint: [0, 0, 0, 0, 0, 0],
      },
    },
  };
}

export function migrateProfile(profile: Partial<CharacterProfile>) {
  // 업데이트로 추가되는 required 필드를 추가

  // 1. profile.isSupporter
  if (profile.isSupporter === undefined) {
    // console.log("isSupporter 정의 안돼있어서 추가!")
    profile.isSupporter = false;
  }
  // 2. profile.solveInfo
  if (profile.solveInfo === undefined) {
    // console.log(profile, "solveInfo추가!")
    profile.solveInfo = {
      before: { coreGoalPoint: [0, 0, 0, 0, 0, 0] },
    };
  }

  // 3. core.goalPoint
  for (const attr of Object.values(ArkGridAttrs)) {
    for (const ctype of Object.values(ArkGridCoreTypes)) {
      if (profile.cores) {
        // 당연히 있겠지만...
        const core = profile.cores[attr][ctype];
        if (core && core.goalPoint === undefined) {
          // console.log(core, "에 goalpoint 추가!")
          core.goalPoint = 0;
        }
      }
    }
  }
}

export function getCurrentProfile() {
  // 현재 프로필을 반드시 반환합니다.
  // 프로필을 찾았다면 반환
  const profile = getProfile(currentProfileName.current);
  if (profile) return profile;
  else {
    // 기본 프로필을 찾고 있으면 변경하고 반환
    const defaultProfile = getProfile(DEFAULT_PROFILE_NAME);
    setCurrentProfileName(DEFAULT_PROFILE_NAME);
    if (defaultProfile) return defaultProfile;

    // 기본 프로필이 없다면 생성 후 반환
    const newDefaultProfile = initNewProfile(DEFAULT_PROFILE_NAME);
    if (!addNewProfile(newDefaultProfile)) {
      throw Error('기본 프로필 생성 실패!');
    }
    return newDefaultProfile;
  }
}

export function setCurrentProfileName(name: string) {
  currentProfileName.current = name;
}

export function deleteProfile(name: string) {
  if (name === DEFAULT_PROFILE_NAME) return;
  const profiles = appConfig.current.characterProfiles;
  const index = profiles.findIndex((p) => p.characterName === name);

  if (index === -1) return;
  if (currentProfileName.current === name) {
    setCurrentProfileName(profiles[index - 1].characterName);
  }
  profiles.splice(index, 1);
  // 삭제한 프로필이 현재 선택된 프로필이면 초기화
}

export function updateProfileCharacterName(name: string) {
  // 현재 프로필의 이름을 수정합니다.
  const existProfile = appConfig.current.characterProfiles.findIndex(
    (p) => p.characterName === name
  );
  if (existProfile != -1) return false;
  const profile = getCurrentProfile();
  profile.characterName = name;
}

export function addGem(gem: ArkGridGem) {
  const gems = getCurrentProfile().gems;
  const targetGems = gem.gemAttr == '질서' ? gems.orderGems : gems.chaosGems;
  gem.grade = determineGemGrade(gem.req, gem.point, gem.option1, gem.option2, gem.name);
  // validate gem (안정인데 옵션 등)
  targetGems.push(gem);
}

export function clearGems(gemAttr?: ArkGridAttr) {
  const gems = getCurrentProfile().gems;
  switch (gemAttr) {
    case '질서':
      gems.orderGems.length = 0;
      break;
    case '혼돈':
      gems.chaosGems.length = 0;
      break;
    default:
      gems.orderGems.length = 0;
      gems.chaosGems.length = 0;
  }
}

export function deleteGem(gem: ArkGridGem) {
  const gems = getCurrentProfile().gems;
  const targetGems = gem.gemAttr === '질서' ? gems.orderGems : gems.chaosGems;

  // 배열에서 gem 제거
  const index = targetGems.indexOf(gem);
  if (index !== -1) {
    targetGems.splice(index, 1);
  }
}
export function unassignGems() {
  const gems = getCurrentProfile().gems;
  gems.orderGems.forEach((g) => {
    delete g.assign;
  });
  gems.chaosGems.forEach((g) => {
    delete g.assign;
  });
}

export function getCore(attr: ArkGridAttr, ctype: ArkGridCoreType) {
  const cores = getCurrentProfile().cores;
  return cores[attr][ctype];
}
export function addCore(attr: ArkGridAttr, ctype: ArkGridCoreType, isSupporter: boolean) {
  const profile = getCurrentProfile();
  const cores = profile.cores;
  cores[attr][ctype] = createCore(attr, ctype, '영웅', isSupporter, profile.weapon);
}
export function resetCore(attr: ArkGridAttr, ctype: ArkGridCoreType) {
  const cores = getCurrentProfile().cores;
  cores[attr][ctype] = null;
}
export function clearCores() {
  const cores = getCurrentProfile().cores;
  for (const attr of Object.values(ArkGridAttrs)) {
    for (const ctype of Object.values(ArkGridCoreTypes)) {
      cores[attr][ctype] = null;
    }
  }
}
export function updateCore(attr: ArkGridAttr, ctype: ArkGridCoreType, core: ArkGridCore) {
  const cores = getCurrentProfile().cores;
  cores[attr][ctype] = JSON.parse(JSON.stringify(core));
}

export function updateIsSupporter(v: boolean) {
  const profile = getCurrentProfile();
  profile.isSupporter = v;
}

export function updateWeapon(fixed: number, percent: number) {
  const profile = getCurrentProfile();
  profile.weapon = {
    fixed,
    percent,
  };
}

export const roleImages = import.meta.glob<string>('/src/assets/role/*.webp', {
  eager: true,
  import: 'default',
});
export const imgRoleCombat = roleImages['/src/assets/role/combat.webp'];
export const imgRoleSupporter = roleImages['/src/assets/role/supporter.webp'];
