// English messages of the goal cards of Pending changes (spec 013 W-8), typed against the Korean list (goals.ko.ts).
import type { GoalsMessages } from './goals.ko'

export const goalsEn: GoalsMessages = {
  goals: {
    title: 'Goal reached',
    suffix: 'account',
    body: '{name} has reached its goal of {goal} (expected {ym}). Stop sending to this account?',
    bodyNamed: '{name} has reached its goal of {goal} (expected {ym}). Stop sending to this account?',
    waiting: 'Waiting',
    changes: 'What changes from {ym}',
    send: 'Sent to {name}',
    remainder: 'Left over in {ym}',
    hint: 'Stopping makes this account’s amount 0 from {ym}; it stays left over. You can revert it in History, or send again from the account window.',
    stop: 'Stop',
    keep: 'Keep sending',
    stopped: 'Stopped sending to {name} from {ym}',
    kept: 'Still sending to {name}. You will be asked again if the goal changes',
    toHistory: 'History',
    maturityTitle: 'Maturity',
    maturityBody: '{name} matures in {ym}. Stop sending to this account?',
    maturityHint: 'Stopping makes this product’s amount 0 from {ym}; it stays left over. You can revert it in History. Keep sending is remembered in this browser only.',
    maturityKept: 'Still sending to {name}. Remembered in this browser only',
  },
}
