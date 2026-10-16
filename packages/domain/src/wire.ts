/** What a response schema infers, read-only all the way down: nothing edits a response in place. */
export type Wire<T> = T extends readonly (infer E)[]
  ? readonly Wire<E>[]
  : T extends object
    ? { readonly [K in keyof T]: Wire<T[K]> }
    : T;
