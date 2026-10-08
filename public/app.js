(() => {
  const $ = id => document.getElementById(id);
  const states = ['stateUpload', 'stateLoading', 'stateResult', 'stateError'];
  const show = name => states.forEach(s => ($(s).hidden = s !== name));

  const MAX_SIDE = 1024; // enough detail for posture, keeps uploads small and AI calls cheap
  const LOADING_LINES = ['Interrogating the suspect…', 'Measuring how far that neck has wandered…', 'Checking for shrimp tendencies…', 'Inspecting the shoulders for evidence…', 'Choosing their posture animal…'];
  // Score bands from the Slouch Catcher story, worst to best.
  const PERSONAS = [
    { min: 0, emoji: '🦐', name: 'Shrimp', roast: 'Full curl mode! Time to straighten up and fix that slouch.' },
    { min: 41, emoji: '❓', name: 'Question Mark', roast: "Even your posture is confused! Let's fix this." },
    { min: 56, emoji: '🐢', name: 'Turtle', roast: 'Hiding in your shell? Time to come out strong.' },
    { min: 66, emoji: '🦩', name: 'Flamingo', roast: 'Standing tall and looking good! Almost there.' },
    { min: 81, emoji: '🦒', name: 'Giraffe', roast: 'Reaching for the stars with that spine!' },
    { min: 91, emoji: '🐿️', name: 'Meerkat', roast: 'Always on the lookout, always standing tall!' },
    { min: 96, emoji: '🦚', name: 'Peacock', roast: 'Posture royalty! Your spine is a work of art.' },
  ];
  const personaFor = score => PERSONAS.filter(p => score >= p.min).pop();
  let loadingTimer = null;
  let checklistTimers = [];
  let lastImage = null;
  let lastResult = null;  // { r, persona } for the result on screen
  let people = null;      // { catcher, target, phone }, only once the share form is filled in for this result
  let anonCard = null;    // card without names, offered for download if they skip the form
  let namedCard = null;   // personalised card, made after the form
  const STEPS = { source: 'sourceStep', details: 'detailsForm', ready: 'readyStep' };

  // ---------- who's catching whom (asked only when sharing) ----------
  const STORE_KEY = 'slouchCatcher.catcher';
  const cleanName = v => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  // Accepts 10-digit Indian mobiles, with or without +91 / 0 prefixes and spaces.
  const cleanPhone = v => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
    else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
    return /^[6-9]\d{9}$/.test(d) ? d : null;
  };

  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (saved) { $('catcherName').value = saved.catcher || ''; $('catcherPhone').value = saved.phone || ''; }
  } catch { /* storage blocked: the form just starts empty */ }

  const modal = $('catchModal');
  let modalStep = null;
  function openModal(step) {
    modalStep = step;
    Object.entries(STEPS).forEach(([name, id]) => ($(id).hidden = name !== step));
    modal.setAttribute('aria-labelledby', STEPS[step] + 'Title');
    $('formError').hidden = true;
    if (!modal.open) modal.showModal();
    const first = step === 'details'
      ? [$('catcherName'), $('targetName'), $('catcherPhone')].find(i => !i.value) || $('catcherName')
      : [...$(STEPS[step]).querySelectorAll('.btn')].find(b => b.offsetParent);
    first?.focus();
  }
  const closeModal = () => modal.open && modal.close();
  // Closing the share form without filling it in still leaves them a card to download.
  modal.addEventListener('close', () => { if (modalStep === 'details' && !people) offerDownload(); });
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); }); // backdrop click
  $('modalClose').addEventListener('click', closeModal);
  $('startBtn').addEventListener('click', () => openModal('source'));
  $('dropzone').addEventListener('click', () => openModal('source'));
  $('skipBtn').addEventListener('click', () => { closeModal(); downloadCard(); });

  $('detailsForm').addEventListener('submit', e => {
    e.preventDefault();
    const catcher = cleanName($('catcherName').value);
    const target = cleanName($('targetName').value);
    const phone = cleanPhone($('catcherPhone').value);
    const errors = [
      [$('catcherName'), !catcher, 'Tell us your name.'],
      [$('targetName'), !target, 'Who did you catch? Add their name.'],
      [$('catcherPhone'), !phone, 'Enter a valid 10-digit mobile number.'],
    ];
    errors.forEach(([input, bad]) => input.setAttribute('aria-invalid', bad));
    const firstBad = errors.find(([, bad]) => bad);
    if (firstBad) {
      $('formError').textContent = firstBad[2];
      $('formError').hidden = false;
      firstBad[0].focus();
      return;
    }
    people = { catcher, target, phone };
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ catcher, phone })); } catch { /* ignore */ }
    const { r } = lastResult;
    fetch('/api/lead', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ people, verdict: r.verdict, score: r.score }),
      keepalive: true,
    }).catch(() => { /* never block the share on lead capture */ });

    $('caughtBy').textContent = personalLine(r.verdict, people);
    $('caughtBy').hidden = false;
    if (lastResult.persona) $('personaKicker').textContent = target + "'s posture animal";
    unlockDownload();
    showReadyCard();
  });

  // ---------- input ----------
  const onFile = file => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return fail('Please choose an image file (JPG, PNG or WebP).');
    analyse(file);
  };
  const fromPicker = e => { const f = e.target.files[0]; e.target.value = ''; closeModal(); onFile(f); };
  $('fileInput').addEventListener('change', fromPicker);
  $('cameraInput').addEventListener('change', fromPicker);
  // The picker buttons are <label>s; make them work from the keyboard too.
  $('sourceStep').querySelectorAll('label[for]').forEach(l => l.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $(l.htmlFor).click(); }
  }));

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => onFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', e => {
    if (!$('stateUpload').hidden && !modal.open) onFile([...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')));
  });

  $('againBtn').addEventListener('click', () => {
    $('targetName').value = '';
    show('stateUpload');
    openModal('source');
  });
  $('retryBtn').addEventListener('click', () => (lastImage ? send(lastImage) : show('stateUpload')));

  // ---------- image prep ----------
  async function toJpegDataUrl(file) {
    let src;
    try {
      src = await createImageBitmap(file, { imageOrientation: 'from-image' }); // respects phone EXIF rotation
    } catch {
      src = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = () => rej(new Error('decode'));
        img.src = URL.createObjectURL(file);
      });
    }
    const w = src.width, h = src.height, scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  // ---------- flow ----------
  async function analyse(file) {
    let dataUrl;
    try { dataUrl = await toJpegDataUrl(file); }
    catch { return fail("We couldn't open that photo. Try a JPG or PNG (iPhone HEIC photos can be shared as 'Most Compatible')."); }
    lastImage = dataUrl;
    send(dataUrl);
  }

  async function send(dataUrl) {
    $('loadingImg').src = dataUrl;
    $('resultImg').src = dataUrl;
    show('stateLoading');
    $('app').scrollIntoView({ behavior: 'smooth', block: 'start' });
    startLoadingText();
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.detail) console.warn('[slouch-catcher] server detail:', data.detail);
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      await finishChecklist();
      render(data);
    } catch (err) {
      fail(err.message === 'Failed to fetch' ? 'Could not reach the server. Check your connection and try again.' : err.message);
    } finally {
      stopLoadingText();
    }
  }

  function startLoadingText() {
    let i = 0;
    $('loadingText').textContent = LOADING_LINES[0];
    loadingTimer = setInterval(() => { i = Math.min(i + 1, LOADING_LINES.length - 1); $('loadingText').textContent = LOADING_LINES[i]; }, 1800);
    const items = [...$('checklist').children];
    items.forEach(li => li.classList.remove('done'));
    // The last item ("Assigning a persona") only ticks once the AI has actually answered.
    checklistTimers = [setTimeout(() => items[0].classList.add('done'), 500), setTimeout(() => items[1].classList.add('done'), 2200)];
  }
  function stopLoadingText() { clearInterval(loadingTimer); checklistTimers.forEach(clearTimeout); }
  function finishChecklist() {
    [...$('checklist').children].forEach(li => li.classList.add('done'));
    return new Promise(r => setTimeout(r, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450));
  }

  function fail(msg) {
    $('errorMsg').textContent = msg;
    show('stateError');
  }

  // ---------- result ----------
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');

  function personalLine(verdict, who) {
    if (!who) return verdict === 'bad' ? 'Caught slouching!' : verdict === 'good' ? 'Caught standing tall!' : 'The suspect escaped... this time.';
    const { catcher, target } = who;
    return verdict === 'bad' ? `${target}, you've been caught slouching by ${catcher}!`
      : verdict === 'good' ? `${catcher} caught ${target} standing tall!`
      : `${target} slipped past ${catcher}... this time.`;
  }

  function shareMessage(who) {
    const { r, persona } = lastResult;
    const { catcher, target } = who;
    const text = !persona
      ? `🕵️ ${target} escaped ${catcher}'s Slouch Catcher... this time. Catch your own slouchers:`
      : r.verdict === 'bad'
        ? `🚨 ${target}, you've been CAUGHT SLOUCHING by ${catcher}! Posture animal: ${persona.emoji} ${persona.name} (${r.score}/100). "${persona.roast}" Think you're not a shrimp? Prove it:`
        : `${persona.emoji} ${catcher} caught ${target} standing tall! Posture animal: ${persona.name} (${r.score}/100). Bet you can't beat that. Try it:`;
    return text + ' ' + location.origin + location.pathname;
  }

  function render(r) {
    const v = $('verdict');
    v.className = 'verdict ' + r.verdict;
    v.textContent = r.verdict === 'good' ? '✓ Caught standing tall' : r.verdict === 'bad' ? '🚨 Slouch caught!' : '🕵️ Suspect escaped';

    const hasScore = typeof r.score === 'number';
    const persona = hasScore ? personaFor(r.score) : null;
    $('caughtCard').className = 'caught-card ' + r.verdict;
    $('caughtBy').hidden = true;
    $('personaBadge').textContent = persona ? persona.emoji : '🕵️';
    $('scoreBadge').hidden = !hasScore;
    $('scoreBadgeNum').textContent = hasScore ? r.score : '';
    $('personaKicker').textContent = persona ? 'Posture animal' : 'Case unsolved';
    $('personaName').textContent = persona ? persona.name : 'No ID yet';
    $('statusTitle').textContent = persona ? `${persona.name} status` : 'Case status';
    $('personaRoast').textContent = persona ? `"${persona.roast}"` : 'We need a clearer shot of the suspect: side-on, with head, shoulders and back in frame.';
    document.querySelectorAll('#personaGrid li').forEach(li => li.classList.toggle('active', !!persona && +li.dataset.min === persona.min));
    $('scoreBlock').hidden = !hasScore;
    if (hasScore) {
      $('scoreNum').textContent = r.score + '/100';
      $('meter').setAttribute('aria-valuenow', r.score);
      const fill = $('meterFill');
      fill.style.width = '0';
      fill.style.background = r.score >= 70 ? 'var(--bh-good)' : r.score >= 45 ? 'var(--bh-warn)' : 'var(--bh-bad)';
      requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = r.score + '%')));
    }

    $('summary').textContent = r.summary;
    $('shameBlock').hidden = !(r.issues || []).length;
    $('issues').replaceChildren(...(r.issues || []).map(t => Object.assign(document.createElement('li'), { textContent: t })));
    $('demoNote').hidden = !r.demo;

    const p = r.product;
    $('product').hidden = !p;
    if (p) {
      $('productLabel').textContent = persona ? `Physio-recommended fix for this ${persona.name.toLowerCase()}` : 'Physio-recommended fix';
      $('productImg').src = p.image;
      $('productImg').alt = p.name;
      $('productImgLink').href = $('productLink').href = withUtm(p.url);
      $('productName').textContent = p.name;
      $('productReason').textContent = p.reason || '';
      $('productPrice').textContent = inr(p.price);
      $('productMrp').textContent = p.mrp > p.price ? inr(p.mrp) : '';
      $('productOff').textContent = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) + '% OFF' : '';
      $('productOff').hidden = !(p.mrp > p.price);
    }

    lastResult = { r, persona };
    people = null;
    anonCard = namedCard = null;
    $('shareLabel').textContent = r.verdict === 'good' ? 'Brag on WhatsApp' : 'Roast on WhatsApp';
    $('shareHint').hidden = true;
    $('saveBtn').hidden = $('downloadBtn').hidden = true;

    show('stateResult');
    $('app').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ---------- sharing ----------
  // WhatsApp share asks for the names + phone first; skipping the form unlocks a plain download instead.
  $('shareBtn').addEventListener('click', () => (people ? showReadyCard() : openModal('details')));
  $('saveBtn').addEventListener('click', downloadCard);
  $('downloadBtn').addEventListener('click', downloadCard);

  function makeCard(who) {
    const { r, persona } = lastResult;
    const c = { file: null };
    const name = who ? who.target : persona ? persona.name : 'slouch';
    c.ready = drawShareCard(r, persona, who)
      .then(blob => (c.file = new File([blob], `caught-${slug(name)}.jpg`, { type: 'image/jpeg' })))
      .catch(err => { console.warn('[slouch-catcher] share card failed:', err); return null; });
    return c;
  }

  // The card is drawn before the Send button is enabled, so the tap that shares it
  // still counts as a fresh user gesture for navigator.share.
  async function showReadyCard() {
    namedCard ||= makeCard(people);
    const send = $('sendBtn');
    send.href = 'https://wa.me/?text=' + encodeURIComponent(shareMessage(people));
    send.classList.add('is-busy');
    $('cardPreview').removeAttribute('src');
    $('readyHint').hidden = true;
    openModal('ready');
    const file = await namedCard.ready;
    send.classList.remove('is-busy');
    if (file) $('cardPreview').src = URL.createObjectURL(file);
  }

  $('sendBtn').addEventListener('click', e => {
    const file = namedCard?.file;
    if (!file) return e.preventDefault(); // still drawing
    if (navigator.canShare?.({ files: [file] })) {
      e.preventDefault();
      navigator.share({ files: [file], text: shareMessage(people) }).catch(err => {
        if (err.name !== 'AbortError') window.open($('sendBtn').href, '_blank', 'noopener');
      });
      return;
    }
    // No file sharing here (most desktops): the link opens WhatsApp with the text, and we save the card to attach.
    downloadFile(file);
    $('readyHint').textContent = 'Card saved. Attach it in the WhatsApp chat for the full roast!';
    $('readyHint').hidden = false;
  });

  function unlockDownload() { $('saveBtn').hidden = $('downloadBtn').hidden = false; }
  function offerDownload() {
    unlockDownload();
    hint('No worries! You can still download the Caught Card and share it yourself.');
  }

  async function downloadCard() {
    const c = namedCard || (anonCard ||= makeCard(null));
    const file = c.file || await c.ready;
    if (file) { downloadFile(file); hint('Caught Card saved to your downloads.'); }
    else hint("Couldn't create the card image. Please try again.");
  }

  function downloadFile(file) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function hint(msg) { $('shareHint').textContent = msg; $('shareHint').hidden = false; }
  const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'slouch';

  // ---------- the share card image (1080x1350, Figma "Persona report" layout) ----------
  const C = { top: '#5a1d4f', bottom: '#683574', card: '#3a2342', amber: '#ffb21c', amberLight: '#ffd25f', coral: '#ff7d6b', plum: '#4f275c' };
  const loadImage = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  let logoPromise = null;
  const amberLogo = () => (logoPromise ||= fetch('/bh-logo.svg')
    .then(r => r.text())
    .then(svg => loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg.replace(/#5e1951/gi, C.amber))))
    .catch(() => null));

  async function drawShareCard(r, persona, who) {
    const W = 1080, H = 1350;
    await Promise.all(['400 100px "Gochi Hand"', '800 40px Montserrat', '600 40px Montserrat'].map(f => document.fonts.load(f).catch(() => {})));
    const [photo, logo] = await Promise.all([loadImage(lastImage), amberLogo()]);
    const canvas = Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d');
    const font = (weight, size, fam = 'Montserrat, sans-serif') => (ctx.font = `${weight} ${size}px ${fam}`);
    const centered = (text, y, color) => { ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(text, W / 2, y); };

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, C.top); bg.addColorStop(1, C.bottom);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    // Brand
    if (logo) ctx.drawImage(logo, (W - 280) / 2, 54, 280, 280 * 294.4 / 1249.2);
    else { font(800, 56); centered('betterhood', 106, C.amber); }

    // Headline: personalised once they have told us the names
    font(700, 42);
    const head = wrap(ctx, personalLine(r.verdict, who), W - 140).slice(0, 2);
    head.forEach((line, i) => centered(line, 196 + i * 54, '#fff'));
    let y = 196 + head.length * 54 + 26;

    font(800, 30); centered('POSTURE PERSONA', y, C.amberLight);
    font(400, 104, '"Gochi Hand", cursive'); centered((persona ? persona.name : 'No ID yet').toUpperCase(), y + 104, C.coral);
    y += 160;

    // Photo, cover-cropped into a rounded square
    const ps = Math.min(470, H - y - 360), px = (W - ps) / 2;
    ctx.save();
    roundRect(ctx, px, y, ps, ps, 36); ctx.clip();
    const s = Math.max(ps / photo.width, ps / photo.height);
    ctx.drawImage(photo, px + (ps - photo.width * s) / 2, y + (ps - photo.height * s) / 2, photo.width * s, photo.height * s);
    ctx.restore();
    ctx.lineWidth = 8; ctx.strokeStyle = C.amber; roundRect(ctx, px, y, ps, ps, 36); ctx.stroke();

    // Persona emoji badge (bottom-left) and score badge (top-right)
    circle(ctx, px + 10, y + ps - 10, 66, C.card, C.amber);
    ctx.fillStyle = '#fff'; font(400, 70, 'sans-serif'); ctx.textBaseline = 'middle'; centeredAt(ctx, persona ? persona.emoji : '🕵️', px + 10, y + ps - 6);
    if (typeof r.score === 'number') {
      const g = ctx.createLinearGradient(px + ps - 90, 0, px + ps + 90, 0);
      g.addColorStop(0, C.amber); g.addColorStop(1, C.amberLight);
      const bx = px + ps - 10, by = y + 40;
      circle(ctx, bx, by, 80, g);
      ctx.fillStyle = C.plum; font(900, 60); centeredAt(ctx, String(r.score), bx, by - 12);
      font(800, 20); centeredAt(ctx, 'SCORE', bx, by + 36);
    }
    ctx.textBaseline = 'alphabetic';
    y += ps + 50;

    // Status box with the roast
    font(600, 34);
    const roast = wrap(ctx, persona ? `"${persona.roast}"` : 'Send a clearer side-on shot to reveal the posture animal.', W - 220).slice(0, 3);
    const boxH = 84 + roast.length * 46;
    ctx.fillStyle = 'rgba(169, 130, 168, 0.5)'; roundRect(ctx, 80, y, W - 160, boxH, 24); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = C.amber; ctx.stroke();
    font(800, 26); centered(`${(persona ? persona.name : 'Case').toUpperCase()} STATUS`, y + 46, '#fff');
    font(600, 34); roast.forEach((line, i) => centered(line, y + 96 + i * 46, '#fff'));
    y += boxH + 56;

    // What got them caught
    if (r.issues?.length && y < H - 100) { font(700, 30); centered(r.issues.join('  •  '), y, C.amber); }

    font(500, 26); centered('Caught by Slouch Catcher  |  Fix it at betterhood.in', H - 48, '#f1e6f4');

    return new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.9));
  }

  function wrap(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; }
      else line = test;
    }
    if (line) lines.push(line);
    return lines;
  }
  function roundRect(ctx, x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad); ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad); ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
  function circle(ctx, x, y, rad, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.lineWidth = 6; ctx.strokeStyle = stroke; ctx.stroke(); }
  }
  function centeredAt(ctx, text, x, y) {
    ctx.textAlign = 'center'; ctx.fillText(text, x, y);
  }

  function withUtm(url) {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'slouch-catcher');
    u.searchParams.set('utm_medium', 'posture-check');
    return u.toString();
  }
})();
