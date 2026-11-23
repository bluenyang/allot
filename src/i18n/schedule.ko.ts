// Korean messages of the time zone and own monthly dates (spec 013 rc.3 W-18).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const scheduleKo = {
  schedule: {
    title: '기준 일정',
    tzHint: '화면의 "오늘"·"이번 달"과 AI 도구가 이 시간대를 따라요',
    tzSaved: '시간대를 바꿨어요',
    listLabel: '내 기준 일정',
    monthlyN: '매달 {n}일',
    editLabel: '{name} 수정',
    noAccount: '통장 없음',
    addTitle: '기준 일정 추가',
    editTitle: '기준 일정 수정',
    desc: '급여일·이체일·카드 결제일 밖에 매달 돌아오는 날이에요. 달력과 일정에 보이고, 주말·공휴일이면 위와 같은 규칙으로 옮겨요. 금액은 적지 않아요.',
    name: '이름',
    namePh: '예: 관리비',
    needName: '이름을 적어 주세요',
    day: '매달 날',
    dayOf: '{n}일',
    dayHint: '그 달에 없는 날(31일 등)은 그 달 마지막 날이에요',
    account: '통장',
    accountNone: '정하지 않음',
    direction: '돈의 방향',
    dirIn: '들어오는 돈',
    dirOut: '나가는 돈',
    note: '메모',
    foot: '저장하면 변경 내역에 남아요',
    kind: {
      in: '들어옴',
      out: '나감',
    },
  },
} as const

export type ScheduleMessages = Widen<typeof scheduleKo>
