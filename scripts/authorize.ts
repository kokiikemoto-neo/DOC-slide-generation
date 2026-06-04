// OAuth トークンだけを取得して token.json を保存する小さなコマンド。
//   npm run login
// 既に token.json があれば再利用（作り直したい場合は token.json を消してから実行）。
import { authorize } from "../src/render/auth.js";

authorize()
  .then(() => {
    console.log("\n✅ 認証が完了し token.json を保存しました。Cloud Run へはこの token.json を Secret として渡します。");
  })
  .catch((err) => {
    console.error(`\n❌ 認証に失敗しました: ${(err as Error).message}`);
    process.exit(1);
  });
