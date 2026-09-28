// Hex-map benchmark (baked maps, Enhancer #272): one scene, same steps every run.
// Runs inside the browser being tested.
// Party moves write to the scene (token + fog), so pass moves > 0 only for test scenes.
async function sdeBench({ sceneId, moves = 0, follow = false, playScale = 0.5, idleMs = 3000 }) {
  const X = "shadowdark-extras";
  const now = () => performance.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const frames = () => {
    const d = [];
    const tick = () => d.push(canvas.app.ticker.deltaMS);
    canvas.app.ticker.add(tick);
    return () => { canvas.app.ticker.remove(tick); return d; };
  };
  const stats = (d, secs) => {
    const s = [...d].sort((a, b) => a - b);
    const q = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0);
    // Hitches: frames over 33 ms (two frames lost at 60 Hz) and over 50 ms.
    return {
      fps: Math.round(d.length / secs), p50: q(0.5), p95: q(0.95), worst: Math.round(s.at(-1) ?? 0),
      over33: d.filter((x) => x > 33.4).length, over50: d.filter((x) => x > 50).length,
    };
  };
  const measure = async (ms, action) => {
    const stop = frames();
    const t0 = now();
    if (action) await action();
    await sleep(ms);
    return stats(stop(), (now() - t0) / 1000);
  };

  const scene = game.scenes.get(sceneId);
  if (!scene) throw new Error(`no scene ${sceneId}`);
  const out = {
    scene: scene.name, user: game.user.name,
    perfMode: Object.entries(CONST.CANVAS_PERFORMANCE_MODES).find(([, v]) => v === canvas.performance.mode)?.[0],
  };

  // 1. Scene load: view (or redraw) it, then wait for any sprite art to be drawn too.
  const t0 = now();
  await new Promise((resolve) => {
    Hooks.once("canvasReady", resolve);
    if (canvas.scene?.id === sceneId) canvas.draw(); else scene.view();
  });
  out.loadMs = Math.round(now() - t0);
  const want = Object.values(scene.getFlag(X, "bakedKeyed") ?? {}).flat().length;
  const drawn = () => canvas.primary.children.filter((c) => c.name?.startsWith(`${X}.keyed.`)).length;
  while (want && drawn() < want && now() - t0 < 60000) await sleep(25);
  out.artReadyMs = Math.round(now() - t0);
  out.tiles = scene.tiles.size;
  out.sprites = want;
  out.textureMB = Math.round(foundry.canvas.TextureLoader.approximateTotalMemoryUsage / 1048576);

  // 2. Idle at play zoom on the party.
  const party = scene.tokens.find((t) => t.actor?.getFlag(X, "isParty"));
  const c = party?.object?.center ?? { x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2 };
  canvas.pan({ x: c.x, y: c.y, scale: playScale });
  await sleep(1000);
  out.idlePlay = await measure(idleMs);

  // 3. A fixed pan path at play zoom, into areas not yet on screen.
  out.pan = await measure(300, async () => {
    for (const [dx, dy] of [[3000, 0], [0, 2500], [-3000, 0], [0, -2500]]) {
      await canvas.animatePan({ x: c.x + dx, y: c.y + dy, scale: playScale, duration: 700 });
    }
  });

  // 4. Zoom out to the whole map (the first frames carry the hitch), then idle there.
  const [sw, sh] = canvas.screenDimensions;
  const fit = Math.min(sw / canvas.dimensions.width, sh / canvas.dimensions.height);
  out.zoomOut = await measure(1500, async () => canvas.pan({ x: canvas.dimensions.width / 2, y: canvas.dimensions.height / 2, scale: fit }));
  out.idleWhole = await measure(idleMs);
  out.zoomIn = await measure(1500, async () => canvas.pan({ x: c.x, y: c.y, scale: playScale }));

  // 5. The party travels hex by hex toward the farthest map corner, into fog (the token's owner,
  // test scenes only), moved the way a drag moves it. With `follow`, the camera eases after it as
  // a player keeps the party in view, so moves, fog reveals and map streaming happen together.
  if (moves && party?.isOwner) {
    out.moves = [];
    const g = scene.grid;
    const start = party.object.center;
    const { width: W, height: H } = canvas.dimensions;
    const far = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: 0, y: H }, { x: W, y: H }]
      .sort((a, b) => Math.hypot(b.x - start.x, b.y - start.y) - Math.hypot(a.x - start.x, a.y - start.y))[0];
    const len = Math.hypot(far.x - start.x, far.y - start.y);
    const heading = { x: (far.x - start.x) / len, y: (far.y - start.y) / len };
    // On a pyramid scene: is every piece the view needs, at the zoom's level, on the canvas?
    const pyramid = scene.getFlag(X, "bakedPyramid");
    const core = pyramid && await import(foundry.utils.getRoute(`modules/${X}/scripts/hex/hex-bake-core.mjs`));
    const sharp = () => {
      const { meta } = pyramid;
      const k = canvas.stage.scale.x;
      const [vw, vh] = canvas.screenDimensions;
      const view = { x: canvas.stage.pivot.x - (vw / k / 2), y: canvas.stage.pivot.y - (vh / k / 2), width: vw / k, height: vh / k };
      const level = core.pyramidLevel(k * canvas.app.renderer.resolution, meta.levels.length);
      if (level === meta.levels.length - 1) return true;
      const have = new Set(canvas.primary.children.flatMap((c) => c.children ?? []).map((c) => c.name));
      return core.piecesInView(meta, level, view, 0).every((q) => have.has(`${X}.pyramid.${q.key}`));
    };
    for (let k = 0; k < moves; k++) {
      const doc = scene.tokens.get(party.id);
      const at = doc.object.center;
      const onward = (o) => { const c = g.getCenterPoint(o); return ((c.x - at.x) * heading.x) + ((c.y - at.y) * heading.y); };
      const to = g.getAdjacentOffsets(g.getOffset(at)).sort((a, b) => onward(b) - onward(a))[0];
      const p = g.getCenterPoint(to);
      let revealAt = null;
      const hook = Hooks.on("updateScene", (s, ch) => { if (s.id === sceneId && ch.flags?.[X] && revealAt === null) revealAt = now(); });
      const stop = frames();
      const t1 = now();
      const moved = doc.move({ x: Math.round(p.x - (doc.width * g.sizeX) / 2), y: Math.round(p.y - (doc.height * g.sizeY) / 2) });
      const panned = follow ? canvas.animatePan({ x: p.x, y: p.y, scale: canvas.stage.scale.x, duration: 600 }) : null;
      await moved;
      // Sharp: once the camera has stopped, every piece of the new view is in.
      let sharpMs = null;
      if (pyramid) {
        await panned;
        while (!sharp() && now() - t1 < 5000) await new Promise((r) => requestAnimationFrame(r));
        if (sharp()) sharpMs = Math.round(now() - t1);
      }
      await sleep(Math.max(0, (follow ? 1500 : 2000) - (now() - t1)));
      Hooks.off("updateScene", hook);
      const st = stats(stop(), (now() - t1) / 1000);
      out.moves.push({ worst: st.worst, p95: st.p95, over33: st.over33, revealMs: revealAt === null ? null : Math.round(revealAt - t1), sharpMs });
    }
  }
  out.focused = document.hasFocus();
  return out;
}
