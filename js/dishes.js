// How a claimed dish is named on the menu and the food cards. Shared by both pages.
(function () {
  // For these items the guest's description is the whole entry (salads and
  // potatoes get a name made from it); the rest show the dish, then the description.
  var DESC_ONLY = ['appetizer', 'dessert', 'potato', 'vegetable', 'salad', 'non-alcoholic drinks', 'alcoholic drinks'];

  function listJoin(parts) {
    return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  // Salads and potatoes get a name built from the description:
  //   "arugula, tomatoes, and balsamic" → "Arugula salad with tomatoes and balsamic"
  //   "greens, feta, walnuts"           → "Salad with greens, feta and walnuts"
  //   "roasted, rosemary"               → "Roasted potatoes with rosemary"
  // A description that already names the dish ("Caesar salad", "mashed potatoes") is used as written.
  var NAMED = {
    salad: { noun: 'salad', already: /salad|slaw/i, base: /^(mixed |leafy |baby |spring )?(greens|lettuce|mix|spring mix)$/i },
    potato: { noun: 'potatoes', already: /potato|fries|tots|latke|hash ?brown|spud/i, base: null }
  };

  function dishName(d, rule) {
    var t = d.replace(/[.!]+$/, '').trim();
    var cap = function (x) { return x.charAt(0).toUpperCase() + x.slice(1); };
    if (rule.already.test(t)) return cap(t);
    var w = t.search(/\swith\s/i);
    var name;
    if (w > 0) {
      var head = t.slice(0, w);
      name = rule.base && rule.base.test(head)
        ? rule.noun + ' with ' + head + ' and ' + t.slice(w).replace(/^\s*with\s+/i, '')
        : head + ' ' + rule.noun + t.slice(w);
    } else {
      var parts = t.split(/\s*,\s*(?:and\s+|&\s+)?|\s+(?:and|&)\s+/i).map(function (x) { return x.trim(); }).filter(Boolean);
      // A plain base like "greens" reads better after the noun: "Salad with greens, ...".
      if (rule.base && rule.base.test(parts[0])) name = rule.noun + ' with ' + listJoin(parts);
      else name = parts[0] + ' ' + rule.noun + (parts.length > 1 ? ' with ' + listJoin(parts.slice(1)) : '');
    }
    return cap(name);
  }

  // { title, desc } for a menu entry ({ item, title: description or item }).
  function dishLabel(e) {
    var desc = e.title && e.title.toLowerCase() !== e.item.toLowerCase() ? e.title : '';
    var item = e.item.toLowerCase();
    if (DESC_ONLY.indexOf(item) >= 0) {
      return { title: desc ? (NAMED[item] ? dishName(desc, NAMED[item]) : desc) : e.item, desc: '' };
    }
    return { title: e.item, desc: desc };
  }

  window.FG = window.FG || {};
  window.FG.dishLabel = dishLabel;
})();
