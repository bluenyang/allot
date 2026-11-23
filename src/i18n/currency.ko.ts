// Korean messages of the currency list and rate refresh (spec 013 rc.3 W-19).
// Merged in src/i18n/index.ts; kept in their own module so work on separate screens does not touch one file.
import type { Widen } from './ko'

export const currencyKo = {
  currency: {
    title: '통화',
    // settings › currency (S-23)
    baseFixed: 'KRW · 대한민국 원 (₩)',
    baseNote: '원화 고정 — 모든 금액·회차·분배가 원화예요.',
    uses: '구독 {subs}건 · 지출 {spendings}건',
    usesSubs: '구독 {n}건',
    usesSpendings: '지출 {n}건',
    rate: '₩{rate} / 1 {code}',
    manual: '직접 입력',
    autoAt: '자동 · {at}',
    autoNever: '자동 · 아직 갱신 전',
    autoFailed: '자동 · 마지막 갱신 실패',
    autoFailedWhy: '마지막 갱신 실패: {why}',
    refresh: '지금 갱신',
    refreshing: '갱신 중…',
    refreshed: '자동 환율을 갱신했어요',
    refreshOff: '이 서버는 환율 자동 갱신을 꺼 두었어요',
    addTitle: '외화 추가',
    code: '통화 코드',
    codeHint: 'ISO 4217 세 글자(예: EUR, JPY). 목록에서 고르거나 직접 적어요.',
    rateLabel: '{code} → KRW',
    rateHint: '1 {code}가 몇 원인지 적어요.',
    autoHint: '하루 한 번 공개 환율(ECB 기준)로 바꿔요. 받지 못하면 지금 값을 그대로 쓰고 실패를 보여요.',
    autoUnknownHint: '공개 환율에 없는 통화도 켤 수 있어요. 갱신이 안 되면 넣은 값을 그대로 써요.',
    deleteHint: '이 통화를 쓰는 구독이나 지출이 있으면 지울 수 없어요.',
    editLabel: '{code} 수정',
    why: {
      unknown_code: '공개 환율에 없는 통화예요',
      timeout: '환율 서비스가 제때 답하지 않았어요',
      network: '환율 서비스에 닿지 못했어요',
      bad_answer: '환율 서비스의 답을 읽지 못했어요',
      out_of_range: '받은 환율이 저장할 수 있는 범위 밖이에요',
      http: '환율 서비스 오류 ({status})',
    },
    // amounts in a foreign currency (S-23)
    vatForeignOnly: 'VAT는 외화 결제에만 쓰여요.',
    foreignN: '외화 {n}건',
    itemFx: ' ({code} {amount})',
    fxBufferAll: '외화 항목 환율 버퍼 {pct}%',
    fxBufferEach: '외화 항목 환율 버퍼(통화별)',
    // change history (S-23, S-22)
    tables: {
      foreign_currency: '통화',
      schedule_item: '기준 일정',
    },
    fields: {
      rate: '환율',
      auto: '자동 갱신',
      day: '날',
      direction: '방향',
    },
    system: '자동 갱신',
  },
} as const

export type CurrencyMessages = Widen<typeof currencyKo>
