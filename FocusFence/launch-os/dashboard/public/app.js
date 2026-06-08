async function loadState() {
  const response = await fetch('../../data/processed/dashboard-state.json');
  if (!response.ok) throw new Error(`Failed to load dashboard state: ${response.status}`);
  return response.json();
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function renderList(id, values) {
  const list = document.getElementById(id);
  list.innerHTML = '';
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = value;
    list.append(item);
  }
}

function renderDaily(record) {
  const target = document.getElementById('latestDaily');
  if (!record) {
    target.innerHTML = '<p class="muted">No daily review yet.</p>';
    return;
  }
  target.innerHTML = `
    <p><strong>${record.date}</strong></p>
    <p>${record.sections.Goal || ''}</p>
    <p class="muted">${record.completed.length} completed item(s), ${record.openQuestions.length} open question(s)</p>
  `;
}

function renderDecisions(records) {
  const target = document.getElementById('decisions');
  target.innerHTML = '';
  for (const record of records) {
    const item = document.createElement('div');
    item.className = 'decision';
    item.innerHTML = `
      <h4>${record.title}</h4>
      <p>${record.decision}</p>
      <p class="muted">Reversal: ${record.reversalCriteria}</p>
    `;
    target.append(item);
  }
}

try {
  const state = await loadState();
  setText('generatedAt', new Date(state.status.generatedAt).toLocaleString());
  setText('target', state.status.target);
  setText('stage', state.status.currentStage);
  renderList('nextActions', state.nextActions);
  renderDaily(state.daily.at(-1));
  renderDecisions(state.decisions);
} catch (error) {
  setText('stage', error.message);
}

