// The Mapbox GL build the /communities map loads from Mapbox's CDN. One place
// for the version, so the page's preload and script tags and the sitewide
// background prefetch (MapPreload) always name the same two files: a prefetch
// of any other URL would be wasted, and a version bump here reaches both.
// 3.33.0 since 23 Nov 2026. Builds before 3.11 got an older Mapbox Standard
// basemap that ignored the style's own colors (water, greenspace, borders) and
// had no way to recolor the pink country borders.
export const MAPBOX_GL_VERSION = 'v3.33.0'
export const MAPBOX_GL_JS_URL = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js`
export const MAPBOX_GL_CSS_URL = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css`
