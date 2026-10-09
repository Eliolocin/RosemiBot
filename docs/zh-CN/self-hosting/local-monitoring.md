---
title: "本地Grafana监控"
sidebar:
  order: 7
---

使用预构建的Grafana仪表板监控本地TomoriBot实例，以跟踪内存使用情况、缓存大小、令牌消耗和命令流量。

一起启动TomoriBot和Grafana：

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

这个命令：
- 启动TomoriBot和PostgreSQL（数据库在端口15432上公开）
- 使用预配置的PostgreSQL数据源在端口3000上启动Grafana
- 配置TomoriBot概览仪表板
- 连接内部Docker网络上的所有服务

在 [http://localhost:3000](http://localhost:3000) 打开Grafana：
- **用户名**：`admin`
- **密码**：通过`.env`中的`GRAFANA_PASSWORD`设置（未设置时默认为`admin`）

## 自动置备的面板

TomoriBot概述仪表板自动加载，无需手动配置。其面板显示进程内存、缓存条目计数、每小时错误、模型的令牌使用情况、每小时活动、顶级命令、用户区域设置、情绪云以及活动预设和模型。

每个面板都会查询所有安装中存在的标准表，从而允许相同的仪表板布局在本地和云环境中工作。

某些面板需要特定的运行时设置或主机支持：

| 控制板 | 需求 |
|---|---|
| 进程内存、缓存条目 | 每个`CACHE_METRICS_INTERVAL_MS`写入`metric_samples`行。收集器仅在`RUN_ENV=production`时运行，因此开发实例此处不显示任何数据。|
| 按类型划分的每小时错误数 | `ERROR_DB_LOGGING_ENABLED`（默认启用）。事件期间的平线可能表明数据库断路器已打开，而不是错误已停止。|
| 主机内存和交换层、主机压力 (PSI) 和换入率 | Linux主机。这些内容为`/proc/meminfo`、`/proc/pressure/*`、`/proc/swaps`和`/sys/block/zram0`，因此它们在macOS和Windows上保持为空。zram系列需要配置zram交换设备； 没有zram的主机仍会报告一般内存和压力指标。|

## 修改与保留改动

仪表板在Grafana界面中保持可编辑状态，以便进行实时调试。由于容器重新启动会将仪表板编辑重置回磁盘文件，因此请导出修改后的仪表板JSON并将其保存到`docker/grafana/dashboards/`以保留更改。

要添加新仪表板，请将其JSON定义放置在`docker/grafana/dashboards/`中。使用固定uid `tomoribot-postgres`定位PostgreSQL数据源：没有显式uid的数据源会接收随机生成的标识符，这会导致仪表板使用不匹配的uid来呈现空白面板。
