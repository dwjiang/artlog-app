type RenderedNode = { props: { modifiers?: { $type: string }[] }; parent: RenderedNode | null };

/** The SwiftUI `dynamicTypeSize` constraints native content inherits from itself and its ancestors. */
export function dynamicTypeSizeCaps(node: RenderedNode) {
  const caps: { $type: string }[] = [];
  for (let current: RenderedNode | null = node; current; current = current.parent) {
    caps.push(...(current.props.modifiers ?? []).filter(({ $type }) => $type === "dynamicTypeSize"));
  }
  return caps;
}
