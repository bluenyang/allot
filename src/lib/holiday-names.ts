// Holiday names for the screen (spec 008 S-9). The holiday code keeps the stored (Korean) names as
// data; the built-in set and its substitute holidays are shown in English when the screen is English.
// A name the user typed in their own set is shown as it is.
import { KR_NAME, KR_NAME_EN, KR_NAMES_EN } from '../data/holidays-kr'
import { lang, t } from '../i18n'

const SUBSTITUTE = /^대체공휴일\((.+)\)$/

/** The name to show for a holiday name as the holiday code returns it. */
export function holidayName(name: string): string {
  if (lang.value !== 'en') return name
  const sub = SUBSTITUTE.exec(name)
  if (sub) return t('holiday.substitute', { name: KR_NAMES_EN[sub[1]!] ?? sub[1]! })
  return KR_NAMES_EN[name] ?? name
}

/** The name to show for a holiday set (the built-in one follows the language). */
export function setName(set: { name: string; builtin?: string | null }): string {
  return lang.value === 'en' && (set.builtin === 'kr' || set.name === KR_NAME) ? KR_NAME_EN : set.name
}
