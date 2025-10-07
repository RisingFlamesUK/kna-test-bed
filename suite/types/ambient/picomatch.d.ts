// suite/types/picomatch.d.ts
declare module 'picomatch' {
  export type Matcher = (input: string) => boolean;
  export interface Options {
    dot?: boolean;
    nocase?: boolean;
  }
  export default function picomatch(pattern: string, options?: Options): Matcher;
}
