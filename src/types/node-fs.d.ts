// The tests run under Node, where node:fs is there; the browser app's types do not include Node's, so the one function a test uses is declared here
// (src/overview/overviewCss.test.ts reads its stylesheet from the file: imported with "?raw", the test runner handed it an empty string).
declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
}
