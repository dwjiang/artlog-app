export type GlobeCamera = { yaw: number; pitch: number; zoom: number };
export type GlobePin = { id: string; latitude: number; longitude: number; label: string };
export type GlobeCluster = { x: number; y: number; ids: string[]; label: string };
const radians = Math.PI / 180;

export function globeGeometry(width: number, height: number, zoom: number) {
  "worklet";
  return {
    cx: width / 2,
    cy: height / 2 - 4,
    radius: Math.min(width * 0.445, height * 0.475) * zoom,
  };
}
export function globeCamera(latitude: number, longitude: number): GlobeCamera {
  "worklet";
  return { yaw: -longitude, pitch: Math.max(-70, Math.min(70, latitude)), zoom: 1 };
}
export function projectGlobePin(pin: GlobePin, camera: GlobeCamera, width: number, height: number) {
  "worklet";
  const { cx, cy, radius } = globeGeometry(width, height, camera.zoom);
  const latitude = pin.latitude * radians,
    longitude = (pin.longitude + camera.yaw) * radians,
    pitch = camera.pitch * radians;
  const x = Math.cos(latitude) * Math.sin(longitude),
    y = Math.sin(latitude),
    z = Math.cos(latitude) * Math.cos(longitude);
  return {
    x: cx + radius * x,
    y: cy - radius * (y * Math.cos(pitch) - z * Math.sin(pitch)),
    depth: y * Math.sin(pitch) + z * Math.cos(pitch),
  };
}
export function globeClusters(
  pins: GlobePin[],
  camera: GlobeCamera,
  width: number,
  height: number,
): GlobeCluster[] {
  "worklet";
  const groups: GlobeCluster[] = [];
  for (const pin of pins) {
    const point = projectGlobePin(pin, camera, width, height);
    if (point.depth < 0.04 || point.x < 0 || point.x > width || point.y < 0 || point.y > height)
      continue;
    const group = groups.find(
      (candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < 27,
    );
    if (group) {
      const count = group.ids.length;
      group.x = (group.x * count + point.x) / (count + 1);
      group.y = (group.y * count + point.y) / (count + 1);
      group.ids.push(pin.id);
    } else groups.push({ x: point.x, y: point.y, ids: [pin.id], label: pin.label });
  }
  return groups;
}
export function hitGlobePin(groups: GlobeCluster[], x: number, y: number) {
  "worklet";
  let nearest: GlobeCluster | undefined,
    distance = 24;
  for (const group of groups) {
    const next = Math.hypot(group.x - x, group.y - y);
    if (next < distance) {
      nearest = group;
      distance = next;
    }
  }
  return nearest?.ids[0];
}
