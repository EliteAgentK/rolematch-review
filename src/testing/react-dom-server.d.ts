// The one function the unit tests use from react-dom's server renderer (src/testing/ssr.ts). The project has React's types but not react-dom's.
declare module "react-dom/server" {
  export function renderToStaticMarkup(element: import("react").ReactElement): string;
}
