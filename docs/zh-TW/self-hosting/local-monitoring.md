---
title: 本機Grafana監控
sidebar:
  order: 7
---

使用預先建置的Grafana儀表板監控本機TomoriBot實例，以追蹤記憶體使用量、快取大小、令牌消耗和命令流量。

一起啟動TomoriBot和Grafana：

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

這個命令：
- 啟動TomoriBot和PostgreSQL（資料庫在連接埠15432上公開）
- 使用預先設定的PostgreSQL資料來源在連接埠3000上啟動Grafana
- 配置TomoriBot概覽儀表板
- 連接內部Docker網路上的所有服務

在 [http://localhost:3000](http://localhost:3000) 開啟Grafana：
- **使用者名稱**：`admin`
- **密碼**：透過`.env`中的`GRAFANA_PASSWORD`設定（未設定時預設為`admin`）

## 佈建好的儀表板

TomoriBot概述儀表板自動加載，無需手動配置。其面板顯示進程記憶體、快取條目計數、每小時錯誤、模型的令牌使用情況、每小時活動、頂級命令、使用者區域設定、情緒雲以及活動預設和模型。

每個面板都會查詢所有安裝中存在的標準表，從而允許相同的儀表板佈局在本地和雲端環境中工作。

某些面板需要特定的運行時設定或主機支援：

| 控制板 | 需求 |
|---|---|
| 進程記憶體、快取條目 | 每個`CACHE_METRICS_INTERVAL_MS`寫入`metric_samples`行。收集器僅在`RUN_ENV=production`時運行，因此開發實例此處不顯示任何資料。|
| 按類型劃分的每小時錯誤數 | `ERROR_DB_LOGGING_ENABLED`（預設啟用）。事件期間的平線可能表示資料庫斷路器已打開，而不是錯誤已停止。|
| 主機記憶體和交換層、主機壓力 (PSI) 和換入率 | Linux主機。這些內容為`/proc/meminfo`、`/proc/pressure/*`、`/proc/swaps`和`/sys/block/zram0`，因此它們在macOS和Windows上保持為空。zram系列需要配置zram交換設備；沒有zram的主機仍會報告一般記憶體和壓力指標。|

## 編輯與保留變更

儀表板在Grafana介面中保持可編輯狀態，以便進行即時調試。由於容器重新啟動會將儀表板編輯重設為磁碟文件，因此請匯出修改後的儀表板JSON並將其儲存到`docker/grafana/dashboards/`以保留變更。

若要新增儀表板，請將其JSON定義放置在`docker/grafana/dashboards/`中。使用固定uid `tomoribot-postgres`定位PostgreSQL資料來源：沒有明確uid的資料來源會接收隨機產生的標識符，這會導致儀表板使用不匹配的uid來呈現空白面板。
