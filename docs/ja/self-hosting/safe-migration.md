---
title: "安全な移行ガイド"
sidebar:
  order: 6
---

新しいコードを`git pull`してTomoriBotを再起動すると、ボットは起動時に自動的にデータベーススキーマの移行を実行します。これは強力であり、SQLの更新を手動で管理する必要がないことを意味しますが、同時に破壊的な操作がデータに静かに影響を与える可能性があることも意味します。このガイドでは、プルする前に自分自身を保護する方法を説明します。

## なぜこれが重要なのか

## カスタム表現メディアのバックアップ
<!-- anchor: custom-expression-media-backups -->

データベースのバックアップには、カスタム表現メタデータ、ペルソナメンバーシップ、およびストレージ参照が保持されます。アップロードまたはインポートされたメディアバイトは含まれません。データベースとメディアを一緒にバックアップする前に、ボットを停止してください。ローカルストレージを使用して、`data/custom-expressions/`をコピーし、同じ場所に復元します。GCSまたはS3を使用して、所有する`custom-expressions/`オブジェクトをバックアップし、構成された式バケットにそのキーを復元します。一致する`EXPRESSION_STORAGE_BACKEND`および`EXPRESSION_STORAGE_BUCKET`設定を復元します。バックエンドまたはバケットのみを変更すると、既存の参照が読み取れなくなります。リンク式はURLとしてのみ保存され、外部ホストに依存したままになります。Discord JSONエクスポートには、式レジストリやメディアアーカイブは含まれません。

## プル前のチェックリスト

`git pull`を実行する前に、以下の手順に従ってください。

1. **ボットの停止**：アクティブなデータベース接続がバックアップに干渉しないように、TomoriBotプロセスをシャットダウンします。
2. **データベースをバックアップし、キーを保持する**：以下の2つの方法のいずれかを使用してください。ダンプに必要なすべての暗号化バージョンの保護されたコピーを個別に保管し、使い捨てのデータベースで復元をテストしてください。
3. **現在のコミットの記録**：`git rev-parse HEAD`を実行し、ロールバックが必要になった場合に備えて出力を保存します。
4. **プルと再起動**：バックアップがディスク上に安全に保存されたら、プルと再起動を行っても安全です。

### 前提条件：`pgvector`拡張機能

フルバックアップはプレーンなSQLの`pg_dump`（`backupData.ts`は`pg_dump --clean --if-exists -f`を実行します）であるため、RAGに使用される`vector`型の`document_chunks`テーブルが含まれます。復元する前に、ターゲットのPostgresで`pgvector`拡張機能が利用可能である必要があります。そうでないと、ダンプの`CREATE EXTENSION IF NOT EXISTS vector`が実行できず、`document_chunks`テーブルの作成に失敗します。

ホスト上で一度インストールします（Postgresのメジャーバージョンに合わせてください）。例としてPostgres 16の場合は以下のようになります。

```bash
sudo apt-get install -y postgresql-16-pgvector
```

利用可能であることを確認します。

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

これなしで復元した場合：

- プロジェクトの`restore-backup`（および`ON_ERROR_STOP=1`を指定して実行した`psql -f`）は、`extension "vector" is not available`エラーで早期に中断し、データは読み込まれません。pgvectorをインストールして再試行してください。
- エラーを無視する（`ON_ERROR_STOP=0`）手動の`psql -f`の実行はさらに悪化します。失敗した`COPY public.document_chunks`がpsqlの入力パーサーの同期を乱し、その後の`COPY`データ行をSQLとして誤って解析してしまいます（`syntax error at or near …`の連鎖）。これにより、テーブル全体が静かに削除され（観測例：`documents`と`llms`）、データの一部が失われた不完全な復元データベースが残ってしまいます。失敗が直ちに表面化するように、必ず`ON_ERROR_STOP=1`を指定して復元してください。

### オプションA: プロジェクトのバックアップスクリプトを使用する

TomoriBotには2つのバックアップスクリプトが含まれており、それぞれ対象となるデータが異なります。

- **`bun run backup`**：データベーススキーマ全体とデータダンプ（ペルソナ、メモリー、設定などすべて）
- **`bun run backup:personas`**：ペルソナのプリセットとペルソナごとのサーバーメモリーのみ

安全に移行するには、フルバックアップを使用してください。

```bash
bun run backup
```

これにより、PostgreSQLデータベース全体がプレーンなSQLダンプとして含まれた、タイムスタンプ付きのバンドルが`backups/`（または`.env`でオーバーライドされている場合は`TOMORI_BACKUP_DIR`）に作成されます。このバンドルには `.env` やマスターシークレットは含まれません。復元する前に、ターゲットのシークレットソースに一致する暗号化バージョンを個別にプロビジョニングし、すべてのボットインスタンスを停止してください。完全な手順については、[データベースのバックアップと復旧キー](/ja/self-hosting/maintenance/#database-backups-and-recovery-keys) を参照してください。キーが不足しているか間違っている場合、破壊的なSQLが実行される前に復元が停止します。レガシーバンドルには生の `config.env` シークレットがまだ含まれています。個人的に確認し、自分でキーをプロビジョニングしてください。復元によってそのファイルがコピーされることはありません。後で復元するには、以下を実行します。

```bash
bun run restore-backup --latest
```

または、特定のバンドルから復元します。

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### 自動のローカルスタートアップバックアップ

本番環境以外（`RUN_ENV`が`production`に設定されていない場合）では、TomoriBotはデータベースの初期化が実行される前に、フルデータバックアップがあるかどうかも確認します。以下のいずれかの条件に当てはまる場合、`backupData.ts`と互換性のある自動バンドルを作成します。

- 最新のフルデータバックアップが、異なる`package.json`のボットバージョンによって作成された場合
- 最新のフルデータバックアップが、少なくとも`TOMORI_AUTO_BACKUP_INTERVAL_HOURS`前のものである場合（デフォルトは`24`）

自動バックアップは`bundle_info.json`で`backupType: "automatic"`とタグ付けされ、名前に`_auto`サフィックスが付きます。手動での`bun run backup`によるバンドルは`manual`とタグ付けされ、最新のバックアップチェックを満たすことはできますが、自動保持の対象には決してカウントされません。スタートアップ時のゲートは、最新の`TOMORI_AUTO_BACKUP_MAX`個（デフォルトは`5`）の自動バンドルを保持し、それより古い自動バンドルのみを削除します。

`pg_dump`のないマシンなどで、この安全ゲートなしでローカル/開発用ボットを起動する必要がある場合は、`.env`で`TOMORI_AUTO_BACKUP_ENABLED=false`を設定してください。

### オプションB: 直接`pg_dump`を実行する

手動での制御を好む場合は、PostgreSQLに組み込まれている`pg_dump`ユーティリティと、TomoriBot自身の環境変数を使用します。

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

これにより、カスタム形式のバイナリダンプ（SQLテキストよりもコンパクト）が保存されます。環境変数は`.env`と一致します。

- `POSTGRES_HOST`：デフォルトは`localhost`
- `POSTGRES_PORT`：デフォルトは`5432`
- `POSTGRES_USER`：DBのユーザー
- `POSTGRES_DB`：デフォルトは`tomodb`

復元するには、以下を実行します。

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

注意： `.pgpass`ファイル（PostgreSQLに組み込まれている認証情報ファイル）でパスワードを設定していない限り、`pg_restore`はパスワードの入力を求めてきます。

## CI経由でデプロイする貢献者向け：`(Checkpoint)`規則

AWSまたはGCPに`.github/workflows/deploy-{aws,gcp-legacy}.yml`のワークフロー経由でデプロイするフォークを保守している場合、これらのパイプラインはオプトインのデプロイ前スナップショットをサポートしています。コミットメッセージに`(Checkpoint)`という文字通りのトークンが含まれている場合、コードがデプロイされる前、かつ移行ランナーが起動時にデータベースに触れる前に、ワークフローは`aws rds create-db-snapshot`（またはGCP Cloud SQLの同等のコマンド）を実行します。

次の場合に使用します。

- カラムの削除、テーブルの削除、カラムの型変更など、データが失われる移行（OD-R-6の破壊的移行ポリシー）を行う場合。
- 複数の移行を組み合わせたリリースバンドルコミットを出荷し、単一のロールバックポイントを用意したい場合。
- キューに入れられた移行が安全かどうか不明な場合：疑わしい場合はチェックポイントを作成してください。

日常的な破壊的でないデプロイ（新しいカラム、新しいインデックス、シードデータの追加）についてはスキップしてください。スナップショットには実際のコストがかかり、日常的なパスには必要ありません。

コミットメッセージの例：

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

`(Checkpoint)`トークンは、件名または本文の任意の場所に記載できます。これはヘッドコミットのメッセージに対して大文字と小文字を区別して照合されます。アドホックなケースでは、ワークフローのバックアップ入力を有効にした手動ディスパッチも同じ働きをします。

## 移行が途中で失敗した場合の対処法

移行中にボットがクラッシュまたはハングアップした場合：

1. **すぐにボットを停止する**：ブラインド状態で移行を再試行させないでください。

2. **ログを確認する**：TomoriBotはデフォルトでstdout/stderrにログを出力します（プロセスマネージャーまたはDockerログによってキャプチャされます）。失敗した移行を示すエラーメッセージを探してください。出力例：

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **復元するかどうかを決定する**：エラーが回復不可能な場合（例：存在しないカラムを削除しようとした場合など）は、バックアップから復元します。

   ```bash
   # Option A restore
   bun run restore-backup --latest

   # Or Option B restore
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **コードをロールバックする**：最後に動作していたコミットに戻します。

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   プル前のチェックリストのステップ3で保存したハッシュを使用するか、以下を使用して見つけます。

   ```bash
   git log --oneline | head -20
   ```

5. **バグを報告する**：[github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) で問題を報告してください。以下を含めてください。
   - 失敗した移行のファイル名（ログから）
   - 完全なエラーメッセージ
   - 最後に成功したコミットのハッシュ
   - お使いのOS、Bunのバージョン（`bun --version`）、およびPostgreSQLのバージョン

## 自動的に回復不可能なもの

プロジェクトの設計（OD-R-6）に基づき、破壊的な移行は移行ランナーによってロールバックすることはできません。例：

- `DROP COLUMN name_here`：削除された行は永遠に失われます。SQLスクリプトでそれらを回復することはできません。
- `DROP TABLE old_table`：テーブル全体が消去されます。
- 型の縮小（例：`VARCHAR(255) → VARCHAR(100)`）：100文字を超える値は切り捨てられます。

これらの操作については、唯一の回復方法はバックアップです。古いバージョンを使用しており、新しいリファクタリングが出荷された場合は、プルする前に必ずバックアップを取ってください。

移行ランナーが前方のみ（forward-only）の設計になっているのは意図的なものです。テスト時の開発者の安全のためにロールバックファイル（`.down.sql`）は存在しますが、本番環境での回復にはバックアップと個別に保持された暗号化キーが使用されます。破壊的な移行を再実行しても、削除されたデータを復元することはできません。

## ブランチを試してから`main`に戻る

よくあるケースとして、誰かに既存のインストール環境でブランチをテストするよう頼まれ、そのブランチをチェックアウトして起動し、その後`main`に戻すことがデータベースに害を及ぼさないかを知りたい、というものがあります。

重要な事実：

- GitとPostgreSQLは別々の世界です。`git checkout`はディスク上のファイルを入れ替えるだけで、データベースに接続したり変更したりすることは一切ありません。PostgreSQLは適用された移行状態を `schema_migrations` テーブルに保存します。Gitブランチを切り替えても、そのテーブルは変更されません。
- 移行は（`initializeDatabase.ts`を介して）起動時に自動的に実行されるため、ブランチを起動した瞬間に、その新しい移行が接続先のデータベースに適用されます。
- 前方ランナーは決して自動ロールバックしません。`main`に戻ると、ランナーはディスク上のファイルをスキャンし、保留中のものが何もないことを確認して、何もしません。ブランチが適用した移行は、適用されたままです。

では安全なのか？ それは完全に、そのブランチの移行が何を行ったかによります。

- 追加のみ（新しいテーブル/新しいカラム）→安全です。新しいオブジェクトはただ未使用のまま存在するだけであり、`main`のコードはそれらを一切参照しないため、誤った結果やクラッシュを引き起こすことはありません。未使用のオブジェクトは、レビュー済みの移行を通じてのみ削除してください。
- 破壊的（`main`がまだ使用しているテーブルへの`DROP`/`RENAME`/`ALTER`）→安全ではありません。ブランチの変更によって、`main`のコードは今や存在しない、または変更されたカラム/テーブルに取り残されます。

最も安全なアプローチ： ブランチを使い捨てのデータベース（別の`POSTGRES_DB`）に向けることで、実際のデータには一切触れないようにします。接続はすでに`POSTGRES_*`の変数から構築しており、`bun run nuke-db`でスクラッチデータベースをリセットできます。

### テスト用の移行を手動でロールバックする

もし実際のデータベースに対してブランチをテストしてしまい、後でその移行を取り消したい場合は、ロールバックランナーを使用します。前方ランナーとは異なり、これは決して自動的には実行されません。`.down.sql`ファイルは通常データを失うものであるため、ロールバックは常に意図的な手動操作です。

```bash
# Preview only (dry run): show what would be rolled back
bun run migrate:down 034          # this migration + every newer applied one
bun run migrate:down --last       # only the most recently applied migration
bun run migrate:down --last=2     # the two most recently applied migrations

# Execute the rollback (runs the .down.sql files, removes schema_migrations rows)
bun run migrate:down 034 --yes
```

このコマンドは、選択された`.down.sql`ファイルを降順のバージョン順に実行し（ある移行の依存先が、その移行自体より先に取り消されるようにするため）、その後`schema_migrations`の該当する行を削除します。これらの行がなくなると、次にそれらの移行をまだ含むブランチを起動したときに、前方ランナーがその移行を再適用します。

> ブランチにいる間に実行してください。ロールバックはディスクから`NNN_description.down.sql`を読み込みます。`git checkout main`を実行すると、それらのファイルは失われ、ロールバックはもう実行できなくなります。ブランチを切り替える前に、先にロールバックしてください。

> それでもデータは失われます。ここで`034`をロールバックすると`DROP TABLE short_term_memories`が実行されます。テスト中に作成されたデータはすべて失われます。テストの後片付けとしては想定内ですが、保持しておきたいデータに対しては、バックアップなしで`migrate:down`を絶対に実行しないでください。

## 関連項目

- [データベーススキーマのドキュメント](/en/architecture/subsystems/database-schema/)：現在のスキーマ構造について学ぶ
- [Bunドキュメント](https://bun.sh)：Bunランタイムの基本を学ぶ
