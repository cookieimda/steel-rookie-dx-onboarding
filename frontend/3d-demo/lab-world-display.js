import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { displayNumber } from './lab-display-data.js';

/** 독립 전광판과 설비 반응 층. 바닥판·뒷벽은 만들지 않는다. */
export function createLabWorld(scene, reduced) {
  const surface = document.createElement('canvas'); surface.width = 2160; surface.height = 860;
  const pen = surface.getContext('2d'), texture = new THREE.CanvasTexture(surface); texture.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }));
  screen.name = 'lab-quotation-board'; screen.raycast = () => {}; screen.visible = false; scene.add(screen);
  const reaction = new THREE.Group(); scene.add(reaction);
  let current, rows = [], series = new Map(), lines = [], pulse = null, bounds = null, flashed = 0, lastFlash = -1, playback = 1;
  const ink = (text, x, y, size, color = '#e8ecf2', bold = false) => { pen.fillStyle = color; pen.font = `${bold ? 700 : 500} ${size}px "Noto Sans KR", sans-serif`; pen.fillText(text, x, y); };
  function draw(flash = 0) {
    pen.fillStyle = '#101620'; pen.fillRect(0, 0, 2160, 860);
    pen.strokeStyle = '#435064'; pen.lineWidth = 3; pen.strokeRect(2, 2, 2156, 856);
    pen.fillStyle = '#ff9e64'; pen.fillRect(0, 0, 2160, 6);
    ink(`${current?.data.name || ''} 조업 전광판`, 48, 78, 48, '#f2f2f2', true);
    ink('WHAT-IF · 교육용 모의 수치', 1400, 74, 31, '#a3aab7');
    ['지표', '계산값', '기준값', '등락', '실험 변경 이력'].forEach((label, i) => ink(label, [48, 620, 1030, 1400, 1770][i], 153, 30, '#8995a6'));
    if (!rows.length) ink('오른쪽 조건을 바꾸면 계산 결과가 이곳에 표시됩니다.', 80, 440, 43, '#8995a6');
    rows.forEach((r, i) => {
      const top = 176 + i * 100, tint = r.direction === 'up' ? '#ff7077' : r.direction === 'down' ? '#7faeff' : '#e5e8ed';
      pen.fillStyle = i % 2 ? '#172130' : '#131b27'; pen.fillRect(24, top, 2112, 94);
      if (flash && r.direction !== 'flat') { pen.fillStyle = r.direction === 'up' ? `rgba(220,70,80,${flash * .15})` : `rgba(80,130,230,${flash * .15})`; pen.fillRect(24, top, 2112, 94); }
      ink(r.label, 48, top + 62, 41, '#cbd2dd');
      ink(`${displayNumber(r.value, r.digits)} ${r.unit}`, 620, top + 62, 47, tint, true);
      ink(displayNumber(r.base, r.digits), 1030, top + 62, 38, '#8c98a8');
      ink(r.direction === 'flat' ? '—' : `${r.direction === 'up' ? '▲ +' : '▼ −'}${displayNumber(Math.abs(r.delta), r.digits)}`, 1400, top + 62, 40, tint, true);
      const samples = series.get(r.id) || [r.base, r.value], min = Math.min(...samples), range = Math.max(1, Math.max(...samples) - min);
      pen.beginPath(); samples.forEach((v, j) => { const x = 1780 + j / Math.max(1, samples.length - 1) * 300, y = top + 72 - (v - min) / range * 50; if (j) pen.lineTo(x, y); else pen.moveTo(x, y); });
      pen.lineWidth = 3; pen.strokeStyle = tint; pen.stroke();
    });
    ink('▲ 상승 빨강 · ▼ 하락 파랑  /  실제 조업·금융 시세 아님  /  오른쪽에서 입력 조건 조절', 48, 826, 28, '#7f8b9e'); texture.needsUpdate = true;
  }
  const centerOf = id => current?.eqs.find(e => e.id === id)?.box.getCenter(new THREE.Vector3());
  function clearReactions() {
    lines = []; pulse = null;
    reaction.children.slice().forEach(obj => { reaction.remove(obj); obj.geometry?.dispose(); obj.material?.dispose(); });
  }
  function focus(id) {
    if (pulse) { reaction.remove(pulse); pulse.geometry.dispose(); pulse.material.dispose(); }
    const p = centerOf(id); if (!p) return;
    pulse = new THREE.Mesh(new THREE.TorusGeometry(2.2, .035, 8, 64), new THREE.MeshBasicMaterial({ color: 0xffb982, transparent: true, opacity: .8, depthWrite: false }));
    pulse.rotation.x = -Math.PI / 2; pulse.position.set(p.x, .2, p.z); pulse.raycast = () => {}; reaction.add(pulse);
  }
  function flow(aId, bId, color) {
    const a = centerOf(aId), b = centerOf(bId); if (!a || !b || aId === bId) return;
    a.y += 2; b.y += 2; const mid = a.clone().lerp(b, .5); mid.y += 4 + a.distanceTo(b) * .12;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .45 }));
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(30), 3));
    const dots = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size: 5, sizeAttenuation: false, depthWrite: false }));
    reaction.add(line, dots); line.raycast = dots.raycast = () => {}; lines.push({ curve, dots });
  }
  function setProcess(p) {
    clearReactions(); current = p; rows = []; series = new Map();
    const size = p.bounds.getSize(new THREE.Vector3()), c = p.bounds.getCenter(new THREE.Vector3());
    const w = Math.max(45, size.x * 1.05, size.z * .9), h = w * 860 / 2160;
    screen.scale.set(w, h, 1); screen.position.set(c.x, p.bounds.max.y + h * .42 + 3, p.bounds.min.z - 6); screen.visible = true;
    bounds = new THREE.Box3().setFromCenterAndSize(screen.position, new THREE.Vector3(w, h, 1)); draw();
  }
  function update(next, reply, section) {
    rows = next;
    for (const r of rows) { const values = series.get(r.id) || [r.base]; values.push(r.value); series.set(r.id, values.slice(-20)); }
    flashed = performance.now(); draw(reduced ? 0 : 1); clearReactions();
    if (section === 'ironmaking') {
      const color = reply.result.hot_metal_temp_c >= reply.baseline.hot_metal_temp_c ? 0xff9e64 : 0x6b9fe6;
      for (const effect of reply.effects) flow(effect.equipment_id, 'blast_furnace', color);
      if (reply.effects.length) { flow('blast_furnace', 'taphole_casthouse', color); focus('blast_furnace'); }
      if (reply.result.warnings.length && pulse) pulse.material.color.setHex(0xee686e);
    } else {
      const nodes = new Map(reply.nodes.map(n => [n.id, n]));
      for (const e of reply.edges.filter(e => e.active)) { const a = nodes.get(e.from), b = nodes.get(e.to); if (a.process === section && b.process === section) flow(a.equipment_id, b.equipment_id, e.effect > 0 ? 0xff9e64 : 0x6b9fe6); }
      const changed = rows.find(r => r.direction !== 'flat'); if (changed) focus(changed.equipment);
    }
    document.body.dataset.labEffects = String(lines.length);
  }
  return { setProcess, update, focus, bounds: () => bounds, speed: value => { playback = value; }, clear: () => { clearReactions(); screen.visible = false; }, tick(now, camera) {
    if (!screen.visible) return;
    screen.quaternion.copy(camera.quaternion);
    const phase = reduced ? 0 : Math.round(Math.max(0, 1 - (now - flashed) / 800) * 10) / 10;
    if (phase !== lastFlash) { draw(phase); lastFlash = phase; }
    if (pulse) pulse.scale.setScalar(reduced ? 1 : 1 + .12 * Math.sin(now / 350));
    for (const { curve, dots } of lines) { const positions = dots.geometry.attributes.position; for (let j = 0; j < 10; j++) { const p = curve.getPoint((j / 10 + (reduced ? 0 : now / 2600 * playback)) % 1); positions.setXYZ(j, p.x, p.y, p.z); } positions.needsUpdate = true; }
  } };
}
