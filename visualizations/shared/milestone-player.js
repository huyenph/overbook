(() => {
  const milestoneId = document.body.dataset.milestone;
  const data = window.MILESTONE_DATA?.[milestoneId];
  if (!data) throw new Error(`Missing visualization data for milestone ${milestoneId}`);

  document.title = `Overbook · Milestone ${data.number} · ${data.shortTitle}`;
  const root = document.getElementById('app');
  root.innerHTML = `
    <main class="page">
      <header>
        <div class="eyebrow">Overbook · Milestone ${data.number} · ${data.questions.join(' / ')}</div>
        <h1>${data.title}</h1>
        <p class="lead">${data.subtitle}</p>
      </header>
      <section aria-labelledby="rough-title">
        <div class="section-head">
          <div><div class="eyebrow">Rough diagram</div><h2 id="rough-title">${data.roughTitle}</h2></div>
          <p>${data.roughCopy}</p>
        </div>
        <div class="panel rough">
          <div class="flow" id="rough-flow"></div>
          <div class="question-strip">${data.questions.map((question) => `<span>${question}</span>`).join('')}</div>
        </div>
      </section>
      <section aria-labelledby="sim-title">
        <div class="section-head">
          <div><div class="eyebrow">Animated diagram</div><h2 id="sim-title">${data.simTitle}</h2></div>
          <p>${data.simCopy}</p>
        </div>
        <div class="panel sim">
          <div class="toolbar">
            <div class="modes" id="modes" role="group" aria-label="Choose a scenario"></div>
            <button class="play" id="play" type="button">▶ Play animation</button>
          </div>
          <div class="concepts" id="concepts" aria-label="Concepts currently applied"></div>
          <div class="stage-wrap">
            <div class="stage" id="stage" aria-label="Animated system flow"></div>
            <div class="metrics" id="metrics"></div>
            <div class="readout">
              <div class="narration">
                <div class="step-no" id="step-no"></div>
                <p id="narration"></p>
                <div class="progress" aria-hidden="true"><span id="progress"></span></div>
              </div>
              <div class="result" id="result"><span>Result</span><strong id="result-title"></strong><p id="result-copy"></p></div>
            </div>
            <div class="sr-only" id="live" aria-live="polite"></div>
          </div>
        </div>
        <div class="takeaways">${data.takeaways.map((item) => `<article><h3>${item[0]}</h3><p>${item[1]}</p></article>`).join('')}</div>
      </section>
    </main>`;

  const $ = (id) => document.getElementById(id);
  const els = {
    flow: $('rough-flow'), modes: $('modes'), concepts: $('concepts'), stage: $('stage'),
    metrics: $('metrics'), play: $('play'), stepNo: $('step-no'), narration: $('narration'),
    progress: $('progress'), result: $('result'), resultTitle: $('result-title'),
    resultCopy: $('result-copy'), live: $('live')
  };
  let modeIndex = 0;
  let frameIndex = -1;
  let timer = null;

  function flowMarkup(nodes, animated = false) {
    return nodes.map((node, index) => {
      const card = animated
        ? `<article class="stage-node" data-node="${index}"><span class="node-index">0${index + 1}</span><strong>${node.name}</strong><div class="node-value">${node.value}</div><span class="node-status">Idle</span></article>`
        : `<article class="flow-node"><strong>${node.name}</strong><code>${node.value}</code><span>${node.description}</span></article>`;
      const arrow = index < nodes.length - 1 ? `<div class="${animated ? 'stage-arrow' : 'flow-arrow'}" data-arrow="${index}" aria-hidden="true">→</div>` : '';
      return card + arrow;
    }).join('');
  }

  els.flow.innerHTML = flowMarkup(data.flow);
  els.stage.innerHTML = flowMarkup(data.flow, true);
  els.modes.innerHTML = data.modes.map((mode, index) => `<button class="mode" type="button" data-index="${index}" data-tone="${mode.tone}" aria-pressed="${index === 0}">${mode.label}</button>`).join('');

  function selectedMode() { return data.modes[modeIndex]; }

  function renderConcepts() {
    els.concepts.innerHTML = selectedMode().concepts.map((concept) => `
      <article class="concept ${concept.tone}">
        <div class="q">${concept.q}</div><strong>${concept.title}</strong>
        <span class="state">${concept.state}</span><p>${concept.copy}</p>
      </article>`).join('');
  }

  function reset() {
    clearInterval(timer);
    timer = null;
    frameIndex = -1;
    renderConcepts();
    [...els.stage.querySelectorAll('.stage-node')].forEach((node, index) => {
      node.className = 'stage-node';
      node.querySelector('.node-value').textContent = data.flow[index].value;
      node.querySelector('.node-status').textContent = 'Idle';
    });
    [...els.stage.querySelectorAll('.stage-arrow')].forEach((arrow) => arrow.className = 'stage-arrow');
    const labels = selectedMode().metrics.map((metric) => metric[0]);
    els.metrics.innerHTML = labels.map((label, index) => `<div class="metric"><span>${label}</span><strong data-metric="${index}">—</strong></div>`).join('');
    els.stepNo.textContent = `STEP 0 / ${selectedMode().frames.length}`;
    els.narration.textContent = 'Select “Play animation” to run this scenario.';
    els.progress.style.width = '0%';
    els.result.className = 'result';
    els.resultTitle.textContent = 'Not started';
    els.resultCopy.textContent = selectedMode().startCopy;
    els.play.disabled = false;
    els.play.textContent = '▶ Play animation';
  }

  function drawFrame(index) {
    const mode = selectedMode();
    const frame = mode.frames[index];
    [...els.stage.querySelectorAll('.stage-node')].forEach((node, nodeIndex) => {
      const tone = frame.tones?.[nodeIndex] ?? '';
      node.className = `stage-node ${frame.active.includes(nodeIndex) ? 'active' : ''} ${tone}`.trim();
      node.querySelector('.node-status').textContent = frame.status[nodeIndex] ?? 'Idle';
      if (frame.values?.[nodeIndex] !== undefined) node.querySelector('.node-value').textContent = frame.values[nodeIndex];
    });
    [...els.stage.querySelectorAll('.stage-arrow')].forEach((arrow, arrowIndex) => {
      arrow.className = `stage-arrow ${frame.paths?.includes(arrowIndex) ? 'active' : ''}`;
    });
    [...els.metrics.querySelectorAll('[data-metric]')].forEach((metric, metricIndex) => {
      metric.textContent = frame.metrics[metricIndex];
    });
    els.stepNo.textContent = `STEP ${index + 1} / ${mode.frames.length}`;
    els.narration.textContent = frame.note;
    els.progress.style.width = `${((index + 1) / mode.frames.length) * 100}%`;
    els.live.textContent = frame.note;
    if (index === mode.frames.length - 1) {
      els.result.className = `result ${mode.result.tone}`;
      els.resultTitle.textContent = mode.result.title;
      els.resultCopy.textContent = mode.result.copy;
      els.play.disabled = false;
      els.play.textContent = '↻ Replay';
      clearInterval(timer);
      timer = null;
    }
  }

  function play() {
    reset();
    els.play.disabled = true;
    els.play.textContent = 'Playing…';
    frameIndex = 0;
    drawFrame(frameIndex);
    timer = setInterval(() => {
      frameIndex += 1;
      if (frameIndex < selectedMode().frames.length) drawFrame(frameIndex);
    }, 1250);
  }

  els.modes.addEventListener('click', (event) => {
    const button = event.target.closest('.mode');
    if (!button) return;
    modeIndex = Number(button.dataset.index);
    [...els.modes.querySelectorAll('.mode')].forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
    reset();
  });
  els.play.addEventListener('click', play);
  reset();
})();
