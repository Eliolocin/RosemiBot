---
title: "安全迁移指南"
sidebar:
  order: 6
---

当你`git pull`拉到新代码并重启TomoriBot时，bot会在启动时自动运行数据库结构迁移。这很强大：意味着你不必手动管理SQL更新，但也意味着破坏性操作可能悄无声息地影响你的数据。这份指南告诉你拉取之前该怎么保护自己。

## 为什么这件事重要

TomoriBot的迁移执行器（在`src/db/migrationRunner.ts`）会按版本顺序执行所有尚未应用的迁移。迁移是只能向前的：一旦出问题，执行器不会自动回滚。大多数迁移是安全的扩展（新增列、新增表），但按项目内部的设计政策（OD-R-6），`DROP COLUMN`或`DROP TABLE`这类破坏性操作是被允许的。如果破坏性迁移在没有备份的情况下运行，你的数据会永久丢失。拿不准的时候，先备份。

## 自定义表达媒体备份
<!-- anchor: custom-expression-media-backups -->

数据库备份保留自定义表达式元数据、人格成员资格和存储引用。它们不包括上传或导入的媒体字节。在一起备份数据库和媒体之前停止机器人。使用本地存储，复制`data/custom-expressions/`并将其恢复到同一位置。使用GCS或S3，备份拥有的`custom-expressions/`对象并在配置的表达式存储桶中恢复其密钥。恢复匹配的`EXPRESSION_STORAGE_BACKEND`和`EXPRESSION_STORAGE_BUCKET`设置。单独更改后端或存储桶会使现有引用无法读取。链接表达式仅存储为URL，并且仍然依赖于其外部主机。Discord JSON导出不携带表达式注册表或媒体存档。

## 拉取前的检查清单

在运行`git pull`之前先做这些步骤：

1. **停掉bot**：关闭TomoriBot进程，这样就不会有活跃的数据库连接干扰备份。
2. **备份数据库并保留其密钥**：使用以下两种方法之一。保留转储所需每个加密版本的单独受保护副本，并在一次性数据库上测试恢复。
3. **记下当前提交**：运行`git rev-parse HEAD`并保存输出，以备需要回滚。
4. **拉取并重启**：备份安全落到磁盘之后，就可以放心拉取并重启了。

### 前提：`pgvector`扩展

完整备份是纯SQL的`pg_dump`（`backupData.ts`运行的是`pg_dump --clean --if-exists -f`），所以它包含RAG用到的`vector`类型`document_chunks`表。目标Postgres必须在你还原之前就具备`pgvector`扩展，否则转储里的`CREATE EXTENSION IF NOT EXISTS vector`无法执行，`document_chunks`表也创建失败。

在主机上安装一次（要匹配你的Postgres主版本），例如Postgres 16：

```bash
sudo apt-get install -y postgresql-16-pgvector
```

确认它可用：

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

如果没装就还原：

- 本项目的`restore-backup`（以及任何带`ON_ERROR_STOP=1`的`psql -f`）会提前中止，报
  `extension "vector" is not available`：不会载入任何数据。装好pgvector再重试。
- 手动`psql -f`且忽略错误（`ON_ERROR_STOP=0`）更糟：失败的`COPY public.document_chunks`会让
  psql的输入解析器错位，于是它把后面的`COPY`数据行误当成SQL解析（一连串
  `syntax error at or near …`）。这会悄悄丢掉整张表（已观察到：`documents`和`llms`），留下一个
  看起来完好、其实少了很多行的半还原数据库。还原时始终用`ON_ERROR_STOP=1`，让失败立刻暴露出来。

### 方案A：使用项目的备份脚本

TomoriBot自带两个备份脚本，各自针对不同的数据：

- **`bun run backup`**：完整的数据库结构加数据转储（人格、记忆、配置，全部内容）
- **`bun run backup:personas`**：只包含人格预设集和按人格区分的服务器记忆

为了安全迁移，请使用完整备份：

```bash
bun run backup
```

这会在 `backups/`（如果被 `.env` 覆盖，则为 `TOMORI_BACKUP_DIR`）中创建一个带有时间戳的捆绑包，其中包含作为纯 SQL 转储的整个 PostgreSQL 数据库。该捆绑包不包含 `.env` 或主密钥。在恢复之前，请在目标密钥源中单独配置匹配的加密版本，并停止所有机器人实例。有关完整步骤，请参阅[数据库备份和恢复密钥](/zh-CN/self-hosting/maintenance/#database-backups-and-recovery-keys)。缺失或错误的密钥会在执行破坏性 SQL 之前停止恢复。旧版捆绑包仍包含原始 `config.env` 密钥；请私下审查它们并自行配置其密钥。恢复绝不会复制该文件。要稍后恢复，请运行：

```bash
bun run restore-backup --latest
```

或者从指定的包还原：

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### 启动时的本地自动备份

在非生产环境（`RUN_ENV`未设为`production`）里，TomoriBot还会在数据库初始化运行之前检查是否存在完整数据备份。只要满足下面任一条件，它就会生成一个与`backupData.ts`兼容的自动备份包：

- 最新的完整数据备份是由另一个`package.json`里的bot版本创建的
- 最新的完整数据备份已经至少旧了`TOMORI_AUTO_BACKUP_INTERVAL_HOURS`（默认：`24`）

自动备份在`bundle_info.json`里标记为`backupType: "automatic"`，文件名带`_auto`后缀。手动`bun run backup`生成的包标记为`manual`；它们可以满足是否有最新备份的检查，但永远不会计入自动备份的保留数量。启动时的这道关卡会保留最新的`TOMORI_AUTO_BACKUP_MAX`个自动备份包（默认：`5`），并且只删除更旧的自动备份包。

如果你需要在不带这道安全关卡的情况下启动本地或开发用bot（例如在一台没有`pg_dump`的机器上），请在`.env`里设置`TOMORI_AUTO_BACKUP_ENABLED=false`。

### 方案B：直接用`pg_dump`

如果你更喜欢手动掌控，可以用PostgreSQL自带的`pg_dump`工具配合TomoriBot自己的环境变量：

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

它会保存一份自定义格式的二进制转储（比SQL文本更紧凑）。这些环境变量与你的`.env`一致：

- `POSTGRES_HOST`：默认`localhost`
- `POSTGRES_PORT`：默认`5432`
- `POSTGRES_USER`：你的数据库用户
- `POSTGRES_DB`：默认`tomodb`

还原：

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

注意： 除非你在`.pgpass`文件（PostgreSQL自带的凭据文件）里设置好密码，否则`pg_restore`会提示你输入。

## 给通过CI部署的贡献者：`(Checkpoint)`约定

如果你维护一个通过`.github/workflows/deploy-{aws,gcp-legacy}.yml`里的工作流部署到AWS或GCP的分支，这些流水线支持选择启用的部署前快照：当提交信息里包含字面量标记`(Checkpoint)`时，工作流会在任何代码被部署之前、也在启动时的迁移执行器碰到数据库之前，先运行`aws rds create-db-snapshot`（或GCP Cloud SQL的对应操作）。

这些情况下用它：

- 你要发布的迁移会删列、删表、改列类型，或者以其他方式丢数据（OD-R-6的破坏性迁移政策）。
- 你要发布一个合并了多个迁移的发布包提交，希望有一个统一回滚点。
- 你不确定排队中的迁移是否安全：拿不准就打检查点。

日常的非破坏性部署（新增列、新增索引、追加种子数据）可以跳过：快照有实打实的成本，而日常路径不需要它。

提交信息示例：

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

`(Checkpoint)`标记可以出现在标题或正文的任何位置：它会对头提交的信息做区分大小写的匹配。手动触发工作流并开启工作流的备份输入，是应对临时情况的同一根杠杆。

## 迁移中途失败了怎么办

如果bot在迁移期间崩溃或卡住：

1. **立刻停掉bot**：不要让它盲目重试迁移。

2. **看日志**：TomoriBot默认把日志写到stdout/stderr（由你的进程管理器或Docker日志捕获）。找那条点出失败迁移的错误信息。输出示例：

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **决定是否还原**：如果错误无法恢复（例如迁移试图删除一个并不存在的列），就从备份还原：

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

4. **回滚代码**：退回到最后一个可用的提交：

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   用你在拉取前检查清单第3步保存的哈希，或者用下面的命令找：

   ```bash
   git log --oneline | head -20
   ```

5. **报告问题**：到 [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) 提一个issue，附上：
   - 失败的迁移文件名（来自日志）
   - 完整的错误信息
   - 最后一个成功提交的哈希
   - 你的操作系统、Bun版本（`bun --version`）和PostgreSQL版本

## 哪些情况无法自动恢复

按项目的设计（OD-R-6），破坏性迁移无法被迁移执行器回滚。例如：

- `DROP COLUMN name_here`：被删的行永久丢失，没有任何SQL脚本能找回它们
- `DROP TABLE old_table`：整张表都没了
- 类型收窄（例如`VARCHAR(255) → VARCHAR(100)`）：超过100字符的值会被截断

对这类操作，唯一的恢复手段就是你的备份。如果你还在旧版本上，而新的重构已经发布，拉取之前一定要备份。

迁移运行器的仅向前设计是经过深思熟虑的：回滚文件（`.down.sql`）的存在是为了开发人员在测试期间的安全，但生产恢复依赖于备份及其单独保留的加密密钥。重新执行破坏性迁移无法恢复已删除的数据。

## 试完功能分支再回到`main`

常见情形：有人让你在现有安装上测一个分支，你想知道检出该分支、启动它、再切回`main`，会不会伤到你的数据库。

关键事实：

- Git 和 PostgreSQL 是两个独立的世界。`git checkout` 只会替换磁盘上的文件；它从不连接或修改你的数据库。PostgreSQL 将已应用的迁移状态存储在 `schema_migrations` 表中。切换 git 分支不会改变该表。
- 迁移会在启动时自动运行（通过`initializeDatabase.ts`），所以你一启动该分支，它的新迁移就会应用到你所指向的那个数据库上。
- 只能向前的执行器从不自动回滚。当你回到`main`时，它扫描磁盘上的文件，发现没有待应用的迁移，就什么都不做。分支应用过的迁移仍然处于已应用状态。

那它安全吗？ 这完全取决于该分支的迁移做了什么：

- **仅添加**（新表/新列）→ 安全。新对象只是闲置不用；`main` 的代码永远不会引用它们，因此它们不会导致错误的结果或崩溃。仅应通过经过审查的迁移来删除未使用的对象。
- 破坏性（对`main`仍在使用的表做`DROP`、`RENAME`、`ALTER`）→ 不安全。分支的改动会让`main`的代码面对一个已经消失或已被改动的列或表。

最稳妥的做法： 让该分支指向一个用完就扔的数据库（另设一个`POSTGRES_DB`），这样你的真实数据永远不会被碰到。你本来就用`POSTGRES_*`变量构建连接，而`bun run nuke-db`可以重置一个临时数据库。

### 手动回滚测试用的迁移

如果你在真实数据库上测过某个分支，事后想撤销它的迁移，就用回滚执行器。与只能向前的执行器不同，它从不自动运行：回滚永远是刻意的主动行为，因为`.down.sql`文件通常是有损的。

```bash
# Preview only (dry run): show what would be rolled back
bun run migrate:down 034          # this migration + every newer applied one
bun run migrate:down --last       # only the most recently applied migration
bun run migrate:down --last=2     # the two most recently applied migrations

# Execute the rollback (runs the .down.sql files, removes schema_migrations rows)
bun run migrate:down 034 --yes
```

该指令按递减的版本顺序运行选中的`.down.sql`文件（这样依赖它的迁移会先被撤销），然后删除对应的`schema_migrations`数据行。这些行被删掉之后，下次你启动一个仍然带着这些迁移的分支时，只能向前的执行器会重新应用它们。

> 请还在该分支上时运行它。回滚会从磁盘读取`NNN_description.down.sql`。一旦你`git checkout main`，那些文件就没了，回滚也就无法再执行。先回滚，再切分支。

> 它仍然是有损的。在这里回滚`034`会运行`DROP TABLE short_term_memories`，所以测试期间创建的任何数据都会消失。对测试清理来说这在意料之中，但绝不要在没有备份的情况下对你想保留的数据运行`migrate:down`。

## 另见

- [数据库结构文档](/en/architecture/subsystems/database-schema/)：了解当前的结构
- [Bun文档](https://bun.sh)：学习Bun运行时基础
