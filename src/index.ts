#!/usr/bin/env node
// SlideGen CLI エントリポイント。
//   slidegen render  --style <stylespec.json> --input <content.json> [opts]
//   slidegen compose --style <stylespec.json> --input <content.json> [--out plan.json]
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";
import { loadStyleSpec, loadComingSoonContent, SchemaValidationError } from "./load.js";
import { composeComingSoon } from "./compose/layout.js";
import { renderToSlides } from "./render/googleSlides.js";
import { AuthError } from "./render/auth.js";
import { PerspectiveError } from "./render/perspective.js";
import { ImageResolveError } from "./render/drive.js";

const DEFAULT_STYLE = path.join(ROOT, "samples", "stylespec-coming-soon.json");

interface ParsedArgs {
  command: string | undefined;
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  // 先頭がフラグ(--xxx)ならコマンド無しとして扱う
  const hasCommand = argv.length > 0 && !argv[0]!.startsWith("-");
  const command = hasCommand ? argv[0] : undefined;
  const rest = hasCommand ? argv.slice(1) : argv;
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i]!;
    if (tok.startsWith("--")) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    }
  }
  return { command, flags };
}

function usage(): string {
  return [
    "SlideGen — テンプレ準拠スライド生成 (coming-soon-v1 固定)",
    "",
    "使い方:",
    "  slidegen render  --input content.json [--style stylespec-coming-soon-v1.json] [--title T] [--keep-uploads] [--plan-out plan.json]",
    "  slidegen compose --input content.json [--style stylespec-coming-soon-v1.json] [--out plan.json]",
    "",
    "オプション:",
    "  --style        固定StyleSpecのパス (既定: samples/stylespec-coming-soon-v1.json)",
    "  --input        7スロット content.json のパス (必須)",
    "  --out          compose: SlidePlan の出力先 (省略時は標準出力)",
    "  --plan-out     render: 生成した SlidePlan も保存する",
    "  --title        プレゼンのタイトル",
    "  --keep-uploads 生成後に Drive の一時画像を削除しない",
    "  --help         このヘルプ",
  ].join("\n");
}

function requireString(flags: ParsedArgs["flags"], key: string): string {
  const v = flags[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new UsageError(`--${key} が必要です。`);
  }
  return v;
}

class UsageError extends Error {}

async function run(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));

  if (!command || command === "help" || flags["help"]) {
    console.log(usage());
    return;
  }

  if (command === "compose" || command === "render") {
    const stylePath =
      typeof flags["style"] === "string" ? (flags["style"] as string) : DEFAULT_STYLE;
    const inputPath = requireString(flags, "input");

    const spec = loadStyleSpec(stylePath);
    const content = loadComingSoonContent(inputPath);
    const { plan, warnings } = composeComingSoon(spec, content, path.basename(stylePath));

    for (const w of warnings) console.warn(`⚠ ${w}`);

    if (command === "compose") {
      const json = JSON.stringify(plan, null, 2);
      if (typeof flags["out"] === "string") {
        fs.writeFileSync(flags["out"] as string, json, "utf8");
        console.log(`SlidePlan を書き出しました: ${flags["out"]}`);
      } else {
        console.log(json);
      }
      return;
    }

    // render
    if (typeof flags["plan-out"] === "string") {
      fs.writeFileSync(flags["plan-out"] as string, JSON.stringify(plan, null, 2), "utf8");
      console.log(`SlidePlan を書き出しました: ${flags["plan-out"]}`);
    }
    const result = await renderToSlides(spec, plan, {
      keepUploads: flags["keep-uploads"] === true,
      title: typeof flags["title"] === "string" ? (flags["title"] as string) : undefined,
    });
    console.log("\n✅ 生成しました:");
    console.log(`   ${result.presentationUrl}`);
    return;
  }

  throw new UsageError(`不明なコマンド: ${command}`);
}

run().catch((err) => {
  // エラー種別ごとに分かりやすいメッセージへ
  if (err instanceof SchemaValidationError) {
    console.error(`\n❌ 入力の検証に失敗しました。\n${err.message}`);
  } else if (err instanceof AuthError) {
    console.error(`\n❌ 認証エラー: ${err.message}`);
  } else if (err instanceof PerspectiveError) {
    console.error(`\n❌ 透視変換エラー: ${err.message}`);
  } else if (err instanceof ImageResolveError) {
    console.error(`\n❌ 画像エラー: ${err.message}`);
  } else if (err instanceof UsageError) {
    console.error(`\n❌ ${err.message}\n\n${usage()}`);
  } else {
    console.error(`\n❌ エラー: ${(err as Error).message}`);
  }
  process.exit(1);
});
