/**
 * DANGUN 코인(DGN) 환산 공통 헬퍼
 * ─────────────────────────────────────────────
 * 사용법:
 *   DGN.init()               — 공개 설정 로드 (페이지 로드 시 1회)
 *   DGN.html(krw)            — "<br><small>≒ 1,000 DGN</small>" 반환
 *   DGN.inline(krw)          — "≒ 1,000 DGN" 텍스트만 반환
 *   DGN.applyAll()           — data-dgn-target 속성 요소 일괄 업데이트
 * ─────────────────────────────────────────────
 * HTML에서 금액 요소에 data-dgn-src="1000000" 넣으면
 * DGN.applyAll() 호출 시 자동으로 DGN 환산 표기 삽입.
 */
(function (global) {
  var _rate    = 0;        // 1 KRW = _rate DGN
  var _symbol  = 'DGN';
  var _enabled = false;
  var _loaded  = false;

  var DGN = {
    /* 공개 설정 로드 (비동기) */
    init: function () {
      return fetch('/api/settings/public')
        .then(function (r) { return r.json(); })
        .then(function (d) {
          _rate    = parseFloat(d.dangun_coin_rate   || '0') || 0;
          _symbol  = d.dangun_coin_symbol  || 'DGN';
          _enabled = d.dangun_coin_enabled !== '0';
          _loaded  = true;
          return { rate: _rate, symbol: _symbol, enabled: _enabled };
        })
        .catch(function () {
          _loaded = true;
          return { rate: 0, symbol: 'DGN', enabled: false };
        });
    },

    /* 환율값 직접 주입 (이미 로드된 경우 사용) */
    set: function (rate, symbol, enabled) {
      _rate    = parseFloat(rate)   || 0;
      _symbol  = symbol             || 'DGN';
      _enabled = enabled !== false;
      _loaded  = true;
    },

    get rate()    { return _rate; },
    get symbol()  { return _symbol; },
    get enabled() { return _enabled; },
    get loaded()  { return _loaded; },

    /* KRW → DGN 변환 (정수) */
    convert: function (krw) {
      if (!_enabled || _rate <= 0) return 0;
      return Math.round(Number(krw || 0) * _rate);
    },

    /* "<br><small class='dgn-sub'>≒ 1,000 DGN</small>" */
    html: function (krw) {
      if (!_enabled || _rate <= 0) return '';
      var dgn = Math.round(Number(krw || 0) * _rate);
      return '<br><small class="dgn-sub" style="font-size:10px;color:var(--accent-gold);opacity:0.85;font-family:\'Orbitron\',monospace;letter-spacing:0.04em;">≒ ' +
        dgn.toLocaleString('ko-KR') + ' ' + _symbol + '</small>';
    },

    /* "≒ 1,000 DGN" (텍스트) */
    inline: function (krw) {
      if (!_enabled || _rate <= 0) return '';
      var dgn = Math.round(Number(krw || 0) * _rate);
      return '≒ ' + dgn.toLocaleString('ko-KR') + ' ' + _symbol;
    },

    /**
     * data-dgn="KRW숫자" 속성을 가진 모든 요소에
     * DGN 환산 <small> 태그를 삽입한다.
     * 이미 .dgn-sub 자식이 있으면 업데이트한다.
     */
    applyAll: function () {
      if (!_enabled || _rate <= 0) return;
      document.querySelectorAll('[data-dgn]').forEach(function (el) {
        var krw = parseFloat(el.dataset.dgn) || 0;
        var dgn = Math.round(krw * _rate);
        var existing = el.querySelector('.dgn-sub');
        if (existing) {
          existing.textContent = '≒ ' + dgn.toLocaleString('ko-KR') + ' ' + _symbol;
        } else {
          var sm = document.createElement('small');
          sm.className = 'dgn-sub';
          sm.style.cssText = 'display:block;font-size:10px;color:var(--accent-gold);opacity:0.85;font-family:"Orbitron",monospace;letter-spacing:0.04em;margin-top:2px;';
          sm.textContent = '≒ ' + dgn.toLocaleString('ko-KR') + ' ' + _symbol;
          el.appendChild(sm);
        }
      });
    },

    /**
     * 특정 요소 ID에 DGN 환산 small 태그를 삽입/업데이트
     * @param {string} elId   대상 요소 ID
     * @param {number} krw    원화 금액
     */
    applyTo: function (elId, krw) {
      if (!_enabled || _rate <= 0) return;
      var el = document.getElementById(elId);
      if (!el) return;
      var dgn = Math.round(Number(krw || 0) * _rate);
      var existing = el.querySelector('.dgn-sub');
      if (existing) {
        existing.textContent = '≒ ' + dgn.toLocaleString('ko-KR') + ' ' + _symbol;
      } else {
        var sm = document.createElement('small');
        sm.className = 'dgn-sub';
        sm.style.cssText = 'display:block;font-size:10px;color:var(--accent-gold);opacity:0.85;font-family:"Orbitron",monospace;letter-spacing:0.04em;margin-top:2px;';
        sm.textContent = '≒ ' + dgn.toLocaleString('ko-KR') + ' ' + _symbol;
        el.appendChild(sm);
      }
    },
  };

  global.DGN = DGN;
}(window));
