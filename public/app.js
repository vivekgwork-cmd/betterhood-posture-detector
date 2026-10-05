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
  let lastImage = null;

  // ---------- input ----------
  const onFile = file => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return fail('Please choose an image file (JPG, PNG or WebP).');
    analyse(file);
  };
  $('fileInput').addEventListener('change', e => { onFile(e.target.files[0]); e.target.value = ''; });
  $('cameraInput').addEventListener('change', e => { onFile(e.target.files[0]); e.target.value = ''; });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => onFile(e.dataTransfer.files[0]));
  document.addEventListener('paste', e => {
    if (!$('stateUpload').hidden) onFile([...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')));
  });

  $('againBtn').addEventListener('click', () => show('stateUpload'));
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
  }
  function stopLoadingText() { clearInterval(loadingTimer); }

  function fail(msg) {
    $('errorMsg').textContent = msg;
    show('stateError');
  }

  // ---------- result ----------
  const inr = n => '₹' + Number(n).toLocaleString('en-IN');

  function render(r) {
    const v = $('verdict');
    v.className = 'verdict ' + r.verdict;
    v.textContent = r.verdict === 'good' ? '✓ Caught standing tall' : r.verdict === 'bad' ? '🚨 Slouch caught!' : '🕵️ Suspect escaped';

    const hasScore = typeof r.score === 'number';
    const persona = hasScore ? personaFor(r.score) : null;
    $('caughtCard').className = 'caught-card ' + r.verdict;
    $('personaBadge').textContent = persona ? persona.emoji : '🕵️';
    $('personaKicker').textContent = persona ? 'Posture animal' : 'Case unsolved';
    $('personaName').textContent = persona ? `The ${persona.name}` : "Couldn't make an ID";
    $('personaRoast').textContent = persona ? persona.roast : 'We need a clearer shot of the suspect: side-on, with head, shoulders and back in frame.';
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

    const shareText = !persona
      ? '🚨 Caught anyone slouching lately? Find out their posture animal with Slouch Catcher:'
      : r.verdict === 'bad'
        ? `🚨 CAUGHT SLOUCHING! Posture animal: ${persona.emoji} ${persona.name} (${r.score}/100). "${persona.roast}" Think you're not a shrimp? Prove it:`
        : `${persona.emoji} Caught standing tall! Posture animal: ${persona.name} (${r.score}/100). Bet you can't beat that. Try it:`;
    $('shareLabel').textContent = r.verdict === 'good' ? 'Share the glory on WhatsApp' : 'Share the shame on WhatsApp';
    $('shareBtn').href = 'https://wa.me/?text=' + encodeURIComponent(shareText + ' ' + location.origin + location.pathname);

    show('stateResult');
    $('app').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function withUtm(url) {
    const u = new URL(url);
    u.searchParams.set('utm_source', 'slouch-catcher');
    u.searchParams.set('utm_medium', 'posture-check');
    return u.toString();
  }
})();
