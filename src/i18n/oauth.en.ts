// English messages of the external app connection screens (spec 015), typed against the Korean list (oauth.ko.ts).
import type { OAuthMessages } from './oauth.ko'

export const oauthEn: OAuthMessages = {
  oauth: {
    consent: {
      title: 'Connect an app',
      loading: 'Checking the connection request…',
      asks: '{name} wants to connect to your Allot.',
      returnsTo: 'If you allow it, you go back to',
      localhostWarn: 'This app only goes back to this computer (localhost). Unless you just started the connection yourself in a terminal or a desktop app, deny it.',
      choose: 'Permission for this app',
      read: 'Read',
      readDesc: 'Reads your data and cannot change it.',
      propose: 'Propose changes · confirm on the screen',
      proposeDesc: 'Proposes changes. They apply only after you confirm them in Pending changes.',
      apply: 'Propose changes · confirm in the chat',
      applyDesc: 'Shows a proposal, takes your answer in the chat, then applies it. You can revert it in the history.',
      notAsked: 'The app did not ask for this permission.',
      noneAsked: 'This app asked for no Allot permission. Deny it and check the app\'s settings.',
      allow: 'Allow',
      deny: 'Deny',
      sending: 'Sending…',
      failed: 'Could not finish. Connect again from the app.',
      account: 'Connecting with the account {email}.',
    },
  },
}
