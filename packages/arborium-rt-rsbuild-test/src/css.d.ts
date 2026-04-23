// Lets TypeScript accept bare CSS side-effect imports from
// `@discord/arborium-rt/themes/*.css`. rspack/rsbuild pick these up and
// ship them as style assets; TS just needs a type stub.
declare module '*.css';
