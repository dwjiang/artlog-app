// Metro bundles `.txt` files as assets (metro.config.js); `expo/types` only declares the default extensions.
declare module "*.txt" {
  const assetId: number;
  export default assetId;
}
