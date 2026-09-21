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
  float luminance = dot(color.rgb, half3(0.299, 0.587, 0.114));
  half3 sage = mix(half3(0.71, 0.77, 0.70), half3(0.88, 0.91, 0.85), smoothstep(0.25, 0.95, luminance));
  float light = 0.96 + 0.04 * z;
  float gridDistance = min(abs(sin(latitude * 6.0)), abs(sin(longitude * 6.0)));
  float grid = 1.0 - smoothstep(0.008, 0.022, gridDistance);
  half3 rgb = mix(sage * light, half3(0.63, 0.69, 0.61), grid * 0.22);
  float alpha = clamp((1.0 - sqrt(rr)) * radius, 0.0, 1.0);
  return half4(rgb * alpha, alpha);
}`;
