// 외부 앱 연결(OAuth) 화면의 문구 (spec 015 S-5, S-10, S-11): 동의 화면, 연결된 앱, 관리 › 로그인 방식의 스위치.
export const oauthKo = {
  oauth: {
    consent: {
      title: '앱 연결',
      loading: '연결 요청을 확인하는 중…',
      asks: '{name} 앱이 내 Allot에 연결하려고 해요.',
      returnsTo: '허락하면 돌아갈 곳',
      localhostWarn: '이 앱은 이 컴퓨터(localhost)로만 돌아가요. 내가 지금 터미널이나 데스크톱 앱에서 직접 연결을 시작한 게 아니라면 거절하세요.',
      choose: '이 앱에 줄 권한',
      read: '읽기',
      readDesc: '내 데이터를 읽기만 하고 바꾸지 못해요.',
      propose: '쓰기 제안 · 화면에서 확인',
      proposeDesc: '변경을 제안해요. \'대기 중인 변경\'에서 내가 확인해야 적용돼요.',
      apply: '쓰기 제안 · 대화에서 확인',
      applyDesc: '제안을 보여 주고 대화에서 내 답을 받은 뒤 적용해요. 변경 내역에서 되돌릴 수 있어요.',
      notAsked: '앱이 요청하지 않은 권한이에요.',
      noneAsked: '이 앱은 Allot 권한을 하나도 요청하지 않았어요. 거절하고 앱의 설정을 확인하세요.',
      allow: '허락',
      deny: '거절',
      sending: '보내는 중…',
      failed: '처리하지 못했어요. 앱에서 다시 연결해 주세요.',
      account: '{email} 계정으로 연결해요.',
    },
  },
}

export type OAuthMessages = typeof oauthKo
