// The inverse of projectGlobePin maps each visible sphere pixel into the bundled coastline texture.
export const globeShader = `
uniform shader land;
uniform float2 center;
uniform float radius;
uniform float yaw;
uniform float pitch;
half4 main(float2 position) {
  float2 xy = (position - center) / radius;
  xy.y = -xy.y;
  float rr = dot(xy, xy);
  if (rr >= 1.0) return half4(0);
  float z = sqrt(1.0 - rr);
  float y0 = xy.y * cos(pitch) + z * sin(pitch);
  float z0 = -xy.y * sin(pitch) + z * cos(pitch);
  float latitude = asin(clamp(y0, -1.0, 1.0));
  float longitude = atan(xy.x, z0) - yaw;
  float2 uv = float2(fract(longitude / 6.28318530718 + 0.5), 0.5 - latitude / 3.14159265359);
  half4 color = land.eval(uv * float2(2048, 1024));
  float light = clamp(0.79 + 0.20 * z - 0.105 * xy.x + 0.15 * xy.y, 0.72, 1.085);
  float2 degrees = float2(longitude, latitude) * 57.295779513;
  float2 grid = abs(fract(degrees / 30.0 + 0.5) - 0.5) * 30.0;
  float line = 1.0 - smoothstep(0.06, 0.24, min(grid.x, grid.y));
  half3 rgb = mix(color.rgb * light, half3(0.28, 0.35, 0.25), line * 0.12);
  float alpha = clamp((1.0 - sqrt(rr)) * radius, 0.0, 1.0);
  return half4(rgb * alpha, alpha);
}`;
