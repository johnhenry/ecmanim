// Ambient declarations for dependencies that ship no TypeScript types.
// Both are consumed through narrow, well-tested call sites; `any` at the
// module boundary is deliberate (we do not re-declare their full APIs here).

declare module "gifenc" {
  export const GIFEncoder: any;
  export function quantize(...args: any[]): any;
  export function applyPalette(...args: any[]): any;
  const _default: any;
  export default _default;
}

declare module "opentype.js" {
  export function parse(buffer: ArrayBuffer | Buffer, options?: any): any;
  export function load(url: string, callback?: any): any;
  const _default: any;
  export default _default;
}
