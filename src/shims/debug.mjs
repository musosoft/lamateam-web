export default function createDebug() {
  function debug() {}
  debug.enabled = false;
  debug.log = () => {};
  debug.extend = () => debug;
  debug.destroy = () => {};
  return debug;
}

export function debug() {
  return createDebug();
}

export const enable = () => {};
export const disable = () => "";
export const enabled = () => false;
export const log = () => {};
export const formatArgs = () => {};
export const save = () => {};
export const load = () => {};
export const useColors = () => false;
export const storage = undefined;
