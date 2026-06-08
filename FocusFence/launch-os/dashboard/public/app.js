async function loadState() {
  const response = await fetch('/data/processed/dashboard-state.json');
  if (!response.ok) throw new Error(`Failed to load dashboard state: ${response.status}`);
  return response.json();
}

function text(id, value) {
  document.getElementById(id).textContent = value;
}

function html(id, value) {
  document.getElementById(id).innerHTML = value;
}

function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function listItems(values = []) {
  return values.map((value) => `<li>${escapeHTML(value)}</li>`).join('');
}

function renderDaily(record) {
  if (!record) {
    html('latestDaily', '<p class="muted">还没有每日记录。</p>');
    return;
  }
  text('latestDate', record.date);
  html(
    'latestDaily',
    `
      <div class="daily-block">
        <h4>目标</h4>
        <p>${escapeHTML(record.goal || '')}</p>
      </div>
      <div class="daily-block">
        <h4>完成</h4>
        <ul>${listItems(record.completed)}</ul>
      </div>
      <div class="daily-block">
        <h4>错误 / 修正</h4>
        <p>${escapeHTML(record.corrections || '暂无')}</p>
      </div>
    `,
  );
}

function renderNextActions(values = []) {
  html('nextActions', listItems(values));
}

function renderDecisions(records = []) {
  html(
    'decisionList',
    records
      .map(
        (record) => `
          <div class="timeline-item">
            <h4>${escapeHTML(record.title)}</h4>
            <p>${escapeHTML(record.decision)}</p>
            <p class="muted">推翻条件：${escapeHTML(record.reversalCriteria || '未设置')}</p>
          </div>
        `,
      )
      .join(''),
  );
}

function renderOperations(records = []) {
  html(
    'operationList',
    records
      .map(
        (record) => `
          <div class="timeline-item">
            <h4>${escapeHTML(record.title)}</h4>
            <p>${escapeHTML(record.summary)}</p>
            <div class="subgrid">
              <div>
                <strong>资源</strong>
                <ul>${listItems(record.resources)}</ul>
              </div>
              <div>
                <strong>成本</strong>
                <p>${escapeHTML(record.cost)}</p>
              </div>
              <div>
                <strong>验证</strong>
                <ul>${listItems(record.verification)}</ul>
              </div>
            </div>
          </div>
        `,
      )
      .join(''),
  );
}

function renderClusters(clusters = []) {
  html(
    'keywordClusters',
    clusters
      .map(
        (cluster) => `
          <div class="cluster">
            <strong>${escapeHTML(cluster.name)}</strong>
            <span>${cluster.keywords.length} 个种子词</span>
          </div>
        `,
      )
      .join(''),
  );
}

try {
  const state = await loadState();
  text('generatedAt', `生成时间 ${new Date(state.status.generatedAt).toLocaleString()}`);
  text('target', state.status.target);
  text('stage', state.status.currentStage);
  text('price', state.project.price);
  text('product', state.project.product);
  text('publicUrl', state.project.publicUrl);
  text('costNote', state.project.costNote);
  text('decisionCount', String(state.decisions.length));
  text('dailyCount', String(state.daily.length));
  text('keywordRows', `${state.semrush.keywordRows} 行`);
  renderDaily(state.daily.at(-1));
  renderNextActions(state.nextActions);
  renderDecisions(state.decisions);
  renderOperations(state.operations);
  renderClusters(state.semrush.clusters.clusters || []);
} catch (error) {
  text('stage', error.message);
}
