/*
 * 일기·리포트 자동 모드 (선택). 이 도구에서 OpenAI 로 요청을 보내는 유일한 곳입니다.
 *
 * - 사용자가 「내보내기 → 설정」에 자기 OpenAI API 키를 넣었을 때만 부릅니다.
 *   키는 이 브라우저 localStorage 에만 두고, 코드·리포·백업 파일에는 없습니다(공개 리포).
 * - 보내는 것: 화면에 보이는 프롬프트 글자뿐입니다. 사진·좌표 원본은 보내지 않습니다
 *   (프롬프트에는 날짜·장소 이름·사진 장수·시간대·메모가 들어갑니다).
 * - 답은 「미리 보기」 칸에만 채웁니다. 본문에 넣는 것은 사람이 확인하고 누릅니다.
 */
(function (root) {
  'use strict';
  var ENDPOINT = 'https://api.openai.com/v1/chat/completions';

  // opts: { key, prompt, model } → Promise(답 글자)
  function write(opts) {
    if (!opts.key) return Promise.reject(new Error('OpenAI API 키를 먼저 넣어 주세요(내보내기 → 설정).'));
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + opts.key },
      body: JSON.stringify({
        model: opts.model || 'gpt-4o-mini',
        temperature: 0.7,
        messages: [{ role: 'user', content: opts.prompt }]
      })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (j) {
        if (!res.ok) {
          if (res.status === 401) throw new Error('OpenAI 키가 맞지 않습니다. 키를 다시 확인해 주세요.');
          if (res.status === 429) throw new Error('OpenAI 사용 한도에 걸렸습니다. 잠시 뒤 다시 하거나 결제 설정을 확인해 주세요.');
          throw new Error((j && j.error && j.error.message) || ('OpenAI 요청 실패 (HTTP ' + res.status + ')'));
        }
        return j && j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content || '' : '';
      });
    }, function () { throw new Error('OpenAI 에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'); });
  }

  root.JAI = { write: write, ENDPOINT: ENDPOINT };
})(window);
