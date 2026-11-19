// Shades for clip label colors and marker colors (project.json stores the names).
export const LABEL_HEX = {
  red: '#e5534b', orange: '#ec8f3c', yellow: '#e2c541', green: '#57b85c', teal: '#2fb4a6',
  blue: '#4a8ff0', violet: '#9a6ff0', pink: '#e866b5', brown: '#a77b52', gray: '#8b8b93',
};
export const MARKER_DEFAULT = '#ffa64d';
export const markerHex = (m) => LABEL_HEX[m?.color] || MARKER_DEFAULT;
