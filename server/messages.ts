// Every message the server shows to a person, in both languages (spec 008 S-10). The screen sends
// `Accept-Language: ko|en`; `msg(c, key, vars)` picks the list. A missing or unknown language is Korean.
// MCP tool descriptions and errors stay English and do not come from here.
import type { Context } from 'hono'

export type Lang = 'ko' | 'en'
export type Vars = Record<string, string | number>

const ko = {
  // common
  invalidInput: '입력값을 확인해 주세요.',
  dateFormat: 'YYYY-MM-DD',
  monthFormat: 'YYYY-MM',
  invalidType: '값의 형식이 맞지 않아요.',
  tooSmall: '값이 너무 작거나 짧아요.',
  tooBig: '값이 너무 크거나 길어요.',
  invalidValue: '허용되지 않는 값이에요.',
  invalidFormat: '값의 모양이 맞지 않아요.',
  unknownField: '알 수 없는 항목이 있어요.',
  itemNotFound: '항목을 찾을 수 없어요.',
  pendingApproval: '관리자 승인을 기다리고 있어요.',
  appUnlisted: '등록되지 않은 앱 주소예요.',
  fkMissing: '연결된 항목을 찾을 수 없어요.',
  duplicate: '같은 항목이 이미 있어요. 하나만 둘 수 있는 항목이에요.',
  outOfRange: '입력값이 허용 범위를 벗어났어요.',
  // data rules
  phaseOverlap: "'{label} {name}' 구간({from}~{to})과 겹쳐요.",
  amountsFixedOnly: '구간 금액은 고정 대상에만 넣을 수 있어요.',
  oneLiving: "'생활비 합계' 대상은 하나만 둘 수 있어요.",
  oneSubscriptions: "'구독 이체액' 대상은 하나만 둘 수 있어요.",
  oneRemainder: "'나머지' 대상은 하나만 둘 수 있어요.",
  beforeNotTime: 'before는 시각이어야 해요.',
  beforeBoth: 'before와 beforeId는 함께 보내야 해요.',
  changeNotFound: '변경 묶음을 찾을 수 없어요.',
  changeReverted: '이미 되돌린 변경이에요. 되돌린 묶음을 되돌리면 다시 적용돼요.',
  changeLater: '이후에 바뀐 항목이 있어 되돌릴 수 없어요.',
  changeChild: '이후에 연결된 항목이 생겨서 되돌릴 수 없어요.',
  revertOverlap: "되돌리면 '{a}' 구간과 '{b}' 구간이 겹쳐요.",
  revertAmounts: '되돌리면 고정 대상이 아닌 곳에 구간 금액이 생겨요.',
  revertSpending: '되돌리면 "{name}"의 회차가 회차 수와 맞지 않게 돼요.',
  // proposals from an AI key (spec 009)
  proposalNotFound: '제안을 찾을 수 없어요.',
  proposalNotPending: '이미 처리된 제안이에요.',
  proposalExpired: '제안이 만료됐어요. AI에게 다시 제안하게 하세요.',
  proposalStale: '제안한 뒤 데이터가 바뀌었어요. AI에게 다시 제안하게 하세요.',
  proposalKeyGone: '이 제안을 올린 키를 더 쓸 수 없어요. 폐기됐거나 만료됐거나 쓰기 범위가 없어요.',
  proposalUiOnly: '이 제안은 Allot 화면에서 확인해야 해요.',
  proposalOwnKey: '이 키가 올린 제안만 다룰 수 있어요.',
  proposalTooMany: '대기 중인 제안이 {max}개예요. 먼저 확인하거나 거절해 주세요.',
  proposalNoEffect: '바뀌는 것이 없어요.',
  proposalRevertScope: 'AI는 이 변경 묶음을 되돌릴 수 없어요. 계좌·부채·공휴일·표시 설정이 들어 있어요.',
  proposalAt: '{n}번째 변경: ',
  proposalAccount: '이 계정은 지금 쓸 수 없어요.',
  // validation (zod)
  dateInvalid: '없는 날짜예요.',
  amountTooBig: '금액이 너무 커요.',
  hexColor: '색은 #RRGGBB 형식이에요.',
  holidayNameReq: '공휴일 이름을 입력해 주세요.',
  ruleOrDate: '반복 규칙(RRULE)이나 날짜(RDATE) 중 하나는 있어야 해요.',
  setNameReq: '세트 이름을 입력해 주세요.',
  rulesMax: '규칙은 100개까지예요.',
  builtinRules: '기본 세트의 규칙은 바꿀 수 없어요.',
  rulesNeeded: '규칙을 하나 이상 넣어 주세요.',
  serviceNameReq: '서비스 이름을 입력해 주세요.',
  changeFieldsReq: '바꿀 항목을 하나 이상 입력해 주세요.',
  phaseEndEarly: '끝 월이 시작 월보다 빨라요.',
  nameReq: '이름을 입력해 주세요.',
  spendRounds: '회차가 지출과 맞지 않아요.',
  spendHow: '내는 방식과 회차 수, 수수료, 간격이 맞지 않아요.',
  spendFx: 'USD 지출에는 환율이 필요하고, 원화에는 환율이 없어야 해요.',
  spendKrwWhole: '원화 금액은 정수여야 해요.',
  domainFormat: '도메인 형식이 아니에요.',
  emailFormat: '이메일 형식이 아니에요.',
  orgFormat: 'GitHub organization 이름이 아니에요.',
  urlFormat: 'URL 형식이 아니에요.',
  scopeFormat: 'scope 형식이 아니에요.',
  ymRange: 'YYYY-MM 또는 YYYY-MM~MM',
  keyNameReq: '키 이름을 적어 주세요.',
  keyConfirmNeedsWrite: '확인 방식은 쓰기 키에만 있어요.',
  keyNameMax: '키 이름은 32자까지예요.',
  keyDaysInt: '일 수는 정수예요.',
  keyDaysMin: '만료는 1일 이상이에요.',
  keyDaysMax: '만료는 365일까지예요.',
  // holiday rule problems (src/lib/holidays.ts ruleProblem)
  rule_tooLong: '규칙이 너무 길어요.',
  rule_freq: '공휴일 규칙은 FREQ=YEARLY만 쓸 수 있어요.',
  rule_dangiKey: '음력 규칙(RSCALE=DANGI)에는 {key}를 쓸 수 없어요.',
  rule_dangiMonth: '음력 규칙의 BYMONTH는 1~12 하나예요(윤달은 쓸 수 없어요).',
  rule_dangiDay: '음력 규칙의 BYMONTHDAY는 1~30 또는 -1, -2 하나예요.',
  rule_rscale: 'RSCALE={scale}는 쓸 수 없어요. 양력은 생략, 음력은 DANGI예요.',
  rule_key: '규칙에 {key}를 쓸 수 없어요.',
  rule_needMonth: '양력 규칙에는 BYMONTH(1~12)가 있어야 해요.',
  rule_month: 'BYMONTH는 1~12예요.',
  rule_monthday: 'BYMONTHDAY는 1~31 또는 -1~-31이에요.',
  rule_byday: 'BYDAY는 MO~SU, 몇째 주는 1MO·-1FR처럼 써요.',
  rule_setpos: 'BYSETPOS 값이 범위를 벗어났어요.',
  rule_noDates: '이 규칙으로는 날짜가 나오지 않아요.',
  rule_parse: '규칙을 읽지 못했어요: {reason}',
  // admin
  adminOnly: '관리자만 쓸 수 있어요.',
  envLocked: 'env로 정한 항목은 화면에서 바꿀 수 없어요.',
  providerUnknown: '없는 로그인 방식이에요.',
  nothingToChange: '바꿀 항목이 없어요.',
  passwordToggleOnly: '비밀번호는 켜고 끄기만 할 수 있어요.',
  ruleNotAllowed: '{id}에는 {rule} 규칙을 쓸 수 없어요.',
  oidcOnly: '{opt}는 OIDC에만 있어요.',
  passwordOffNoAdmin: '비밀번호를 끄면 관리자가 로그인할 방법이 없어요. 관리자 계정에 다른 로그인 방식을 먼저 연결해 주세요.',
  applyFailed: '설정을 적용하지 못했어요. 이전 설정으로 되돌렸어요.',
  userMissing: '없는 사용자예요.',
  lastAdminDemote: '마지막 관리자는 사용자로 바꿀 수 없어요.',
  lastAdminBan: '마지막 관리자는 정지할 수 없어요.',
  lastAdminDelete: '마지막 관리자는 지울 수 없어요.',
  selfBan: '자기 자신은 정지할 수 없어요.',
  selfDelete: '자기 자신은 지울 수 없어요.',
  confirmEmail: '확인 이메일이 그 사용자의 이메일과 달라요.',
  adminFieldsOnly: '이름과 승인만 바꿀 수 있어요.',
  adminStatusOnly: '승인(활성)으로만 바꿀 수 있어요.',
  badName: '이름을 확인해 주세요.',
  extraFields: '추가 필드는 받을 수 없어요.',
  badRole: "역할은 'admin' 또는 'user'예요.",
  // login methods
  methodDisabled: '사용할 수 없는 로그인 방식이에요.',
  idTokenDisabled: '이 방식으로는 로그인할 수 없어요.',
  signupClosed: '이 로그인 방식으로는 새 계정을 만들 수 없어요.',
  notAllowed: '허용된 사용자가 아니에요.',
  userNotFound: '사용자를 찾을 수 없어요.',
  notLinked: '이미 있는 계정과 연결되어 있지 않아요.',
  clientIdMissing: 'client id가 없어요.',
  clientSecretMissing: 'client secret이 없어요.',
  discoveryMissing: 'discovery URL이 없어요.',
  discoveryNotUrl: 'discovery URL이 URL이 아니에요.',
  discoveryHttps: '운영에서는 discovery URL이 https여야 해요.',
  scopeOpenid: "scope에 'openid'가 있어야 해요.",
  groupsClaimEmpty: 'group 클레임 이름이 비어 있어요.',
  lostSecret: '저장된 client secret을 풀 수 없어요. 마스터 키가 바뀌었다면 이전 키를 ALLOT_MASTER_KEY_PREVIOUS에 넣거나, secret을 다시 넣어 주세요(README: 암호화 키).',
  discoveryConnect: 'discovery URL에 연결하지 못했어요.',
  discoveryStatus: 'discovery URL이 {status}로 답했어요.',
  discoveryJson: 'discovery 응답이 JSON이 아니에요.',
  discoveryField: 'discovery 문서에 {field}가 없어요.',
  issuerHttps: '운영에서는 issuer가 https여야 해요.',
  // API keys
  keyNoExpiry: '이 서버는 만료 없는 키를 허용하지 않아요.',
  keyMax: '키는 {max}개까지 만들 수 있어요.',
  keyCreateFailed: '키를 만들지 못했어요.',
  keyMissing: '없는 키예요.',
} as const

export type MsgKey = keyof typeof ko

const en: Record<MsgKey, string> = {
  invalidInput: 'Please check the values you entered.',
  dateFormat: 'YYYY-MM-DD',
  monthFormat: 'YYYY-MM',
  invalidType: 'The value is the wrong type.',
  tooSmall: 'The value is too small or too short.',
  tooBig: 'The value is too large or too long.',
  invalidValue: 'That value is not allowed.',
  invalidFormat: 'The value is not in the right format.',
  unknownField: 'There is an unknown field.',
  itemNotFound: 'Item not found.',
  pendingApproval: 'Waiting for admin approval.',
  appUnlisted: 'This app address is not registered.',
  fkMissing: 'A linked item could not be found.',
  duplicate: 'That item already exists. Only one is allowed.',
  outOfRange: 'A value is outside the allowed range.',
  phaseOverlap: "Overlaps the '{label} {name}' phase ({from} to {to}).",
  amountsFixedOnly: 'Phase amounts can only be set for fixed targets.',
  oneLiving: "Only one 'Living total' target is allowed.",
  oneSubscriptions: "Only one 'Subscription transfer' target is allowed.",
  oneRemainder: "Only one 'Remainder' target is allowed.",
  beforeNotTime: 'before must be a timestamp.',
  beforeBoth: 'before and beforeId must be sent together.',
  changeNotFound: 'Change set not found.',
  changeReverted: 'This change was already reverted. Reverting the revert applies it again.',
  changeLater: 'Something changed afterwards, so this cannot be reverted.',
  changeChild: 'Something was linked to it afterwards, so this cannot be reverted.',
  revertOverlap: "Reverting would make the '{a}' and '{b}' phases overlap.",
  revertAmounts: 'Reverting would leave a phase amount on a target that is not fixed.',
  revertSpending: 'Reverting would leave the rounds of "{name}" not matching its count.',
  // proposals from an AI key (spec 009)
  proposalNotFound: 'Proposal not found.',
  proposalNotPending: 'This proposal has already been handled.',
  proposalExpired: 'The proposal has expired. Ask the AI to propose it again.',
  proposalStale: 'Your data changed after the proposal was made. Ask the AI to propose it again.',
  proposalKeyGone: 'The key that made this proposal can no longer be used: it was revoked, has expired or has no write scope.',
  proposalUiOnly: 'This proposal must be confirmed in Allot.',
  proposalOwnKey: 'A key can handle only the proposals it made.',
  proposalTooMany: 'There are already {max} pending proposals. Confirm or reject some first.',
  proposalNoEffect: 'Nothing would change.',
  proposalRevertScope: 'An AI cannot revert this change set: it touches accounts, debts, holiday sets or display settings.',
  proposalAt: 'Change {n}: ',
  proposalAccount: 'This account cannot be used right now.',
  dateInvalid: 'That date does not exist.',
  amountTooBig: 'The amount is too large.',
  hexColor: 'Colors use the #RRGGBB format.',
  holidayNameReq: 'Enter a holiday name.',
  ruleOrDate: 'A holiday needs a recurrence rule (RRULE) or dates (RDATE).',
  setNameReq: 'Enter a set name.',
  rulesMax: 'A set can have up to 100 rules.',
  builtinRules: "A built-in set's rules cannot be changed.",
  rulesNeeded: 'Add at least one rule.',
  serviceNameReq: 'Enter the service name.',
  changeFieldsReq: 'Enter at least one field to change.',
  phaseEndEarly: 'The end month is before the start month.',
  nameReq: 'Enter a name.',
  spendRounds: 'The rounds do not match the spending.',
  spendHow: 'The way to pay does not match the number of rounds, the fee or the interval.',
  spendFx: 'A USD spending needs an exchange rate; a KRW one has none.',
  spendKrwWhole: 'A KRW amount must be a whole number.',
  domainFormat: 'Not a valid domain.',
  emailFormat: 'Not a valid email address.',
  orgFormat: 'Not a valid GitHub organization name.',
  urlFormat: 'Not a valid URL.',
  scopeFormat: 'Not a valid scope.',
  ymRange: 'YYYY-MM or YYYY-MM~MM',
  keyNameReq: 'Enter a key name.',
  keyConfirmNeedsWrite: 'A confirmation method belongs to a write key only.',
  keyNameMax: 'A key name can be up to 32 characters.',
  keyDaysInt: 'Days must be a whole number.',
  keyDaysMin: 'Expiry must be at least 1 day.',
  keyDaysMax: 'Expiry can be at most 365 days.',
  rule_tooLong: 'The rule is too long.',
  rule_freq: 'Holiday rules only support FREQ=YEARLY.',
  rule_dangiKey: 'A lunar rule (RSCALE=DANGI) cannot use {key}.',
  rule_dangiMonth: 'BYMONTH in a lunar rule is a single value from 1 to 12 (leap months are not supported).',
  rule_dangiDay: 'BYMONTHDAY in a lunar rule is a single value from 1 to 30, or -1 or -2.',
  rule_rscale: 'RSCALE={scale} is not supported. Leave it out for the solar calendar, or use DANGI for the lunar one.',
  rule_key: 'The rule cannot use {key}.',
  rule_needMonth: 'A solar rule needs BYMONTH (1 to 12).',
  rule_month: 'BYMONTH is 1 to 12.',
  rule_monthday: 'BYMONTHDAY is 1 to 31, or -1 to -31.',
  rule_byday: 'BYDAY is MO to SU; for the nth week write 1MO or -1FR.',
  rule_setpos: 'BYSETPOS is out of range.',
  rule_noDates: 'This rule never produces a date.',
  rule_parse: 'Could not read the rule: {reason}',
  adminOnly: 'Admins only.',
  envLocked: 'Settings fixed by env cannot be changed here.',
  providerUnknown: 'No such login method.',
  nothingToChange: 'Nothing to change.',
  passwordToggleOnly: 'Password login can only be turned on or off.',
  ruleNotAllowed: '{id} does not support {rule} rules.',
  oidcOnly: '{opt} is only available for OIDC.',
  passwordOffNoAdmin: 'With password login off, no admin could sign in. Link another login method to an admin account first.',
  applyFailed: 'Could not apply the settings. The previous settings were restored.',
  userMissing: 'No such user.',
  lastAdminDemote: 'The last admin cannot be changed to a regular user.',
  lastAdminBan: 'The last admin cannot be banned.',
  lastAdminDelete: 'The last admin cannot be deleted.',
  selfBan: 'You cannot ban yourself.',
  selfDelete: 'You cannot delete yourself.',
  confirmEmail: "The confirmation email does not match the user's email.",
  adminFieldsOnly: 'Only the name and approval can be changed.',
  adminStatusOnly: 'The status can only be changed to approved (active).',
  badName: 'Check the name.',
  extraFields: 'Extra fields are not accepted.',
  badRole: "The role is 'admin' or 'user'.",
  methodDisabled: 'This login method is not available.',
  idTokenDisabled: 'Signing in this way is not allowed.',
  signupClosed: 'New accounts cannot be created with this login method.',
  notAllowed: 'This user is not allowed.',
  userNotFound: 'User not found.',
  notLinked: 'This login is not linked to the existing account.',
  clientIdMissing: 'The client id is missing.',
  clientSecretMissing: 'The client secret is missing.',
  discoveryMissing: 'The discovery URL is missing.',
  discoveryNotUrl: 'The discovery URL is not a URL.',
  discoveryHttps: 'In production the discovery URL must use https.',
  scopeOpenid: "The scopes must include 'openid'.",
  groupsClaimEmpty: 'The groups claim name is empty.',
  lostSecret: 'The saved client secret cannot be decrypted. If the master key changed, put the old key in ALLOT_MASTER_KEY_PREVIOUS, or enter the secret again (README: encryption keys).',
  discoveryConnect: 'Could not connect to the discovery URL.',
  discoveryStatus: 'The discovery URL answered {status}.',
  discoveryJson: 'The discovery response is not JSON.',
  discoveryField: 'The discovery document has no {field}.',
  issuerHttps: 'In production the issuer must use https.',
  keyNoExpiry: 'This server does not allow keys without an expiry.',
  keyMax: 'You can create up to {max} keys.',
  keyCreateFailed: 'Could not create the key.',
  keyMissing: 'No such key.',
}

const lists: Record<Lang, Record<MsgKey, string>> = { ko, en }

/** A message and its values, not yet in a language: what a rule that fails deep in the code carries up to the route. */
export interface Msg { key: MsgKey; vars?: Vars }
export const m = (key: MsgKey, vars?: Vars): Msg => ({ key, vars })

/** An error that carries a message to translate where the request (and its language) is known. */
export class MsgError extends Error {
  constructor(public ref: Msg) { super(text('en', ref)) }
}

/** The language of an Accept-Language header: the first listed tag (by q) that is ko or en; else Korean. */
export function langFromHeader(h: string | null | undefined): Lang {
  const tags = (h ?? '').split(',').map((part, i) => {
    const [tag = '', ...params] = part.trim().split(';')
    const q = Number(params.find((p) => p.trim().startsWith('q='))?.trim().slice(2) ?? 1)
    return { tag: tag.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0, i }
  }).filter((x) => x.tag).sort((a, b) => b.q - a.q || a.i - b.i)
  for (const { tag } of tags) {
    if (tag === 'en' || tag.startsWith('en-')) return 'en'
    if (tag === 'ko' || tag.startsWith('ko-')) return 'ko'
  }
  return 'ko'
}

export const langOf = (c: Context) => langFromHeader(c.req.header('accept-language'))

/** The message in `lang`, `{name}` replaced by the values. */
export function text(lang: Lang, ref: Msg | MsgKey, vars?: Vars): string {
  const { key, vars: v } = typeof ref === 'string' ? { key: ref, vars } : ref
  const all = { ...v, ...vars }
  return lists[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => String(all[k] ?? `{${k}}`))
}

/** The message for this request's language. */
export const msg = (c: Context, ref: Msg | MsgKey, vars?: Vars) => text(langOf(c), ref, vars)

/** A zod issue message: a key, or a JSON {key, vars} for messages with values; anything else is shown as it is. */
export function issueText(lang: Lang, message: string | undefined): string {
  if (!message) return text(lang, 'invalidInput')
  if (message in ko) return text(lang, message as MsgKey)
  if (message.startsWith('{"key"')) {
    try { return text(lang, JSON.parse(message) as Msg) } catch { /* not ours */ }
  }
  return message
}

/** What a rule says when it names no message of ours: zod's text is English, so the issue's kind picks a generic message. */
const byCode: Record<string, MsgKey> = {
  invalid_type: 'invalidType',
  too_small: 'tooSmall',
  too_big: 'tooBig',
  invalid_value: 'invalidValue',
  invalid_format: 'invalidFormat',
  not_multiple_of: 'invalidValue',
  invalid_key: 'invalidValue',
  invalid_element: 'invalidValue',
  invalid_union: 'invalidInput',
  unrecognized_keys: 'unknownField',
  custom: 'invalidInput',
}

/** The message of a zod issue in `lang`: our key (explicit) when the rule has one, else a generic one by the issue's code; never zod's own English. */
export function issueMessage(lang: Lang, issue: { code?: string; message?: string } | undefined): string {
  const m = issue?.message
  if (m && (m in ko || m.startsWith('{"key"'))) return issueText(lang, m)
  return text(lang, byCode[issue?.code ?? ''] ?? 'invalidInput')
}

/** The language of a request given to a Better Auth hook (it has headers or a request). */
export function langOfCtx(ctx: unknown): Lang {
  const c = ctx as { headers?: Headers; request?: Request } | null
  return langFromHeader((c?.headers ?? c?.request?.headers)?.get('accept-language'))
}

export const MSG_KEYS = Object.keys(ko) as MsgKey[]
export const MESSAGES = lists
