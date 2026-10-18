// The shared menu: claimed slots grouped by course, refreshed in place.
(function () {
  var COURSES = ['To Start', 'The Main', 'Sides', 'Sweets', 'Drinks'];
  var REFRESH_MS = 45000;
  // For these items the guest's description is the whole entry (salads get a
  // name made from it); the rest show the dish, then the description.
  var DESC_ONLY = ['appetizer', 'dessert', 'potato', 'vegetable', 'salad', 'non-alcoholic drinks', 'alcoholic drinks'];

  function listJoin(parts) {
    return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  // "arugula, tomatoes, and balsamic vinaigrette" → "Arugula salad with tomatoes and balsamic vinaigrette".
  // A description that already says "salad" is used as written.
  function saladName(d) {
    if (/salad/i.test(d)) return d;
    var t = d.replace(/[.!]+$/, '').trim();
    var w = t.search(/\swith\s/i);
    var name;
    if (w > 0) {
      name = t.slice(0, w) + ' salad' + t.slice(w);
    } else {
      var parts = t.split(/\s*,\s*(?:and\s+|&\s+)?|\s+(?:and|&)\s+/i).map(function (x) { return x.trim(); }).filter(Boolean);
      name = parts[0] + ' salad' + (parts.length > 1 ? ' with ' + listJoin(parts.slice(1)) : '');
    }
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

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
        var desc = e.title && e.title.toLowerCase() !== e.item.toLowerCase() ? e.title : '';
        var item = e.item.toLowerCase();
        if (DESC_ONLY.indexOf(item) >= 0) {
          li.appendChild(node('div', 'entry-title', desc ? (item === 'salad' ? saladName(desc) : desc) : e.item));
        } else {
          li.appendChild(node('div', 'entry-title', e.item));
          if (desc) li.appendChild(node('div', 'entry-desc', desc));
        }
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
