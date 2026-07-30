// Loads @testing-library/jest-dom's matcher augmentation for TypeScript. `test/setup.ts` imports it at
// runtime, but that file sits outside tsconfig's `include: ["src"]`, so the types need declaring here.
import "@testing-library/jest-dom/vitest";
