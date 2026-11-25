// The live text stays in the reader. Only an inert visual copy turns above it.
export function createPageTurner({paper, deck, surface, getPage, canSwipe, commit, onBusy}) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = null;
  let gesture = null;
  let returning = null;
  let suppressClickUntil = 0;

  function resetPaper() {
    returning?.cancel(); returning = null;
    paper.style.removeProperty('transform');
    paper.style.removeProperty('transform-origin');
    paper.classList.remove('is-dragging');
    deck.classList.remove('is-dragging');
  }

  function releaseGesture() {
    const previous = gesture; gesture = null;
    if (previous && surface.hasPointerCapture(previous.id)) surface.releasePointerCapture(previous.id);
  }

  function cancel() {
    releaseGesture(); resetPaper();
    if (!active) return;
    const previous = active; active = null;
    clearTimeout(previous.timer);
    previous.animations.forEach(animation => animation.cancel());
    previous.leaf.remove(); previous.shadow.remove();
    deck.style.minHeight = previous.minHeight;
    deck.classList.remove('is-turning');
    paper.inert = false;
    surface.removeAttribute('aria-busy');
    onBusy(false);
  }

  function snapshot() {
    const leaf = paper.cloneNode(true);
    leaf.removeAttribute('id'); leaf.removeAttribute('aria-labelledby');
    leaf.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
    leaf.querySelectorAll('[aria-labelledby], [aria-describedby]').forEach(node => {
      node.removeAttribute('aria-labelledby'); node.removeAttribute('aria-describedby');
    });
    leaf.setAttribute('aria-hidden', 'true'); leaf.inert = true;
    leaf.classList.remove('is-dragging'); leaf.classList.add('page-turn-leaf');
    leaf.style.removeProperty('transform'); leaf.style.removeProperty('transform-origin');
    // Fix the old page's dimensions and font, including the shorter opening pages.
    leaf.style.width = `${paper.offsetWidth}px`;
    leaf.style.height = `${paper.offsetHeight}px`;
    leaf.style.minWidth = '0';
    const light = document.createElement('span'); light.className = 'page-turn-light';
    const curl = document.createElement('span'); curl.className = 'page-turn-curl';
    leaf.append(light, curl);
    return {leaf, light, curl};
  }

  function turn(direction, {scroll = true, startAngle = 0} = {}) {
    if (active || ![1, -1].includes(direction)) return false;
    const page = getPage(); const target = page + direction;
    if (!page || target < 1 || target > 604) return false;
    resetPaper();
    if (reducedMotion.matches || typeof paper.animate !== 'function') {
      commit(target, {scroll}); return true;
    }
    const visual = snapshot();
    const oldHeight = paper.offsetHeight;
    const minHeight = deck.style.minHeight;
    // Navigation and history remain synchronous; the turning copy is decorative.
    commit(target, {scroll});
    deck.style.minHeight = `${Math.max(oldHeight, paper.offsetHeight)}px`;
    const shadow = document.createElement('span');
    shadow.className = `page-turn-shadow ${direction > 0 ? 'turn-next' : 'turn-previous'}`;
    shadow.setAttribute('aria-hidden', 'true');
    visual.leaf.classList.add(direction > 0 ? 'turn-next' : 'turn-previous');
    deck.append(shadow, visual.leaf);
    deck.classList.add('is-turning');
    paper.inert = true; surface.setAttribute('aria-busy', 'true'); onBusy(true);
    const duration = Math.round(720 - Math.min(42, Math.abs(startAngle)) * 4);
    const angle = value => `rotateY(${direction * value}deg)`;
    const options = {duration, easing: 'cubic-bezier(.26,.05,.25,1)', fill: 'forwards'};
    const animations = [
      visual.leaf.animate([
        {transform: angle(Math.abs(startAngle)), filter: 'brightness(1)', offset: 0},
        {transform: angle(Math.max(34, Math.abs(startAngle) + 12)), filter: 'brightness(.96)', offset: .38},
        {transform: angle(78), filter: 'brightness(.86)', offset: .76},
        {transform: angle(112), filter: 'brightness(.9)', offset: 1},
      ], options),
      visual.light.animate([{opacity: 0}, {opacity: .9, offset: .65}, {opacity: .55}], options),
      visual.curl.animate([{opacity: .08, width: '2%'}, {opacity: .85, width: '16%', offset: .6}, {opacity: .6, width: '22%'}], options),
      shadow.animate([
        {opacity: .14, transform: 'scaleX(1)'},
        {opacity: .38, transform: 'scaleX(.65)', offset: .45},
        {opacity: 0, transform: 'scaleX(.04)'},
      ], options),
    ];
    const turnState = {leaf: visual.leaf, shadow, minHeight, animations, timer: null};
    active = turnState;
    const finish = () => { if (active === turnState) cancel(); };
    Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    turnState.timer = setTimeout(finish, duration + 180);
    return true;
  }

  function restoreDraggedPaper() {
    const transform = paper.style.transform;
    if (!transform || reducedMotion.matches || typeof paper.animate !== 'function') { resetPaper(); return; }
    const animation = paper.animate([{transform}, {transform: 'rotateY(0deg)'}], {duration: 170, easing: 'ease-out'});
    returning = animation;
    animation.finished.then(() => { if (returning === animation) resetPaper(); }).catch(() => {});
  }

  surface.addEventListener('pointerdown', event => {
    if (!event.isPrimary) { cancelGesture(); resetPaper(); return; }
    suppressClickUntil = 0;
    if (active || !canSwipe() || event.button !== 0 || !paper.contains(event.target)) return;
    // Mouse text selection and clicking remain native; mouse dragging uses the paper margin.
    if (event.pointerType === 'mouse' && event.target.closest('.quran-word, .gloss-body')) return;
    resetPaper();
    gesture = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, dx: 0, angle: 0};
  });

  surface.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (event.pointerType === 'mouse' && !(event.buttons & 1)) { releaseGesture(); restoreDraggedPaper(); return; }
    if (!canSwipe()) { releaseGesture(); resetPaper(); return; }
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (!gesture.moved) {
      if (Math.abs(dy) > 10 && Math.abs(dy) >= Math.abs(dx)) { releaseGesture(); return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
      gesture.moved = true;
      surface.setPointerCapture(event.pointerId);
      paper.classList.add('is-dragging'); deck.classList.add('is-dragging');
    }
    event.preventDefault();
    gesture.dx = dx;
    const direction = dx > 0 ? 1 : -1;
    const allowed = getPage() + direction >= 1 && getPage() + direction <= 604;
    const progress = Math.min(1, Math.abs(dx) / Math.max(1, paper.clientWidth * .7));
    gesture.angle = allowed ? progress * 42 : progress * 7;
    if (!reducedMotion.matches) {
      paper.style.transformOrigin = direction > 0 ? '100% 50%' : '0% 50%';
      paper.style.transform = `rotateY(${direction * gesture.angle}deg)`;
    }
  }, {passive: false});

  surface.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const completed = gesture;
    releaseGesture();
    if (!completed.moved) return;
    suppressClickUntil = performance.now() + 450;
    const threshold = Math.max(48, Math.min(90, paper.clientWidth * .16));
    const direction = completed.dx > 0 ? 1 : -1;
    if (Math.abs(completed.dx) >= threshold && turn(direction, {scroll: false, startAngle: completed.angle})) return;
    restoreDraggedPaper();
  });

  const cancelGesture = () => { if (!gesture) return; if (gesture.moved) suppressClickUntil = performance.now() + 450; releaseGesture(); restoreDraggedPaper(); };
  surface.addEventListener('pointercancel', cancelGesture);
  surface.addEventListener('lostpointercapture', cancelGesture);
  surface.addEventListener('pointerleave', () => { if (gesture && !gesture.moved) releaseGesture(); });
  window.addEventListener('pointerup', cancelGesture);
  window.addEventListener('pointercancel', cancelGesture);
  surface.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('resize', cancel);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  reducedMotion.addEventListener('change', cancel);
  return {turn, cancel, get busy() { return Boolean(active); }};
}
