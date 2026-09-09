export function layoutIterationBudget(nodeCount) {
  const count = Math.max(0, Number(nodeCount) || 0);
  if (count <= 40) return 130;
  if (count <= 100) return 170;
  if (count <= 250) return 230;
  if (count <= 500) return 290;
  return 340;
}

export function layoutDimensions(viewportWidth, viewportHeight, nodeCount) {
  const width = Math.max(800, Number(viewportWidth) || 1200);
  const height = Math.max(520, Number(viewportHeight) || 720);
  const count = Math.max(1, Number(nodeCount) || 1);
  const targetArea = count * 8_500;
  const scale = Math.max(1, Math.min(3.2, Math.sqrt(targetArea / (width * height))));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    scale,
  };
}

export function fitTransform(viewportWidth, viewportHeight, worldWidth, worldHeight, { minZoom = 0.35, maxZoom = 1, padding = 34 } = {}) {
  const viewportW = Math.max(1, Number(viewportWidth) || 1);
  const viewportH = Math.max(1, Number(viewportHeight) || 1);
  const worldW = Math.max(1, Number(worldWidth) || 1);
  const worldH = Math.max(1, Number(worldHeight) || 1);
  const availableW = Math.max(1, viewportW - padding * 2);
  const availableH = Math.max(1, viewportH - padding * 2);
  const k = Math.max(minZoom, Math.min(maxZoom, availableW / worldW, availableH / worldH));
  return {
    k,
    x: (viewportW - worldW * k) / 2,
    y: (viewportH - worldH * k) / 2,
  };
}

export function applyLocalRepulsion(nodes, cooling, { cellSize = 180, padding = 58 } = {}) {
  const grid = new Map();
  for (const node of nodes) {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const key = `${cellX}:${cellY}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(node);
  }

  const seen = new Set();
  for (const left of nodes) {
    const leftCellX = Math.floor(left.x / cellSize);
    const leftCellY = Math.floor(left.y / cellSize);
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nearby = grid.get(`${leftCellX + offsetX}:${leftCellY + offsetY}`) || [];
        for (const right of nearby) {
          if (left === right) continue;
          const pairKey = left.index < right.index ? `${left.index}:${right.index}` : `${right.index}:${left.index}`;
          if (seen.has(pairKey)) continue;
          seen.add(pairKey);

          let dx = right.x - left.x;
          let dy = right.y - left.y;
          let distanceSquared = dx * dx + dy * dy;
          if (distanceSquared < 1) {
            const direction = ((left.index + right.index) % 2) ? 1 : -1;
            dx = direction;
            dy = 1;
            distanceSquared = 2;
          }
          if (distanceSquared > cellSize * cellSize) continue;
          const distance = Math.sqrt(distanceSquared);
          const minimum = (Number(left.radius) || 0) + (Number(right.radius) || 0) + padding;
          const strength = distance < minimum ? 2.2 : 120 / distanceSquared;
          const push = strength * cooling;
          if (!left.fixed) {
            left.vx -= (dx / distance) * push;
            left.vy -= (dy / distance) * push;
          }
          if (!right.fixed) {
            right.vx += (dx / distance) * push;
            right.vy += (dy / distance) * push;
          }
        }
      }
    }
  }
}
