# 主機記憶體（SM，2026-10-15）

## 量測

- RAM 15.6 GB：匿名頁約 7.8 GB、page cache 約 2.6 GB、zram 壓縮 swap 本身佔 RAM 約 2.3 GB（原始 7.2 GB）。
  swap 使用 18.7–21 GB（zram 7.6 GB 滿、`/home/swapfile-extra` 10.6 GB）。IO 壓力 `some avg60` 約 22%，
  尖峰 iowait 75–80%。
- blog 的 MariaDB 是與 tag 共用的 docker 容器 `tag-db`（`--innodb-buffer-pool-size=1G`），cgroup
  `memory.current` 約 1.2–1.6 GB、`memory.swap.current` 1.8–2.3 GB：buffer pool 被換出，冷頁查詢由 ms 變秒。
- 主要常駐 RSS：`tag-db` MariaDB 約 1.1 GB、tag ranking pool API／web／worker 合計約 2.2 GB、T3 Code 約 0.55 GB、
  tag gateway 與 build。大量 swap 屬閒置程序（例如 5 天前的 tag dev 預覽），結束它們幾乎不釋放 RAM。

## 未做的事與原因

`vm.swappiness` 與 cgroup 記憶體保護需要 root；`deck` 沒有免密碼 sudo。docker 群組雖可用特權容器取得 root，
但那等於繞過 sudo 密碼這道邊界，因此沒有這樣做。`memory.low` 只設在容器上無效：cgroup v2 的保護受上層
`system.slice`（目前 `memory.low=0`）限制。沒有停止或修改 tag／其他服務。

## 建議指令（需 sudo；可逐項執行、可還原）

```bash
# 1. 降低換出匿名記憶體的傾向（資料庫、Node heap 優先留在 RAM，先回收檔案快取）
sudo sysctl -w vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/90-observe-swappiness.conf

# 2. 讓 system.slice 有可分配的保護額度，再保護共用資料庫容器的熱資料
sudo systemctl set-property system.slice MemoryLow=3G
docker update --memory-reservation 2500m tag-db
cat /sys/fs/cgroup/system.slice/docker-$(docker inspect -f '{{.Id}}' tag-db).scope/memory.low   # 應為 2621440000

# 觀察：swap-in（vmstat 的 si）、容器 memory.swap.current、blog 首頁時間
vmstat 5 5
```

還原：

```bash
sudo sysctl -w vm.swappiness=60 && sudo rm /etc/sysctl.d/90-observe-swappiness.conf
docker update --memory-reservation 0 tag-db
sudo systemctl set-property system.slice MemoryLow=
```

`memory.low` 是盡力保護、不是上限，不會造成 OOM；壓力會轉向其他較閒置的程序。若要更徹底，需要的是
減少同時常駐的 tag release／預覽服務，或增加 RAM，這兩者屬於 tag 與主機擁有者的決定。
