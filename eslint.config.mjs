import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "next-env.d.ts", "playwright-report/**", "test-results/**", "public/3d/viewer/**"],
  },
  {
    // Layering guard: services are framework-agnostic and must not reach into
    // the client-side Zustand stores. Read state in the caller and pass it in.
    files: ["src/services/**/*.ts", "src/services/**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [{
          group: ["@/store/*", "**/store/*"],
          message: "服务层不能依赖客户端 store；请把状态读取上移到调用方。",
        }],
      }],
    },
  },
];

export default eslintConfig;
