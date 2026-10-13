// A bridge, not code to copy. The render pipeline is the local implementation's
// (src/server/services/local/render/render-template.ts): the preview reaches it through `services().render`, and
// /api/v1, the backend's own API, imports it there. This keeps `runRender` at its old path for the test plan P1 owns
// that still imports it here (src/server/actions/versioned-name.test.ts) until P1 ports it; the integration step
// (2b-2) deletes the file.

// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the bridge above: nothing else may import an implementation.
export { runRender } from "@/server/services/local/render/render-template";
