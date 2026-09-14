// The Mapbox GL build the /communities map loads from Mapbox's CDN. One place
// for the version, so the page's preload and script tags and the sitewide
// background prefetch (MapPreload) always name the same two files: a prefetch
// of any other URL would be wasted, and a version bump here reaches both.
export const MAPBOX_GL_VERSION = 'v3.8.0'
export const MAPBOX_GL_JS_URL = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.js`
export const MAPBOX_GL_CSS_URL = `https://api.mapbox.com/mapbox-gl-js/${MAPBOX_GL_VERSION}/mapbox-gl.css`
