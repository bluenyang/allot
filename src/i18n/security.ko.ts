// Korean messages of the password policy and API key management (spec 013 rc.3 W-20).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const securityKo = {
  security: {
    title: '보안',
    // password generator (S-24)
    generate: '만들기',
    generated: '만든 비밀번호',
    generatedNote: '저장하기 전에는 어디에도 보내지 않아요. 복사해 두세요.',
    copy: '복사',
    copied: '비밀번호를 복사했어요.',
    copyFailed: '복사하지 못했어요. 직접 선택해 복사하세요.',
    pwShort: '새 비밀번호는 {min}자 이상이어야 해요.',
    tempPwShort: '임시 비밀번호는 {min}자 이상이어야 해요.',
    minLine: '이 서버의 비밀번호 최소 길이: {min}자',
    // admin: the policy (S-24, S-26, A-37)
    minLength: '최소 길이',
    minLengthHint: '8~128자. 새로 정하는 비밀번호에만 적용돼요(이미 있는 짧은 비밀번호로도 로그인돼요).',
    signupRule: '가입 때 같은 규칙',
    signupRuleHint: '비밀번호 가입은 닫혀 있어서, 관리자가 계정을 만들 때의 임시 비밀번호가 가입 비밀번호예요. 같은 최소 길이를 따라요.',
    lockout: '연속 실패 잠금',
    lockoutHint: '켜면 같은 이메일로 비밀번호를 연달아 틀릴 때 그 이메일의 로그인을 잠시 막아요. 없는 계정의 이메일도 같게 세고 같게 답해요.',
    attempts: '실패 횟수',
    attemptsHint: '3~20회',
    minutes: '잠금 시간(분)',
    minutesHint: '1~1440분',
    defaultNote: '아직 정한 정책이 없어요: 최소 8자, 잠금 꺼짐(기본).',
    policySaved: '비밀번호 정책을 저장했어요.',
    locks: '잠긴 이메일',
    locksNone: '지금 잠긴 이메일이 없어요.',
    lockedUntil: '{date}까지',
    unlock: '잠금 풀기',
    unlockLabel: '{email} 잠금 풀기',
    unlocked: '{email} 잠금을 풀었어요.',
    // API key management (S-25)
    renameSave: '이름 저장',
    renamed: "키 이름을 '{name}'(으)로 바꿨어요.",
    scopeSave: '범위 저장',
    scopeSaved: '키 범위를 바꿨어요.',
    extendTo: '{n}일 · {date}까지',
    extendShorter: '지금보다 짧아져요',
    extendNone: '만료 없음',
    extendHint: '누른 때부터 그 날 수만큼으로 만료일이 바뀌어요.',
    extended: '만료일을 바꿨어요.',
    requests: '요청 수(최근 1분)',
    lastUsed: '마지막 사용',
    updateFailed: '키를 바꾸지 못했어요.',
  },
} as const

export type SecurityMessages = Widen<typeof securityKo>
