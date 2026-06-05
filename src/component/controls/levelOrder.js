export const sortFloorCodesByPosition = (floorCodes = [], levels = []) => {
  const levelByCode = new Map(levels.map((level) => [level.code, level]));
  const ordinalByCode = new Map();

  floorCodes.forEach((code, index) => {
    ordinalByCode.set(code, index);
  });

  const entries = floorCodes.map((code, index) => {
    const level = levelByCode.get(code);
    const positionValue = Number.isFinite(level?.position) ? level.position : null;
    const ordinalValue = ordinalByCode.get(code) ?? index;
    const sortValue = positionValue ?? ordinalValue;

    return {
      code,
      sortValue,
      ordinalValue,
      index
    };
  });

  entries.sort((a, b) => {
    if (a.sortValue !== b.sortValue) return b.sortValue - a.sortValue;
    if (a.ordinalValue !== b.ordinalValue) return b.ordinalValue - a.ordinalValue;
    return a.index - b.index;
  });

  return entries.map((entry) => entry.code);
};
