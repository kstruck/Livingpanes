// A minimal code-mode scene for manual testing (tests/preview.html): a colour field that
// darkens at night and a ring wherever food or a tap lands.
export default function create({ THREE, renderer, onFrame, onFeed, onTap, night, pointer }) {
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x225577 }));
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 32), new THREE.MeshBasicMaterial({ color: 0xffcc66 }));
  scene.add(quad, dot);
  let pulse = 0;
  const hit = () => { pulse = 1; };
  onFeed(hit); onTap(hit);
  onFrame((dt, t) => {
    pulse = Math.max(0, pulse - dt);
    quad.material.color.setHSL(0.55 + 0.05 * Math.sin(t * 0.3), 0.5, 0.35 - 0.25 * night());
    const { width, height } = renderer.getSize(new THREE.Vector2());
    dot.position.set(pointer.inside ? pointer.x / width * 2 - 1 : 0, pointer.inside ? 1 - pointer.y / height * 2 : 0, 0);
    dot.scale.setScalar(1 + pulse * 2);
    renderer.render(scene, camera);
  });
  return { dispose() { quad.geometry.dispose(); quad.material.dispose(); dot.geometry.dispose(); dot.material.dispose(); } };
}
