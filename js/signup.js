// Sign-up flow: who's cooking → pick a dish → describe it → claim.
// Name matching runs on the server so the guest list never reaches the browser.
(function () {
  var EXAMPLES = {
    'Appetizer': 'e.g. Baked brie with cranberry and rosemary, crostini on the side',
    'Brisket': 'e.g. Smoked brisket with a coffee rub, sliced, BBQ sauce on the side',
    'Potato': 'e.g. Brown butter mashed potatoes with roasted garlic and chives',
    'Vegetable': 'e.g. Maple-roasted brussels sprouts with bacon and pecans',
    'Salad': 'e.g. Kale and apple salad with cranberries, pecans, and cider vinaigrette',
    'Mac and cheese': 'e.g. Three-cheese baked mac with a toasted breadcrumb crust',
    'Dessert': 'e.g. Pumpkin pie with maple whipped cream',
    'Non-alcoholic drinks': 'e.g. Hot spiced apple cider and a sparkling cranberry punch',
    'Alcoholic drinks': 'e.g. Bourbon apple cider punch, plus a couple bottles of red'
  };
  var STEP_ART = {
    2: { src: 'assets/pumpkins.png', width: '170px' },
    3: { src: 'assets/vase.png', width: '130px' }
  };
  var STEP_WORDS = { 1: 'one', 2: 'two', 3: 'three' };

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    hero: $('hero'), compact: $('compact'), stepArt: $('step-art'), steps: $('steps'),
    step1: $('step1'), step2: $('step2'), step3: $('step3'),
    name: $('guest-name'), cardEmpty: $('card-empty'), cardEmptyText: $('card-empty-text'),
    cardMatch: $('card-match'), initials: $('initials'), matchName: $('match-name'), matchNudge: $('match-nudge'),
    cardAmbiguous: $('card-ambiguous'), cardClaimed: $('card-claimed'), claimedTitle: $('claimed-title'),
    claimedMeta: $('claimed-meta'), changeDish: $('change-dish'), next1: $('next1'),
    nudge2: $('nudge2'), dishes: $('dishes'), back2: $('back2'), next2: $('next2'),
    summaryTitle: $('summary-title'), summaryServes: $('summary-serves'), desc: $('dish-desc'),
    servingsNote: $('servings-note'), back3: $('back3'), claim: $('claim'), note: $('note')
  };

  var state = {
    step: 1,
    input: '',
    ident: null,        // server's identify result for `input`
    pending: false,     // identify in flight
    lookupFailed: false,
    items: null,        // open items, as of the last fetch
    itemsFor: null,     // the input they were fetched for
    itemsLoading: false,
    dish: '',
    desc: '',
    swap: false,        // "change my dish": the claim replaces their current one
    submitting: false,
    notice: ''
  };

  var key = function (s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); };
  var idCache = {};
  var lookupSeq = 0;
  var lookupTimer = null;
  var retryTimer = null;

  // ------------------------------------------------------------ identify

  function onNameInput() {
    state.input = el.name.value;
    state.dish = '';
    state.swap = false;
    state.notice = '';
    state.lookupFailed = false;
    clearTimeout(lookupTimer);
    clearTimeout(retryTimer);
    var k = key(state.input);
    lookupSeq++;
    if (k.replace(/[^a-z]/g, '').length < 2) {
      state.ident = null;
      state.pending = false;
    } else if (idCache[k]) {
      state.ident = idCache[k];
      state.pending = false;
      prefetchItems();
    } else {
      state.ident = null;
      state.pending = true;
      lookupTimer = setTimeout(lookup, 350);
    }
    render();
  }

  function lookup() {
    var seq = ++lookupSeq;
    var name = state.input;
    FG.get({ action: 'identify', name: name }).then(function (r) {
      if (seq !== lookupSeq) return;
      if (r.error) throw new Error(r.error);
      idCache[key(name)] = r;
      state.ident = r;
      state.pending = false;
      render();
      prefetchItems();
    }).catch(function () {
      if (seq !== lookupSeq) return;
      state.pending = false;
      state.lookupFailed = true;
      render();
      retryTimer = setTimeout(function () { state.pending = true; state.lookupFailed = false; render(); lookup(); }, 4000);
    });
  }

  function matched() { return !!(state.ident && state.ident.status === 'match'); }
  function hasExisting() { return matched() && !!state.ident.existing && !state.swap; }

  function nudgeText(id) {
    if (!id) return '';
    return id.isCouple
      ? (id.isPair ? 'You two' : 'You and ' + id.partnerFirst) + ' are coming together, so you count as one kitchen. Please take on a big-batch dish (25 servings) and one dish covers you both.'
      : 'No plus one? Any 7- to 15-serving dish is perfect; the big-batch dishes are best left to the couples.';
  }

  // ------------------------------------------------------------ open items

  function prefetchItems() {
    if (!matched()) return;
    loadItems();
  }

  function loadItems() {
    var forInput = state.input;
    state.itemsLoading = true;
    return FG.get({ action: 'open', name: forInput }).then(function (r) {
      if (r.error) throw new Error(r.error);
      if (forInput !== state.input) return;
      state.items = r.items;
      state.itemsFor = forInput;
      state.itemsLoading = false;
      if (state.dish && !r.items.some(function (i) { return i.item === state.dish; })) state.dish = '';
      render();
    }).catch(function () {
      state.itemsLoading = false;
      if (state.step === 2 && !state.items) state.notice = 'We couldn’t load the dishes. Check your connection and tap Back, then Next.';
      render();
    });
  }

  function visibleItems() {
    if (!state.items || state.itemsFor !== state.input) return null;
    var items = state.items.slice();
    // Couples see the biggest dishes first; singles see the smallest first.
    // The sort is stable, so ties keep the menu order.
    var couple = !!(state.ident && state.ident.isCouple);
    items.sort(function (a, b) { return couple ? b.serves - a.serves : a.serves - b.serves; });
    return items;
  }

  function pickedItem() {
    var items = visibleItems() || [];
    for (var i = 0; i < items.length; i++) if (items[i].item === state.dish) return items[i];
    return null;
  }

  // ------------------------------------------------------------ steps

  function goStep(n, fromHistory) {
    if (n >= 2 && !matched()) n = 1;
    if (n === 3 && !pickedItem()) n = 2;
    var changed = n !== state.step;
    state.step = n;
    if (n === 2) loadItems();
    if (changed && !fromHistory) history.pushState({ step: n }, '');
    render();
    if (changed) {
      window.scrollTo(0, 0);
      var title = $('step' + n + '-title');
      if (title) { title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
    }
  }

  window.addEventListener('popstate', function (e) {
    state.notice = '';
    goStep((e.state && e.state.step) || 1, true);
  });

  // ------------------------------------------------------------ claim

  function submit() {
    var item = pickedItem();
    if (state.submitting || !matched() || !item || !state.desc.trim()) return;
    state.submitting = true;
    state.notice = '';
    render();
    FG.post({ action: 'claim', name: state.input, item: item.item, description: state.desc.trim(), swap: state.swap }).then(function (r) {
      if (r.ok) {
        FG.store.setClaim(r.claimId);
        idCache = {};
        location.href = 'menu/?me=' + encodeURIComponent(r.claimId);
        return;
      }
      state.submitting = false;
      if (r.error === 'taken') {
        state.items = r.items;
        state.itemsFor = state.input;
        state.dish = '';
        state.notice = 'Someone just took the last ' + item.item.toLowerCase() + ' slot. Pick another?';
        goStep(2);
      } else if (r.error === 'has_claim') {
        state.ident = Object.assign({}, state.ident, { existing: r.claim });
        idCache[key(state.input)] = state.ident;
        state.swap = false;
        state.notice = '';
        goStep(1);
      } else {
        state.notice = r.message || 'Something went wrong. Please try again.';
        render();
      }
    }).catch(function () {
      state.submitting = false;
      state.notice = 'We couldn’t save that. Check your connection and try again.';
      render();
    });
  }

  // ------------------------------------------------------------ render

  function show(node, on) { node.hidden = !on; }

  function setButton(btn, enabled) { btn.disabled = !enabled; }

  function renderDishes(items) {
    el.dishes.textContent = '';
    if (!items) {
      var loading = document.createElement('div');
      loading.className = 'card';
      loading.innerHTML = '<div class="card-text">Checking what’s still open…</div>';
      el.dishes.appendChild(loading);
      return;
    }
    if (!items.length) {
      var full = document.createElement('div');
      full.className = 'card';
      full.innerHTML = '<div class="card-text">Every dish is spoken for! <a href="menu/">See the menu</a> for what’s on the table.</div>';
      el.dishes.appendChild(full);
      return;
    }
    var couple = !!(state.ident && state.ident.isCouple);
    items.forEach(function (d) {
      var selected = d.item === state.dish;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'dish' + (couple && d.big ? ' steer' : '');
      b.setAttribute('aria-pressed', selected ? 'true' : 'false');
      var radio = document.createElement('span');
      radio.className = 'radio';
      radio.setAttribute('aria-hidden', 'true');
      var text = document.createElement('span');
      text.className = 'dish-text';
      var nm = document.createElement('span');
      nm.className = 'dish-name';
      nm.textContent = d.item;
      var meta = document.createElement('span');
      meta.className = 'dish-meta';
      meta.textContent = 'Serves ' + d.serves;
      text.appendChild(nm);
      text.appendChild(meta);
      b.appendChild(radio);
      b.appendChild(text);
      if (d.big) {
        var pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = couple ? 'For you two' : 'Big batch';
        b.appendChild(pill);
      }
      b.addEventListener('click', function () {
        state.dish = selected ? '' : d.item;
        state.notice = '';
        render();
        var again = el.dishes.querySelectorAll('.dish')[items.indexOf(d)];
        if (again) again.focus();
      });
      el.dishes.appendChild(b);
    });
  }

  function render() {
    var step = state.step;
    var id = state.ident;
    var ok = matched();

    // header + step marker
    show(el.hero, step === 1);
    show(el.compact, step !== 1);
    if (STEP_ART[step]) {
      el.stepArt.src = STEP_ART[step].src;
      el.stepArt.style.width = STEP_ART[step].width;
    }
    el.steps.setAttribute('aria-label', 'Step ' + step + ' of 3');
    Array.prototype.forEach.call(el.steps.children, function (s, i) { s.className = i < step ? 'on' : ''; });
    show(el.step1, step === 1);
    show(el.step2, step === 2);
    show(el.step3, step === 3);

    // step 1
    var tooShort = key(state.input).replace(/[^a-z]/g, '').length < 2;
    var ambiguous = ok && !!id.ambiguous;
    // Before a name is typed there's no card; while looking it up, a short status.
    show(el.cardEmpty, !ok && !tooShort && (state.pending || state.lookupFailed));
    el.cardEmptyText.textContent = state.lookupFailed
      ? 'We couldn’t reach the guest list. Trying again…'
      : 'Checking the guest list…';
    show(el.cardMatch, ok);
    show(el.cardAmbiguous, ambiguous);
    el.name.classList.toggle('matched', ok);
    if (ok) {
      el.initials.textContent = id.initials;
      el.matchName.textContent = id.matchName;
      el.matchNudge.textContent = nudgeText(id);
    }
    var existing = hasExisting();
    show(el.cardClaimed, existing);
    show(el.next1, !existing);
    if (existing) {
      el.claimedTitle.textContent = 'You’re down for ' + id.existing.item;
      el.claimedMeta.textContent = (id.existing.description ? id.existing.description + ' · ' : '') + 'serves ' + id.existing.serves;
    }
    setButton(el.next1, ok);

    // step 2
    el.nudge2.textContent = ok ? nudgeText(id) : '';
    show(el.nudge2, ok);
    var items = visibleItems();
    if (step === 2) renderDishes(items);
    var picked = pickedItem();
    setButton(el.next2, !!picked);

    // step 3
    el.summaryTitle.textContent = picked ? picked.item : 'Nothing picked yet';
    el.summaryServes.textContent = picked ? 'Serves ' + picked.serves : '—';
    el.desc.placeholder = picked ? (EXAMPLES[picked.item] || 'e.g. What you’re making, and how') : 'Pick a dish in step two first and we will suggest an example here';
    el.servingsNote.textContent = picked
      ? 'Please make enough for ' + picked.serves + ' servings.'
      : 'Pick a dish in step two and we will tell you how many servings to make.';
    var descOk = state.desc.trim().length > 0;
    setButton(el.claim, ok && !!picked && descOk && !state.submitting);
    el.claim.textContent = state.submitting ? 'Claiming…' : 'Claim my dish';
    el.claim.setAttribute('aria-busy', state.submitting ? 'true' : 'false');

    // step note (a notice, when there is one, takes its place)
    var note;
    if (!FG.configured) note = 'The sign-up isn’t connected yet.';
    else if (state.notice) note = state.notice;
    else if (step === 1) note = ok ? '' : 'Type your name to continue.';
    else if (step === 2) note = picked ? '' : 'Pick a dish to continue.';
    else note = descOk ? 'You will land on the shared menu once you claim.' : 'Add a description to claim your dish.';
    if (el.note.textContent !== note) el.note.textContent = note;
  }

  // ------------------------------------------------------------ wire up

  el.name.addEventListener('input', onNameInput);
  el.name.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); if (matched() && !hasExisting()) goStep(2); }
  });
  el.next1.addEventListener('click', function () { goStep(2); });
  el.changeDish.addEventListener('click', function () { state.swap = true; goStep(2); });
  el.back2.addEventListener('click', function () { state.notice = ''; goStep(1); });
  el.next2.addEventListener('click', function () { state.notice = ''; goStep(3); });
  el.back3.addEventListener('click', function () { state.notice = ''; goStep(2); });
  el.desc.addEventListener('input', function () { state.desc = el.desc.value; render(); });
  el.claim.addEventListener('click', submit);

  // Coming back from the menu with the browser's back button.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) { state.submitting = false; idCache = {}; render(); }
  });

  history.replaceState({ step: 1 }, '');
  // A browser may restore typed text on reload.
  if (el.name.value) onNameInput();
  el.desc.value = '';
  render();

  // Warm the images the next steps use.
  ['assets/pumpkins.png', 'assets/vase.png'].forEach(function (src) { var i = new Image(); i.src = src; });
})();
