export function characterFootprint(character) {
  const canonicalMessages = Array.isArray(character?.history) ? character.history.length : 0;
  const branches = Array.isArray(character?.timeline?.branches) ? character.timeline.branches.length : 0;
  const branchMessages = Array.isArray(character?.timeline?.branches)
    ? character.timeline.branches.reduce((total, branch) => total + (Array.isArray(branch?.history) ? branch.history.length : 0), 0)
    : 0;
  return { canonicalMessages, branches, branchMessages };
}

export function removeCharacterFromState(state, characterId) {
  if (!state || !Array.isArray(state.characters)) return null;
  const index = state.characters.findIndex((character) => character?.id === characterId);
  if (index < 0) return null;
  const [removed] = state.characters.splice(index, 1);
  const next = state.characters[Math.min(index, state.characters.length - 1)];
  if (state.activeCharacterId === characterId || !state.characters.some((character) => character.id === state.activeCharacterId)) {
    state.activeCharacterId = next?.id || "";
  }
  return removed;
}
