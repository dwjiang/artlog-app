// Nitro hybrid objects need the native runtime; Jest gets a stub that fails clearly when called.
export const NitroModules = {
  createHybridObject(name: string): never {
    throw new Error(`Nitro hybrid object ${name} is unavailable under Jest`);
  },
};
