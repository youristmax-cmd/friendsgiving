// The shared menu: claimed slots grouped by course, refreshed in place.
(function () {
  var COURSES = ['To Start', 'The Main', 'Sides', 'Sweets', 'Drinks'];
  var REFRESH_MS = 45000;

  var params = new URLSearchParams(location.search);
  var me = params.get('me') || '';
  if (me) FG.store.setClaim(me);
  else me = FG.store.getClaim();

  var coursesEl = document.getElementById('courses');
  var progressEl = document.getElementById('progress');
  var banner = document.getElementById('banner');
  var bannerLine = document.getElementById('banner-line');
  var lastJson = '';
  var timer = null;

  function progressLine(n) {
    return n === 0 ? 'the table is being set' : (n === 1 ? 'one dish on the table so far' : n + ' dishes on the table so far');
  }

  function node(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function render(entries) {
    var order = COURSES.slice();
    entries.forEach(function (e) { if (order.indexOf(e.course) < 0) order.push(e.course); });
    coursesEl.textContent = '';
    var mine = null;
    order.forEach(function (course) {
      var list = entries.filter(function (e) { return e.course === course; });
      if (!list.length) return;
      var section = node('section', 'course');
      var head = node('h2', 'course-head');
      var leafL = node('img');
      leafL.src = '../assets/oak-leaf.png';
      leafL.alt = '';
      var leafR = leafL.cloneNode();
      leafR.className = 'flip';
      head.appendChild(node('span', 'rule'));
      head.appendChild(leafL);
      head.appendChild(node('span', 'course-name', course));
      head.appendChild(leafR);
      head.appendChild(node('span', 'rule'));
      section.appendChild(head);
      var ul = node('ul', 'entries');
      list.forEach(function (e) {
        var li = node('li', 'entry' + (e.mine ? ' mine' : ''));
        li.appendChild(node('div', 'entry-title', e.title || e.item));
        li.appendChild(node('div', 'entry-meta', 'by ' + e.by + ' · serves ' + e.serves));
        if (e.mine) {
          li.appendChild(node('span', 'pill', 'you'));
          mine = mine || e;
        }
        ul.appendChild(li);
      });
      section.appendChild(ul);
      coursesEl.appendChild(section);
    });
    progressEl.textContent = progressLine(entries.length);
    banner.hidden = !mine;
    document.body.classList.toggle('has-banner', !!mine);
    if (mine) bannerLine.textContent = mine.by + ' · ' + mine.item + ' · serves ' + mine.serves;
  }

  function load() {
    if (!FG.configured) { progressEl.textContent = 'the menu isn’t connected yet'; return; }
    FG.get({ action: 'menu', me: me }).then(function (r) {
      if (r.error) throw new Error(r.error);
      var json = JSON.stringify(r.entries);
      if (json !== lastJson) { lastJson = json; render(r.entries); }
    }).catch(function () {
      if (!lastJson) progressEl.textContent = 'couldn’t reach the kitchen, trying again…';
    }).then(schedule);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(function () { if (!document.hidden) load(); else schedule(); }, lastJson ? REFRESH_MS : 8000);
  }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(); });
  load();
})();
