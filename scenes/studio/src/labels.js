// Pet names, drawn as DOM text over the canvas: crisp at any pixel ratio and readable on
// any backdrop (light text, dark halo). A sulking pet gets a small cloud and a "z z".
const CLOUD = '<svg viewBox="0 0 24 14" aria-hidden="true"><path d="M6 13h12a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 8.1 4.1 4.5 4.5 0 0 0 6 13z"/></svg>';

export function createLabels(stage) {
  const layer = document.createElement('div');
  layer.className = 'pet-labels';
  layer.setAttribute('aria-hidden', 'true');
  stage.append(layer);
  const items = new Map();

  function element(id) {
    let item = items.get(id);
    if (item) return item;
    const root = document.createElement('div');
    root.className = 'pet';
    const mood = document.createElement('div');
    mood.className = 'pet-mood';
    mood.innerHTML = `${CLOUD}<span>z</span><span>z</span>`;
    const name = document.createElement('div');
    name.className = 'pet-name';
    root.append(mood, name);
    layer.append(root);
    item = { root, mood, name, text: null, sulking: null };
    items.set(id, item);
    return item;
  }

  function update(agents) {
    const seen = new Set();
    for (const a of agents) {
      if (!a.pet) continue;
      seen.add(a.pet.id);
      const item = element(a.pet.id);
      if (item.text !== a.pet.name) { item.name.textContent = a.pet.name; item.text = a.pet.name; item.name.hidden = !a.pet.name; }
      if (item.sulking !== a.sulking) { item.mood.hidden = !a.sulking; item.sulking = a.sulking; }
      const below = a.len * (a.kind === 'jellyfish' ? 0.9 : a.kind === 'angelfish' ? 0.55 : 0.32);
      const above = a.len * (a.kind === 'jellyfish' ? 0.45 : a.kind === 'angelfish' ? 0.6 : 0.35);
      item.root.style.transform = `translate3d(${a.x.toFixed(1)}px, ${(a.y + below).toFixed(1)}px, 0)`;
      item.mood.style.transform = `translate(-50%, ${(-below - above - 22).toFixed(1)}px)`;
    }
    for (const [id, item] of items) if (!seen.has(id)) { item.root.remove(); items.delete(id); }
  }

  return { update, dispose() { layer.remove(); items.clear(); } };
}
