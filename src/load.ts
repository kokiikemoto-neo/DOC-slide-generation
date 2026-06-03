// JSON ファイルを読み、ajv で対応スキーマ検証してから型付きで返すローダ群。
// 段間契約（StyleSpec / Content / SlidePlan）をランタイムで担保する。
import fs from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import { ROOT } from "./config.js";
import type { StyleSpec, ComingSoonContent, SlidePlan } from "./types.js";

const SCHEMA_DIR = path.join(ROOT, "schemas");

/** スキーマ検証エラー。どのファイルのどこが不正かを読みやすく整形する。 */
export class SchemaValidationError extends Error {
  constructor(
    public readonly label: string,
    public readonly source: string,
    public readonly errors: ErrorObject[]
  ) {
    const detail = (errors ?? [])
      .map((e) => `  - ${e.instancePath || "(root)"} ${e.message ?? ""}`.trimEnd())
      .join("\n");
    super(`${label} のスキーマ検証に失敗しました (${source}):\n${detail}`);
    this.name = "SchemaValidationError";
  }
}

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
const validatorCache = new Map<string, ValidateFunction>();

function getValidator(schemaFile: string): ValidateFunction {
  const cached = validatorCache.get(schemaFile);
  if (cached) return cached;
  const schemaPath = path.join(SCHEMA_DIR, schemaFile);
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`スキーマファイルが見つかりません: ${schemaPath}`);
  }
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const validate = ajv.compile(schema);
  validatorCache.set(schemaFile, validate);
  return validate;
}

function readJson(filePath: string, label: string): unknown {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`${label} が見つかりません: ${abs}`);
  }
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    throw new Error(`${label} の JSON 解析に失敗しました (${abs}): ${(err as Error).message}`);
  }
}

/** 任意データを指定スキーマで検証。失敗時は SchemaValidationError を投げる。 */
export function validateAgainst<T>(
  data: unknown,
  schemaFile: string,
  label: string,
  source: string
): T {
  const validate = getValidator(schemaFile);
  if (!validate(data)) {
    throw new SchemaValidationError(label, source, validate.errors ?? []);
  }
  return data as T;
}

/** 固定 StyleSpec を読み込み stylespec.schema.json で検証して返す。 */
export function loadStyleSpec(filePath: string): StyleSpec {
  const data = readJson(filePath, "StyleSpec");
  return validateAgainst<StyleSpec>(data, "stylespec.schema.json", "StyleSpec", filePath);
}

/** coming-soon-v1 の7スロット入力を読み込み検証して返す。 */
export function loadComingSoonContent(filePath: string): ComingSoonContent {
  const data = readJson(filePath, "content");
  return validateAgainst<ComingSoonContent>(
    data,
    "content-coming-soon.schema.json",
    "ContentInput",
    filePath
  );
}

/** SlidePlan をオブジェクトとして検証（compose 出力の自己検証用）。 */
export function validateSlidePlan(plan: SlidePlan, source = "(in-memory)"): SlidePlan {
  return validateAgainst<SlidePlan>(plan, "slideplan.schema.json", "SlidePlan", source);
}
