// The one react-dom function the app's TypeScript calls (src/utils/viewTransition.ts); the rest of react-dom is used from JavaScript (src/main.jsx).
declare module "react-dom" { export function flushSync<R>(fn: () => R): R; }
