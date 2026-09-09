export function placementProposalPayload(scanId: string): string {
  return JSON.stringify({ operation: 'proposePlacement', scanId });
}
