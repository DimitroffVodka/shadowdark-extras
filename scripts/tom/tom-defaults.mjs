/**
 * Shared ToM defaults.
 *
 * The default scene background is a single source of truth: both
 * `TomSceneModel` implementations used to hardcode the same literal, and the
 * promised asset was never shipped (issue #57). Changing the default means
 * changing this one constant — and the regression test asserts the file it
 * points at actually exists in the module.
 */
export const DEFAULT_SCENE_BACKGROUND = "modules/shadowdark-extras/assets/default-scene.jpg";
