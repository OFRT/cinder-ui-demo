(function () {
  'use strict';
  var input = document.getElementById('site-search-input');
  var list = document.getElementById('site-results');
  if (!input || !list) { return; }
  var index = window.__CINDER_DOC_INDEX || [];
  var active = -1;
  var current = [];

  function norm(s) { return (s || '').toLowerCase(); }
  function summary(text, q) {
    var i = norm(text).indexOf(norm(q));
    if (i < 0) { return text.slice(0, 64); }
    var start = Math.max(0, i - 24);
    return (start > 0 ? '…' : '') + text.slice(start, start + 90);
  }
  function search(q) {
    var key = norm(q).trim();
    if (!key) { return []; }
    var hits = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i];
      var hay = norm(it.t + ' ' + it.x);
      if (hay.indexOf(key) >= 0) {
        var score = norm(it.t).indexOf(key) >= 0 ? 0 : 1;
        hits.push({ it: it, score: score });
      }
    }
    hits.sort(function (a, b) { return a.score - b.score; });
    return hits.slice(0, 8).map(function (h) { return h.it; });
  }
  function paint(q) {
    current = search(q);
    active = -1;
    if (!q.trim()) { list.removeAttribute('data-open'); list.innerHTML = ''; return; }
    if (!current.length) {
      list.innerHTML = '<li aria-disabled="true">没有匹配的页面</li>';
      list.setAttribute('data-open', '');
      return;
    }
    list.innerHTML = current.map(function (it, i) {
      return '<li role="option" data-i="' + i + '"><strong>' + it.t + '</strong><small>' + summary(it.x, q) + '</small></li>';
    }).join('');
    list.setAttribute('data-open', '');
  }
  function go(it) { location.href = it.s + '.html'; }

  input.addEventListener('input', function () { paint(input.value); });
  input.addEventListener('focus', function () { if (input.value) { paint(input.value); } });
  input.addEventListener('keydown', function (e) {
    var items = list.querySelectorAll('li[data-i]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) { return; }
      e.preventDefault();
      active = e.key === 'ArrowDown'
        ? (active + 1) % items.length
        : (active - 1 + items.length) % items.length;
      for (var i = 0; i < items.length; i++) {
        items[i].setAttribute('aria-selected', i === active ? 'true' : 'false');
      }
    } else if (e.key === 'Enter') {
      var pick = current[active >= 0 ? active : 0];
      if (pick) { go(pick); }
    } else if (e.key === 'Escape') {
      list.removeAttribute('data-open');
      input.blur();
    }
  });
  list.addEventListener('click', function (e) {
    var li = e.target.closest('li[data-i]');
    if (li) { go(current[Number(li.getAttribute('data-i'))]); }
  });
  document.addEventListener('click', function (e) {
    if (!list.contains(e.target) && e.target !== input) { list.removeAttribute('data-open'); }
  });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
})();
