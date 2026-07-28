// Vite `?url` asset imports resolve to a string URL at build time.
declare module "*?url" {
  const url: string;
  export default url;
}
