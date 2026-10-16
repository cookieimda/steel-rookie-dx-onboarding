// 계산 모델은 서버에 둔다. 이 모듈은 단위·기준 대비 변화 등 표시 데이터만 만든다.
const IRON_OUTPUTS = [
  ['hot_metal_temp_c', '용선 온도', '℃', 0, 'taphole_casthouse'],
  ['slag_kg', '슬래그량', 'kg/t', 1, 'blast_furnace'],
  ['basicity', '슬래그 염기도', '', 2, 'blast_furnace'],
  ['fuel_rate_kg', '연료비', 'kg/t', 0, 'coke_oven'],
  ['co2_kg', 'CO₂ 상한', 'kg/t', 0, 'blast_furnace'],
  ['ore_kg', '철 원료', 'kg/t', 0, 'sinter_plant'],
];
export function displayRows(reply, section) {
  const rows = section === 'ironmaking'
    ? IRON_OUTPUTS.map(([id, label, unit, digits, equipment]) => ({ id, label, unit, digits, equipment, value: reply.result[id], base: reply.baseline[id] }))
    : reply.nodes.filter(n => n.process === section && !n.control).slice(0, 6).map(n => ({ id: n.id, label: n.label, unit: n.unit, digits: n.digits, equipment: n.equipment_id, value: n.value, base: n.base }));
  return rows.map(row => {
    if (!Number.isFinite(row.value) || !Number.isFinite(row.base)) throw new Error('계산 결과의 수치를 확인할 수 없습니다. 다시 시도해 주세요.');
    const delta = row.value - row.base, threshold = .5 * 10 ** -row.digits;
    return { ...row, delta, direction: Math.abs(delta) < threshold ? 'flat' : delta > 0 ? 'up' : 'down' };
  });
}
export const displayNumber = (value, digits = 0) => value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export function tempPosition(value, low, high) { return Math.min(100, Math.max(0, (value - low) / (high - low) * 100)); }
